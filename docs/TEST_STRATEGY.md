# Test strategy

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
| E2E | administrator configuration and complete business workflows in English/Arabic | production build with disposable database and Chromium |
| Security | unauthenticated/wrong tenant/company/branch/warehouse/record, IDOR, print/export/evidence/attachment, rate/session | required negative suite |
| Concurrency | stock, allocations, numbering, returns, approval, POS close, period close | parallel clients with invariant checks |
| Reconciliation | GL balance and AR/AP/inventory/cash/payroll/assets/tax/POS controls | zero unexplained difference |
| Performance | P50/P95/P99 API/report/database latency and query count | agreed production-shaped dataset |

## Remaining test priorities

1. Split pure unit tests from database suites so local prerequisite failures cannot obscure unit status.
2. Add negative Company-scope tests when the normalized Company model is introduced.
3. Add private-attachment authorization, malware-scan and signed-download tests before attachment storage is implemented.
4. Expand parallel-client invariant tests for stock, allocation, numbering, approval, POS close and period close.
5. Add provider-level PITR, cross-region retention, IAM/KMS and object-attachment restore evidence before production release.

## Evidence format

Every phase report includes command, environment, exact suite/test counts, skips, duration, failure reason, reconciliation figures and artifact links. Historical verification is labelled with its run date and cannot substitute for a current release run.
