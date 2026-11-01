# Data and financial model

This document describes the implementation in the delivery branch. It is not a declaration that production balances or policies have been approved. Acceptance results and release identity are maintained in `05-test-results-and-evidence.md` and the release runbook.

## Identity, agreements and operations

An `Av8Lead` represents the enquiry and its follow-up history. A `Customer` is the person/contact identity. An `Av8Application` is one enrolment; repeat applications preserve the person and maintain separate contract, schedule, academy and refund balances. Tenant, owning company/branch, assigned employee and academy references are checked independently of which authorized company resource collects cash.

`Av8Policy` stores versioned plans, commercial settlements, refund and cheque selections, document/planning settings and the accounting mapping. New material finance policies are DRAFT until authorized approval. A signed contract is an immutable `Av8Record` containing the selected policy versions, full 8/8/2 schedule, actual signing date and source evidence. Approved amendments append their reason, original values, changes, approval and signed evidence. Legacy signed snapshots remain readable with their old interpretation.

`Av8Record` also holds typed operational event records; its `kind`, `status`, versioned JSON data and application/tenant references are interpreted by explicit service methods. Private `Av8Attachment` evidence belongs to a student record and is protected by category permissions. File upload is separate from acceptance/review. The model uses immutable evidence records for financial approvals, service payments, report versions and completed operational events rather than overwriting their source history.

## Financial entities

| Entity | Meaning | Must not be confused with |
|---|---|---|
| `Av8Charge` | Student USD obligation, date/milestone, actual allocation sum and authorized credit adjustments | Bank cash or a completed payment |
| `Av8Fund` RECEIPT | Verified money received; source currency/precision, original amount, USD/base rates, principal credit and actual bank/journal link | Cheque handed over but not cleared |
| `Av8Allocation` charge link | Amount of an actual receipt applied to one student charge, or linked negative correction/refund allocation | A new receipt or second bank posting |
| `Av8Obligation` | Academy USD entitlement/scheduled action; due date, original source rule and optional receipt allocation | An actual transfer |
| `Av8Fund` REMITTANCE + obligation allocations | Actual academy transfer, separately prepared, approved and confirmed against source evidence | Merely becoming due |
| `Av8Fund` REFUND | One approved partial/full actual student payout linked to its case and original receipt sources | Entire case entitlement or a request |
| `Av8Fund` FEE_REIMBURSEMENT | Actual separate bank receipt clearing an approved bank-fee ASSET receivable | Tuition paid, academy principal or ordinary refundable tuition |
| `Av8Record` bank-fee | Actual student-attributed paid bank charge, approved expense/receivable/offset snapshot and remaining reimbursement | A speculative surcharge or fee waiver |
| `Av8Record` remittance-basis | Immutable original receipt and historical liability allocation used in an actual academy transfer | A rewrite of the approved cash instruction or current market rate |
| `Av8Fund` ACADEMY_RECOVERY | Actually received return of an original academy transfer | Expected recovery approval |
| `Av8Record` refund + refund-approval | Termination date/deadline, approved policy/expense/disposition snapshot, payout and recovery state | A payment instruction alone |
| `Av8Record` cheque + cheque-event | Receipt/presentation/clearance/return/cancellation/replacement and immutable transition evidence | Cleared money before selected event |
| `Av8Record` expense/service-payment | Actual paid student-linked expense or monthly service allocation/evidence | Tuition principal or automatic refund deduction |
| `BankTransaction` + `JournalEntry` | Authorized actual resource movement and balanced base-currency double entry | Commercial commission estimate |

Money is integer minor units, rates integer millionths. Original currency precision is read from `Currency.precision` and frozen in fund metadata with base precision. USD obligations remain two decimals. `convertMinor` applies scale adjustment and exact rounding. Dates with contractual meaning are date-only; operational timestamps retain their instant and render in Africa/Cairo.

## Reconciliation and postings

Ordinary receipt: debit selected bank/cash GL, credit the scoped student-collections LIABILITY GL. Academy transfer and student refund: debit the student-collections liability, credit actual resource. Academy recovery reverses the original transfer direction. These cash entries do not declare retained money to be earned revenue. Approved commission revenue recognition and statutory tax treatment remain D11 decisions.

Refund metadata preserves `entitlementUsdMinor`, `liabilityBaseMinor`, `liabilityAccountId`, `policyId`, `fxDifferenceAccountCode`, and `originalReceiptAllocations`. Recovery metadata also preserves `originalRemittanceId` and, for transfers with source-basis evidence, the exact recovered `originalReceiptAllocations`. Academy remittances preserve the same historical source basis in immutable `remittance-basis` records; source cash transferred at a later rate has an explicit approved FX posting rather than silently changing liability or student credit. Actual payout or recovery may use a different current conversion only under the selected policy. The journal clears the historical liability basis and posts the exact actual base difference to the approved scoped GL; the original receipt's USD credit/rates stay immutable. An inactive/inaccessible historical GL must be explicitly reconciled rather than silently remapped. A refund spanning multiple historical liability GLs is split into instructions at that boundary.

Gross/fee/net receipt metadata distinguishes documented student-borne bank deductions from principal. This implemented deduction treatment posts only net cash and credits only net principal. A gross USD 2,000 payment with USD 20 bank deduction yields USD 1,980 cleared cash/principal and USD 20 still due. Company fee expense/reimbursement is zero for this deduction treatment. A separate approved BANK_FEE/REMITTANCE treatment records actual additional bank fees: debit expense/credit bank, debit exact student ASSET receivable/credit the explicitly selected accrued-reimbursement offset. Principal transfer remains unchanged; the bank movement includes principal plus fee. Each student share creates an immutable fee assessment. Actual FEE_REIMBURSEMENT receipts debit bank and credit the original receivable. The final partial reimbursement clears the remaining historical base minor unit; any actual rounding/FX difference uses the approved mapping. The accrued offset is not falsely labelled actual cash reimbursement. Neither path changes agreed academy entitlement.

Student paid amount is the net sum of cleared charge allocations, including negative correction/refund entries. Student balance is charge amount minus approved credits minus net paid. Unapplied credit is available cleared receipt credit minus tuition allocations and net AV8 service-payment allocations; direct provider payments are excluded. Returned cheque receipts are excluded from current available principal while their original bank history remains intact.

Academy original entitlement plus approved obligation adjustments is compared with actual cleared remittance allocations. Scheduled future due, currently due/overdue, funding available, actual transferred and funding exposure are distinct. Cash-plan entitlement is USD 54,000 at signing +3 months; any legacy advance is included within this total. Later instalment entitlement is generated from actual allocated principal only. A partially returned receipt cancels only its untransferred entitlement; already transferred amounts create a funding exposure. Replacement cash restores that exposure before generating new transfer entitlement.

Refund case entitlement = eligible actual cleared student principal received − prior actual refunds − unique explicitly eligible actual paid expenses, floored at zero. Service collections are not silently treated as tuition. Local payout availability = eligible received − actual refunds − actual academy transfers + actual academy recoveries − actual bank fees advanced + actual bank-fee reimbursements. Pending/approved payout instructions reserve entitlement and available sources. Concurrent attempts cannot exceed either cap. The deadline remains original termination +45 days throughout requests, disputes, escalation, academy recovery and partial payout.

## Integrity and correction controls

- Tenant RLS and reference bindings; company/branch/assignment permission checks; explicit authorized bank/GL resources; amount authority limits and fiscal period locks.
- Transactional numbering and idempotency response persistence. Same request key cannot cause duplicate bank, allocation or journal effects; changing its body conflicts.
- Immutable signed contracts, posted fund amounts/rates, allocations and approved financial evidence. Reversal allocations point to one original allocation and cannot be repeated.
- Database guards cap combined tuition and monthly service usage against one cleared receipt; provider payments cannot carry an AV8 fund; service reversals exactly negate their original payment once.
- Remittance allocations cannot exceed the adjusted outstanding obligation. Application-level source funding and termination checks remain within the same serializable transaction as posting.
- Independent approval of outgoing cash, refund entitlement, cheque returns and allocation corrections. Deferred corrections preserve any actual transfer with an explicit funding-restoration trail. Original cash is not reposted for an allocation-only correction.
- Original signed application charge dates are copied into new signed snapshots. Resource operating branch (`FinancialResource.metadata.branchId`) and receipt collection branch remain separate from application/journal business branch; both must belong to the company and be authorized.
- Actual cheque returns create an exact original-journal reversal in an open posting period, with maker/checker and bank evidence. Services using the receipt must be reversed before the return; refunds using it must retain source consistency.
- Refund approval snapshots keep all signed terms, policy version, eligible expense evidence and unpaid-charge disposition. Imported pending cases can be explicitly reviewed without resetting their source termination date.

## Historical import boundary

Opening imports must have a source registry, dry run, balanced control totals, approved existing opening journal and explicit cutover/source identifiers. `metadata.importKind = OPENING_HISTORY` identifies genuine historical funds and stores their opening journal/source/liability mapping. They may be represented as CLEARED history without a new bank transaction only through the narrow validated import path. Importing history must not call collection/remittance posting methods or generate new actual cash. Historic signed schedules are preserved, and unresolved imported refund cases require an explicit policy review before payout.

Operational/import details and rehearsed migration evidence are added by the owning workstream. Production data was not loaded or altered during local verification.

## Operational state and evidence

| Record kind | Evidence/state rule |
| --- | --- |
| `eligibility`, `admission` | Immutable decisions with reviewer/reason/date and exact eligibility/document evidence. Admission requires the final medical pass, verified eligibility and applicable accepted documents. |
| `document` | Working status plus append-preserved review history, issue/expiry dates and verified attachment IDs. Upload alone does not approve it; a reasoned not-applicable conditional item is distinct from a missing required item. |
| `progress`, `report-version` | Editable received report and immutable reviewed revision. Original source report attachments, structured exam rows, hours, qualifications and meaningful results are retained. Correction creates another reviewed version. |
| `academic-dispatch` | One row per reviewed version and recipient. Address/consent snapshot, exact report, attempts, provider reference, claim/lease and state history. Provider acceptance, delivery, failure and unknown outcome are distinct. |
| `training`, `financial-hold` | Internal overdue hold is distinct from requested/notified/academy-confirmed suspension and resumption. Confirmation needs evidence; resumption needs selected clearance policy or authorized exception. No automatic due-date or unrelated service changes. |
| `graduation` | Academic completion date/evidence. It does not close financial balances or assert employment/licensing guarantees. |
| `service`, `service-charge`, `service-payment` | Effective-dated monthly agreement, unique agreement/month charge and actual evidenced payment. Paid/outstanding use exact original currency. AV8-collected credits consume a linked cleared receipt; provider-collected payments do not affect AV8 cash. |
| `expense` | Draft or evidenced actually paid AV8 supplier expense, with separate source currency/rate, supplier/invoice, posted bank movement, USD basis and explicit refund eligibility. Insurance is USD400; no automatic student surcharge. |

A service payment correction appends `service-payment` with `reversalOf`, the exact negative original amount/USD credit and new reason/evidence/date. Only one full inverse of the original is allowed; reversal-of-reversal is prohibited. History remains immutable and current balances use the net. Academic dispatch external requests run outside retryable database transactions. The worker claims one row atomically and persists a two-minute sending lease. Expired sending or ambiguous provider response becomes `DELIVERY_UNKNOWN` and requires provider reconciliation; successful recipients are not blindly replayed. Separate named worker actors maintain expected reports, financial holds and refund deadline tasks through the same scope rules as staff.

## Cutover source identities and control balances

`Av8OpeningSource` / `av8_opening_sources` is an immutable, tenant-bound registry keyed by source system, kind and source ID. PERSON maps repeated source applications to one contact; APPLICATION maps original applications; FUND prevents reusing one historical cleared payment; BATCH holds the preview hash, cutover approval, imported ID mapping, control totals and resource/supplier/customer opening balances. A source checksum collision is an error, never a silent overwrite.

The import is one serializable transaction after a complete dry run. Original signed attachment bytes, amounts, actual dates, historical rates, charge/obligation allocations and pending refund source evidence are preserved. Historical funds have no new BankTransaction; their narrow `OPENING_HISTORY` metadata points to the independently approved, posted, same-branch opening JournalEntry and actual liability account. Database guards preserve this boundary and forbid reversing the supporting journal under already imported paid history. The importer does not call collection/remittance posting and does not infer new academy milestones.

Resource opening amounts retain original currency and reconcile via documented rates to the approved journal's book-currency GL amount. Every resource has one opening baseline across all source systems/batches, and each resource in a batch has its own GL control. Customer and supplier liability source balances reconcile per control GL credit-minus-debit total. These balance sheet controls are separate from operational future student/academy obligations. Treasury shows original opening plus movements strictly after the end-of-day cutoff and independently displays ledger book balance. Entries during cutoff must be frozen; original same-day history is included in the approved source closing balance.

Imported signed schedules use `IMPORTED_SIGNED` and their actual original dates/amounts. Current financial templates cannot regenerate or re-anchor them. Any deferred pass-through must have the explicit original settlement flag and approval reference. Imported pending refunds remain decision-required until a reviewed case reconciles current authorized treatment with original termination/deadline and approval evidence. This avoids turning old approval references into new cash authorizations.

Supplier opening balances are consumed by immutable `supplier-opening-settlement` records keyed to the original source system, batch and balance index. An existing posted bank movement or independently approved manual payment journal supplies the actual cash evidence. Signed original/book amounts preserve payable versus supplier-credit direction. Source reuse is prohibited across supplier links, ordinary payment records and AV8 funds. Partial settlement consumes the original basis proportionally; the last uses the exact remainder. Unsupported FX differences require reviewed accounting treatment before that settlement can proceed. Supplier statements and resource original balances include these links without a second posting.

The hosted scheduler stores one mutable `scheduler-checkpoint` per tenant/named worker, with a unique identity, last cursor, claim token, lease and safe result timestamps. Only an authenticated scheduled endpoint can invoke its explicitly configured active workers. Application work is idempotent; recipient outbox records remain the authoritative delivery evidence. A failed or restarted invocation resumes the persisted cursor; an expired sending lease remains an unknown delivery outcome until reconciled.
