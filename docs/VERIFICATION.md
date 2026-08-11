# Odin ERP verification record

Verification date: 2026-08-11.

## Current release verification — PASSED

The verified application commit is `7d747fb26cacc7874bc8753e416156a0347a3aa9` on
`codex/enterprise-audit-access-hardening`. It was validated locally with Node `v24.14.0`, a clean
PostgreSQL 17 disposable database, the built Nest API on port 8081 and the built Next application on
port 8080. The evidence-only documentation commit is intentionally made after this immutable
application verification; it does not alter the tested application.

| Check | Result |
|---|---|
| Dependency install | PASS — `npm ci`, 983 packages in 16 seconds |
| Prisma | PASS — client generation and schema validation; 17 migrations applied cleanly and seed produced 12 users/6 items |
| TypeScript | PASS — `npm run lint` and explicit `npm run typecheck` for API and web |
| Localization audit | PASS — six categories all zero: missing keys/values, duplicates, hardcoded English, Arabic outside dictionary and suspicious values |
| Unit suite | PASS — 12 suites, 123 tests, 0 failures, 2.154 seconds |
| PostgreSQL integration suite | PASS — 6 suites, 66 tests, 0 failures, 11.481 seconds |
| Security suite | PASS — 13 suites, 159 tests, 0 failures, 12.496 seconds |
| Aggregate API suite | PASS — 18 suites, 189 tests, 0 failures, 12.75 seconds; selector totals overlap and are not summed |
| Integrity, before and after browser workflows | PASS — 5 posted journals; debit/credit `272830000`; ledger, inventory, AR and AP differences `0`; negative stock `0` |
| Production build | PASS — Nest and Next production builds; demo mode is compiled as `false` unless explicitly enabled |
| Dependency audit | PASS — 0 Critical, 2 reviewed High, 0 Moderate, 0 Low; `@nestjs/swagger`/`js-yaml` review expires 2026-09-08 |
| Static security scan | PASS — 143 tracked text files, public-file and demo-control checks, and production browser-asset scan; demo identities are absent from the production bundle |
| Chromium E2E | PASS — 33 scenarios: 31 passed, 0 failed, 2 staging-only scenarios skipped because `STAGING_BASE_URL` was unset (about 2 minutes 42 seconds) |
| Browser evidence | PASS — 11 fresh reproducible screenshots in ignored `artifacts/screenshots/`; coverage includes EN/AR dashboards, purchasing, navigation, sales, and mobile RTL access governance |
| Encrypted logical restore drill | PASS — 4 seconds; AES-256-CBC/PBKDF2-200000, mode `600`, checksum/catalog verification, 17 migrations, one tenant, zero unscoped runtime rows, two attachments/105 bytes and content manifest match, reconciliation and restored API startup |

The drill evidence is stored outside the repository at
`/private/tmp/odin-restore-evidence-release-final/restore-evidence.json`; it records backup SHA-256
`ff90dee6b69143c41e19d0c1792b227a2907f31b82b65429a1457b5ee8c54668` and attachment-manifest
SHA-256 `f370e7afa095e96301fab2fcb0d423f76865ca3c405b379a0eb43e691232f52c`. Its guarded cleanup
confirmed that the temporary restored database was removed.

This record maps the acceptance briefs to executable evidence. The current local release evidence is
the immutable application commit above. The prior
[Quality gate run 31256037111](https://github.com/mohammaddashraff/odin-erp/actions/runs/31256037111)
remains historical evidence for `b534bc240ff8033f4982ff6da01482f476f25fe9`. The browser suites are
`tests/e2e/odin-ui.spec.ts`, `tests/e2e/localization.spec.ts`, and `tests/e2e/access-security.spec.ts`;
backend controls are in `apps/api/src/*.spec.ts`; financial reconciliation is in
`apps/api/src/scripts/integrity.ts`.

## Historical automated evidence (2026-08-08)

| Check | Result |
|---|---|
| CI job status | PASS — verify, security, browser, and restore all completed successfully |
| PostgreSQL migrations | PASS — PostgreSQL 17 applied all 14 migrations to a clean database |
| NestJS/Jest backend controls | PASS — 10 suites, 84 tests, 0 failed |
| Negative data-scope matrix | PASS — database integration exercised `NONE`, `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and `ALL` against persisted documents; query-level unit matrix also passed |
| Negative live access | PASS — direct API checks denied wrong role, branch, warehouse, POS terminal, bank account, GL account, approval/document scope, export override, and hidden fields |
| Playwright real-UI acceptance | PASS — 25 Chromium scenarios, 25 passed, 0 failed, 0 skipped in 2.4 minutes |
| Browser evidence | PASS — [Playwright artifact 9021467648](https://github.com/mohammaddashraff/odin-erp/actions/runs/31256037111/artifacts/9021467648), retained 14 days |
| Encrypted backup restore | PASS — PostgreSQL 17 custom dump, AES-256-CBC/PBKDF2-200000 encryption, mode `600`, decrypt/checksum/catalog verification, and clean isolated restore |
| Restore validation | PASS — 5 seconds; 14 completed migrations; 1 tenant; 0 runtime rows without tenant scope; restored API/database healthy; reconciliation passed |
| Restore evidence | PASS — checksum `790bbc8e4d9b7c57a7de3c42e40c72ef3113917ac75cdaf96459ce07cab12fcb`; [artifact 9021437360](https://github.com/mohammaddashraff/odin-erp/actions/runs/31256037111/artifacts/9021437360), retained 35 days |
| Dependency/security gate | PASS — 0 Critical, 2 reviewed High, 0 Moderate, 0 Low; High decisions are exact, compensating-control documented, and expire 2026-09-08 |
| Critical access-control review | PASS — no unresolved Critical access-control finding; SEC-001 and SEC-002 are resolved |
| English direct-route audit | PASS — all 55 routes, headings, and breadcrumbs |
| Arabic direct-route audit | PASS — all 55 routes, headings, breadcrumbs, `lang="ar"`, and `dir="rtl"` |
| Purchasing localization | PASS — route, RFQ/supplier forms, validation, dialogs, dropdowns, reload, inverse English |
| Dynamic localization | PASS — finance forms, audit actions/entities, technical labels, and toast templates |
| TypeScript lint | PASS |
| Next.js and NestJS production builds | PASS |
| Trial balance | PASS — 9 posted journals; debit and credit both `272847000` minor units |
| Negative stock | PASS — `negativeStockRows=0` |
| Inventory control reconciliation | PASS — `inventoryDifferenceMinor=0` |
| AR reconciliation | PASS — `arDifferenceMinor=0` |
| AP reconciliation | PASS — `apDifferenceMinor=0` |
| Tenant isolation | PASS — PostgreSQL RLS and cross-tenant API tests |
| Posted/audit immutability | PASS — PostgreSQL trigger tests |

## Acceptance matrix

| Required workflow | Result | Evidence |
|---|---|---|
| Light mode and responsive application | PASS | UI test 1 and screenshot 01/02 |
| English and Arabic RTL | PASS | UI test 1 and screenshot 10 |
| Ten role-aware business modules | PASS | `odin-ui.spec.ts`, module-count and expansion test |
| Fifty-five directly addressable screens | PASS | English and Arabic direct-route tests |
| Legacy bookmark migration | PASS | Ten redirect checks; `docs/navigation-route-migration.md` |
| Complete Arabic Purchasing terminology | PASS | `localization.spec.ts`; RFQ Arabic screenshot |
| Purchase Request separated from supplier RFQ | PASS | UI form assertions, API document-type assertion, Prisma migration |
| Locale persistence during server rendering | PASS | Direct reload asserts cookie-backed `html[lang]` and `html[dir]` |
| Finance/admin dynamic localization | PASS | Journal/banking defaults, audit entities/actions, System Health labels, toasts |
| Master-data authoring | PASS | UI tests 2–4 |
| Sales chain and partial conversion | PASS | UI test 2; screenshots 03/04 |
| Sales posting, COGS, stock, VAT, AR | PASS | UI test 2 and integrity reconciliation |
| Customer payment allocation/statement/aging | PASS | UI test 2 |
| Sales return/credit reversal | PASS | UI test 2 |
| Purchase chain and partial conversion | PASS | UI test 3; screenshot 05 |
| Purchase bill, GRNI, VAT, AP, stock | PASS | UI test 3 and integrity reconciliation |
| Supplier payment/statement/aging | PASS | UI test 3 |
| Purchase return reversal | PASS | UI test 3 |
| Warehouse transfer and value preservation | PASS | UI test 4; screenshot 06 |
| Adjustment and stock-count variance | PASS | UI test 4 |
| Negative-stock prevention | PASS | UI/API/database controls |
| POS open/search/discount/hold/resume | PASS | UI test 5 |
| POS cash/card/split payment and receipt | PASS | UI test 5; screenshot 07 |
| POS stock/GL/return/shift close | PASS | UI test 5 |
| Draft multi-line journal workflow | PASS | UI test 6 |
| Balance/control/maker-checker controls | PASS | UI test 6 and backend tests |
| Posted immutability and linked reversal | PASS | UI test 6 and database controls |
| Fiscal close/reopen/closed posting block | PASS | UI test 6 |
| Cash and bank transactions/transfers | PASS | UI test 6 |
| Statement matching/reconciliation differences | PASS | UI test 6 |
| Approval inbox/history/comments | PASS | UI tests 2/7; screenshot 08 |
| Live reports, drill-down, CSV, PDF, print | PASS | UI tests 2/3/5/7 |
| Trial balance and control reconciliations | PASS | UI test 7; screenshot 09; integrity script |
| Auditor/cashier/warehouse permissions | PASS | UI test 7 and API checks |
| Cross-tenant isolation | PASS | backend test plus PostgreSQL RLS query |
| Append-only audit trail | PASS | UI test 7; screenshot 11; DB trigger test |
| Super Admin-only Users & Access | PASS | Direct route, hidden navigation, professional 403, and independent API 403 assertions |
| Multiple roles and explicit user overrides | PASS | Permission unit tests, effective-policy API tests, and Users page controls |
| Own/team record visibility | PASS | PostgreSQL integration tests, including team compatibility without branch widening |
| Sensitive-field redaction and write denial | PASS | PostgreSQL integration tests and browser/API checks |
| Responsive Arabic access administration | PASS | Dark-theme tablet/mobile RTL Playwright scenario with overflow assertions |
| Quotation conversion before order approval | PASS | Sales Manager Chromium workflow creates a draft quotation, converts it directly, then submits the resulting order for approval |
| Selected-tenant UI reset | PASS | UI test 1, password confirmation, integrity response |
| Persistence across refresh/user change | PASS | all serialized UI tests navigate and change sessions |

## PostgreSQL controls exercised

The automated integrity runner performs equivalent persisted-data checks to:

```sql
-- Every posted journal must balance.
SELECT COUNT(*) AS unbalanced_journals
FROM (
  SELECT journal_entry_id
  FROM journal_lines
  GROUP BY journal_entry_id
  HAVING SUM(debit_minor) <> SUM(credit_minor)
) AS exceptions;

-- Posted ledger totals must balance globally.
SELECT SUM(debit_minor) - SUM(credit_minor) AS trial_balance_difference_minor
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.status = 'POSTED';

-- No stock balance may be negative.
SELECT COUNT(*) AS negative_stock_rows
FROM stock_balances
WHERE quantity_milli < 0 OR value_minor < 0;
```

The runner additionally compares account 1200 to perpetual inventory, account 1100 to open
customer documents net of allocations/credits, and account 2000 to open supplier documents net of
allocations/returns. Every difference must be zero before reset reports success.

## Current redesign evidence files

Screenshots are generated in `artifacts/screenshots/` by the Playwright suite:

- `dashboard-en.png`
- `dashboard-ar.png`
- `purchasing-overview-en.png`
- `purchasing-overview-ar.png`
- `purchasing-rfq-en.png`
- `purchasing-rfq-ar.png`
- `navigation-collapsed-en.png`
- `navigation-mobile-en.png`
- `access-permissions-mobile-ar-dark.png`
- `inventory-overview-en.png`
- `sales-overview-mobile-ar.png`

Server-generated PDF samples are stored in `output/pdf/` during verification. Both directories are
ignored because they are reproducible test artifacts.

Current design references are review inputs, not execution evidence:

- `docs/design/odin-enterprise-semantic-dashboard-concept-v2.png` — accepted desktop reference using
  six KPIs available from the real dashboard API
- `docs/design/odin-enterprise-loading-system-concept-v2.png` — accepted loading reference with six
  KPI skeletons matching the real dashboard contract
- `docs/design/odin-enterprise-mobile-rtl-concept.png`
