# ODIN ERP audit fix log

Audit run: `2026-09-26-odin-audit`  
Base revision: `f7d740762be2c9235b5ea8557fdabd7ca90ed991` plus the uncommitted reviewable changes listed here.

## ODIN-FIN-001 — Trial balance reported period turnover instead of ending balances

- **Severity / module / impact:** P1, Accounting reports. Finance Manager, Accountant, Auditor, and
  other report viewers could read balanced but materially overstated trial-balance columns whenever
  an account had both debits and credits in the period.
- **Environment / affected roles:** isolated PostgreSQL 17 audit database; report-authorized roles.
- **Preconditions and reproduction:** create a tax-free company; post opening bank/equity, inventory
  receipt and supplier bill, delivery/COGS, sales invoice, customer receipt, and supplier payment;
  request `trial-balance` over the complete period.
- **Expected:** net ending balances with debit total 11,200 and credit total 11,200.
- **Actual before fix:** raw account turnover produced debit total 13,700 and credit total 13,700.
- **Evidence / source:** deterministic independent values in `ACCOUNTING_RECONCILIATION.md`;
  regression in `apps/api/src/accounting-reference.database.spec.ts`; report implementation in
  `apps/api/src/erp.service.ts` (`report`, trial-balance branch).
- **Root cause:** the trial-balance branch reused accumulated debit/credit activity instead of
  assigning each account's net `balanceMinor` to one ending-balance column.
- **Fix:** calculate each nonzero account net balance, place positive balances in debit and negative
  balances in credit, and total the displayed rows. General/account ledgers still show turnover.
- **Verification:** `npm test` in the Node 24 audit container: **19 suites, 190 tests passed, 0
  failed**; the reference assertion observes 11,200/11,200. Status: **VERIFIED_PASS**.
- **Remaining limits:** opening-balance presentation by arbitrary report start date and every UI
  export combination were not independently recalculated in this run.

## ODIN-OPS-001 — Database backup omitted the runtime PostgreSQL role prerequisite

- **Severity / module / impact:** P1, Operations/backup. A clean disaster restore produced 58 RLS
  policy restore errors and was not independently usable until an operator guessed the missing role.
- **Environment / affected role:** `odin-demo` backup, disposable PostgreSQL 17 restore; server
  operator/database administrator.
- **Preconditions and reproduction:** run the old `scripts/backup-deployment.sh`; restore the custom
  dump with `pg_restore --exit-on-error --no-owner` into a new PostgreSQL 17 cluster that does not
  already contain `odin_app`.
- **Expected:** documented backup artifacts contain every non-secret prerequisite needed to restore
  schema, data, grants, and RLS policies.
- **Actual before fix:** restore stopped on policies because role `odin_app` did not exist.
- **Evidence / source:** initial dump `/srv/demo/backups/odin-20260926T111333Z.dump`; 58 affected RLS
  policies; backup implementation `scripts/backup-deployment.sh`.
- **Root cause:** `pg_dump` does not include cluster-global roles and the script did not create a
  companion bootstrap artifact.
- **Fix:** every backup now creates a mode-0600, password-free `.roles.sql` companion with an
  idempotent, least-privilege `odin_app` role bootstrap; retention handles both artifact types.
- **Verification:** backup pair `odin-20260926T113036Z.dump` plus its role companion restored into a
  clean disposable PostgreSQL 17 cluster. Result: 1 tenant, 12 users, 5 journals, 17 migrations and
  58 RLS policies. Status: **VERIFIED_PASS**.
- **Remaining limits:** backups remain local to this host; off-site copies, encryption-at-rest of the
  dump, provider PITR, retention immutability and recovery monitoring need operational decisions.

## ODIN-SEC-001 — Deployed dependency tree contained Critical and High advisories

- **Severity / module / impact:** P1, application dependencies/security. All users were potentially
  exposed to framework and multipart-parser defects under advisory-specific request conditions.
- **Environment / affected roles:** repository dependency tree and server demo build; all roles and
  unauthenticated entry points.
- **Preconditions and reproduction:** run `npm audit --json` on the original lockfile and the
  repository `npm run security:audit` gate.
- **Expected:** no unresolved Critical or unreviewed High advisory in the release dependency tree.
- **Actual before fix:** 1 Critical, 11 High, and 2 Moderate advisories, including affected Next.js
  and Nest/Express multipart dependencies.
- **Evidence / source:** sanitized audit details in
  `artifacts/audit/2026-09-26/logs/npm-audit-details.json`; `package.json`, `package-lock.json`,
  `apps/web/package.json`, and `apps/api/package.json`.
- **Root cause:** pinned framework and transitive dependency versions predated available patched
  releases.
- **Fix:** Next.js 16.3.6, Nest platform-express 11.2.6, Swagger 11.4.7, Prisma 7.10.0, and bounded
  overrides for patched `deepmerge-ts` and `mysql2`; no major framework migration.
- **Verification:** dependency audit reports **0 Critical, 0 High, 0 Moderate, 0 Low**; security scan,
  TypeScript checks, production build, and the 190-test full gate pass. Status: **VERIFIED_PASS**.
- **Remaining limits:** advisories are time-sensitive; CI must continue running the audit gate and
  overrides should be removed when their parent dependencies consume fixed versions.

## ODIN-DEP-001 — PostgreSQL driver emits nested-query deprecation warning

- **Severity / module / impact:** P3, data access/maintainability. Current queries pass, but the
  adapter behavior is deprecated and may break after a future `pg` 9 upgrade.
- **Environment / affected roles:** Node 24 test container, Prisma adapter-pg 7.10.0, database suites;
  all workflows that open the affected transaction path.
- **Preconditions and reproduction:** run the full database-backed Jest suite with Node deprecation
  tracing enabled.
- **Expected:** no driver deprecation warning.
- **Actual:** `Calling client.query() when the client is already executing a query is deprecated`.
- **Evidence / source:** `artifacts/audit/2026-09-26/logs/pg-deprecation-trace.log`; trace enters the
  Prisma PostgreSQL query interpreter rather than ODIN application code.
- **Root cause:** upstream `@prisma/adapter-pg`/driver interaction during transaction execution.
- **Recommended implementation:** track the Prisma adapter fix, retest on a patched compatible
  release, and keep `pg` below the incompatible major until the warning is removed.
- **Verification:** warning reproduced while all **190/190** tests passed. Status:
  **VERIFIED_FAIL** for warning removal; no current functional failure.
- **Remaining limits:** no safe local application patch was identified; suppressing the warning would
  hide upgrade risk and was intentionally avoided.
