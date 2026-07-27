# Odin ERP implementation checklist

The acceptance source of truth is [docs/VERIFICATION.md](docs/VERIFICATION.md). The items below are
implemented, persisted in PostgreSQL, reachable from the UI, and covered by automated UI or backend
tests.

- [x] Next.js/TypeScript web application with default light mode and Arabic RTL
- [x] NestJS/TypeScript API with runtime Swagger documentation
- [x] PostgreSQL 17 active database, Prisma migrations, deterministic tenant seed, Docker Compose
- [x] Exact minor-unit money and thousandth-unit quantities
- [x] Tenant RLS, API authorization, role-aware UI, branch/warehouse access context
- [x] Customer/supplier/item/category/unit/warehouse/bank-account/fiscal-period creation
- [x] Sales quotation → order → delivery → invoice with partial quantity tracking
- [x] Customer receipts and allocation, statements, aging, returns, credit, full GL/stock effects
- [x] Purchase request → order → receipt → bill with partial quantity tracking
- [x] Supplier payments and allocation, statements, aging, returns, full GL/stock effects
- [x] Warehouse transfer, adjustment, stock count/variance, stock card, negative-stock prevention
- [x] POS shift, search/scan, discounts, hold/resume, split tender, receipt, return, close/report
- [x] Multi-line journals, maker-checker, post/reverse, immutable posting, fiscal close/reopen
- [x] Cash/bank receipt/payment/transfer and basic statement reconciliation
- [x] Approval inbox with document metadata, history, comments, approve/reject, self-approval block
- [x] Database-derived dashboard and immediately refreshed operational/financial reports
- [x] Report/source drill-down, CSV, browser print, and server-generated PDF
- [x] Append-only audit evidence and administrator-only selected-tenant UI reset
- [x] Jest/Supertest controls, Playwright real-UI workflows, and reconciliation integrity script

Optional production extensions are documented in the README and are not gaps in the agreed demo
scope.
