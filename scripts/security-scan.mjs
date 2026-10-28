import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const webRoot = join(root, process.env.ODIN_UI_APP || 'apps/web');
const textExtensions = new Set(['', '.cjs', '.css', '.env', '.example', '.html', '.js', '.json', '.md', '.mjs', '.prisma', '.sql', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}\b/],
];

let scanned = 0;
for (const file of tracked) {
  const absolute = join(root, file);
  if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size > 2_000_000 || !textExtensions.has(extname(file))) continue;
  const content = readFileSync(absolute, 'utf8');
  scanned += 1;
  for (const [label, pattern] of secretPatterns) if (pattern.test(content)) failures.push(`${label}: ${file}`);
}

const publicRoot = join(webRoot, 'public');
const exposedExtensions = new Set(['.db', '.dump', '.env', '.key', '.pem', '.pfx', '.p12', '.sql', '.sqlite']);
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
for (const file of walk(publicRoot)) if (exposedExtensions.has(extname(file).toLowerCase())) failures.push(`sensitive public file: ${relative(root, file)}`);

const loginSource = readFileSync(join(webRoot, 'src/components/login.tsx'), 'utf8');
if (/admin@odin\.demo|Password: password/.test(loginSource)) failures.push('demo credentials exposed in login UI');
if (/useState\(['"]admin@odin\.demo['"]\)/.test(loginSource)) failures.push('demo account is the unconditional production login default');
const seedSource = readFileSync(join(root, 'apps/api/prisma/seed.ts'), 'utf8');
if (!seedSource.includes("if (!demoResetEnabled()) throw new Error('Demo seed is disabled for production deployments.')")) failures.push('demo seed lacks a production deployment guard');

const builtStatic = join(webRoot, process.env.ODIN_UI_BUILD_DIR || '.next', 'static');
if (existsSync(builtStatic) && process.env.NEXT_PUBLIC_ODIN_DEMO_MODE !== 'true') {
  for (const file of walk(builtStatic)) {
    if (!['.js', '.json'].includes(extname(file))) continue;
    if (readFileSync(file, 'utf8').includes('admin@odin.demo')) failures.push(`demo account leaked into production browser asset: ${relative(root, file)}`);
  }
}

if (failures.length) {
  console.error(`Security scan failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Security scan passed: ${scanned} repository text files, high-confidence secrets, public files, demo controls, and production browser assets checked.`);
}
