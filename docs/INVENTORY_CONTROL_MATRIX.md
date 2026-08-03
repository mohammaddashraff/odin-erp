# Inventory control matrix

| Control | Current evidence | Status | Required next control |
|---|---|---|---|
| Canonical movements | `StockMovement` records each posting and running totals | Substantial | source line, direction identity, company, bin, batch/serial and reversal link |
| Perpetual balance | composite warehouse/item balance | Substantial | row lock/version and corruption repair workflow |
| Negative stock | service check and DB balance trigger | Substantial | concurrency proof under simultaneous issues |
| Costing | weighted-average issue cost from current value/quantity | Partial | explicit configured method, cost layers, rounding residual policy |
| Transfer | paired warehouse operations via document posting | Substantial | in-transit state, acceptance, idempotency and exact reversal |
| Receipt/delivery | source-linked lines and partial conversion limits | Substantial | reservation/backorder state and over-return DB defense |
| Adjustment/count | adjustment and stock-count document types | Partial | blind count, freeze/snapshot, approval amount limits and variance reasons |
| UOM | unit master and integer quantity | Partial | conversions, base/entered quantity and rounding rules |
| Warehouse scope | actor assignment checks on many writes/reports | Unsafe in some reads | central predicate for every POS/list/report/export/evidence path |
| Bins/lots/serials/expiry | absent | Missing | normalized traceability and FEFO allocation |
| Reservations/availability | absent | Missing | on-hand, reserved, available, committed and in-transit facts |
| Historical valuation | movement/running value present | Partial | as-of reconstruction tests, cost layers and correction links |
| Reconciliation | stock balance to account 1200 checker | Substantial | company/warehouse/currency filters and scheduled exception workflow |

## Concurrency design

Claim idempotency, lock the ordered set of stock-balance rows with `SELECT ... FOR UPDATE`, validate availability, append immutable movements, update versioned balances, create the accounting entry, and commit once. All retries must reuse the same operation key and return the prior result. Tests must attempt two simultaneous sales, transfers, returns, counts and serial allocations.

## Inventory definition of done

A movement workflow is incomplete until permission/scope/limit/approval, exact stock and cost effect, journal, traceability, report/export, reversal, audit, Arabic/English, concurrency and reconciliation tests pass.
