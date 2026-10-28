# ODIN ERP accounting reconciliation

Audit run: `2026-09-26-odin-audit`  
Status: **VERIFIED_PASS** for the deterministic fixture and the deployed-demo integrity checks described below.

All amounts in the reference fixture use EGP minor units in an isolated synthetic tenant/company,
a single currency, zero tax, the same posting-date range, and posted records only. The fixture is a
calculation test, not a tax-policy recommendation. It creates unique records and calls the real
`ErpService` workflows; it does not edit balances or insert unexplained journal lines.

## Deterministic event-to-posting matrix

| Business event | Workflow transition | Debit | Credit | Stock/subledger/report effect |
|---|---|---:|---:|---|
| Opening funds | journal draft → submit → approve → post | Bank 10,000 | Equity 10,000 | Bank and balance sheet increase |
| Receive 10 units × 100 | PO → goods receipt → post | Inventory 1,000 | GRNI 1,000 | Quantity +10; inventory value +1,000 |
| Recognize supplier bill | receipt → bill → post | GRNI 1,000 | AP 1,000 | Supplier payable +1,000; GRNI clears |
| Deliver 4 units | sales order → delivery → post | COGS 400 | Inventory 400 | Quantity −4; inventory value −400 |
| Recognize sales invoice | delivery → invoice → post | AR 600 | Revenue 600 | Customer receivable +600 |
| Receive and allocate 300 | customer receipt → post | Bank 300 | AR 300 | Customer receivable −300 |
| Approve and allocate supplier payment 400 | payment submit → different checker approves | AP 400 | Bank 400 | Supplier payable −400 |

Raw debit and credit **turnover** are each 13,700 because the GRNI receipt/bill clearing entries are
both real activity. A trial balance must present each account's net ending debit or credit balance;
its correct ending totals are 11,200 each. The original report incorrectly displayed turnover as the
trial-balance debit/credit columns. `ODIN-FIN-001` fixes that distinction while leaving the general
ledger and account-ledger activity views unchanged.

## Reference expected versus observed

| Measure | Expected | Observed | Difference | Status |
|---|---:|---:|---:|---|
| Bank | 9,900 | 9,900 | 0 | VERIFIED_PASS |
| Inventory quantity | 6 | 6 | 0 | VERIFIED_PASS |
| Inventory value | 600 | 600 | 0 | VERIFIED_PASS |
| Customer receivable | 300 | 300 | 0 | VERIFIED_PASS |
| Supplier payable | 600 | 600 | 0 | VERIFIED_PASS |
| Sales revenue | 600 | 600 | 0 | VERIFIED_PASS |
| Cost of goods sold | 400 | 400 | 0 | VERIFIED_PASS |
| Profit before other items | 200 | 200 | 0 | VERIFIED_PASS |
| Trial-balance debits | 11,200 | 11,200 | 0 | VERIFIED_PASS |
| Trial-balance credits | 11,200 | 11,200 | 0 | VERIFIED_PASS |
| AR subledger − AR control | 0 | 0 | 0 | VERIFIED_PASS |
| AP subledger − AP control | 0 | 0 | 0 | VERIFIED_PASS |
| Inventory valuation − inventory control | 0 | 0 | 0 | VERIFIED_PASS |

The test also asserts that each posting is represented once, the posted journals balance, the
ending inventory has quantity six and value 600, GRNI is zero, and the income statement profit is
200. Evidence: `artifacts/audit/2026-09-26/logs/final-full-test.log`; implementation and assertions:
`apps/api/src/accounting-reference.database.spec.ts`.

## Deployed demo baseline

The server-side integrity command was run against the verified isolated copy of the deployed demo
data. It reported 5 posted journals, total debits and credits of 2,728,300.00 each, no negative-stock
rows, and zero differences for ledger balance, inventory-to-control, AR-to-control, and AP-to-control.
Evidence: `artifacts/audit/2026-09-26/logs/integrity-isolated.log`.

This result does not prove that every historical posting used the intended account or that every UI
report filter is correct. The deterministic fixture independently checks the requested main path;
existing database suites cover returns, reversals, partial conversion limits, tax/rounding rules,
period locks, posting retry protection, authorization, payment maker/checker, and transaction
rollback. Foreign-currency revaluation, governed closing, advances, landed cost, and concurrent
stock-row locking remain product gaps in `REMAINING_BACKLOG.md`.
