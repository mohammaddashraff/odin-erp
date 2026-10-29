import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, process.env.ODIN_UI_SOURCE || 'apps/web/src');
// Bundle the small dictionary entry points in memory. This keeps extensionless
// TypeScript imports portable across Windows and POSIX without temporary files.
const loadTypescriptModule = async file => {
  const output = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
};
const { translationCatalog, enumLabel } = await loadTypescriptModule(resolve(sourceRoot, 'core/i18n.ts'));
const { uiCopy } = await loadTypescriptModule(resolve(sourceRoot, 'core/ui-copy.ts'));
const { adminCopy } = await loadTypescriptModule(resolve(sourceRoot, 'core/admin-copy.ts'));
const { av8Copy } = await loadTypescriptModule(resolve(sourceRoot, 'core/av8-copy.ts'));
const dictionaries = { ...translationCatalog, replacement: uiCopy, administration: adminCopy, av8: av8Copy };
const entries = Object.entries(dictionaries).flatMap(([namespace, values]) => Object.entries(values).map(([key, value]) => ({namespace, key, value})));
const issues = {missingKeys: [], missingValues: [], duplicateKeys: [], hardcodedVisibleEnglish: [], arabicOutsideDictionary: [], suspiciousArabicValues: []};
const brandCopy = new Set(['AV8 ERP','AV8 / ERP','AV8 ERP · ODIN Software Solutions','ODIN ERP · OSS.', 'OSS. Odin Software Solutions / ERP — ODIN ERP', 'Odin Software Solutions', 'OSS. / ERP', '/ ERP', 'odin software solution']);
const technical = /^(?:OSS\.?|ODIN(?: ERP)?|ERP|EN|English|PDF|CSV|SKU|VAT|MFA|TOTP|EGP|USD|EUR|ID|IP|IBAN|USB-C|YYYY-MM-DD|CAI|CAI-MAIN|ALX|[A-Z]{2,}-\d+)$/;
const allowedLatin = /\b(?:ODIN|ERP|PDF|PNG|JPEG|WebP|UTF-8|CSV|SKU|IBAN|IP|USB-C|YYYY-MM-DD|MFA|TOTP|OSS|PostgreSQL|NestJS|Prisma|Next|RESET)\b/g;
const sourceFiles = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? sourceFiles(resolve(dir, e.name)) : /\.tsx?$/.test(e.name) ? [resolve(dir, e.name)] : []);
const visibleProps = new Set(['label', 'title', 'subtitle', 'placeholder', 'aria-label', 'caption', 'submitLabel', 'hint']);
function check(text, file) {
  if (/[A-Za-z]/.test(text) && !technical.test(text) && !brandCopy.has(text) && enumLabel(text, 'ar') === text) issues.missingKeys.push(`${relative(root,file)}: ${text}`);
}
for (const file of sourceFiles(sourceRoot)) {
  const normalizedFile = file.replaceAll('\\', '/');
  if (normalizedFile.endsWith('/core/av8-copy.ts') || normalizedFile.endsWith('/core/admin-copy.ts') || normalizedFile.endsWith('/core/i18n.ts') || normalizedFile.endsWith('/core/ui-copy.ts') || normalizedFile.endsWith('/core/accounting-copy.ts') || normalizedFile.endsWith('/core/accounting-report-copy.ts')) continue;
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['tr', 't', 'notify'].includes(n.expression.text) && ts.isStringLiteral(n.arguments[0])) check(n.arguments[0].text, file);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fieldSpec' && n.arguments[1] && ts.isStringLiteral(n.arguments[1])) check(n.arguments[1].text, file);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ((file.endsWith('report-schema.ts') && ['column','field'].includes(n.expression.text)) || (file.includes('/screens/av8') && n.expression.text==='f')) && n.arguments[1] && ts.isStringLiteral(n.arguments[1])) check(n.arguments[1].text,file);
    if (ts.isPropertyAssignment(n) && visibleProps.has(n.name.getText(ast).replaceAll('"','').replaceAll("'",'')) && ts.isStringLiteral(n.initializer)) check(n.initializer.text, file);
    if (ts.isJsxAttribute(n) && visibleProps.has(n.name.getText(ast)) && n.initializer && ts.isStringLiteral(n.initializer)) check(n.initializer.text, file);
    if (ts.isStringLiteral(n) && /[\u0621-\u064a]/.test(n.text) && n.text !== 'العربية') issues.arabicOutsideDictionary.push(`${relative(root,file)}: ${n.text}`);
    if (ts.isJsxText(n)) {
      const text = n.text.trim();
      if (/[A-Za-z]/.test(text) && !technical.test(text) && !brandCopy.has(text)) issues.hardcodedVisibleEnglish.push(`${relative(root,file)}: ${text}`);
    }
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
for (const entry of entries) {
  if (!entry.value.trim()) issues.missingValues.push(`${entry.namespace}: ${entry.key}`);
  // Accepted CSV header keys must remain literal, even in translated help.
  const value=entry.key==='Required columns: name, phone, source. Optional columns: email, campaign, program.'?entry.value.replace(/\b(?:name|phone|source|email|campaign|program)\b/g,''):entry.value;
  if (/[A-Za-z]{3,}/.test(value.replace(allowedLatin, ''))) issues.suspiciousArabicValues.push(entry);
}
// Duplicate properties inside one dictionary are mistakes; separate namespaces
// may intentionally provide context-specific wording for the same English key.
for (const name of ['i18n.ts','ui-copy.ts','accounting-copy.ts','accounting-report-copy.ts','admin-copy.ts','av8-copy.ts']) {
  const file = resolve(sourceRoot, 'core', name);
  const ast = ts.createSourceFile(file, readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true);
  function visit(n) {
    if (ts.isObjectLiteralExpression(n)) {
      const seen = new Set();
      for (const p of n.properties) if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        if (seen.has(p.name.text)) issues.duplicateKeys.push(`${name}: ${p.name.text}`);
        seen.add(p.name.text);
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(ast);
}
for (const key of Object.keys(issues)) issues[key] = [...new Set(issues[key])];
const review = process.argv.includes('--report') ? entries.map(e => ({...e, textOverflowRisk:e.value.length > Math.max(36,e.key.length*2.4)})) : undefined;
console.log(JSON.stringify({summary:Object.fromEntries(Object.entries(issues).map(([k,v])=>[k,v.length])),issues,...(review ? {review} : {})},null,2));
if (Object.values(issues).some(v => v.length)) process.exitCode = 1;
