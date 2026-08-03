# Test strategy

## Original baseline

- Jest: 8 suites, 49 tests; current run 5 suites/32 tests passed and 3 suites/17 tests failed.
- Sixteen failures were database connections blocked by the execution sandbox.
- One unit failure is deterministic test pollution: an invoice due 2026-07-31 is evaluated against the real 2026-08-03 clock and returns OVERDUE instead of UNPAID.
- Playwright: 23 scenarios; 21 local scenarios could not launch Chromium in the sandbox and 2 staging-only scenarios skipped.
- API and web TypeScript compile; web production build passes; full build cannot reach PostgreSQL migration step.

## Post-hardening verification

- Jest now contains 53 tests. The six database-independent suites pass all 37 tests; this includes the corrected fixed `asOf` receivables case and new exact-output/POS-scope tests.
- The remaining two suites contain 16 database tests. They were attempted with escalated host access and fail only because no PostgreSQL server is listening at `127.0.0.1:5433`; Docker Desktop is also not running, so this environment cannot provide the prerequisite service.
- `npm run build` passes for both workspaces. Build performs client generation and compilation only; `npm run release:migrate` is the explicit release migration/bootstrap step.
- TypeScript lint, translation audit and `git diff --check` pass.
- Playwright remains environment-blocked: Chromium cannot launch under the available macOS sandbox and the required application/database services are unavailable.

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

## Immediate test corrections

1. Continue injecting/passing an `asOf` clock in every ageing/overdue unit test; the observed receivables case is corrected.
2. Split pure unit tests from database tests so a DB outage does not hide unit status.
3. Add route metadata coverage and navigation-key registry tests.
4. Extend the initial POS-query and exact document/report output tests with database-backed negative tests for POS objects, approvals, evidence field redaction and bank-account scope.
5. Run database suites in CI with PostgreSQL 17 and Node 24.
6. Start API/web automatically for local Playwright or fail with an explicit prerequisite message.

## Evidence format

Every phase report includes command, environment, exact suite/test counts, skips, duration, failure reason, reconciliation figures and artifact links. Historical verification is labelled with its run date and cannot substitute for a current release run.
