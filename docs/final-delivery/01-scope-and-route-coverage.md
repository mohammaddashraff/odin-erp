# Scope and route coverage

Baseline source: `828ae27bd17682739d192115ed163781f2388bea`; inventory date 31 October 2026. The authoritative IDE checkout was unavailable at discovery; source was cloned into an isolated temporary checkout. The user confirmed that main contains the latest work.

This is a maintained inventory, not a completion certificate. Rows begin **required and still incomplete / NOT RUN**. Source review, rendered-route evidence, backend invariant checks and actual browser actions are recorded separately; one does not imply the others. Existing tests and historical release notes are candidates, not evidence of a current pass.

## Current counts

- 78 registered page routes across 12 module groups.
- 10 legacy redirects and 4 special route families.
- 180 controller endpoint declarations (refreshed after implementation).
- 582 lexical control/component declarations, 127 literal client request expressions, 61 query-state references, 70 Prisma models.
- Compiled local render acceptance passed 312/312 variants. Named action workflows have separate evidence; final exact-commit aggregate verification is recorded in the release evidence.

[Machine-readable source inventory](source-coverage.json), [route matrix CSV](route-coverage.csv), [endpoint matrix CSV](endpoint-coverage.csv). The JSON retains a source location, request wiring, permissions and evidence/status fields. Lexical controls include shared component definitions and dynamic templates. All 582 current declarations and their shared workflow handlers have a semantic source-review group in [control-review.json](control-review.json). Decorative icon matches and demo-only controls are distinguished. Individual runtime branches remain NOT RUN unless actual action evidence is attached. Counts of control declarations are not counts of independently verified user actions.

## Registered routes

| ID | Module | Route | Entry permission | Screen source | Result |
|---|---|---|---|---|---|
| av8-appointments | av8 | `/av8/appointments` | `av8.leads.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-leads | av8 | `/av8/leads` | `av8.leads.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-students | av8 | `/av8/students` | `av8.applications.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-affairs | av8 | `/av8/affairs` | `av8.affairs.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-finance | av8 | `/av8/finance` | `av8.finance.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-reports | av8 | `/av8/reports` | `av8.reports.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| av8-settings | av8 | `/av8/settings` | `av8.policies.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| dashboard | command | `/dashboard` | `av8.workspace.view` | `screens/av8.tsx`, `screens/av8-student.tsx`, `screens/av8-funds.tsx`, `screens/av8-policies.tsx`, `screens/av8-lead-import.tsx` | Render PASS 4/4 |
| sales-overview | sales | `/sales/overview` | `sales.overview.view` | `screens/overview.tsx` | Render PASS 4/4 |
| customers | sales | `/sales/customers` | `sales.customer.view` | `screens/masters.tsx` | Render PASS 4/4 |
| sales-quotations | sales | `/sales/quotations` | `sales.quotation.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| sales-orders | sales | `/sales/orders` | `sales.order.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| deliveries | sales | `/sales/deliveries` | `sales.delivery.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| sales-invoices | sales | `/sales/invoices` | `sales.invoice.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| sales-returns | sales | `/sales/returns` | `sales.return.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| credit-notes | sales | `/sales/credit-notes` | `sales.credit_note.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| customer-balances | sales | `/sales/customer-balances` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| purchasing-overview | purchasing | `/purchasing/overview` | `purchasing.overview.view` | `screens/overview.tsx` | Render PASS 4/4 |
| suppliers | purchasing | `/purchasing/suppliers` | `purchasing.supplier.view` | `screens/masters.tsx` | Render PASS 4/4 |
| purchase-requests | purchasing | `/purchasing/requests` | `purchasing.request.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| purchase-rfqs | purchasing | `/purchasing/rfqs` | `purchasing.rfq.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| purchase-orders | purchasing | `/purchasing/orders` | `purchasing.order.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| goods-receipts | purchasing | `/purchasing/receipts` | `purchasing.receipt.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| supplier-bills | purchasing | `/purchasing/bills` | `purchasing.bill.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| purchase-returns | purchasing | `/purchasing/returns` | `purchasing.return.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| supplier-balances | purchasing | `/purchasing/supplier-balances` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| inventory-overview | inventory | `/inventory/overview` | `inventory.overview.view` | `screens/overview.tsx` | Render PASS 4/4 |
| items | inventory | `/inventory/items` | `inventory.item.view` | `screens/masters.tsx` | Render PASS 4/4 |
| categories | inventory | `/inventory/categories` | `inventory.item.view` | `screens/masters.tsx` | Render PASS 4/4 |
| units | inventory | `/inventory/units` | `inventory.item.view` | `screens/masters.tsx` | Render PASS 4/4 |
| warehouses | inventory | `/inventory/warehouses` | `inventory.warehouse.view` | `screens/masters.tsx` | Render PASS 4/4 |
| transfers | inventory | `/inventory/transfers` | `inventory.transfer.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| adjustments | inventory | `/inventory/adjustments` | `inventory.adjustment.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| counts | inventory | `/inventory/counts` | `inventory.stock_count.view` | `screens/documents.tsx`, `screens/document-editor.tsx` | Render PASS 4/4 |
| stock-card | inventory | `/inventory/stock-card` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| valuation | inventory | `/inventory/valuation` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| hr-overview | hr | `/hr/overview` | `hr.employee.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| employees | hr | `/hr/employees` | `hr.employee.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| departments | hr | `/hr/departments` | `hr.department.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| attendance | hr | `/hr/attendance` | `hr.attendance.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| leave | hr | `/hr/leave` | `hr.leave.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| payroll | hr | `/hr/payroll` | `hr.payroll.view` | `screens/hr.tsx`, `screens/employee-profile.tsx` | Render PASS 4/4 |
| pos-workspace | pos | `/pos/workspace` | `pos.register.view` | `screens/pos.tsx` | Render PASS 4/4 |
| accounting-overview | accounting | `/accounting/overview` | `accounting.overview.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| chart-of-accounts | accounting | `/accounting/chart-of-accounts` | `accounting.account.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| journals | accounting | `/accounting/journals` | `accounting.journal.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| periods | accounting | `/accounting/periods` | `accounting.period.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| general-ledger | accounting | `/accounting/general-ledger` | `accounting.journal.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| trial-balance | accounting | `/accounting/trial-balance` | `reports.standard.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| income-statement | accounting | `/accounting/income-statement` | `reports.profitability.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| balance-sheet | accounting | `/accounting/balance-sheet` | `reports.profitability.view` | `screens/accounting-overview.tsx`, `screens/chart-of-accounts.tsx`, `screens/accounting-journals.tsx`, `screens/accounting-periods.tsx`, `screens/accounting-reports.tsx` | Render PASS 4/4 |
| banking-overview | banking | `/banking/overview` | `banking.account.view` | `screens/overview.tsx` | Render PASS 4/4 |
| bank-accounts | banking | `/banking/accounts` | `banking.account.view` | `screens/masters.tsx` | Render PASS 4/4 |
| payment-allocations | banking | `/banking/allocations` | `payments.receipt.view` OR `payments.payment.view` | `screens/finance.tsx` | Render PASS 4/4 |
| bank-transactions | banking | `/banking/transactions` | `banking.transaction.view` | `screens/finance.tsx` | Render PASS 4/4 |
| bank-statements | banking | `/banking/statements` | `banking.statement.view` | `screens/finance.tsx` | Render PASS 4/4 |
| bank-reconciliation | banking | `/banking/reconciliation` | `banking.statement.reconcile` | `screens/finance.tsx` | Render PASS 4/4 |
| approval-inbox | approvals | `/approvals/inbox` | `approvals.queue.view` | `screens/documents.tsx` | Render PASS 4/4 |
| reports-overview | reports | `/reports/overview` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| sales-reports | reports | `/reports/sales` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| purchasing-reports | reports | `/reports/purchasing` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| inventory-reports | reports | `/reports/inventory` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| accounting-reports | reports | `/reports/accounting` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| banking-reports | reports | `/reports/banking` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| pos-reports | reports | `/reports/pos` | `reports.standard.view` | `screens/reports.tsx` | Render PASS 4/4 |
| admin-overview | admin | `/admin/overview` | `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-users | admin | `/settings/access/users` | `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-roles | admin | `/settings/access/roles` | `system.super_admin` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| audit-log | admin | `/admin/audit` | `audit.business.view` OR `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| advanced | admin | `/admin/advanced` | `settings.users_access.view` OR `settings.system.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| authority-limits | admin | `/settings/access/limits` | `system.super_admin` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| profile | admin | `/my-profile` | `authenticated` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-new-user | admin | `/settings/access/users/new` | `system.super_admin` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-governance | admin | `/settings/access/governance` | `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-permissions | admin | `/settings/access/permissions` | `system.super_admin` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-audit | admin | `/settings/access/audit` | `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| access-reviews | admin | `/settings/access/reviews` | `settings.users_access.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |
| system-health | admin | `/admin/system-health` | `settings.system.view` | `screens/administration.tsx`, `screens/access.tsx`, `screens/authority-limits.tsx` | Render PASS 4/4 |

## Existing modules remain in scope

Sales, purchasing, suppliers, inventory, HR (employees, departments, attendance, leave and payroll), POS, accounting, treasury, approvals, reporting and administration are present and remain in scope. No route has been removed or declared optional.

## Deep links, tabs and meaningful actions

[Named real browser workflow evidence](browser-action-coverage.json) distinguishes current action proofs from all route rendering. The source review of every declaration remains in [control-review.json](control-review.json).

| Surface | Actual verification and remaining limits |
|---|---|
| Student workspace, 18 tabs | Real scoped data rendered; guardian/evidence/service/net receipt, refund/recovery, cheque return/replacement, exact fee reimbursement, policy approval, admission, academic correction, blocked recipient retry, training/graduation and 8/8/2 signed contracts exercised. Other conditional operations retain backend/source coverage; these proofs do not imply every button click. |
| Leads and appointments | Source wiring reviewed; real API setup creates lead/appointment/conversion. Full lead form and import controls have backend coverage; individual browser mutations are not inferred from setup. |
| Sales/purchase/inventory documents | All registered pages rendered; shared editor/actions reviewed and actual backend commercial cycles cover payloads, approval, postings and inventory. Individual conversion/return/attachment UI branches remain separately unexercised. |
| Accounting | Real balanced journal creation/submission, independent approval/posting and linked reversal passed with zero combined account effect. Period/account-administration controls retain source/backend coverage; page render alone is not a lifecycle pass. |
| Treasury/resources | Real edit/deactivate/filter/reactivate/restore, statement preview/import without posting cash, and paired transfer with fee/lost-response idempotent retry passed. FX alternatives have backend invariant evidence; this browser transfer is same currency. |
| Opening import/supplier | Existing 400 EGP supplier payment linked against 1,000 EGP opening payable; 600 remains, no new cash/journals. Full preview/commit is the next focused browser check; manual journal settlement alternative has backend coverage. |
| HR | Every page rendered and employee/payroll/attendance/leave handlers reviewed; actual backend HR suite covers scoped records. Individual browser payroll/leave mutations are not claimed. |
| Access/profile/administration | All pages rendered; role-entry/direct API denials and memory-only session restoration/logout tested. Access group, authority, employee-user/password/MFA administration payloads have source/backend coverage; no blanket browser administration claim. |
| AV8 reports | Every permitted report choice loaded actual API; services search and filtered CSV downloaded. Report totals/precision/filter invariants are separately tested in backend suites. |
| Shared shell | Desktop/mobile four language/theme sets and two tablet variants; System appearance; collapsed sidebar, mobile focus/Escape/inert; modal Tab/Shift+Tab/Escape labels tested. Focused accessibility evidence is not a full WCAG certification. |

## Baseline gaps and implementation disposition

| Baseline gap | Implementation now available | Verification disposition |
|---|---|---|
| Guardian email / monthly dual-recipient delivery | Guardian email; immutable reviewed report versions; per-recipient queue/retry/provider reconciliation in `av8-operations.tsx` | B16/B17 passed actual admission and academic correction/training actions; local email stays explicitly blocked. Hosted provider evidence is tracked separately by the release owner. |
| Admission, services/insurance, training/graduation, termination | Dedicated student tabs and scoped operation APIs; actual evidence and separate cash/payment state | All 18 tabs rendered; actual service, admission, refund, training/graduation actions passed in named scenarios; conditional alternatives retain separate coverage. |
| Refund/cheque/service/insurance/delivery reports | Selector, dates/branch/status/resource filters, explicit schemas and CSV endpoint wiring | All report choices loaded and filtered services CSV downloaded; report arithmetic/backend filters retain separate tests. |
| Paired treasury transfers and statements | Root implementation in `finance.tsx` and treasury service/import API | Paired transfer with fee, actual balanced journal/two movements and lost response retry passed; statement preview/import passed with unchanged cash count. |
| Resource administration | Active/inactive resource listing and edit/deactivate/reactivate UI | Actual edit/deactivate/filter/reactivate/restore passed. |
| Page search label and login redirect | Search now says Search pages; authenticated `/login` redirects to permitted destination without blank AV8 content | Login redirect exercised successfully with five named role templates |
| Opening legacy data | File upload, dry-run errors/totals, preserved preview identity and explicit commit with opening-journal prerequisite | Importer backend acceptance and focused browser checks tracked separately |
| POS retries and closed-shift operations | Stable checkout identity; explicit same-branch/warehouse register for held-sale resumption and refunds; original tender methods preserved by backend | Compiled local retry/split-tender/closed-shift recovery passed; exact-commit aggregate is a release check. |
| Supplier opening settlement | Existing posted cash or approved manual journal linked to imported payable/credit, with immutable settlement history | Compiled local settlement passed: existing EGP 400 payment linked, EGP 600 remains, no new cash or journal. |
| Memory-only browser sessions | HttpOnly cookie restoration, server-verified cross-tab synchronization, serialized login/refresh/logout and denial during restoration outage | Compiled production-runtime browser session/reload/two tab/outage-denial/logout checks passed. |
| Allocation corrections | Payment allocation history, evidence-backed request and independent approval; immutable inverse linkage | Backend finance suite and focused browser acceptance tracked separately |

No route was removed. The retained sidebar architecture and styles were preserved. New functionality is grouped inside existing pages/tabs. The lexical source inventory is refreshed with `node --experimental-strip-types scripts/av8/refresh-coverage.mjs`; it preserves existing route, endpoint, control, client-call, query-state, redirect, special-route and model evidence fields by stable identity and does not confer a runtime pass.

## Runtime evidence

The original compiled local run passed 11/11 scenarios and 312/312 route variants: desktop English/light, desktop Arabic/dark, mobile English/dark and mobile Arabic/light. Further targeted tests exercised tablet layout and the named financial/academic/contract scenarios in [browser-action-coverage.json](browser-action-coverage.json). Source was still a working tree; [run metadata](evidence/browser-compiled/run-metadata.json) intentionally has no tested release commit. The release owner binds final verification to the final exact commit.

`tests/final-delivery/browser.spec.ts` uses the actual API and PostgreSQL. Negative probes inject one refresh 503, a nonce-less script, and loss of a transfer/POS response **after** actual server commit. Business responses are not replaced with fixtures. Isolated data and explicitly synthetic signature/stamp PDFs are used. No local academic email is sent; provider-disabled errors and recipient states are asserted.

[Retained compiled evidence](evidence/browser-compiled/results.json) contains the original 11-pass run. Focused result files retain both successful scenarios and earlier failures from incorrect test labels/role assumptions; the action matrix identifies the final successful proof for each scenario. These files must not be misrepresented as one all-green aggregate. Earlier watch-server failures remain under `evidence/browser-preliminary/` and were superseded by the compiled rerun. Downloaded PDFs require separate rendered inspection; source-backed report/ledger assertions do not replace that review.

## Evidence policy and acceptance

A route becomes verified only with current-build evidence for correct data, permitted/denied roles, meaningful actions, error/empty/loading states, Arabic/English, theme and responsive behavior. Shared mechanics may reuse evidence; route-specific wiring and authorization may not. PDFs require rendered inspection. Source inventory must be refreshed after route/API additions; detailed action rows and evidence should be added as workflows are exercised.

Existing `tests/remediation/coverage.spec.ts` calls `reviewFixture`, whose API interception is explicit in `tests/remediation/fixtures.ts`. Its passes cannot prove a database workflow. `tests/ui-v2/routes.spec.ts` is intended to use real backend data and remains NOT RUN here. All fixture, real API, database and browser results must stay separately labelled.


## Semantic action review

[Control review groups](control-review.json) associate every lexical control with its actual workflow, bound handler, permission/state conditions and relevant test source. The source review includes cancellation/submit handlers, read-only or disabled controls, navigation links, dynamic form templates, downloads, filters, tab state and shared primitives. It does not convert a reused template into proof that every possible business branch was executed.

Backend workflow evidence is attached by the release verification owner for accounting references/journals, sales/purchasing/inventory documents, payment approval, HR, access/company governance, private attachments, AV8 finance/operations/opening/scheduler/integrity and treasury. These suites verify scoped data/state transitions and accounting invariants. A suite pass supports only the tested operations; it is not an individual browser-click pass. All individual control rows retain that distinction.

The named browser matrix includes those shared workflows plus actual partial refunds and academy recovery, cheque credit/return/replacement, exact fee reimbursement and signature evidence, policy approval, academic eligibility, immutable report corrections, blocked recipient recovery, suspension/resumption/graduation, signed 8/8/2 contract schedules, independently approved journal reversal, and paired treasury transfer retries. The policy modal check tests focus containment with Tab and Shift+Tab, field names and Escape. It is a focused accessibility check, not a WCAG certification.

Hosted deployment, provider email delivery and approved client policy configuration have separate evidence gates. They are not silently reclassified as passed by local source inspection or route rendering. No registered ERP module or route has been declared outside scope.
