# Data model review

## Inventory

The Prisma schema has 41 models and 11 enums. Tenant ownership is present on all business/access tables, with broad tenant/date/status indexes and foreign keys. Money uses BigInt minor units; quantity uses integer thousandths; exchange rates use millionths.

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
| Legal organization | Tenant → Branch → Warehouse | Add Company/LegalEntity; every accounting/transaction/configuration row receives company ownership |
| User assignments | branch/warehouse IDs stored as JSON | relational user-company/branch/warehouse/department/team/resource assignments with validity dates |
| Roles | tenant role plus JSON legacy permissions | versioned templates and scoped role assignments; retain compatibility during migration only |
| Data scopes | one scope per role/resource, JSON config | normalized policies with explicit NONE/selected-resource/custom predicate references |
| Temporary access | absent | grant header/items, approval, start/expiry, automatic expiry and evidence |
| Approval delegation | absent | delegate, document type, amount, organization scope and validity |
| Access review/SoD | absent | campaigns, decisions, conflicts, exceptions and compensating controls |
| Documents | six-state workflow | reusable transition/event model supporting partial, settled, reversed and correction states |
| Optimistic concurrency | absent | version columns and conditional updates on mutable aggregates |
| Idempotency | table exists but is unused | request identity, operation, actor, status, response hash, expiry and atomic claim |
| Inventory | item/warehouse only | variants, UOM conversions, bin, reservation, lot/batch/serial/expiry and cost-layer models |
| Payments | allocation has three business fields | party/currency/rate, before/after balance, journal, source, reversal and immutable status |
| Currency | documents have currency/rate; other domains mixed | transaction and functional currency on all monetary facts; exact conversion evidence |
| Accounting dimensions | branch and free-text cost center | normalized cost center, department, project, profit center and dimension values |
| Period close | string status | governed close/reopen request, checklist, approvals, close journal and retained-earnings evidence |
| Attachments | JSON on documents | private attachment metadata, storage key, hash, scan status, owner/scope and audit |
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
