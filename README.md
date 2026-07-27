# Odin ERP

Odin ERP is a client-demonstration accounting and distribution system. Its sales, purchasing,
inventory, POS, accounting, cash/bank, approval, reporting, permission, audit, and tenant-reset
workflows are executable from the browser and persisted in PostgreSQL.

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
npm run db:migrate
npm run db:seed
npm run build
npm run start
```

Set `ODIN_DEMO_PASSWORD` in `.env` before seeding. `ODIN_ALLOWED_ORIGINS` is a comma-separated
allowlist. Swagger is disabled unless `ENABLE_SWAGGER=true`.
The API emits one JSON log record per handled request with request ID, route, status, duration,
user, tenant, and safe error metadata; it never serializes request headers, cookies, tokens,
passwords, request bodies, or database URLs.

Open:

- Application: [http://127.0.0.1:8080](http://127.0.0.1:8080)
- API health: [http://127.0.0.1:8080/api/health](http://127.0.0.1:8080/api/health)
- Swagger, when enabled: [http://127.0.0.1:8081/api/docs](http://127.0.0.1:8081/api/docs)

For development, use `npm run dev` after the database steps. Stop the database with
`docker compose down`; its named volume preserves transactions across restarts.

## Demo users

Every account uses the password supplied through `ODIN_DEMO_PASSWORD`.

| Role | Email |
|---|---|
| Administrator | `admin@odin.demo` |
| CFO | `cfo@odin.demo` |
| Finance Manager | `finance@odin.demo` |
| Accountant | `accountant@odin.demo` |
| Auditor (read only) | `auditor@odin.demo` |
| Sales Manager | `sales@odin.demo` |
| Purchasing Manager | `purchasing@odin.demo` |
| Warehouse Manager | `warehouse@odin.demo` |
| POS Cashier | `cashier@odin.demo` |

## Browser workflows

- Masters: create customers, suppliers, categories, units, items with barcode/prices/VAT/reorder
  level, warehouses, cash/bank accounts, and fiscal periods.
- Sales: quotation → sales order → delivery note → sales invoice, with remaining-quantity limits,
  partial conversion, approval, posting, receipt allocation, return/credit, stock, COGS, VAT, AR,
  statements, aging, and journal drill-down.
- Purchasing: purchase request → purchase order → goods receipt → supplier bill, with partial
  receipt/billing limits, approval, posting, payment allocation, purchase return, GRNI, inventory,
  VAT, AP, statements, and aging.
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
  audit trail, and an administrator-only selected-tenant reset with password confirmation and an
  integrity result.

## Verification commands

Run these while PostgreSQL is available; start the application before the Playwright command.

```bash
npm run lint
npm run build
npm test
npm run test:e2e
npm run integrity
```

The Playwright suite drives the real UI, changes users, and covers the complete sales, purchasing,
inventory, POS, accounting, banking, permissions, reporting, export, Arabic RTL, audit, and reset
story. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the acceptance matrix and captured
evidence. See [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md) for the client demonstration sequence.
The signed AR movement model and no-implicit-credit rule are documented in
[docs/customer-receivables.md](docs/customer-receivables.md).

## Optional production extensions

Enterprise SSO/MFA, exchange-rate feeds and period-end currency revaluation, configurable approval
graphs, attachment object storage/virus scanning, FIFO/lot/serial costing, and external bank-feed
connectors are production extensions. They are not required for the implemented demo workflows.
