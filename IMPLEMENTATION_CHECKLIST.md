# Odin ERP implementation checklist

The acceptance source of truth is [docs/VERIFICATION.md](docs/VERIFICATION.md). The items below are
implemented, persisted in PostgreSQL, reachable from the UI, and covered by automated UI or backend
tests.

The checked list is the historically verified demo baseline. Current enterprise-tranche work is
classified separately and must not inherit those PASS claims:

| Current tranche | Classification |
|---|---|
| Explicit typecheck/schema-validation commands and portable restore mechanics | Implemented |
| Western-digit Arabic, loading/skeletons, semantic palette and module identity | Partially implemented |
| Company/governance/field/attachment/limit architecture | Partially implemented |
| Current immutable full-suite verification | Partially implemented — sources exist, but final counts, failures/skips, duration and SHA are pending |
| Provider PITR/cross-region/IAM/KMS/scanner/recovery evidence | Requires external/provider evidence |

- [x] Next.js/TypeScript web application with default light mode and Arabic RTL
- [x] NestJS/TypeScript API with runtime Swagger documentation
- [x] PostgreSQL 17 active database, Prisma migrations, deterministic tenant seed, Docker Compose
- [x] Exact minor-unit money and thousandth-unit quantities
- [x] Tenant RLS, API authorization, role-aware UI, branch/warehouse access context
- [x] Customer/supplier/item/category/unit/warehouse/bank-account/fiscal-period creation
- [x] Sales quotation → order → delivery → invoice with partial quantity tracking
- [x] Customer receipts and allocation, statements, aging, returns, credit, full GL/stock effects
- [x] Purchase request → order → receipt → bill with partial quantity tracking
- [x] Supplier-payment submission plus separate-checker posting/allocation, statements, aging,
  returns, full GL/stock effects and maker/checker evidence
- [x] Warehouse transfer, adjustment, stock count/variance, stock card, negative-stock prevention
- [x] POS shift, search/scan, discounts, hold/resume, split tender, receipt, return, close/report
- [x] Multi-line journals, maker-checker, post/reverse, immutable posting, fiscal close/reopen
- [x] Cash/bank receipt/payment/transfer and basic statement reconciliation
- [x] Approval inbox with document metadata, history, comments, approve/reject, self-approval block
- [x] Database-derived dashboard and immediately refreshed operational/financial reports
- [x] Report/source drill-down, CSV, browser print, and server-generated PDF
- [x] Append-only audit evidence and administrator-only selected-tenant UI reset
- [x] Jest/Supertest controls, Playwright real-UI workflows, and reconciliation integrity script

Production/enterprise gaps and provider-evidence requirements are recorded in
`docs/CURRENT_CAPABILITY_MATRIX.md`; they must not be dismissed as optional when assessing an
enterprise or production release.
