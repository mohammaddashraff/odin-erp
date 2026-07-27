# Customer receivables policy

Odin maintains customer receivables from one signed movement model:

- posted sales invoice: debit/positive receivable;
- posted physical sales return: credit/negative receivable;
- posted credit note: credit/negative receivable;
- posted customer receipt allocation: credit/negative receivable;
- every non-posted or cancelled document: no receivable movement.

`paidMinor` is the persisted allocation total on an invoice. Balance and ageing calculations use
that field once; they do not also subtract payment rows. Statements show the underlying receipt
rows instead, so their chronological debit/credit total reaches the same balance.

Invoice settlement exposes the original-currency gross, paid, returned, credited, net receivable,
remaining amount, and payment status. Customer totals, statements, ageing, dashboard KPIs, and
account 1100 reconciliation use base-currency values translated with each document's preserved
posting exchange rate.

## Excess credits

Odin does not currently have a customer-credit/refund workflow. A sales return or credit note is
therefore rejected when its amount is greater than:

`invoice gross - posted returns - posted credit notes - allocated receipts`

This validation runs during conversion and again atomically during posting. Negative historic
balances remain visible as `CREDIT_BALANCE`; they are never silently clamped to zero.

Correction documents must be converted from a posted invoice and preserve both
`sourceDocumentId` and every `sourceLineId`. Posted documents and their lines remain protected by
the PostgreSQL immutability triggers.
