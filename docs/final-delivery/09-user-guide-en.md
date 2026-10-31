# AV8 ERP user guide

The deployed setup URL is https://av8.odin-ltd.com. The administrator must complete private password/MFA onboarding and approve the applicable policies before live business use. Production report emails are currently disabled pending a separate provider key; verified staging deliveries are not a claim that production sending is enabled.

Use your assigned account and company/branch scope. The sidebar groups AV8 work, sales, purchasing, inventory, finance, treasury, HR, POS and administration. Expand a group to see its pages; collapse the sidebar without losing access. On a phone, open **Menu** and close it with Escape or the close button. **Search pages** finds permitted destinations. The account menu provides **My Profile**, appearance (Light/Dark/System) and sign-out. Reload restores a valid session through the protected server cookie. Signing out also clears the other tabs; if the server cannot confirm sign-out, follow the displayed error before leaving a shared device. The language control switches English/Arabic and preserves the current page.

For a privileged account, enter your password and then complete the authentication challenge. At first enrollment, add the displayed **Authenticator setup key** to your authenticator app, save the **One-time recovery codes** privately, and enter the six-digit code. Later sign-ins use a current six-digit code or an unused recovery code. Do not share the setup key or recovery codes in screenshots. If both methods are unavailable, use the administrator’s reviewed recovery process; there is no client-side MFA bypass.

This guide describes the implemented interface. Release verification and unresolved configuration are documented separately; an available button is not evidence that a bank movement or external email occurred.

## Sales: inquiry to student file

1. Open **AV8 → Leads & follow-ups → Capture lead**. Enter the actual name, phone, source/program, branch and responsible staff. Set the next follow-up in Cairo time. Review a potential duplicate before confirming it; do not create a second identity merely to avoid a warning.
2. For bulk entry, use **Import leads**, upload the supported file, review the preview and row errors, correct the file, and commit only the reviewed preview. External social-platform connections are not required for manual entry/import.
3. Open the lead. **Record activity**, **Assign**, **Appointment** and **Consultation outcome** update the same history. Enter the actual attendance/outcome; a planned appointment is not attendance.
4. **Open application** links the qualified inquiry to its student file and academy. The file has grouped tabs for application/agreement, travel preparation, fees/installments, student follow-up and history.
5. Use **Correct student details** or **Assign responsible staff** with a reason. The timeline preserves who changed the record. If a stale-version error appears, refresh, review the intervening change and submit the intended correction again.

## Student Affairs: admission, preparation and progress

In **Admissions**, review outstanding travel requirements. **Verify academic eligibility** records the approved criteria and supporting document; it does not infer a pass mark. **Record admission decision** checks medical clearance, eligible academic evidence and required documents. Record medical outcomes in **Medical**. A failed pre-contract medical outcome follows the full application-fee refund workflow, which Finance handles separately.

In **Documents**, upload the actual file, review each item, enter relevant issue/expiry dates, and choose its status. For conditional documents, record whether required for this student. A reason and appropriate evidence are required. Do not apply assumed legal validity periods. Protected passport, criminal-record and bank-statement material follows your permissions.

Update **English**, **Visa** and **Travel** independently. Enter actual appointments, submission, decision, departure and arrival dates. Preparing documents does not automatically complete English or issue a visa. The readiness list links to unresolved requirements. Future installments do not block departure; due upfront obligations, academy transfers and required documents do. An authorized exception must be recorded explicitly.

Use **Guardian** to record the actual relationship, contact email, consent date and permitted sharing categories. Use **Progress** to plan monthly reporting periods, upload the academy's original report and record source/received date, hours, exam results, qualifications and progress. Select the original academy report attachment; enter one qualification per line. Review after checking the attachment. To correct a reviewed report, select **Create corrected report version** and explain the correction; review the new version separately.

**Report delivery** shows the reviewed versions and separate student/guardian outcomes. Review may queue the emails automatically; **Queue report emails** safely requests the same delivery identities again. A queued or provider-accepted message is not proof of delivery. Fix missing configuration/contact information before retrying a failed recipient. Use **Reconcile delivery outcome** for an unknown result with the provider message reference. Do not resend to successful recipients. Missing provider access is a deployment configuration issue, not a successful delivery.

**Training** records starting, requesting/notifying suspension, confirmed suspension, requesting resumption and confirmed resumption. Overdue tuition and academy suspension are distinct facts. Confirm suspension/resumption only with academy evidence. Resumption requires the approved arrears-resolution rule or an authorized exception; a small partial payment does not automatically resume training. **Record graduation** retains balances and outstanding follow-up.

## Accommodation, transport and insurance

Open **Services → Add monthly service**. Enter the student-specific monthly price, currency, provider, dates and whether AV8 collects or the student pays the provider directly. Amend with an effective date; prior terms remain visible. Finance creates each monthly charge and records payments. For AV8 collections, use **Record AV8 service collection**, then approve and confirm the actual receipt before selecting those cleared funds for the monthly charge. The same funds cannot also settle tuition. For direct provider payments, attach evidence; these do not increase AV8 cash. Use **Reverse service payment** with actual evidence and a reason to correct an erroneous recorded service payment; the original remains visible.

**Record student expense** creates an insurance/other expense draft or links an actual paid expense. Insurance is an AV8 cost of USD 400, not an automatic extra student charge. A paid expense needs the actual posted treasury payment, supplier, invoice/policy reference, date and evidence. Explicitly record whether it is approved as eligible to reduce a refund and why. Use **Record expense payment** to finalize a draft; the earlier record remains auditable.

## Finance: receipts, academy transfers, cheques and refunds

Before first use, Management must approve the applicable payment plan, accounting mapping and unresolved business choices in **Business configuration**. Draft plans are unusable for new contracts. Existing signed agreements retain their snapshots. The confirmed installment plans each total USD 64,000; pay-in-full totals USD 54,000 including the USD 2,000 application fee once. The first deferred offset requires an explicit approved choice; do not assume it from an example.

| USD component | Plan 1 | Plan 2 | Pay in full |
|---|---:|---:|---:|
| Application, once | 2,000 | 2,000 | 2,000 |
| Contract/study package | 6,000 at signing | 14,000 at signing | 52,000 at the explicitly agreed collection milestone |
| Visa issued/before travel | 8,000 | — | — |
| Later quarterly installments | 5 × 9,600 | 6 × 8,000 | None |
| Total / payment items | 64,000 / 8 | 64,000 / 8 | 54,000 / 2 |

Quarterly dates use calendar months from the contract with the approved first-payment offset. Visa or travel delays do not change financial due dates. Review the actual signed schedule before collecting; later policy edits do not rewrite it.

In **Payments → Record payment**, select the destination bank/cash account and fee/installment. Enter gross amount, actual date and reference. The receiving account determines currency. Use the dated exchange rate or enter the authorized transaction rate; the preview is followed by server validation. If the receiving bank deducted a fee borne by the student, record it separately. Only net principal settles tuition; the unpaid remainder stays due. Save records and posts the actual receipt together. A failed save must be investigated before entering a different duplicate transaction.

Download the **Official receipt PDF** from the cleared cash record. Upload the actual signed/stamped copy and use **Record signed receipt copy**. A generated PDF does not assert a signature that was never provided. Student statements and academy statements remain separately downloadable.

In **Academy statement**, record an actual transfer or use **Collections & academy** for a batch remittance and allocation. Request, approval and confirmation are separate stages. Allocate only cleared actual funds to the intended obligations; reconcile remaining amounts. The installment plan's USD 1,500 medical and USD 4,500 visa amounts are within USD 6,000; later deferred collections pass through in full. Pay-in-full academy settlement is USD 54,000 three calendar months after signing. Student funds retained are shown before other supplier/insurance operating expenses; this is neither the reconciled treasury balance nor accounting profit. When the actual transfer rate differs from the original collection liability basis, choose the explicitly approved transfer FX policy; its mapped difference account preserves the original student USD balance.

For an actual outgoing bank fee, select the approved **Bank transfer fee policy** and enter the fee separately on the academy remittance. It is an additional cash debit and does not reduce academy principal. For a batch remittance, enter each student's explicitly agreed fee share; the shares must reconcile exactly, and those students must have principal allocations in the confirmed transfer. **Bank transfer fees and student reimbursement** shows the actual fee and outstanding recovery. Record the student's actual reimbursement, then obtain approval and confirm receipt. The exact fee cap prevents overcollection; it does not increase tuition or commission. Accounting mappings for expense, receivable and reimbursement offset require an explicit approved policy. Wallet student collections likewise require explicit approval in the accounting policy.

In **Cheques**, receive the instrument against an approved cheque policy, charge and bank. Receipt generates an acknowledgment, not cleared cash or tuition credit. Present it, then confirm bank clearance with evidence. Record a return/cancellation in its permitted stage. Reversing a cleared cheque needs a return request and a different authorized approver; the original posting remains linked. A replacement references the returned/cancelled cheque.

In **Refunds → Request termination and refund**, enter the actual termination date and approved refund policy. Select only approved, actual eligible expenses. Resolve each remaining obligation if the policy requires individual decisions. Legacy contract conflicts require a documented resolution reference. Approval preserves the calculated entitlement; it does not transfer money. Prepare actual payout, obtain approval and confirm the bank movement. Partial payments show paid and remaining amounts. The deadline remains termination plus 45 days even when academy reimbursement is delayed. Request/approve academy reimbursement, record actual recovery against its original remittance, or escalate the financing decision. Do not equate an academy transfer with a deductible expense.

## Reports and inherited ERP work

**AV8 reports** includes admissions, documents/visa/departures, progress, balances/collections/academy/commission, services/insurance, training/graduation, report delivery, refunds, cheques and bank-fee reimbursement subject to permissions. Search, choose dates/branch/status and relevant financial filters. Collections separately identifies the application branch, actual collection/resource branch, receiving account, external reference and net amount. Shared financial resources allow an explicit authorized collection branch; check the date basis. **Export current page** exports that filtered page, not every page. Use the student file for detailed supporting history.

The retained sales/purchasing/inventory/HR/POS/accounting pages remain accessible from the sidebar. Follow their required draft/approve/post lifecycle and source-document links. Treasury distinguishes accounts/resources, transactions, statements and reconciliation. Search **Bank Transactions & Transfers** by reference/description, choose the financial resource and page through the full authorized history. The list displays each transaction ID. Deactivating a bank stops new postings while authorized historical records remain searchable; revoking a user’s financial access is a separate administration action. To match an older bank movement, use **Match posted transaction by ID** and review the bank, direction and amount; supplier opening settlement also accepts the original movement or journal ID when it is outside the recent selector. A matching bank-statement line is evidence of reconciliation, not a new receipt. Do not repost a bank transaction to repair a statement mismatch. Finance should use documented reversals and allocation corrections rather than deleting posted history. For a paired transfer between resources, enter the actual debit and credit, the approved source book rate (book currency per source-currency unit), the actual destination rate and the supporting rate evidence. The source book rate preserves the approved carrying basis; it is not an inferred current market rate. Review any separately mapped FX difference before posting.

## Point of sale

Open a register shift for the actual branch and warehouse. Build the cart, review the exact cash/card/bank split and complete or hold it. A retry after a failed response reuses the same submission identity while the cart remains unchanged. Reconcile the sale history before creating another sale.

To resume a held cart, review the actual tender amounts. If its original shift is closed, explicitly select an open shift in the same branch and warehouse and record the reason. A full return preserves the original tender methods. If the original shift is closed, choose an open matching refund shift; the original closed cash count remains unchanged. Close each shift using the actual counted cash and review any variance.

## Administration and recovery

Use named users, least-privilege role templates, assigned companies/branches/resources and expiry for temporary access. Disable access without deleting historical attribution. Profile/password and MFA/recovery functions are in **My Profile** and user administration. Keep recovery codes outside shared screenshots. System setup, opening-balance migration, email-provider and backup/restore procedures belong to the deployment runbook; do not invent balances or policies to clear a blocked screen.

For controlled legacy migration, open **Business configuration → Opening balances and historical students**. Choose the reconciled JSON source file prepared under the migration runbook, preview row errors and control totals, and verify the original signed contracts and historical payment references. Commit only the reviewed preview with a cutover approval reason. A separately approved posted opening journal must reconcile the resources. The importer links historical balances without creating new collections, remittances or journals. Replaying the same source identities is safe; a changed source must be reviewed. **Opening supplier balances → Link posted supplier settlement** connects an existing treasury payment (or supplier credit receipt) to the imported balance. For an actual settlement whose original currency differs from the book currency, select the independently approved posted manual settlement journal, financial resource, original amount and documented rate. The backend verifies company, branch, original liability basis and unused source evidence; the link creates no new cash or journal. The recorded settlements retain date, reference, evidence and reason.

| Problem | Next action |
|---|---|
| Required field or amount/rate error | Correct the highlighted field and actual evidence; do not adjust amounts simply to bypass validation. |
| Forbidden or record absent | Check company, branch, assignment and action permission with the administrator; a direct URL grants no access. |
| Save timed out | Refresh/reconcile the recorded result first; retry the unchanged operation where offered. Avoid a new duplicate instruction. |
| Period closed/account inactive | Finance reviews the date/account and approved period procedure. Never silently backdate. |
| Attachment rejected | Use PDF/PNG/JPEG/WebP within the displayed limit; preserve the original document and ask for an approved alternative if needed. |
| Report email blocked/unknown | Correct contact/configuration or reconcile provider evidence; only confirmed failures are retried. |
| Contract policy unavailable | Have Management complete and approve the specific unresolved policy. Other student preparation can continue. |

Synthetic screenshots and tested scenario results are linked from [scope and route coverage](01-scope-and-route-coverage.md). They contain no real student records or credentials.
