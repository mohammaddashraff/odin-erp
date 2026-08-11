# Enterprise access control and Arabic RTL

This document is the implementation and operations handoff for Odin ERP's tenant-scoped access-control system and Arabic/RTL overhaul.

## Current-tranche classification (2026-08-11)

| Capability | Classification | Evidence boundary |
|---|---|---|
| Previously verified tenant/role/scope enforcement | Tested | Historical quality run `31256037111` applies only to commit `b534bc2` |
| Company-aware and governed effective-access architecture | Partially implemented | Company/customer/supplier/branch and mapped bank/GL boundaries plus governed access APIs exist; remaining tenant-shared masters, full governance UI and current end-to-end evidence remain incomplete |
| Western-digit Arabic policy | Implemented | Web and API/export locale resolution uses `ar-EG-u-nu-latn`; current full-route/input/export regression evidence is pending |
| Current-tranche end-to-end verification | Partially implemented | Required sources exist, but do not reuse the 31 July or 8 August totals as evidence for the current working tree; final counts, failures/skips, duration and immutable SHA are pending |

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
- Tenant-wide Users, Roles, Permissions and Access Audit remain gated by `system.super_admin`.
  Company Administrators may open the separate Access Governance workspace only for companies in
  their company-scoped `settings.users_access.view/manage` envelope.

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

Migration `20260809120000_company_access_governance` adds the Company, time-bounded membership and
CompanyBranch boundary; customer/supplier Company ownership; typed financial resources and
assignments; temporary grants; delegations; SoD rules; review records; authority policies; private
attachments; compatibility backfills/triggers; and RLS/runtime grants. Migration
`20260811120000_payment_approval_workflow` adds submitted/posted/rejected payment state and checker
evidence for outgoing supplier payments. These additions do not remove the legacy role or
branch/warehouse JSON compatibility columns.

The migration is additive. It retains `users.role_id` as the primary role and retains `roles.permissions` for compatibility. The first wildcard administrator in each tenant is promoted to `super_admin`; existing users and documents are not deleted. Legacy permission strings are normalized at authentication time while tenants transition to the new editor.

## Effective policy rules

### Multiple roles and overrides

- Primary and additional role grants are combined.
- The broadest configured data scope wins for the same resource.
- `EDIT` wins over `VIEW`, which wins over `HIDDEN`, across assigned roles.
- The highest configured numeric limit wins across assigned roles.
- User `DENY` overrides every role grant and wildcard.

### Data scopes

Supported values are `NONE`, `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and
`ALL`. They are applied through resource-specific predicates to customers, suppliers, documents,
warehouse operations, employees, journals, payments, dashboards, approval queues, reports,
attachments and evidence queries. Customers and suppliers have explicit Company ownership;
suppliers can also use selected-resource assignment. Items, categories, units, departments,
currencies and some accounting configuration remain tenant-level masters, while their operational
documents and branch/warehouse facts are company bounded. A missing scope defaults to `NONE`.

### Protected fields

The field registry covers purchase/cost price, document cost/profit/internal notes, customer credit
limit/payment terms/balance, bank account details, salary, journal lines, party tax identifiers,
private-attachment metadata, approval evidence and audit values/metadata/references. The centralized
projector removes `HIDDEN` values from the identified nested customer, supplier, document, journal,
payment, approval and audit response trees. Exposed protected writes require `EDIT`, including
customer credit/payment terms, party tax data, item purchase price, bank-account number, document
notes, journal lines and attachment upload metadata. `VIEW` is read-only for those write paths.
Every future endpoint, job, notification, export and nested serializer still requires explicit
projection registration; automatic universal coverage is not claimed.

### Limits

Compatibility role limits cover sales discount percentage, quotation amount, credit-sale approval
threshold and return approval threshold. Company/currency-aware authority policies add purchase-order
and supplier-bill approval, receipt/payment, treasury movement, journal posting, expense approval and
customer credit-exposure keys with optional company, branch, role, department, document type and
validity bounds. Current service adapters enforce the applicable document, payment, treasury and
journal paths; complete domain routing/escalation is not implemented.

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

## Users & Access and governance UI

Only Super Admin can open the tenant-wide administration pages:

- `/settings/access/users`: primary role, additional roles, active status, grants, and denies
- `/settings/access/roles`: create, edit, duplicate, archive, assign users, module/action matrix, scopes, fields, and limits
- `/settings/access/permissions`: centralized registry grouped by module
- `/settings/access/audit`: append-only security events with old/new values

Direct navigation by other roles renders a professional 403 page; `/api/access` independently returns HTTP 403.

The separate `/settings/access/governance` workspace is visible to authorized Company
Administrators within their assigned-company envelope. It displays governed companies and members,
effective permissions/scopes/fields/limits/resource sources, SoD risk, non-mutating safe preview and
immutable access-review evidence; authorized reviewers can record review decisions. Membership,
financial-resource, temporary-grant, delegation and authority-policy mutation endpoints are bounded
server-side but do not yet all have dedicated browser forms.

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

The translation catalog is split into namespaces in `i18n.ts`. `formatters.ts` centralizes dates,
date/time, month/year, numbers, quantities, percentages, currencies, and exchange rates. Arabic uses
the Latin numbering system (`latn`) without exception: Arabic text remains RTL while numbers render
as `0-9`, including currency, dates, times, counts, inputs, charts, reports, exports and print/PDF
output. Codes, document numbers, email, IP, SKU, IBAN-like/account values, phone numbers and
permission keys remain bidirectionally isolated LTR values. RTL uses logical CSS properties;
directional icons flip, while functional icons do not. The full design and verification contract is
in `DESIGN_SYSTEM_AND_LOCALIZATION.md`.

Run `npm run i18n:review` for the development review report. It contains every translation key, English and Arabic values, missing/duplicate/suspicious flags, and a static text-overflow risk indicator. `npm run i18n:audit` is the CI gate.

## Main files changed

- Database: `apps/api/prisma/schema.prisma`, the enterprise access migration, `bootstrap.ts`, and `seed.ts`
- Authorization: `permissions.ts`, `auth.ts`, `authorization.guard.ts`, `access-control.service.ts`, `access-control.controller.ts`, `erp.controller.ts`, and `erp.service.ts`
- Audit/logging: `request-logging.interceptor.ts` and access-audit database triggers
- Web: `navigation.ts`, `odin-app.tsx`, `access-workspace.tsx`, `sales-workspace.tsx`, and access/RTL/responsive styles
- Localization: `i18n.ts`, `formatters.ts`, and `scripts/check-translations.mjs`
- Tests: permission/governance/projection unit tests; PostgreSQL/RLS company, attachment, ERP
  authorization, payment-approval and business integration tests; localization/access/UI Playwright
  tests

## Migration and deployment

Back up the production database, then run:

```bash
npm install
npm run db:generate
npm run db:validate
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
npm run db:validate
npm run db:migrate
npm run lint
npm run typecheck
npm run i18n:audit
npm test
npm run integrity
npm run build
npm run test:e2e
```

The current test sources cover direct-route and API denial, explicit-deny precedence, Company and
record scopes, protected-field projection/write denial, private attachment ownership/tickets/download
audit, SoD `WARN`/`BLOCK` mutation behavior, outgoing-payment maker/checker, tenant RLS, append-only
audit, authority limits, responsive layouts, English/Arabic, LTR/RTL, light/dark themes, LTR codes and
Western-digit formatting. These sources are not a current PASS record until the exact final commands,
counts and SHA are recorded in `VERIFICATION.md`.

Historical local verification on 31 July 2026 passed TypeScript lint, the zero-issue translation
audit, 49 API/database tests, 21 local Chromium scenarios, the production NestJS/Next.js build and
the financial integrity checker; a clean database then applied nine migrations. Those totals do not
verify the current tranche. The deployed workflow scenarios remain conditional on staging
credentials and a staging base URL.

## Remaining production extensions

Explicit team membership is represented by role scope configuration (`userIds`). For migrated
policies without membership configuration, Odin uses active roles in the same business module as a
conservative compatibility fallback instead of widening `TEAM` to the whole branch. A normalized
team model/editor is not implemented. Customers and suppliers are company-owned; items and several
reference/configuration masters remain tenant-level and therefore keep multi-company depth partial.
Enterprise SSO, mature recertification campaigns, a governed SoD-exception/four-eyes role-change
workflow, external SIEM export, provider attachment storage/scanning/recovery and production
IAM/KMS/PITR evidence remain future or deployment work.
