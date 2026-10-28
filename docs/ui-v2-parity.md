# Replacement parity and verification ledger

The specification is an implementation requirement. This ledger distinguishes implementation from evidence. `IMPLEMENTED` is not a verification claim. The active local source/build and the existing public ERP service now use the replacement. The public cutover followed the user’s explicit authorization.

The baseline is Git `f7d7407` plus the existing user changes. The full original-work checkpoint is `54e6ac7c2d20a9b624126b8a2515dee60e36f89e` on `checkpoint/ui-original-with-user-work-2026-09-26`; a bundle is retained at `/srv/demo/backups/odin-before-ui-v2.bundle`.

The user answered **“create”** to the request for an isolated test environment. A separate local PostgreSQL instance and the unchanged API are used at loopback ports 5547 and 8183; the built replacement preview uses 8184 (initial development preview: 8182). Existing deployed services are untouched. Test credentials/secrets are kept outside this repository.

## Complete retained route inventory

All 61 routes are implemented using new page markup/components/CSS. Authentication and ten existing compatibility redirects are retained. Shared nonvisual authentication, permissions, translations, and exact formatters are reused. Route smoke coverage is separate from workflow verification below.

| Route | Surface | Required permission (any listed) | State | API/workflow family |
| --- | --- | --- | --- | --- |
| `/dashboard` | Executive Dashboard | `dashboard.overview.view` | VERIFIED | dashboard |
| `/sales/overview` | Sales Overview | `sales.overview.view` | VERIFIED | domain-overview |
| `/sales/customers` | Customers | `sales.customer.view` | VERIFIED | master-data |
| `/sales/quotations` | Quotations | `sales.quotation.view` | VERIFIED | documents |
| `/sales/orders` | Sales Orders | `sales.order.view` | VERIFIED | documents |
| `/sales/deliveries` | Deliveries | `sales.delivery.view` | VERIFIED | documents |
| `/sales/invoices` | Invoices | `sales.invoice.view` | VERIFIED | documents |
| `/sales/returns` | Returns | `sales.return.view` | VERIFIED | documents |
| `/sales/credit-notes` | Credit Notes | `sales.credit_note.view` | VERIFIED | documents |
| `/sales/customer-balances` | Customer Balances | `reports.standard.view` | VERIFIED | reports |
| `/purchasing/overview` | Purchasing Overview | `purchasing.overview.view` | VERIFIED | domain-overview |
| `/purchasing/suppliers` | Suppliers | `purchasing.supplier.view` | VERIFIED | master-data |
| `/purchasing/requests` | Purchase Requests | `purchasing.request.view` | VERIFIED | documents |
| `/purchasing/rfqs` | Requests for Quotation | `purchasing.rfq.view` | VERIFIED | documents |
| `/purchasing/orders` | Purchase Orders | `purchasing.order.view` | VERIFIED | documents |
| `/purchasing/receipts` | Goods Receipts | `purchasing.receipt.view` | VERIFIED | documents |
| `/purchasing/bills` | Supplier Bills | `purchasing.bill.view` | VERIFIED | documents |
| `/purchasing/returns` | Purchase Returns | `purchasing.return.view` | VERIFIED | documents |
| `/purchasing/supplier-balances` | Supplier Balances | `reports.standard.view` | VERIFIED | reports |
| `/inventory/overview` | Inventory Overview | `inventory.overview.view` | VERIFIED | domain-overview |
| `/inventory/items` | Items | `inventory.item.view` | VERIFIED | master-data |
| `/inventory/categories` | Categories | `inventory.item.view` | VERIFIED | master-data |
| `/inventory/units` | Units of Measurement | `inventory.item.view` | VERIFIED | master-data |
| `/inventory/warehouses` | Warehouses | `inventory.warehouse.view` | VERIFIED | master-data |
| `/inventory/transfers` | Warehouse Transfers | `inventory.transfer.view` | VERIFIED | documents |
| `/inventory/adjustments` | Stock Adjustments | `inventory.adjustment.view` | VERIFIED | documents |
| `/inventory/counts` | Stock Counts | `inventory.stock_count.view` | VERIFIED | documents |
| `/inventory/stock-card` | Stock Card | `reports.standard.view` | VERIFIED | reports |
| `/inventory/valuation` | Inventory Valuation | `reports.standard.view` | VERIFIED | reports |
| `/hr/employees` | Employees | `hr.employee.view` | VERIFIED | master-data |
| `/pos/workspace` | POS Workspace | `pos.register.view` | VERIFIED | pos |
| `/accounting/overview` | Accounting Overview | `accounting.overview.view` | VERIFIED | domain-overview |
| `/accounting/chart-of-accounts` | Chart of Accounts | `accounting.account.view` | VERIFIED | master-data |
| `/accounting/journals` | Journal Entries | `accounting.journal.view` | VERIFIED | accounting |
| `/accounting/periods` | Fiscal Periods | `accounting.period.view` | VERIFIED | accounting |
| `/accounting/general-ledger` | General Ledger | `accounting.journal.view` | VERIFIED | accounting |
| `/accounting/trial-balance` | Trial Balance | `reports.standard.view` | VERIFIED | reports |
| `/accounting/income-statement` | Income Statement | `reports.profitability.view` | VERIFIED | reports |
| `/accounting/balance-sheet` | Balance Sheet | `reports.profitability.view` | VERIFIED | reports |
| `/banking/overview` | Cash & Bank Overview | `banking.account.view` | VERIFIED | domain-overview |
| `/banking/accounts` | Cash & Bank Accounts | `banking.account.view` | VERIFIED | master-data |
| `/banking/allocations` | Receipts & Payments | `payments.receipt.view, payments.payment.view` | VERIFIED | payments |
| `/banking/transactions` | Bank Transactions & Transfers | `banking.transaction.view` | VERIFIED | banking |
| `/banking/statements` | Bank Statements | `banking.statement.view` | VERIFIED | banking |
| `/banking/reconciliation` | Bank Reconciliation | `banking.statement.reconcile` | VERIFIED | banking |
| `/approvals/inbox` | Approval Inbox | `approvals.queue.view` | VERIFIED | approvals |
| `/reports/overview` | Report Library | `reports.standard.view` | VERIFIED | reports |
| `/reports/sales` | Sales Reports | `reports.standard.view` | VERIFIED | reports |
| `/reports/purchasing` | Purchasing Reports | `reports.standard.view` | VERIFIED | reports |
| `/reports/inventory` | Inventory Reports | `reports.standard.view` | VERIFIED | reports |
| `/reports/accounting` | Accounting Reports | `reports.standard.view` | VERIFIED | reports |
| `/reports/banking` | Cash & Bank Reports | `reports.standard.view` | VERIFIED | reports |
| `/reports/pos` | POS Reports | `reports.standard.view` | VERIFIED | reports |
| `/admin/overview` | Administration Overview | `audit.business.view` | VERIFIED | domain-overview |
| `/admin/audit` | Audit Log | `audit.business.view` | VERIFIED | audit |
| `/settings/access/governance` | Access Governance | `settings.users_access.view` | VERIFIED | access |
| `/settings/access/users` | Users | `system.super_admin` | VERIFIED | access |
| `/settings/access/roles` | Roles | `system.super_admin` | VERIFIED | access |
| `/settings/access/permissions` | Permissions | `system.super_admin` | VERIFIED | access |
| `/settings/access/audit` | Access Audit Log | `system.super_admin` | VERIFIED | access |
| `/admin/system-health` | System Health | `settings.system.view` | VERIFIED | system-health |

## API contracts and interaction coverage

- **dashboard**: GET /dashboard.
- **domain-overview**: GET /sales/overview, /documents, /journals, /banking, or /audit by module.
- **master-data**: GET /bootstrap; GET /sales/customers or /hr/employees; POST /masters/:kind; PATCH /masters/customers/:id.
- **documents**: GET /sales/documents or /documents; GET /documents/:id; POST/PATCH /documents; POST :id/{submit,approve,reject,request-changes,comment,convert,post}; GET :id/pdf.
- **accounting**: GET/POST /journals; PATCH :id; POST :id/{submit,approve,post,reverse/create}; POST/PATCH /periods.
- **payments**: GET/POST /payments; POST :id/{approve,reject}.
- **banking**: GET /banking; POST /banking/{transactions,statements}; POST /banking/statement-lines/:id/match.
- **pos**: GET /pos; POST /pos/shifts; POST :id/close; POST /pos/sales; POST :id/{resume,return}; GET :id/pdf.
- **reports**: GET /reports/:report; GET :report/{csv,pdf}; GET /evidence/:reference.
- **audit**: GET /audit; guarded POST /system/reset.
- **approvals**: GET /approvals; document lifecycle endpoints.
- **system-health**: GET /health.
- **access**: GET /access and /access/companies; role/user mutations; GET effective; POST simulate/reviews.

## Critical workflow acceptance gate

| Workflow | Preserved semantics and validations | Current evidence/state |
| --- | --- | --- |
| Login, MFA and sessions | Same login/verify endpoints, browser token/refresh-hint keys, HttpOnly refresh cookie, remembered session, cross-tab logout, step-up and server permission enforcement. MFA enrollment secret/recovery codes remain available. | VERIFIED — `api-security.spec.ts`, `security-reports.spec.ts`, `attachments-mfa.spec.ts`: remembered cookie rotation/revocation, expiry refresh, cross-tab logout, twelve roles, MFA enrollment/TOTP/recovery reuse rejection and masked step-up. |
| Customers | Server search/status/branch/page, generated code, business/individual, contact and tax registration, addresses, branch, nullable credit/terms, hold, currency and tax treatment; field-level access respected. Detail includes documents, payments, statement, ageing, audit when provided. | VERIFIED create/edit/required validation/search/empty state/unsaved navigation in `routes.spec.ts` |
| Master records | Client search over entire bootstrap collection, local pagination; complete supplier/item/category/unit/warehouse/bank forms and original defaults; employee server search/status; account list read only. | VERIFIED — operations.spec.ts: supplier, item, category, unit, warehouse and bank creation; routes.spec.ts: customer create/edit; all English/Arabic direct routes include employees and read-only accounts. |
| Sales | Server type/search/status/branch/salesperson/currency/page/sort query. Quote/order create; exact integer previews, exchange rates/manual reason, branch employees/warehouses, terms/notes, price overrides. Edit locked by backend; draft retry retains ID. Approval maker/checker, partial linked conversion, post, invoice receivables, returns/credits and private attachments. | VERIFIED — `transactions.spec.ts`, `localized-workflows.spec.ts`, `attachments-mfa.spec.ts`: edit, approval, posting, partial conversions, returns/credits, exact journal/stock/source reconciliation, manual USD rate/reason, review decisions and attachment bytes. |
| Purchasing | Request → RFQ → order → goods receipt → bill/return; supplier and source-line links, remaining quantity, approval and posting. | VERIFIED — operations.spec.ts: all six linked stages, independent checker, supplier payment and posted return. |
| Inventory | Transfer destination, adjustment increase/decrease, counted vs system quantity; nonnegative counts and positive movement quantities, no client changes to posting rules. | VERIFIED — operations.spec.ts: positive adjustment, warehouse transfer and physical count, each approved/posted through the real UI. |
| Journals/periods | Posting accounts exclude control/nonposting accounts; balanced draft, description edit, submit/approve/post, dated reasoned reversal, create/close/reopen periods. Server validates locks and maker/checker. | VERIFIED — finance-pos.spec.ts: server rejection of an unbalanced entry, edit, independent approval/post, balanced reversal, and period create/close/reopen. |
| Receipts/payments | Posted remaining document allocation; exact decimal amount; receipts post, supplier payments require another checker; rejection reason validation. | VERIFIED — transactions.spec.ts and operations.spec.ts: invoice receipt and independently approved supplier allocation; backend payment-approval.database.spec.ts covers enforcement/rejection rules. |
| Banking | Receipt/payment/transfer with ledger counterparty; single-line statement import retained, opening/closing difference, matching compatible unreconciled movements and confirmation. | VERIFIED — finance-pos.spec.ts: bank movement, imported statement line and confirmed reconciliation. |
| POS | Branch/warehouse/register/opening cash; product search and Enter barcode; quantity/discount and exact/split tenders; hold/resume/return, receipt download and counted cash closing. | VERIFIED — finance-pos.spec.ts: barcode Enter, exact split tenders, receipt PDF, return, held cart/resume and counted-cash shift close. |
| Reports | All 18 existing reports; server calculations, fields/totals, reference evidence, CSV/PDF and print CSS. No fabricated charts or periods. | VERIFIED — security-reports.spec.ts: all 18 choices and 36 CSV/PDF downloads plus source evidence; localization-contracts.spec.ts: locale export bytes; visual.spec.ts: browser print. |
| Governance | Company/member selection clears prior evidence; effective grants/denials/scopes/fields/limits/sources, segregation warnings, safe preview, reasoned access review. User roles/overrides/MFA settings; role create/edit/duplicate/archive, scopes/assigned resources/fields/limits. | VERIFIED — security-reports.spec.ts: member context clearing, effective access, safe preview, reasoned review, role lifecycle and user MFA/explicit DENY persistence; api-security.spec.ts: assignment/redaction/scope/API denials. |
| Feedback/accessibility | Loading, empty vs no matches, errors/retry, denied screen, missing financial values not zero, native dialog trap/Escape/return, keyboard labels/focus, form guards and busy submits. | VERIFIED — `routes.spec.ts`, `visual.spec.ts`, `localized-workflows.spec.ts`: required fields, native dialog keyboard behavior, controlled pending/503/retry/no-match states, language and navigation guards, persisted normalized numbers. |
| Responsive/Arabic | Official local fonts, logical CSS, LTR lockup and isolated identifiers, mobile navigation, local table scroll and print. | VERIFIED — `visual.spec.ts`, `localized-workflows.spec.ts`, `localization-contracts.spec.ts`: all 61 Arabic routes, ten redirects, Western digits, 1366/1440/1920 desktop, tablet 768 and mobile 390, both directions and print. |

## Verification recorded in this implementation session

- Baseline lint: passed, `/tmp/odin-ui-v2/baseline-lint.log`.
- Baseline unit checks: 12 suites / 123 tests passed, `/tmp/odin-ui-v2/baseline-unit.log`.
- Unchanged backend against isolated DB: 19 suites / 190 tests passed, `/tmp/odin-ui-v2/backend-tests.log`. Existing PostgreSQL adapter deprecation warning remains.
- Replacement TypeScript check: passed after fixes, `/tmp/odin-ui-v2/frontend-typecheck.log`.
- Browser plugin not available. Installed agent-browser verified initial page identity/content/controls and absence of error overlays. Playwright executes actual API-connected workflows; `playwright.ui-v2.config.ts` targets only the local isolated preview.
- Preview gate: 28 of 29 passed together; the remaining role-navigation assertion expected the old submenu for a module with one authorized page. The corrected assertion verifies the actual destination and passed for all twelve roles. The strengthened exact financial-effect chain also passed. Failed runs remain failure evidence and are not counted as passes.

## Final active-build results

- The final release gate covers **34 unique passing acceptance tests**. The main run completed 32 passing tests before the runner was terminated with SIGTERM. Its remaining attachment/MFA group and the three strengthened completion checks then passed together: **5 passed, 0 failed, 0 skipped**. This is deliberately not described as one uninterrupted 34-test run.
- Earlier historical gates remain recorded: a complete 30-test run and six affected-editor regressions. They are not counted as new tests.
- Final root lint/typecheck, frontend production build, translation audit and security scan: **passed**. Translation/security findings: **0**.
- The unchanged backend's isolated-database result is **19 suites / 190 tests passed**. The release image also retains all 164 deployed backend files and the deployed dependency lock byte-for-byte.
- All 61 retained routes passed English and Arabic sweeps; ten legacy redirects and the manifest route were verified. Representative real screenshots are in `docs/ui-v2/screenshots`.
- Final review closed two gaps: dirty POS carts now require confirmation before navigation/language/sign-out or shift-form changes; mobile navigation contains keyboard focus, supports Escape/focus return, and makes its closed controls inert. Both languages pass a 200% desktop-zoom-equivalent editor check.
- Commands, per-test outcomes, build ID and active frontend source SHA-256 hashes are in [verification.json](ui-v2/verification.json).

## Active-app retirement

After the preview gate, the new source and approved assets moved into `apps/web`. Old ERP visual components, CSS files and logo were removed from the active source. `apps/web-v2` was removed. `@odin/web` package identity and existing build/deployment scripts remain intact. The original-work Git checkpoint and bundle retain all retired source.

Original `access-security.spec.ts` assertions are carried into `tests/ui-v2/api-security.spec.ts`; original formatter, locale export, digit and role checks are carried into the new localization/security suites. Original business UI flows now operate the replacement full-page editors and native dialogs. Old presentation selectors and dark-theme assertions are retired because those layouts are intentionally replaced. The independent nonvisual `tests/e2e/staging-business-workflow.spec.ts` is retained unchanged and remains an explicit opt-in test through `playwright.staging.config.ts`.

The active normal `npm run test:e2e` entrypoint now runs the replacement suite. Final active-path results are recorded in [verification.json](ui-v2/verification.json). See [migration and rollback](ui-v2-migration.md) for runtime setup and verification limits.

## Detailed contract notes

- **Queries:** sales documents retain `type`, `search`, `status`, `branchId`, `salespersonId`, `currency`, `page`, `pageSize=15`, `sort=updated`. Customers/employees keep their server searches. Generic document/master lists filter the entire returned collection before local 15-row pagination, preserving the API's collection limits.
- **Defaults and precision:** source defaults for branch/warehouse, currencies, commercial tax modes, unit prices, term dates, journal accounts and POS register/opening cash are retained. Financial previews use integer minor units/BigInt; a price omitted by API projection shows Restricted in the line and totals until an explicit known price is supplied; payload strings strip valid locale grouping only for explicitly named numeric fields. Invalid precision/grouping is still rejected by the API; identifiers and notes are not parsed as numbers.
- **Document state:** backend flags determine editing locks, maker/checker decisions and effects. Linked conversions submit original line IDs and requested quantities. Required decision/reversal reasons, exchange override reasons, count-vs-movement quantity rules and private-download tickets remain enforced.
- **Contexts:** pending resource requests cancel on path/session/locale change. Data is synchronously hidden when its requester/path or reference owner changes. Transient notifications are bound to the authenticated user object and cannot appear after switching accounts. Governance clears the prior member's preview/effective data; backend company-governance integration tests verify company A/B isolation. No unsupported global company switch was invented.
- **Keyboard:** Enter barcode lookup, native form submission, visible focus, sidebar expansion, Escape/trapping/return for dialogs, browser print, and Back/Cancel/link/context/unload form guards are covered. No claim is made that browser-history traversal has a custom router blocker.
- **Metadata:** `/manifest.webmanifest` remains installable metadata with ODIN ERP identity and the verified original mark; existing favicon compatibility URLs redirect to that packaged asset.

No requested application module remains unimplemented. The user subsequently authorized deployment to the existing ERP service. Physical devices and the explicit external staging suite remain outside the local gate; release status and limits are in the migration notes.

## Public deployment verification

After user authorization, the frontend-only image was deployed to [demo.odin-ltd.com](https://demo.odin-ltd.com). Chromium passed all 61 English routes, five representative Arabic routes, mobile focus/Escape behavior, and login/logout with no runtime errors. The smoke test blocked business-write requests and observed none. Health passed; ledger, inventory, AR and AP differences remain zero and match the pre-release baseline. Exact image/backend fingerprints and rollback information are in [deployment.json](ui-v2/deployment.json).
