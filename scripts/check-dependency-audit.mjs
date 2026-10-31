import { spawnSync } from 'node:child_process';

const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('Dependency audit did not return valid JSON.');
  console.error(audit.stderr || audit.stdout);
  process.exit(1);
}
if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || typeof report.metadata?.vulnerabilities !== 'object') {
  console.error('Dependency audit returned an error or incomplete report.');
  console.error(report?.message || audit.stderr || audit.stdout);
  process.exit(1);
}

const failures = [];
// No standing High-risk exceptions. Any future advisory requires an explicit reviewed decision.
const accepted = {};

const today = new Date().toISOString().slice(0, 10);
const vulnerabilities = report.vulnerabilities || {};
for (const [name, finding] of Object.entries(vulnerabilities)) {
  const severity = String(finding.severity || '').toLowerCase();
  if (!['high', 'critical'].includes(severity)) continue;
  if (severity === 'critical') {
    failures.push(`unresolved Critical advisory: ${name}`);
    continue;
  }
  const exception = accepted[name];
  if (!exception) {
    failures.push(`unreviewed High advisory: ${name}`);
    continue;
  }
  if (today > exception.reviewBy) failures.push(`expired advisory decision: ${name} (${exception.reviewBy})`);
  const sources = (finding.via || []).filter((entry) => typeof entry === 'object').map((entry) => Number(entry.source)).sort((a, b) => a - b);
  if (exception.sources.length && JSON.stringify(sources) !== JSON.stringify(exception.sources)) failures.push(`advisory set changed for ${name}: ${sources.join(', ')}`);
  console.warn(`RISK_ACCEPTED ${name} ${severity.toUpperCase()} review-by=${exception.reviewBy}: ${exception.reason}`);
}

const counts = report.metadata?.vulnerabilities || {};
console.log(`Dependency audit observed ${counts.critical || 0} Critical, ${counts.high || 0} High, ${counts.moderate || 0} Moderate, ${counts.low || 0} Low advisories.`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Dependency audit gate passed: no Critical or unreviewed High advisory is unresolved.');
