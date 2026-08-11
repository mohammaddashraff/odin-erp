# Module gap analysis

Current-tranche classifications use **Implemented**, **Partially implemented**, **Tested**,
**Requires external/provider evidence**, and **Not implemented**. The priority table below is a gap
analysis, not a PASS record; see `CURRENT_CAPABILITY_MATRIX.md` for per-capability classification.

## Prioritization method

Priority is based on financial/security exposure, integrity dependency, and workflow completeness. P0 blocks production use; P1 blocks enterprise access or core transaction maturity; P2 deepens existing domains; P3 is new optional scope.

| Domain | Current connected workflow | Highest-risk gaps | Priority |
|---|---|---|---|
| Platform operations | Vercel-shaped web/API configuration and PostgreSQL | production secret/reset, MFA/session controls, PR security gates and a repository restore drill exist; production promotion, provider IAM/KMS/PITR/cross-region evidence, alerting and provider attachment recovery remain | P0 |
| Access control | registry → roles/user policy → company/temporary/delegated policy → guard/service → UI/audit | default-NONE, bounded company governance, bank/GL assignments, temporary access, delegation, `WARN`/`BLOCK` SoD, review, simulator, projection and private attachments exist; remaining shared masters, non-bank/GL domain adapters, complete governance UI, configurable same-record SoD and final verification remain | P0/P1 |
| Sales | quotation → order → delivery → invoice → receipt → return/credit | CRM, quote versions, reservations/backorders governance, partial corrections, credit workflow, price lists/promotions, commissions, portal | P2 |
| Purchasing | request → RFQ → PO → receipt → bill → payment → return | quotation comparison, 2/3-way match, acceptance, landed cost/imports, debit notes, performance and limits | P2 |
| Inventory | movement ledger → balance → valuation/report | explicit locking, idempotency, UOM conversions, reservations, bins, lots/serials/expiry, FIFO/FEFO, partial exact returns | P1/P2 |
| Accounting | source → posted journal → reports/reconciliation → journal reversal | reusable posting kernel, document reversal orchestration, close workflow, dimensions, FX revaluation, accruals, budgets, consolidation | P1/P2 |
| Payments/treasury | immediate receipt posting; outgoing payment submission → checker approval/rejection → allocation/journal; bank statement match | currency-rich allocation facts, payment reversal, advances/unallocated amounts, cheques, transfer pairing and broader typed-resource domain adapters | P1/P2 |
| POS | shift → sale → stock/journal/tender → return → close | branch/warehouse list and object checks now exist; terminal assignment, partial returns, original-tender refunds, retry idempotency and supervisor overrides remain | P1/P2 |
| Approvals | submit → one manager decision → event/audit | configurable rules/steps, parallel approvals, delegation, SLA/escalation, attachment/comments governance, limit routing | P1 |
| HR/payroll | employee master only | every transactional HR/payroll capability and reconciliation | P3 after kernel |
| Reporting | hardcoded live reports → CSV/PDF | central report metadata, per-report keys, consistent filters/scopes/field redaction, background jobs, saved views, freshness | P1/P2 |
| UI/localization | centralized Western-digit formatting, translation, shared loading/motion primitives, semantic palette and module accents | current full-route/browser evidence, contrast/accessibility depth and unfinished governance mutation forms remain tranche gaps | P1 |
| Integrations/portals | none | complete secure integration and portal foundations | P3 |
| Assets/MRP/projects/maintenance | none | complete domains; keep feature-flagged and out of core navigation | P3 |

## Cross-module integrity gaps

1. `ErpService` combines policy, validation, pricing, posting, stock, payment, reporting and reset. Extracting seams with characterization tests is required before broad changes.
2. State transitions are duplicated and use small enums that cannot express partial fulfillment/settlement/reversal.
3. The idempotency table is not consumed by write endpoints.
4. Stock updates read then upsert without explicit row locking or a version column.
5. Final payment allocations still lack before/after balances, transaction/functional currency and
   rate, reversal lineage and a generalized event history, despite the new pending allocation plan
   and checker state.
6. A Company boundary now covers membership, branches, customers, suppliers, mapped bank/GL objects
   and branch-derived facts, but remaining tenant-level masters/configuration prevent a claim of
   complete multi-company accounting.
7. Relational Company and financial-resource assignments coexist with legacy branch/warehouse JSON
   and JSON scope/resource envelopes; complete normalized team/department/branch assignment and
   custom policy references remain future work.

## Recommended delivery sequence

Production configuration and access leaks → organization/company model → access governance → transaction/state/idempotency kernel → inventory/payment concurrency → current-domain depth → optional new modules.
