# Data model review

## Inventory

The verified pre-tranche Prisma schema at `2ad6968` has 48 models, 14 enums and 14 migrations.
Tenant ownership is present on all pre-tranche business/access tables, with broad tenant/date/status
indexes and foreign keys. Money uses BigInt minor units; quantity uses integer thousandths; exchange
rates use millionths. Recount models/enums/migrations after the current additive migration is final;
do not copy these baseline totals into current verification evidence.

| Current-tranche model area | Classification | Boundary |
|---|---|---|
| Company and normalized selected-resource ownership | Partially implemented | Company, time-bounded membership/branch mapping, customer/supplier ownership and typed financial resources/assignments are additive; current cross-company regressions pass, while tenant-shared master depth remains incomplete |
| Temporary grants, delegation, SoD and access review/simulation | Partially implemented | validity/revocation, `WARN`/`BLOCK` rules on current permission-set mutations, immutable review evidence and non-mutating explanation records are additive and current regressions pass; configurable same-record rules and governed exceptions remain incomplete |
| Centralized field policy and private attachments | Implemented | projector plus DB-backed safe metadata/content/ticket/audit controls are additive; future response coverage and provider storage/scanner remain incomplete |
| Generalized authority limits | Partially implemented | Existing sales limits plus company/currency/time-bounded authority policies and current document/payment/journal/treasury adapters are additive; complete domain routing and escalation remain incomplete |
| Provider object storage, scanner and attachment recovery | Requires external/provider evidence | Metadata and authorization hooks cannot establish provider IAM/KMS/scanning/recovery evidence |

## Strong foundations

- Tenant-qualified business codes and document numbers.
- Composite stock-balance key by tenant/warehouse/item.
- Unique source journal and reversal linkage.
- Source-document and source-line traceability.
- Separate movement ledger and current stock balance.
- Persisted approval/audit events and access assignments.
- Additive migrations preserve legacy role/user compatibility.

## Structural gaps

| Area | Current state | Target change |
|---|---|---|
| Legal organization | Tenant → Company membership/mapping → Branch → Warehouse for branch-derived transactions | propagate explicit Company ownership to remaining tenant-shared masters/configuration and prove every cross-company join |
| User assignments | relational time-bounded Company and typed financial-resource assignments coexist with legacy branch/warehouse JSON | complete branch/warehouse/department/team normalization through a measured dual-read migration |
| Roles | tenant role plus JSON legacy permissions | versioned templates and scoped role assignments; retain compatibility during migration only |
| Data scopes | one scope per role/resource, JSON config | normalized policies with explicit NONE/selected-resource/custom predicate references |
| Temporary access | company/scope/start/expiry/reason/grantor/revocation with active-window evaluation | add mature approval/recertification workflow and operational expiry monitoring |
| Approval delegation | bounded company/scope/start/expiry/reason/revocation with non-escalation | extend to document type/amount routing as approval graphs mature |
| Access review/SoD | immutable review evidence, effective-access explanation, seeded `WARN` rules and persisted `BLOCK` enforcement on current permission-set mutations | add campaign depth, configurable same-record rules, governed exceptions and compensating controls |
| Documents | six-state workflow; outgoing payments have a separate submitted/posted/rejected state | reusable transition/event model supporting partial, settled, reversed and correction states across domains |
| Optimistic concurrency | absent | version columns and conditional updates on mutable aggregates |
| Idempotency | table exists but is unused | request identity, operation, actor, status, response hash, expiry and atomic claim |
| Inventory | item/warehouse only | variants, UOM conversions, bin, reservation, lot/batch/serial/expiry and cost-layer models |
| Payments | branch and submitted/posted/rejected status, pending allocation plan, maker/checker actors/timestamps/comment, journal and final allocation rows | add transaction/functional currency and rate facts, before/after balance evidence, governed reversal and reusable transition history |
| Currency | documents have currency/rate; other domains mixed | transaction and functional currency on all monetary facts; exact conversion evidence |
| Accounting dimensions | branch and free-text cost center | normalized cost center, department, project, profit center and dimension values |
| Period close | string status | governed close/reopen request, checklist, approvals, close journal and retained-earnings evidence |
| Attachments | DB-backed private metadata/content with owner scope, hash, allowlisted type/size, safe filename, signed user-bound ticket, audit and `NOT_CONFIGURED` scanner status | integrate provider object storage, real malware scanner and attachment recovery evidence |
| Integration/events | absent | outbox, inbox/idempotency, delivery attempts and dead letters |

## Constraint gaps

- Add tenant/company consistency checks across foreign-key pairs; current independent foreign keys can theoretically connect same-tenant assumptions incorrectly through owner/admin paths.
- Add non-negative/check constraints for prices, amounts, rates, allocation amounts and allowed debit/credit line shapes.
- Add database prevention for over-allocation and over-return through locked aggregate operations and immutable facts.
- Add unique open POS register/session constraint, not only application pre-check.
- Add explicit stock row locking/version and unique movement identity per source line/direction; current movement key may be too coarse for legitimate split lines and too weak for some retries.
- Replace free-form fiscal status with an enum or governed state table.

## Migration principles

Add, backfill, validate, dual-read, switch, then retire. Large constraints should be created in low-lock forms where PostgreSQL permits and validated separately. Never run demo seed during migration. Every migration is tested against a production-shaped copy and has a forward-fix plan.
