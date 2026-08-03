# Module gap analysis

## Prioritization method

Priority is based on financial/security exposure, integrity dependency, and workflow completeness. P0 blocks production use; P1 blocks enterprise access or core transaction maturity; P2 deepens existing domains; P3 is new optional scope.

| Domain | Current connected workflow | Highest-risk gaps | Priority |
|---|---|---|---|
| Platform operations | Vercel-shaped web/API configuration and PostgreSQL | production secret/reset and PR quality gates are hardened; shared demo identities, no MFA/security scanning/release promotion, and no monitored backups remain | P0 |
| Access control | registry → roles → user policy → guard/service → UI/audit | POS/approval/output/evidence paths received an initial hardening pass; implicit BRANCH scope, banking gaps, no company, delegated administration, temporary access, review, simulator or SoD remain | P0/P1 |
| Sales | quotation → order → delivery → invoice → receipt → return/credit | CRM, quote versions, reservations/backorders governance, partial corrections, credit workflow, price lists/promotions, commissions, portal | P2 |
| Purchasing | request → RFQ → PO → receipt → bill → payment → return | quotation comparison, 2/3-way match, acceptance, landed cost/imports, debit notes, performance and limits | P2 |
| Inventory | movement ledger → balance → valuation/report | explicit locking, idempotency, UOM conversions, reservations, bins, lots/serials/expiry, FIFO/FEFO, partial exact returns | P1/P2 |
| Accounting | source → posted journal → reports/reconciliation → journal reversal | reusable posting kernel, document reversal orchestration, close workflow, dimensions, FX revaluation, accruals, budgets, consolidation | P1/P2 |
| Payments/treasury | receipt/payment → allocation → journal; bank statement match | immutable allocation lifecycle, currency fields, payment reversal, advances/unallocated amounts, cheques, transfer pairing, account scopes | P1/P2 |
| POS | shift → sale → stock/journal/tender → return → close | branch/warehouse list and object checks now exist; terminal assignment, partial returns, original-tender refunds, retry idempotency and supervisor overrides remain | P1/P2 |
| Approvals | submit → one manager decision → event/audit | configurable rules/steps, parallel approvals, delegation, SLA/escalation, attachment/comments governance, limit routing | P1 |
| HR/payroll | employee master only | every transactional HR/payroll capability and reconciliation | P3 after kernel |
| Reporting | hardcoded live reports → CSV/PDF | central report metadata, per-report keys, consistent filters/scopes/field redaction, background jobs, saved views, freshness | P1/P2 |
| Integrations/portals | none | complete secure integration and portal foundations | P3 |
| Assets/MRP/projects/maintenance | none | complete domains; keep feature-flagged and out of core navigation | P3 |

## Cross-module integrity gaps

1. `ErpService` combines policy, validation, pricing, posting, stock, payment, reporting and reset. Extracting seams with characterization tests is required before broad changes.
2. State transitions are duplicated and use small enums that cannot express partial fulfillment/settlement/reversal.
3. The idempotency table is not consumed by write endpoints.
4. Stock updates read then upsert without explicit row locking or a version column.
5. Payment allocations store only amount and references; they do not preserve before/after balances, currency, rate, source, reversal, or posting linkage.
6. A Company boundary is absent, so “multi-company” cannot be claimed.
7. Generic JSON assignment fields make referential integrity and scalable scope queries difficult.

## Recommended delivery sequence

Production configuration and access leaks → organization/company model → access governance → transaction/state/idempotency kernel → inventory/payment concurrency → current-domain depth → optional new modules.
