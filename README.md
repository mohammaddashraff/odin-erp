# Odin ERP

Odin ERP is a client-demonstration accounting and distribution system. It has executable,
PostgreSQL-backed sales, purchasing, inventory, POS, accounting, cash/bank, approval, reporting,
permission, audit, and tenant-reset workflows. It is not presented as a production-complete ERP;
the implemented boundaries and remaining gaps are recorded in
[docs/CURRENT_CAPABILITY_MATRIX.md](docs/CURRENT_CAPABILITY_MATRIX.md).

The application opens in light mode. English/LTR and Arabic/RTL are selectable from the header and
persist across navigation and sign-in.

## Technology actually in use

- Web: Next.js 16, React 19, and TypeScript
- API: NestJS 11 and TypeScript
- Database: PostgreSQL 17
- ORM/migrations: Prisma 7 with the PostgreSQL driver adapter
- Tests: Jest/Supertest and Playwright
- API contract: OpenAPI, with runtime Swagger available only when explicitly enabled
- Money: exact integer minor units (`BigInt`); quantities: integer thousandths

PostgreSQL row-level security scopes the runtime role by tenant. Database triggers protect posted
journals and audit rows, enforce balanced posting, and prevent invalid stock value/quantity. The
browser never stores business records in local storage.

## Start from a clean checkout

Requirements: Node.js 24+, npm, Docker with Compose.

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:seed
npm run build
npm run start
```

The shared demo password is `password`; these accounts are for disposable demo environments only.
Production refuses startup unless `ODIN_TOKEN_SECRET` is unique and at least 32 characters, and
tenant demo reset is disabled unless a production deployment explicitly sets
`ODIN_DEPLOYMENT_MODE=demo`. `ODIN_ALLOWED_ORIGINS` is a comma-separated allowlist.
Local development may leave `ODIN_MFA_ENCRYPTION_KEY` empty and derive a disposable key from the
local token secret. Production must set a unique 32-byte key, for example from
`openssl rand -base64 32`; production validation remains fail-closed.
Swagger is disabled unless `ENABLE_SWAGGER=true`.
The API emits one JSON log record per handled request with request ID, route, status, duration,
user, tenant, and safe error metadata; it never serializes request headers, cookies, tokens,
passwords, request bodies, or database URLs.

Open:

- Application: [http://127.0.0.1:8080](http://127.0.0.1:8080)
- API health: [http://127.0.0.1:8080/api/health](http://127.0.0.1:8080/api/health)
- Swagger, when enabled: [http://127.0.0.1:8081/api/docs](http://127.0.0.1:8081/api/docs)

For development, use `npm run dev` after the database steps. Stop the database with
`docker compose down`; its named volume preserves transactions across restarts.

Production builds do not modify the database. Run `npm run release:migrate` as an explicit,
audited release step before starting a compatible application version; see
[docs/RELEASE_AND_ROLLBACK_RUNBOOK.md](docs/RELEASE_AND_ROLLBACK_RUNBOOK.md).

## Demo users

Every account uses the password `password`.

| Role | Email |
|---|---|
| Super Admin | `admin@odin.demo` |
| CFO | `cfo@odin.demo` |
| Finance Manager | `finance@odin.demo` |
| Accountant | `accountant@odin.demo` |
| Auditor (read only) | `auditor@odin.demo` |
| Sales Manager | `sales@odin.demo` |
| Sales Employee | `sales.employee@odin.demo` |
| Purchasing Manager | `purchasing@odin.demo` |
| Warehouse Keeper | `warehouse@odin.demo` |
| POS Cashier | `cashier@odin.demo` |
| HR Manager | `hr@odin.demo` |
| Branch Manager | `branch@odin.demo` |

## Browser workflows

- Masters: create customers, suppliers, categories, units, items with barcode/prices/VAT/reorder
  level, warehouses, cash/bank accounts, and fiscal periods.
- Sales: quotation → sales order → delivery note → sales invoice, with remaining-quantity limits,
  partial conversion, approval, posting, receipt allocation, return/credit, stock, COGS, VAT, AR,
  statements, aging, and journal drill-down.
- Purchasing: purchase request → purchase order → goods receipt → supplier bill, with partial
  receipt/billing limits, approval, posting, purchase return, GRNI, inventory, VAT, AP, statements,
  aging, and a submitted outgoing-payment instruction that a different authorized user approves or
  rejects before allocation and posting. Customer receipts retain immediate posting.
- Inventory: warehouse transfer, inventory adjustment, stock count and variance, negative-stock
  prevention, inventory gain/loss accounting, warehouse balances, valuation, and stock card.
- POS: shift open/close, barcode/SKU/name search, customer/walk-in sales, permitted discounts,
  cash/card/split tender, hold/resume, receipt PDF, return, stock/COGS/VAT/revenue posting, and cash
  over/short reporting.
- Accounting: multi-line journals, branch and cost center, submit/approve/post, maker-checker,
  balance/control-account checks, immutable posting, linked reversal, fiscal close/reopen, and
  closed-period enforcement.
- Banking: cash/bank/card accounts, receipts, payments, transfers, manual statement entry,
  transaction matching, reconciliation status, and difference display.
- Reports: trial balance, general and account ledgers, balance sheet, income statement, customer and
  supplier statements, AR/AP aging, inventory balances/valuation/movements, sales, purchases, and
  POS shifts. Reports refresh from persisted records and support source/journal drill-down.
- Output: professional browser print CSS, CSV for table reports, and server-generated PDFs for
  business documents, POS receipts, and financial reports.
- Administration: approval inbox/history/comments, role-aware navigation/actions, append-only
  business and access audit trails, tenant-wide Super Admin role/user management, bounded
  company-governance APIs, a governance workspace for effective-access evidence, safe preview and
  access-review decisions, data/field scopes, role limits and overrides, and an administrator-only
  selected-tenant reset with password confirmation and an integrity result. Company membership,
  resource-assignment, temporary-access, delegation and authority-policy mutations are API-backed but
  do not yet all have dedicated browser forms.
- Attachments: an authorized sales-document detail view can upload, list and download private,
  DB-backed attachments through short-lived user/session-bound tickets. Provider object storage,
  malware scanning and provider recovery are not integrated.

## Verification commands

Run these while PostgreSQL is available; start the application before the Playwright command.

```bash
npm run lint
npm run typecheck
npm run i18n:audit
npm run db:validate
npm run build
npm run test:unit
npm run test:db
npm run test:security
npm test
npm run test:e2e
npm run integrity
```

`test:unit` excludes `database-controls.spec.ts` and `*.database.spec.ts`; `test:db` selects those
PostgreSQL suites; and `test:security` uses the anchored security-regression basename selector in
`package.json`. The full `npm test` remains the authoritative combined Jest gate.

The local Playwright suites drive the real UI for navigation, loading, responsive layouts, access
denials, localization, export locale handling, customer creation and the quotation-to-order approval
path. Two deployed quote-to-cash scenarios run only when staging configuration is supplied. Backend,
PostgreSQL and integrity suites cover the broader accounting and business invariants; they are not a
substitute for unimplemented browser workflow coverage. See
[docs/VERIFICATION.md](docs/VERIFICATION.md) for the acceptance matrix and evidence status. See
[DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md) for the client demonstration sequence.
The signed AR movement model and no-implicit-credit rule are documented in
[docs/customer-receivables.md](docs/customer-receivables.md).
The access-control architecture, role matrix, Arabic terminology, migration procedure, and demo
account handoff are documented in
[docs/ACCESS_CONTROL_AND_ARABIC_RTL.md](docs/ACCESS_CONTROL_AND_ARABIC_RTL.md).
The semantic palette, loading-state architecture, motion rules, module identity, and Western-digit
Arabic policy are documented in
[docs/DESIGN_SYSTEM_AND_LOCALIZATION.md](docs/DESIGN_SYSTEM_AND_LOCALIZATION.md).

## Optional production extensions

Enterprise SSO, exchange-rate feeds and period-end currency revaluation, configurable multi-step
approval graphs, provider attachment object storage/scanning/recovery, FIFO/lot/serial costing, and
external bank-feed connectors are production extensions. Provider IAM/KMS/PITR/cross-region evidence
and production promotion/rollback evidence are also outside what this repository alone can establish.
