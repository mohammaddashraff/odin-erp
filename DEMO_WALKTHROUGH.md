# Odin ERP client demonstration

Use the browser only after starting the stack. All demo users use the password `password`.

## 1. Light mode, dashboard, and language

1. Sign in at `http://127.0.0.1:8080` as `admin@odin.demo`.
2. Show the light-mode dashboard, live KPI cards, alerts, and integrity status.
3. Select Arabic in the header. Confirm Arabic labels, right-to-left navigation, and layout.
4. Return to English; the selection persists.

## 2. Sales chain and its effects

1. In **Masters**, create a customer if desired.
2. In **Sales**, create a quotation with customer, branch, warehouse, dates, payment terms, tax
   mode, notes, and one or more item lines.
3. Convert the draft quotation directly to a sales order, then submit the order for approval.
4. Switch to `finance@odin.demo`, open **Approvals**, add a comment, and approve the order.
5. Convert only the required remaining quantity to a delivery note; submit, approve, and post it.
6. Convert the delivered quantity to a sales invoice; submit, approve, and post it.
7. Open the invoice detail to show its related-document chain, journal entry, delivery stock
   movement, COGS, revenue, VAT, and AR effects.
8. In **Payments**, create and allocate a partial customer receipt. Show the invoice paid amount,
   customer statement, and AR aging.
9. Convert the invoice to a sales return or credit note. Post it and show inventory restoration and
   reversed revenue, VAT, receivable, inventory, and COGS effects.

The conversion dialog exposes remaining quantities and rejects over-conversion in the API.

## 3. Purchasing chain and its effects

1. Create a supplier in **Masters**.
2. Create and submit a purchase request; convert it to a purchase order.
3. Switch users for approval, then post the order.
4. Convert a selected remaining quantity into a goods receipt for a selected warehouse and post it.
5. Convert received quantities into a supplier bill. An amount greater than the remaining received
   quantity is rejected.
6. Post the bill and show GRNI, input VAT, AP, inventory movement, and document chain.
7. Create a partial supplier payment. Show that it remains **Submitted** with no journal or
   allocation effect, then switch to a different authorized checker and approve it. Show the posted
   allocation, supplier statement, AP aging, and retained maker/checker evidence.
8. Create a purchase return and show stock reduction and reversal of payable, VAT, and inventory.

## 4. Inventory

1. Create a category, unit, item (including SKU/barcode/prices/VAT/reorder level), and warehouse.
2. Show stock by item and warehouse and open the stock-card history.
3. Create, submit, approve, and post a warehouse transfer. Compare source, destination, and total
   inventory value before and after.
4. Post inventory gain/loss adjustments and inspect the generated journal.
5. Enter a stock count, compare system and counted quantities, then post its variance.
6. Attempt to issue more stock than available and show the backend rejection.

## 5. POS

1. Sign in as `cashier@odin.demo` and open a shift with opening cash.
2. Search by name/SKU or scan a barcode, change quantity, and apply an allowed discount.
3. Select a customer or use walk-in, hold the sale, then resume it.
4. Complete with exact cash/card split tender and open the receipt PDF.
5. Show the reduced inventory and revenue, VAT, COGS, cash, and card-ledger effects.
6. Return the POS sale.
7. Close the shift with actual cash and show expected cash, actual cash, variance, over/short entry,
   and shift report.

## 6. General accounting and banking

1. As `accountant@odin.demo`, create a balanced multi-line journal with branch/cost center and
   submit it. Demonstrate unbalanced and restricted-control-account rejections.
2. As another authorized user, approve and post it.
3. Attempt to edit the posted journal and show the immutable-entry rejection.
4. Reverse it with a reason and an open date; show the original/reversal link in the ledger.
5. Close a fiscal period, attempt a dated posting, show the backend rejection, then reopen it.
6. Create cash/bank accounts and record receipts, payments, and account transfers.
7. Enter a bank statement line, match it to a system transaction, and show the reconciled state and
   statement/unmatched differences.

## 7. Reports, permissions, audit, and reset

1. Open **Reports** and show the trial balance, general ledger, account ledger, financial
   statements, AR/AP reports, inventory reports, sales/purchase reports, and POS shift report.
2. Click a source reference to drill down to the journal/document evidence. Export CSV/PDF and use
   browser print.
3. Sign in as `auditor@odin.demo`; create/post/reverse actions are absent and backend writes are
   denied. Sign in as `cashier@odin.demo`; accounting administration is unavailable. Sign in as
   `warehouse@odin.demo`; profitability reports are unavailable.
4. Show approval history/comments and the append-only audit trail.
5. As administrator, open **System**, enter the confirmation text and password, and reset the
   selected tenant. Show the returned reconciliation result and the restored deterministic state.
