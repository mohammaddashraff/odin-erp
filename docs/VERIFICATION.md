# Odin ERP verification record

This record maps the acceptance briefs to executable evidence. The authoritative browser suites are
`tests/e2e/odin-ui.spec.ts` and `tests/e2e/localization.spec.ts`; backend controls are in
`apps/api/src/*.spec.ts`; financial reconciliation is in `apps/api/src/scripts/integrity.ts`.

## Automated evidence

| Check | Result |
|---|---|
| Playwright real-UI acceptance | PASS — 21 local Chromium scenarios, 0 failed; 2 deployment-only staging scenarios skipped without staging configuration |
| Browser server responses | PASS — no HTTP 5xx responses captured |
| Browser console | PASS — no unexpected console errors |
| English direct-route audit | PASS — all 55 routes, headings, and breadcrumbs |
| Arabic direct-route audit | PASS — all 55 routes, headings, breadcrumbs, `lang="ar"`, and `dir="rtl"` |
| Purchasing localization | PASS — route, RFQ/supplier forms, validation, dialogs, dropdowns, reload, inverse English |
| Dynamic localization | PASS — finance forms, audit actions/entities, technical labels, and toast templates |
| NestJS/Jest backend controls | PASS — 8 suites, 49 tests |
| TypeScript lint | PASS |
| Next.js and NestJS production builds | PASS |
| PostgreSQL migrations | PASS — all 9 migrations applied in sequence to a clean database, including the additive enterprise access-control migration |
| Trial balance | PASS — total debit equals total credit |
| Negative stock | PASS — no negative quantity or value |
| Inventory control reconciliation | PASS — ledger equals perpetual valuation |
| AR reconciliation | PASS — control ledger equals open customer subledger |
| AP reconciliation | PASS — control ledger equals open supplier subledger |
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

Server-generated PDF samples are stored in `output/pdf/` during verification. Both directories are
ignored because they are reproducible test artifacts.
