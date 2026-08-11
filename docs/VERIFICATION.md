# Odin ERP verification record

Verification date: 2026-08-08.

## Current tranche status — verification pending

The successful record below is preserved as historical evidence for application commit
`b534bc240ff8033f4982ff6da01482f476f25fe9`. It does **not** verify the current enterprise access,
Western-digit localization, loading, semantic-color, dashboard or documentation tranche. Do not
copy its PASS labels, totals, artifact IDs or duration into the next release record. Replace this
section only after the current commit is built and exercised in the required environment.

| Current-tranche scope | Classification | Evidence state |
|---|---|---|
| Named typecheck and migration-validation entry points | Implemented | Root `npm run typecheck` and `npm run db:validate` commands exist; full-tranche execution is pending |
| Western-digit Arabic web/API/export policy | Implemented | Central locale resolution uses `ar-EG-u-nu-latn`; formatter/full-route/input/export evidence remains pending |
| Loading/skeletons, semantic palette and module identity | Partially implemented | Architecture and accepted design concepts are recorded; route integration and regression evidence must be reconciled with the final application diff |
| Company/security governance, field projection and private attachment repository controls | Implemented | Additive code is present, but no current-tranche PASS claim is permitted before database, API-tampering and browser reruns; broader limits remain partial |
| Current clean migration replay and all automated suites | Not implemented | A new immutable commit/CI run, exact totals, failures/skips and durations have not yet been recorded |
| Provider PITR, cross-region retention, IAM, KMS and production attachment recovery | Requires external/provider evidence | Repository tests and a logical restore drill cannot establish these provider controls |

The current tranche must execute, at minimum, from the repository root:

```bash
npm ci
npm run db:generate
npm run db:validate
npm run db:migrate
# npm run db:seed  # disposable verification database only; never production
npm run lint
npm run typecheck
npm run i18n:audit
npm run test:unit
npm run test:db
npm run test:security
npm test
npm run integrity
npm run build
npm run security:audit
npm run security:scan
npx playwright test tests/e2e/odin-ui.spec.ts tests/e2e/localization.spec.ts tests/e2e/access-security.spec.ts --project=chromium
git diff --check
```

Record the PostgreSQL version and migration count, Jest suites/tests, Playwright tests/skips,
reconciliation values, command durations, failure reasons, screenshots and final Git SHA. Run the
encrypted restore drill separately when its PostgreSQL 17 source/restore URLs and ephemeral key are
available.

This record maps the acceptance briefs to executable evidence. The authoritative release evidence is
[Quality gate run 31256037111](https://github.com/mohammaddashraff/odin-erp/actions/runs/31256037111),
which completed successfully for branch head `b534bc240ff8033f4982ff6da01482f476f25fe9`. The browser suites are
`tests/e2e/odin-ui.spec.ts`, `tests/e2e/localization.spec.ts`, and `tests/e2e/access-security.spec.ts`;
backend controls are in `apps/api/src/*.spec.ts`; financial reconciliation is in
`apps/api/src/scripts/integrity.ts`.

## Automated evidence

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
