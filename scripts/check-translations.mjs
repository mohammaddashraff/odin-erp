import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { tsImport } from 'tsx/esm/api';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, process.env.ODIN_UI_SOURCE || 'apps/web/src');
const { translationCatalog, enumLabel } = await tsImport(pathToFileURL(resolve(sourceRoot, 'core/i18n.ts')).href, import.meta.url);
const { uiCopy } = await tsImport(pathToFileURL(resolve(sourceRoot, 'core/ui-copy.ts')).href, import.meta.url);
const { adminCopy } = await tsImport(pathToFileURL(resolve(sourceRoot, 'core/admin-copy.ts')).href, import.meta.url);
const dictionaries = { ...translationCatalog, replacement: uiCopy, administration: adminCopy };
const entries = Object.entries(dictionaries).flatMap(([namespace, values]) => Object.entries(values).map(([key, value]) => ({namespace, key, value})));
const issues = {missingKeys: [], missingValues: [], duplicateKeys: [], hardcodedVisibleEnglish: [], arabicOutsideDictionary: [], suspiciousArabicValues: []};
const brandCopy = new Set(['ODIN ERP · OSS.', 'OSS. Odin Software Solutions / ERP — ODIN ERP', 'Odin Software Solutions', 'OSS. / ERP', '/ ERP', 'odin software solution']);
const technical = /^(?:OSS\.?|ODIN(?: ERP)?|ERP|EN|English|PDF|CSV|SKU|VAT|MFA|TOTP|EGP|USD|EUR|ID|IP|IBAN|USB-C|YYYY-MM-DD|CAI|CAI-MAIN|ALX|[A-Z]{2,}-\d+)$/;
const allowedLatin = /\b(?:ODIN|ERP|PDF|CSV|SKU|IBAN|IP|USB-C|YYYY-MM-DD|MFA|TOTP|OSS|PostgreSQL|NestJS|Prisma|Next|RESET)\b/g;
const sourceFiles = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? sourceFiles(resolve(dir, e.name)) : /\.tsx?$/.test(e.name) ? [resolve(dir, e.name)] : []);
const visibleProps = new Set(['label', 'title', 'subtitle', 'placeholder', 'aria-label', 'caption', 'submitLabel', 'hint']);
function check(text, file) {
  if (/[A-Za-z]/.test(text) && !technical.test(text) && !brandCopy.has(text) && enumLabel(text, 'ar') === text) issues.missingKeys.push(`${relative(root,file)}: ${text}`);
}
for (const file of sourceFiles(sourceRoot)) {
  if (file.endsWith('/core/admin-copy.ts') || file.endsWith('/core/i18n.ts') || file.endsWith('/core/ui-copy.ts') || file.endsWith('/core/accounting-copy.ts') || file.endsWith('/core/accounting-report-copy.ts')) continue;
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['tr', 't', 'notify'].includes(n.expression.text) && ts.isStringLiteral(n.arguments[0])) check(n.arguments[0].text, file);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fieldSpec' && n.arguments[1] && ts.isStringLiteral(n.arguments[1])) check(n.arguments[1].text, file);
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
  if (/[A-Za-z]{3,}/.test(entry.value.replace(allowedLatin, ''))) issues.suspiciousArabicValues.push(entry);
}
// Duplicate properties inside one dictionary are mistakes; separate namespaces
// may intentionally provide context-specific wording for the same English key.
for (const name of ['i18n.ts','ui-copy.ts','accounting-copy.ts','accounting-report-copy.ts','admin-copy.ts']) {
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
