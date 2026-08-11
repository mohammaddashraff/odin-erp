# Accounting control matrix

| Control | Current evidence | Status | Required next control |
|---|---|---|---|
| Fixed-point money | BigInt minor units and tested parsers | Substantial | currency-specific precision registry across all domains |
| Journal balance | service validation plus DB trigger on POSTED transition | Complete for current journal paths | invariant/property tests for every source type |
| Posted journal immutability | update/delete and line triggers | Complete for runtime role | retention/restore and break-glass owner monitoring |
| Posted document immutability | document/line triggers | Substantial | immutable payment allocation/stock movement and exact correction orchestration |
| Open-period enforcement | service checks before posting | Substantial | company ledger period, governed close/reopen and DB defense where practical |
| Maker-checker | document/manual-journal self-approval blocks plus mandatory separate checker for outgoing supplier payments | Substantial but incomplete | configurable same-record SoD, approval routing/escalation and governed exceptions |
| Source-to-journal link | unique journal source and document link | Substantial | formal non-accounting classification and completeness report |
| Reversal | linked journal reversal with exact swapped lines | Partial | approval, independent maker-checker, idempotency and source document/stock/payment reversal |
| AR | invoice/receipt/return/credit signed model and reconciliation | Substantial | currency allocation facts, write-time constraints and stable as-of reports |
| AP | bill/return plus submitted outgoing payment approved into atomic allocation/journal effects and reconciliation | Substantial but incomplete | matching, debit notes, currency controls, governed payment reversal and supplier subledger detail |
| Inventory control | inventory account reconciled to stock value | Substantial | cost layers/method choice, locks and historical valuation |
| Cash/bank | company-owned/assigned bank-account scope, posted transactions and exact statement match | Partial | charges, FX, cheque states, non-bank typed-resource adapters and formal cash reconciliation |
| Tax | output/input VAT journal paths and report | Partial | tax engine, jurisdiction/effective dates, withholding, rounding policy and filing locks |
| FX | document rate/date and base journal conversion for AR | Partial | all subledgers, realized/unrealized FX, revaluation and currency balances |
| Fiscal close | OPEN/CLOSED/LOCKED toggle | Placeholder | checklist, trial balance/reconciliations, maker-checker, year-end and governed reopening |
| Dimensions | branch and journal-line cost center string | Partial | normalized cost center/project/profit center/department/company dimensions |
| Budgets/consolidation/intercompany | absent | Missing | implement only after company and accounting kernel |

## Mandatory posting invariants

For every posted source: debit equals credit; tenant/company/branch/currency dimensions are valid; one journal or explicit non-accounting classification exists; period is open; source and journal are immutable; retry creates no duplicate; failure rolls back source status, stock and payment effects.

## Correction policy

Never edit a posted fact. Journal errors use linked reversal and replacement; sales/purchase errors use return/credit/debit workflows; stock errors use linked adjustment; payment errors use allocation/payment reversal. Original plus reversal must produce the expected net by currency, party, warehouse, batch/serial and control account.
