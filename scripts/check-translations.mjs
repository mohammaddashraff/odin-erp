import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dictionaryPath = resolve(root, 'apps/web/src/app/i18n.ts');
const uiPaths = [
  resolve(root, 'apps/web/src/app/odin-app.tsx'),
  resolve(root, 'apps/web/src/app/sales-workspace.tsx'),
  resolve(root, 'apps/web/src/app/access-workspace.tsx'),
];
const dictionary = readFileSync(dictionaryPath, 'utf8');
const keyPattern = /(?:^|[,{]\s*)'((?:[^'\\]|\\.)+)':\s*'((?:[^'\\]|\\.)*)'/gm;
const entries = [...dictionary.matchAll(keyPattern)].map((match) => ({ key: match[1], value: match[2] }));
const keys = new Set(entries.map(({ key }) => key));
const duplicateKeys = [...Map.groupBy(entries, ({ key }) => key)]
  .filter(([, values]) => values.length > 1 && new Set(values.map(({ value }) => value)).size > 1)
  .map(([key]) => key);
const missing = new Set();
const hardcoded = [];
const unexpectedArabic = [];

for (const path of uiPaths) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'([^']+)'\s*,/g)) if (!keys.has(match[1])) missing.add(match[1]);
  for (const match of source.matchAll(/>([A-Za-z][A-Za-z0-9 &/.,'’:-]{2,})</g)) {
    const value = match[1].trim();
    if (!/^(ODIN|ODIN ERP|ERP|EN|PDF|CSV|NestJS|Next\.js|PostgreSQL|Prisma)$/.test(value)) hardcoded.push(`${path.replace(`${root}/`, '')}: ${value}`);
  }
  for (const match of source.matchAll(/[\u0600-\u06ff][\u0600-\u06ff\s]+/g)) {
    const value = match[0].trim();
    if (value && value !== 'العربية') unexpectedArabic.push(`${path.replace(`${root}/`, '')}: ${value}`);
  }
}

const suspiciousArabic = entries.filter(({ key, value }) => /[A-Za-z]{3,}/.test(value)
  && !/ODIN|ERP|PDF|CSV|SKU|IBAN|IP|USB-C|YYYY-MM-DD/.test(value)
  && key !== 'Password: password');
const issues = {
  missingKeys: [...missing].sort(),
  missingValues: entries.filter(({ value }) => !value.trim()).map(({ key }) => key).sort(),
  duplicateKeys: duplicateKeys.sort(),
  hardcodedVisibleEnglish: [...new Set(hardcoded)].sort(),
  arabicOutsideDictionary: [...new Set(unexpectedArabic)].sort(),
  suspiciousArabicValues: suspiciousArabic,
};

const review = process.argv.includes('--report') ? entries.map(({ key, value }) => ({
  key,
  english: key,
  arabic: value,
  missing: !value.trim(),
  duplicate: duplicateKeys.includes(key),
  suspiciousUntranslated: suspiciousArabic.some((entry) => entry.key === key),
  textOverflowRisk: value.length > Math.max(36, key.length * 2.4),
})) : undefined;
console.log(JSON.stringify({ summary: Object.fromEntries(Object.entries(issues).map(([key, values]) => [key, values.length])), issues, ...(review ? { review } : {}) }, null, 2));
if (Object.values(issues).some((values) => values.length)) process.exitCode = 1;
