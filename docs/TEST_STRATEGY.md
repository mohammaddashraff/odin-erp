# Test strategy

## Current tranche verification contract (2026-08-11)

Historical totals below remain valid only for their recorded commit. The enterprise access and UI/
localization tranche has no current PASS record yet. Its implementation may be classified as
**Implemented** or **Partially implemented**, but it becomes **Tested** only after the relevant
unit, PostgreSQL, direct-API and Chromium suites pass on the same immutable commit.

The root verification surface is `npm run lint`, `npm run typecheck`, `npm run db:validate`,
`npm run test:unit`, `npm run test:db`, `npm run test:security`, `npm test`, `npm run integrity`,
`npm run build`, `npm run i18n:audit`, `npm run security:audit`, `npm run security:scan` and the
selected local Playwright suites. `test:unit` excludes the legacy `database-controls.spec.ts` plus
the stable `*.database.spec.ts` naming class, `test:db` selects those files, and `test:security` uses
one anchored pattern for authorization, session/configuration, denial auditing, governance,
attachments, ERP direct-ID/field authorization, payment approval and persisted database controls.
The selector in `package.json` is authoritative; a security-relevant database suite must be in both
the database naming class and that anchored security selector.
`npm run lint` remains the existing workspace TypeScript gate; the explicit `typecheck`
alias makes the release command contract unambiguous. Database tests require PostgreSQL 17 and the
admin/runtime role URLs. Browser tests require the seeded database plus API on port 8081 and web
application on port 8080; the Playwright config does not start services automatically.

Required current-tranche regression evidence includes:

- Arabic UI text, dates, times, currencies, percentages, counts and inputs contain Western digits
  and no Arabic-Indic or Persian digit glyphs.
- Reduced-motion-safe navigation/loading, layout-shaped dashboard/table/form/chart skeletons,
  button busy states, modal/drawer transitions and responsive RTL layouts.
- Company Administrator boundaries, cross-company object/ID tampering, customer/supplier ownership,
  selected financial-resource assignments, temporary expiry, delegation envelopes, SoD warnings and
  hard assignment blocks, access review and effective-access simulation.
- Protected-field API projection/redaction and write denial, including document notes and journal
  lines; customer-detail dependency gates; private attachment authorization, ticket/download audit,
  UI exposure and direct unauthorized API attempts.
- Outgoing supplier-payment submission, zero pre-approval financial effect, checker authorization,
  maker/checker separation, reject reasons, amount authority, branch/company/bank/bill scope,
  atomic posting/allocation and terminal-state immutability. Customer receipts retain their existing
  immediate-post regression.
- Centralized limits across the implemented document/payment/journal scopes and the existing tenant,
  branch, warehouse, POS, output, MFA, session, accounting and reconciliation regressions.

Provider PITR, cross-region retention, IAM/KMS, scanner-provider operation and production attachment
recovery are **Requires external/provider evidence**, not repository test PASS conditions.

## Historical local baseline (2026-08-03)

- Jest: 8 suites, 49 tests; that local run had 5 suites/32 tests pass and 3 suites/17 tests fail.
- Sixteen failures were database connections blocked by the execution sandbox.
- One unit failure is deterministic test pollution: an invoice due 2026-07-31 is evaluated against the real 2026-08-03 clock and returns OVERDUE instead of UNPAID.
- Playwright: 23 scenarios; 21 local scenarios could not launch Chromium in the sandbox and 2 staging-only scenarios skipped.
- API and web TypeScript compile; web production build passes; full build cannot reach PostgreSQL migration step.

This baseline is retained only as history; it is superseded by the CI evidence below.

## Post-hardening verification (2026-08-08)

- [Quality gate run 31256037111](https://github.com/mohammaddashraff/odin-erp/actions/runs/31256037111) passed all four jobs: verify, security, browser and restore.
- PostgreSQL 17 applied all 14 migrations to a clean database; 10 Jest suites passed all 84 tests. The database suite includes a persisted negative matrix for `NONE`, `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and `ALL`.
- Chromium passed all 25 Playwright scenarios in 2.4 minutes with zero failures/skips. Live tests cover session rotation/logout, role/branch/warehouse/POS denial, unassigned bank/GL denial, explicit user `DENY`, field redaction, scoped CSV/PDF output, approval scope, security headers, localization and responsive access administration.
- The encrypted restore drill passed in five seconds: checksum/catalog verified, file mode `600`, 14 migrations compatible, zero unscoped runtime tenant rows, zero reconciliation differences and restored API/database health.
- The security job passed secret/demo/public-file and production-browser scans. Dependency audit recorded zero Critical, two reviewed High, zero Moderate and zero Low; decisions expire 2026-09-08 and the gate fails closed on audit-service errors.
- TypeScript lint, translation audit, Prisma validation, Next/Nest production builds and `git diff --check` pass.

## Test layers

| Layer | Scope | Gate |
|---|---|---|
| Unit | permission decisions/explanations, scope predicates, field projection, limits, state transitions, money/tax/FX/UOM, journal/reversal | no database/network; deterministic clock |
| Integration | PostgreSQL RLS, constraints, transactions, locks, idempotency, posting, allocations, migration sequence | disposable PostgreSQL 17; isolated tenant per test |
| API | authentication, exact permission, object scope, hidden fields, limits, status and safe errors | Supertest against real Nest module and database |
| E2E | local navigation/loading/access/localization and selected sales UI paths; deployed quote-to-cash scenarios when staging is configured | production build with disposable database and Chromium; staging tests are explicitly conditional |
| Security | unauthenticated/wrong tenant/company/branch/warehouse/record, IDOR, print/export/evidence/attachment, rate/session | required negative suite |
| Concurrency | stock, allocations, numbering, returns, approval, POS close, period close | parallel clients with invariant checks |
| Reconciliation | GL balance and AR/AP/inventory/cash/payroll/assets/tax/POS controls | zero unexplained difference |
| Performance | P50/P95/P99 API/report/database latency and query count | agreed production-shaped dataset |

## Remaining test priorities

1. Keep the unit/database/security selectors disjoint where intended, include every new stable
   security basename, and report overlap explicitly rather than summing overlapping suite totals.
2. Extend Company tests from current membership, party, branch, finance-object, attachment and
   direct-ID boundaries to the remaining tenant-level masters, dashboards, reports and outputs.
3. Keep private-attachment service/HTTP/database authorization, signed-download, UI and DB-backed
   restore coverage current; add real malware-scanner tests only when a provider is integrated.
4. Keep outgoing-payment approval tests at service/database depth and add a real browser
   maker/checker scenario; expand parallel-client invariants for payment approval, stock, allocation,
   numbering, POS close and period close.
5. Add provider-level PITR, cross-region retention, IAM/KMS and object-attachment restore evidence
   before production release.

## Evidence format

Every phase report includes command, environment, exact suite/test counts, skips, duration, failure reason, reconciliation figures and artifact links. Historical verification is labelled with its run date and cannot substitute for a current release run.
