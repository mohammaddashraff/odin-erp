# Business rules and owner decisions

Delivery brief: `master-delivery-brief.md`, explicitly adopted by the repository owner. The confirmed amounts below are client requirements. Test-only choices are synthetic examples, not production approvals. This document is not a tax, legal or statutory accounting opinion.

## Confirmed commercial rules

| Component | Plan A | Plan B | Pay in full |
|---|---:|---:|---:|
| Application, once | USD 2,000 | USD 2,000 | USD 2,000 |
| Signing payment | USD 6,000 | USD 14,000 | USD 52,000 at explicitly selected collection milestone |
| Visa issued / before travel | USD 8,000 | Included in signing payment | Included in selected collection milestone |
| Later principal | 5 × USD 9,600 | 6 × USD 8,000 | None |
| Student total / schedule rows | USD 64,000 / 8 | USD 64,000 / 8 | USD 54,000 / 2 |
| Academy entitlement | USD 6,000 initial + USD 48,000 later | USD 6,000 initial + USD 48,000 later | Entire USD 54,000 |
| Academy dates | USD 1,500 medical pass; USD 4,500 visa; later actual principal immediately due | Same | Signing +3 calendar months |
| AV8 commercial retention | USD 10,000 before expenses | USD 10,000 before expenses | No separate commission configured |

New plan versions use `rulesVersion: 2026-10-31`. The system requires an explicitly approved plan before drafting/signing a new contract. Old signed contract snapshots keep their original interpretation. They cannot be silently converted to the new prices or dates. A signed amendment records before/after amounts or dates and keeps the original agreement.

Signing anchors quarterly dates. Calendar arithmetic clips each instalment independently to the last day of its target month using the original signing day; 31 January +3 months is 30 April. Financial due dates are date-only values. The due/overdue boundary uses Africa/Cairo. Travel, visa and training changes do not recalculate quarterly dates. Plan A's visa payment retains its real milestone until a specific approved date is known; the product does not invent one.

The first application charge belongs to the application and is reused in the signed schedule. Medical failure before contract signing follows its separate full USD 2,000 refund path, requiring the full cleared application payment and independent approval. Passing medical alone does not approve admission. Initial academy milestones are created for the selected instalment plan; selecting pay in full instead does not automatically add USD 6,000 to its USD 54,000 total. Existing genuine advances remain recorded and count within the total.

A later USD 3,000 collection against USD 9,600 leaves USD 6,600 outstanding. It creates an immediately due USD 3,000 academy obligation. Approval, actual transfer evidence and a cleared bank/journal transaction are separate actions. The system blocks an unfunded transfer; an obligation coming due is not proof that AV8 collected money.

USD obligations and academy settlements use exact integer cents. Supported receipt currencies use the configured currency precision. Rates are integer millionths in the direction `USD per original currency unit` and `base currency per original currency unit`. Historic values are stored with each actual movement. A saved-rate change cannot rewrite old student credit.

Bank fees deducted before receipt reduce net cash and principal credited. Gross, fee, net, student fee responsibility and residual balance remain visible; this path posts no fictitious AV8 fee expense or reimbursement. The student must settle the principal shortfall. An additional outgoing academy bank fee is also supported under an explicitly approved BANK_FEE policy: the actual expense, bank debit, exact student receivable and selected accrued-reimbursement offset are posted together. Actual fee reimbursement is a separate bank receipt clearing that receivable; it never increases tuition paid or academy entitlement. Batch fees require explicit per-student shares. Missing accounting mappings block only this fee treatment, rather than silently waiving it or reducing academy principal.

Termination entitlement is actual eligible cleared student principal received, less earlier refunds and individually approved, documented actual paid expenses. It is never automatically contract payment forfeiture, commission forfeiture or all academy transfers deducted. The original termination date +45 calendar days is retained. Payout is limited by the approved remaining entitlement and actual local funding; academy recovery must actually clear before that recovered portion can be paid. An escalation decision does not extend the deadline or manufacture cash.

Insurance is an actual USD 400 AV8 expense supported by the operational expense record and posted payment. It is not a new student charge. It is deductible from a refund only where the explicit eligible-expense decision says so. Accommodation and transport use separate effective-dated agreements; direct provider payments are evidence records outside AV8 cash.

## Business-owner confirmation sheet

Production decision evidence has not been supplied in this delivery session. An authorized business owner and finance/legal owners must record the following actual selections in production. Existing approved signed exceptions require individual review. None of these open items blocks unrelated development or changes confirmed totals.

| ID | Decision owner | Implemented selection and suggested review choice | Exact impact / current disposition |
|---|---|---|---|
| D01 | AV8 commercial owner | Approve first quarterly offset on each new plan version. Candidate **3 months** is demonstrated only in synthetic tests; quarterly interval remains 3 months. Explicit date amendments also supported. | New instalment policy drafts have no offset and cannot be used until selected/approved. No automatic production +3 choice. |
| D02 | Commercial owner + academy | Confirm a separate cash-plan commission/rebate only if the academy agreement grants one. Keep unconfigured until evidenced. | Confirmed academy USD 54,000 at signing +3 works independently. No USD 10,000 retention, receivable or revenue is invented. |
| D03 | Finance manager | Record an escalation/financing decision if academy recovery threatens the unchanged 45-day deadline. Suggested action: escalate the dated case with evidence and owner. | Recovery REQUESTED/APPROVED/actually received and student payout/remaining are separate. Local-funded partial payouts work. System never extends the deadline. External financing itself must be documented in treasury, not simulated as an academy recovery. |
| D04 | Finance manager + commercial owner | Explicitly approve clearance-based student credit and cleared-funds gates; select whether RECEIPT or CLEARANCE fixes FX. This conservative implementation supports these two FX choices. | Cheque policy starts DRAFT/unselected. Receipt/presentation alone creates no bank cash or student credit. Different credit semantics require an expressly approved additional implementation. Returns/replacements and exact original-journal reversal are implemented. |
| D05 | Commercial owner + finance manager | Approve paid-minus-eligible-actual-expenses policy, each eligible deduction, legacy-contract resolution and CANCEL_REMAINING / RETAIN_REMAINING / EXPLICIT_PER_CHARGE. Suggested review choice: decide each disputed legacy case explicitly. | Policy version, signed contract, expenses and unpaid disposition snapshot on case; separate requester/approver; immutable approval. No implicit insurance/application/commission forfeiture. Imported pending cases require review and keep original date/source. |
| D06 | Finance manager / accountant | Select evidenced transaction rate source; select ORIGINAL_RECEIPT_RATE or APPROVED_PAYOUT_RATE and explicit active scoped FX-difference GL for the latter. Approve agency liability mapping, and the separate BANK_FEE expense/receivable/offset treatment where AV8 advances charges. | Original-rate refunds require matching original currency/rates. Payout-rate refunds preserve original credit and historical liability, posting actual difference only to the selected GL. Original liability account remains attached; mixed-account instructions must be split. Academy remittance also preserves original receipt liability basis and requires an approved FX mapping for later-rate differences; a stored remittance-basis record identifies source receipts. Partial reimbursements/recoveries consume the final base minor-unit remainder exactly. No market feed is assumed. |
| D07 | Service owner + finance | Specify provider, collectionParty AV8/PROVIDER, currency, monthly price, start/end and each agreement's terms. | AV8 service allocations share actual receipt availability with tuition. Provider records do not create treasury cash. Actual full reversals keep evidence and history. No speculative rent/transport price or universal beneficiary. |
| D08 | Affairs + finance manager | Record payment resolution as ALL_OVERDUE_CLEARED or AUTHORIZED_EXCEPTION with explicit exception permission/evidence. Confirm academy suspension/resumption separately. | Internal financial hold is independent of academy status. Payments do not falsely resume academy training, reschedule debt or cancel unrelated services. No late fee or grace period. |
| D09 | Admissions owner | Approve manual evidenced eligibility and individual conditional-document applicability until real thresholds exist. | Medical pass, verified educational eligibility and applicable accepted documents are prerequisites to admission. Legacy English test/IGCSE wording is not an automatic academic threshold. |
| D10 | Commercial owner | Choose cash collection milestone CONTRACT, APPROVED_DATE (actual date), or VISA_BEFORE_TRAVEL. Preserve before-travel clearance gate. | Cash plan starts with no selected collection milestone. Its confirmed academy +3 obligation is independent of this unresolved collection date. |
| D11 | Finance/legal/privacy owners | Approve statutory taxes/invoices, commission revenue recognition, retention and residency rules through real company configuration and signed instructions. | No new exemption, rate, tax invoice/e-invoice claim, government certification or retention term. Company receipts are labelled company receipts with actual signed-copy workflow. Statutory production sign-off remains affected by absent decisions. |

Record decision ID, selected value, approver, date, evidence/contract reference, effective scope and policy version. Do not approve by copying this sheet or the synthetic fixture state. The migration creates selectable drafts and confirmed settlement data, not real business approval of the open decisions.

## Engineering choices, not business rules

- Exact fixed-point conversions round half away from zero at the target minor-unit boundary. No floating-point amounts are used in financial storage.
- Mutating actions use idempotency keys, serializable transactions and database caps; same key with a different payload is rejected.
- Posted journals, cleared movements, signed snapshots and allocation reversals retain history. Corrections create linked records; they do not delete original receipts.
- Deferred allocation corrections carry an existing actual academy transfer to another deferred item without creating a second transfer entitlement. Moving an already advanced allocation into an incompatible category requires actual academy/accounting reconciliation and is refused with a specific reason.
- Returned cheques preserve the original CLEARED fund internally, reverse its actual journal, append negative allocations and project RETURNED to users. A replacement first restores already advanced academy funding, then creates only the genuinely new remittance obligation.
- PDF output is unsigned until a real signed/stamped private evidence file is recorded. Printing is audited. An original returned-cheque receipt can be reprinted with its reversal notice.

Outgoing bank-fee receivables remain separate from tuition and are preserved in a termination case's source snapshot. They are not automatically forgiven, deducted a second time, or included as tuition principal. An academy transfer or recoverable bank-fee advance cannot be presented as an independent eligible actual expense deduction. Unsupported netting/write-off requires a separately authorized accounting decision.
