# Migration and opening balances

The delivery was developed from main `828ae27bd17682739d192115ed163781f2388bea` in an isolated checkout. Forward migrations were applied to fresh local AV8 development and test databases, then exercised with synthetic historical and current workflows. No production migration or real client opening import has been executed. See [acceptance evidence](05-test-results-and-evidence.md) for the final rehearsal result, rather than relying on earlier deployment documents.

## Schema release

Use Node24 and the committed npm lockfile. Run `npm ci --ignore-scripts`, then generate the Prisma client using the target's protected configuration. `npm run release:migrate` now runs **only** `prisma migrate deploy`. It cannot implicitly run the synthetic seed. `prisma/av8-seed.ts` accepts only isolated `AV8_ENV=dev|test`; production and hosted staging require reviewed reference setup and opening import.

The additive delivery migrations introduce confirmed policy versions and calendar due dates; receipt FX/fee metadata; immutable financial, report and operational evidence; wallets; statement source identities; immutable opening sources; reversal/allocation guards; normalized contact search keys; and a separately classified bank-fee reimbursement lifecycle. Read every migration in order and verify the checksums in `_prisma_migrations`. Never edit an applied migration to resolve a production failure. Investigate data violating a new constraint and add a reviewed forward correction or restore before accepting new entry.

Existing signed contracts keep their original snapshots and historical currency rates. New draft policy versions do not change signed terms or manufacture approval. Normalized contact fields are derived search/review keys; their migration preserves original names/phones/emails and never merges people. Wallet enum additions and tighter immutable/financial guards are not undone safely by simply redeploying old application code.

## Cutover procedure

1. Finance selects a date-only cutover boundary and freezes source entry through that date. Assign a source-system identifier, retain the signed source workbook/export privately and record its checksum, reviewer and reconciliation evidence. Do not place personal opening files in Git or CI artifacts.
2. Reconcile the source by company, managing branch, student, academy, resource and original currency. Separate contractual outstanding principal, cleared/unapplied student funds, actual academy transfers, remaining obligations, services, pending refunds and actual fee balances. These categories are not interchangeable.
3. Configure real named users, active companies/branches, currency precision, resources, approved GL mappings and the decisions in [02](02-business-rules-and-decisions.md). Resource assignments and field grants are required in addition to action permissions. A shared family phone is a duplicate-review prompt, not proof of one person.
4. Prepare and independently approve the opening journal through the existing accounting workflow. Supply its posted ID and exact resource/control lines. The importer verifies this journal; it does not guess balancing accounts or create replacement historical bank receipts/remittances.
5. Prepare the versioned JSON manifest described in [opening-manifest.md](opening-manifest.md). Include original student/person/application identifiers, signed evidence, original schedule rows, dates, receipt/remittance references, allocations and historic rates, balances and original approval references. Missing source evidence stays an explicit preview error.
6. In Collections & academy → Opening data, upload the manifest and run the dry run. Resolve every row/control discrepancy. Compare preview counts/totals and hash with the approved source, then commit with the reviewed reason and unchanged hash. The server revalidates; changing the file invalidates the preview.
7. Save returned source-to-application/contract/charge/obligation/fund IDs and audit references. Re-uploading the identical source safely returns its existing mapping; a changed source ID or another baseline for the same resource is rejected. A historical fund is represented by the approved opening journal and never creates a new collection or transfer.
8. Compare student statements, academy statements, services/pending refunds, resource original balances and GL book values. Treasury uses the unique original resource baseline plus actual movements **strictly after** the cutoff date. Freeze all transactions on the cutover day; no unsupported intraday splitting is inferred. Only then unlock new entry.

## Exceptions and rollback boundary

Imported pending refunds require explicit policy/approval reconciliation before new payouts. Historical service balances retain their supplied collection party. Do not backfill guessed receipts, rates, admission decisions, signatures, bank fees or academy payments to make totals agree. Missing original evidence blocks only affected rows/batches and remains a named reconciliation exception.

A failed import transaction leaves no partially committed application set. A successful import is immutable evidence, not an editable spreadsheet. Before operational entry starts, an incorrect cutover can be corrected by restoring the independently verified pre-cutover database/documents and repeating the approved import. After new entry starts, preserve it and use approved linked corrections; wholesale rollback risks losing later legitimate activity. See [07](07-deployment-and-recovery-runbook.md).
