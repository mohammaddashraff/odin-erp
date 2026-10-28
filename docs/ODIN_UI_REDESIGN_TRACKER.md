# ODIN dark glass redesign tracker

Branch: `feature/odin-erp-glass-redesign`
Reference: supplied `docs/design/odin-erp-dark-reference.png` (1672 × 941).

## Scope and architecture

Next.js App Router; one catch-all route dispatches 78 registered routes into 22 screen components. React context retains authentication, company scopes, field permissions, exact money formatting and mutations. Manrope/Noto Arabic and Lucide are reused. No new dependencies, backend edits, database/schema changes, secret changes or production actions.

Shared components: permission-filtered horizontal AppShell and module disclosure menus; mobile drawer; page search; Brand; PageHeader; Panel; GlassMetric; Table; Pagination; Fields; Dialog; Confirm; Tabs; Status; loading/error/empty states. Existing specialized accounting, report, HR, POS and AV8 layouts now consume common semantic surface/text/status tokens. Print retains an opaque light paper palette.

## Execution checklist

- [x] Read package prompt in full and inspect supplied image.
- [x] Preserve clean baseline and create requested branch.
- [x] Inventory registered, auxiliary, redirect and parameterized routes.
- [x] Shared tokens, navigation, cards, forms, tables and dialogs implemented.
- [x] ERP dashboard uses existing scoped document/KPI APIs; AV8 daily workspace retains its queue data and actions. No invented revenue or growth.
- [x] Browser route sweep, representative nested interactions, RTL/mobile and visual refinement (fixture-backed; see verification limitations).
- [x] Frontend production build and TypeScript; browser, formatting, permission, date and exact-money checks. Repository-wide checks remain blocked as documented.
- [ ] Commit, push branch, open pull request. Never merge/deploy.

## Per-route inventory

“Shared system” records implementation coverage, not successful authenticated functional QA. Browser status is updated from actual runs below.

| Route | Module / screen | Migration | Browser QA |
| --- | --- | --- | --- |
| `/av8/appointments` | av8 / av8 | Shared system | Error-state pass |
| `/av8/leads` | av8 / av8 | Shared system | Error-state + Populated; search, capture/save payload + feedback |
| `/av8/students` | av8 / av8 | Shared system | Error-state + Detail + 13 tab entries; fixture data |
| `/av8/affairs` | av8 / av8 | Shared system | Error-state pass |
| `/av8/finance` | av8 / av8 | Shared system | Error-state pass |
| `/av8/reports` | av8 / av8 | Shared system | Error-state pass |
| `/av8/settings` | av8 / av8 | Shared system | Error-state pass |
| `/dashboard` | command / overview + av8 | Shared system | Error-state + ERP + AV8 populated, currency/permission checks |
| `/sales/overview` | sales / domain-overview | Shared system | Error-state pass |
| `/sales/customers` | sales / master-data | Shared system | Error-state pass |
| `/sales/quotations` | sales / documents | Shared system | Error-state pass |
| `/sales/orders` | sales / documents | Shared system | Error-state pass |
| `/sales/deliveries` | sales / documents | Shared system | Error-state pass |
| `/sales/invoices` | sales / documents | Shared system | Error-state + Populated table |
| `/sales/returns` | sales / documents | Shared system | Error-state pass |
| `/sales/credit-notes` | sales / documents | Shared system | Error-state pass |
| `/sales/customer-balances` | sales / reports | Shared system | Error-state pass |
| `/purchasing/overview` | purchasing / domain-overview | Shared system | Error-state pass |
| `/purchasing/suppliers` | purchasing / master-data | Shared system | Error-state pass |
| `/purchasing/requests` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/rfqs` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/orders` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/receipts` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/bills` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/returns` | purchasing / documents | Shared system | Error-state pass |
| `/purchasing/supplier-balances` | purchasing / reports | Shared system | Error-state pass |
| `/inventory/overview` | inventory / domain-overview | Shared system | Error-state pass |
| `/inventory/items` | inventory / master-data | Shared system | Error-state + Empty state |
| `/inventory/categories` | inventory / master-data | Shared system | Error-state pass |
| `/inventory/units` | inventory / master-data | Shared system | Error-state pass |
| `/inventory/warehouses` | inventory / master-data | Shared system | Error-state pass |
| `/inventory/transfers` | inventory / documents | Shared system | Error-state pass |
| `/inventory/adjustments` | inventory / documents | Shared system | Error-state pass |
| `/inventory/counts` | inventory / documents | Shared system | Error-state pass |
| `/inventory/stock-card` | inventory / reports | Shared system | Error-state pass |
| `/inventory/valuation` | inventory / reports | Shared system | Error-state pass |
| `/hr/overview` | hr / hr | Shared system | Error-state pass |
| `/hr/employees` | hr / hr | Shared system | Error-state + Empty state |
| `/hr/departments` | hr / hr | Shared system | Error-state pass |
| `/hr/attendance` | hr / hr | Shared system | Error-state pass |
| `/hr/leave` | hr / hr | Shared system | Error-state pass |
| `/hr/payroll` | hr / hr | Shared system | Error-state pass |
| `/pos/workspace` | pos / pos | Shared system | Error-state + Empty catalog/cart |
| `/accounting/overview` | accounting / domain-overview | Shared system | Error-state + Empty data, English/Arabic, mobile, print |
| `/accounting/chart-of-accounts` | accounting / master-data | Shared system | Error-state pass |
| `/accounting/journals` | accounting / accounting | Shared system | Error-state + Empty table |
| `/accounting/periods` | accounting / accounting | Shared system | Error-state pass |
| `/accounting/general-ledger` | accounting / accounting | Shared system | Error-state pass |
| `/accounting/trial-balance` | accounting / reports | Shared system | Error-state pass |
| `/accounting/income-statement` | accounting / reports | Shared system | Error-state pass |
| `/accounting/balance-sheet` | accounting / reports | Shared system | Error-state pass |
| `/banking/overview` | banking / domain-overview | Shared system | Error-state pass |
| `/banking/accounts` | banking / master-data | Shared system | Error-state pass |
| `/banking/allocations` | banking / payments | Shared system | Error-state pass |
| `/banking/transactions` | banking / banking | Shared system | Error-state + Empty table |
| `/banking/statements` | banking / banking | Shared system | Error-state pass |
| `/banking/reconciliation` | banking / banking | Shared system | Error-state pass |
| `/approvals/inbox` | approvals / approvals | Shared system | Error-state pass |
| `/reports/overview` | reports / reports | Shared system | Error-state pass |
| `/reports/sales` | reports / reports | Shared system | Error-state pass |
| `/reports/purchasing` | reports / reports | Shared system | Error-state pass |
| `/reports/inventory` | reports / reports | Shared system | Error-state pass |
| `/reports/accounting` | reports / reports | Shared system | Error-state pass |
| `/reports/banking` | reports / reports | Shared system | Error-state pass |
| `/reports/pos` | reports / reports | Shared system | Error-state pass |
| `/admin/overview` | admin / administration | Shared system | Error-state pass |
| `/settings/access/users` | admin / administration | Shared system | Error-state + Populated list; restricted-role denial |
| `/settings/access/roles` | admin / administration | Shared system | Error-state pass |
| `/admin/audit` | admin / administration | Shared system | Error-state pass |
| `/admin/advanced` | admin / administration | Shared system | Error-state pass |
| `/settings/access/limits` | admin / administration | Shared system | Error-state pass |
| `/my-profile` | admin / administration | Shared system | Error-state pass |
| `/settings/access/users/new` | admin / administration | Shared system | Error-state pass |
| `/settings/access/governance` | admin / administration | Shared system | Error-state pass |
| `/settings/access/permissions` | admin / administration | Shared system | Error-state pass |
| `/settings/access/audit` | admin / administration | Shared system | Error-state pass |
| `/settings/access/reviews` | admin / administration | Shared system | Error-state pass |
| `/admin/system-health` | admin / administration | Shared system | Error-state pass |
| `/settings/access/users/:id` | admin / user profile | Shared system | Error-state pass |
| `/login` | authentication / MFA | Shared system | Login validation pass; MFA not exercised |
| `/` | renders dashboard at root URL | Retained | Dashboard rendering pass |
| unmatched route | not found | Shared system | 404 pass |

## Redirects

- `/sales` → `/sales/overview`
- `/purchases` → `/purchasing/overview`
- `/inventory` → `/inventory/overview`
- `/pos` → `/pos/workspace`
- `/payments` → `/banking/allocations`
- `/accounting` → `/accounting/general-ledger`
- `/banking` → `/banking/overview`
- `/approvals` → `/approvals/inbox`
- `/reports` → `/reports/overview`
- `/audit` → `/admin/audit`

## Nested states

- AV8 lead detail, activity/assignment/appointment/consultation/convert and CSV import dialogs.
- Student Admissions, Documents, Medical, Agreement, installments, English, visa, travel, payments, academy statement, guardian, tasks/exceptions, timeline; upload and FX dialogs.
- Document create/edit/detail, approval, posting, returns, attachments and linked documents.
- Customer statement/detail, master CRUD, inventory document editors.
- Chart tree/table, account editor, journals/detail/editor, fiscal close/reopen, report filters, ledger drilldowns and print.
- Bank accounts, allocations, reconciliation/import; POS cart/register/shift and payment dialogs.
- Employee profile, departments/attendance/leave/payroll forms.
- Users/create/profile, access groups, permissions, governance/reviews/authority, activity/diagnostics, password/MFA.

## Evidence and constraints

See [verification and screenshots](ui-dark/VERIFICATION.md) for reproducible commands, reference comparison and remaining integration work.

- Every registered route, the dynamic user profile, four additional query entry points, root rendering, all 10 legacy redirects and 404 were exercised in the browser. Error-state coverage confirms shell/rendering resilience, not completion of all business operations.
- Shared styling covers every nested form/detail/dialog listed above. Populated interactions were exercised for leads, selected student states, users, financial dashboard and invoice table; empty fixtures cover six representative transactional modules.
- Student tabs checked: Admissions, Medical, Agreement, Documents, English, Visa, Travel, Progress, Payments, Academy statement, Guardian, Tasks & exceptions, Timeline. Some financial/attachment operations intentionally return an unsupported-fixture error; those integrations remain unverified.
- Frontend TypeScript and production build pass. Live API/database integration is unavailable: Prisma download was blocked by current network policy. No migration or backend change was attempted for this redesign.
- Existing live workflow tests retain their business assertions; shell selectors and navigation-specific assertions were migrated. Their full transactional runs still require the isolated backend.
- Git read works. GitHub API access returned Forbidden; a draft network allowance was saved but is not active until the environment configuration is published.
- Browser plugin is absent; installed Playwright with system Chromium was used.
- Production components use existing real API responses. Synthetic review records exist only in browser fixtures and their clearly identified screenshots.
