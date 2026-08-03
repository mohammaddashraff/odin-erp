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

const accepted = {
  next: {
    reviewBy: '2026-09-03',
    sources: [],
    reason: 'Next 16.2.12 is the current release; npm reports only its pinned PostCSS and optional Sharp dependency advisories. No Server Actions, dynamic CSS/source-map processing, Next Image, or user image uploads are used.',
  },
  postcss: {
    reviewBy: '2026-09-03',
    sources: [1117015, 1124252, 1124288],
    reason: 'Pinned by current Next.js and used only during trusted repository builds; Odin does not process attacker-controlled CSS or source maps.',
  },
  sharp: {
    reviewBy: '2026-09-03',
    sources: [1124066],
    reason: 'Optional Next.js dependency; Odin does not use next/image or process attacker-controlled images. Upgrade when Next supports Sharp 0.35.',
  },
};

const failures = [];
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
