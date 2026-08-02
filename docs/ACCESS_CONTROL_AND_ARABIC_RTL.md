# Enterprise access control and Arabic RTL

This document is the implementation and operations handoff for Odin ERP's tenant-scoped access-control system and Arabic/RTL overhaul.

## Audit summary

The pre-change application had role-aware navigation, but authorization was based mainly on broad legacy permission arrays. Several routes and generic document actions were not mapped to a precise resource/action permission, record visibility defaulted to broad tenant or branch access, and sensitive fields were returned with the rest of the record. Roles could not be composed, individually overridden, scoped, limited, or audited through the UI. Arabic used one large lookup and had inconsistent terminology, incomplete dynamic-value localization, mixed-direction identifiers, and component-specific number/date/currency formatting.

The implementation preserves the legacy role column and permission arrays for compatibility, then layers normalized assignments and centralized policies over them. Existing business documents, accounting rules, APIs, and tenant data are not removed.

## Authorization architecture

- `permissions.ts` is the single registry for permission keys, protected fields, data-scope resources, limits, and legacy aliases.
- Authentication resolves one primary role, optional additional roles, and optional user overrides into an effective actor policy. Grants are additive; an explicit deny always wins, including over wildcards and Super Admin.
- A global NestJS authorization guard enforces static route permissions. Service policies enforce dynamic document permissions, limits, field writes, and record scopes.
- Navigation, routes, buttons, forms, and sensitive fields consume the same effective policy returned by the authenticated session. The API remains authoritative.
- PostgreSQL row-level security remains the tenant boundary. Query predicates add own/team/branch/warehouse/department visibility inside that boundary.
- Access changes and denied attempts are written to a separate append-only audit table with actor, subject, old/new values, tenant, branch, IP, and request ID.
- `system.super_admin` is the only permission that opens Settings → Users & Access.

Permission keys use `module.resource.action`, for example `sales.quotation.create`, `sales.order.approve`, `inventory.transfer.post`, and `accounting.journal.view`.

## Database changes

Migration `20260731120000_enterprise_access_control` adds:

- `permissions`
- `role_permissions`
- `user_roles`
- `user_permission_overrides`
- `role_limits`
- `role_data_scopes`
- `role_field_permissions`
- `access_audit_logs`
- role keys, descriptions, lifecycle timestamps, and archive state
- employee-to-user ownership and salary fields
- customer ownership for own/team scopes
- tenant indexes, foreign keys, RLS policies, runtime grants, and append-only audit triggers

The migration is additive. It retains `users.role_id` as the primary role and retains `roles.permissions` for compatibility. The first wildcard administrator in each tenant is promoted to `super_admin`; existing users and documents are not deleted. Legacy permission strings are normalized at authentication time while tenants transition to the new editor.

## Effective policy rules

### Multiple roles and overrides

- Primary and additional role grants are combined.
- The broadest configured data scope wins for the same resource.
- `EDIT` wins over `VIEW`, which wins over `HIDDEN`, across assigned roles.
- The highest configured numeric limit wins across assigned roles.
- User `DENY` overrides every role grant and wildcard.

### Data scopes

Supported values are `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and `ALL`. They are applied to customers, sales and purchasing documents, warehouse operations, employees, journals, dashboards, approval queues, reports, and evidence queries. Shared supplier and item masters remain tenant-wide unless a role's module permission hides them; transactional purchasing and inventory records still use branch/warehouse scopes.

### Protected fields

The field registry covers purchase price, cost price, cost of goods, profit margin, credit limit, payment terms, customer balance, bank account details, salary, journal details, and tax information. `HIDDEN` values are removed from API responses, `VIEW` fields are read-only, and writes require `EDIT`.

### Limits

Configured role limits currently cover sales discount percentage, quotation amount, credit-sale approval threshold, and return approval threshold. Limits are checked by the backend before workflow state changes.

## Seeded role matrix

| Role | Core access | Default scope | Sensitive fields and limits |
|---|---|---|---|
| Super Admin | Unrestricted tenant administration and Users & Access | All | Edit all; 100%/unbounded demo limits |
| Administrator | All operational modules except Super Admin access/audit administration | All | Edit all |
| Sales Manager | Full sales workflow, approvals, standard/profit reports | Team | Sales/customer financial fields; 15% discount and manager thresholds |
| Sales Employee | Own customers; create/edit/convert quotations; create/edit orders; view linked delivery/invoice | Own | Costs hidden; customer financials view-only; 5% discount and employee thresholds |
| Accountant | Accounting, payments, banking view, invoice/bill posting, reports | All | Financial fields editable; salary hidden |
| Finance Manager | Accounting, banking, payments, reports, finance approvals across sales/purchasing | All | Financial fields editable |
| Warehouse Manager | Inventory administration plus delivery/receipt processing | Warehouse | Inventory/document costs visible; salary and unrelated finance hidden |
| Warehouse Keeper | Inventory movements, stock counts, deliveries, and receipts only | Warehouse | Selling/cost fields hidden; no approval or item-master creation |
| Purchasing Manager | Supplier and purchasing workflows, approvals, reports | Branch | Purchase/item and supplier tax fields editable |
| HR Manager | Employee records and HR workflow | Department | Salary editable; unrelated finance hidden |
| Branch Manager | Operational management and approvals | Branch | Manager-level customer/item/document visibility; 15% discount |
| Auditor | Read/history/print/export and audit/report evidence | All | Sensitive fields view-only; no operational writes |
| POS Cashier | POS register, shifts, sales, receipt, and permitted returns | Branch | Cost/journal details hidden; 5% discount |
| Read Only User | View permissions outside security administration | All | Sensitive fields hidden |

The permission registry is deliberately more granular than this summary. The Permissions page is the authoritative searchable matrix for every resource/action key.

## Users & Access UI

Only Super Admin can open:

- `/settings/access/users`: primary role, additional roles, active status, grants, and denies
- `/settings/access/roles`: create, edit, duplicate, archive, assign users, module/action matrix, scopes, fields, and limits
- `/settings/access/permissions`: centralized registry grouped by module
- `/settings/access/audit`: append-only security events with old/new values

Direct navigation by other roles renders a professional 403 page; `/api/access` independently returns HTTP 403.

## Arabic terminology

| English | Standard Arabic |
|---|---|
| Customer / Customers | العميل / العملاء |
| Quotation / Quotations | عرض سعر / عروض الأسعار |
| Sales Order | أمر بيع |
| Delivery Note | إذن تسليم |
| Invoice | فاتورة |
| Credit Note | إشعار دائن |
| Return | مرتجع |
| Approval Queue | طلبات الموافقة |
| Journal Entry | قيد يومية |
| Chart of Accounts | دليل الحسابات |
| Accounts Receivable | حسابات العملاء |
| Accounts Payable | حسابات الموردين |
| General Ledger | دفتر الأستاذ العام |
| Trial Balance | ميزان المراجعة |
| Cost of Goods Sold | تكلفة البضاعة المباعة |
| Stock Transfer | تحويل مخزني |
| Warehouse / Warehouses | المخزن / المخازن |
| Purchase Order | أمر شراء |
| Supplier / Suppliers | المورد / الموردون |
| Payment Terms | شروط السداد |
| Credit Limit | الحد الائتماني |
| Salesperson | مسؤول المبيعات |
| Branch | الفرع |
| Exchange Rate | سعر الصرف |
| Tax | الضريبة |
| Discount | الخصم |
| Subtotal | الإجمالي قبل الضريبة |
| Grand Total | الإجمالي النهائي |
| Outstanding Balance | الرصيد المستحق |

Statuses use one shared dictionary: Draft `مسودة`, Pending Approval `في انتظار الموافقة`, Approved `معتمد`, Rejected `مرفوض`, Cancelled `ملغي`, Posted `مرحّل`, Partially Paid `مدفوع جزئياً`, Paid `مدفوع`, Overdue `متأخر السداد`, Delivered `تم التسليم`, Completed `مكتمل`, Active `نشط`, and Inactive `غير نشط`.

The translation catalog is split into namespaces in `i18n.ts`. `formatters.ts` centralizes dates, date/time, month/year, numbers, quantities, percentages, currencies, and exchange rates with configurable numerals, date style, currency position, precision, and grouping. RTL uses logical CSS properties; directional icons flip, while functional icons do not. Codes, document numbers, email, IP, SKU, IBAN-like/account values, and permission keys remain LTR.

Run `npm run i18n:review` for the development review report. It contains every translation key, English and Arabic values, missing/duplicate/suspicious flags, and a static text-overflow risk indicator. `npm run i18n:audit` is the CI gate.

## Main files changed

- Database: `apps/api/prisma/schema.prisma`, the enterprise access migration, `bootstrap.ts`, and `seed.ts`
- Authorization: `permissions.ts`, `auth.ts`, `authorization.guard.ts`, `access-control.service.ts`, `access-control.controller.ts`, `erp.controller.ts`, and `erp.service.ts`
- Audit/logging: `request-logging.interceptor.ts` and access-audit database triggers
- Web: `navigation.ts`, `odin-app.tsx`, `access-workspace.tsx`, `sales-workspace.tsx`, and access/RTL/responsive styles
- Localization: `i18n.ts`, `formatters.ts`, and `scripts/check-translations.mjs`
- Tests: permission unit tests, PostgreSQL/RLS tests, sales workflow integration tests, localization Playwright tests, and Odin UI Playwright tests

## Migration and deployment

Back up the production database, then run:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run build
npm run start
```

Do not run `npm run db:seed` against production. It is deterministic demo data and intentionally resets the selected demo tenant. For a new disposable demo database only, run it after migrations.

No existing API was removed. New endpoints are under `/api/access`; existing authenticated session payloads now also include effective roles, permissions, denies, scopes, fields, and limits.

## Demo accounts

All demo accounts use password `password`.

| Email | Role |
|---|---|
| `admin@odin.demo` | Super Admin |
| `cfo@odin.demo` | Finance Manager approval profile |
| `finance@odin.demo` | Finance Manager |
| `accountant@odin.demo` | Accountant |
| `auditor@odin.demo` | Auditor |
| `sales@odin.demo` | Sales Manager |
| `sales.employee@odin.demo` | Sales Employee |
| `purchasing@odin.demo` | Purchasing Manager |
| `warehouse@odin.demo` | Warehouse Keeper |
| `cashier@odin.demo` | POS Cashier |
| `hr@odin.demo` | HR Manager |
| `branch@odin.demo` | Branch Manager |

## Verification

With PostgreSQL and the application running:

```bash
npm run db:generate
npm run db:migrate
npm run lint
npm run i18n:audit
npm test
npm run integrity
npm run build
npm run test:e2e
```

The automated coverage includes direct-route and API denial, allowed actions, maker/checker separation, explicit-deny precedence, record scopes, sensitive-field redaction/write denial, tenant RLS isolation, append-only access audit, approval thresholds, desktop/tablet/mobile layouts, English/Arabic, LTR/RTL, light/dark themes, LTR codes, localized dates/currency, and the existing sales/accounting workflows.

Final local verification on 31 July 2026 passed TypeScript lint, the zero-issue translation audit, all 49 API/database tests, all 21 local Chromium scenarios, the production NestJS/Next.js build, and the financial integrity checker. The two deployment-only Playwright scenarios remain intentionally skipped unless staging credentials and a staging base URL are supplied. A clean PostgreSQL database also applied all nine migrations in sequence.

## Remaining production extensions

Explicit team membership is represented by role scope configuration (`userIds`). For migrated policies that do not yet contain membership configuration, Odin uses active roles in the same business module as a conservative compatibility fallback instead of widening `TEAM` to the whole branch. A dedicated organization/team editor is a future extension. Supplier and item masters are shared tenant-wide reference data, while their transactions remain branch/warehouse scoped. Enterprise SSO/MFA, periodic access recertification, a four-eyes role-change approval workflow, and external SIEM export are also optional production extensions rather than blockers for the implemented tenant-level RBAC system.
