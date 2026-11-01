# ODIN / AV8 ERP — Final Implementation, Verification and Delivery

## MASTER EXECUTION PROMPT

You are the lead implementation engineer responsible for finishing the existing ODIN / AV8 ERP and preparing it for final client delivery. Act as a senior full-stack engineer, financial-workflow engineer, QA engineer and release engineer.

This is an execution task. Inspect the current repository, identify the actual gaps, implement the required changes, run the system, test complete workflows, fix failures, and produce the release and handover evidence. Do not stop after an audit, implementation plan, backlog, attractive screenshots, scaffolding, or a partially connected feature.

The UI redesign is already approved and reported implemented. Preserve its Classic Sidebar design and finish its consistency and functionality across the application. The objective is a complete, reliable ERP using that design.

The latest client business clarification, reproduced in this prompt, is dated 31 October 2026. It establishes the requirements below. The current application's compliance with them is unverified until you inspect and test it.

---

## 1. Working agreement and execution boundaries

1. Read the repository's AGENTS.md and applicable instructions. Inspect git status, active branch, current commit, package/workspace layout, application entry points, schema, migrations, tests, CI and deployment files before editing.
2. Preserve uncommitted work and unrelated changes. Use an isolated branch or worktree if needed. Never reset, overwrite or discard another person's work.
3. The backend is described as NestJS. Next.js, Prisma and PostgreSQL were described in an earlier review. Discover the actual current stack and extend it. Do not replace working architecture merely to match these descriptions.
4. Reuse the existing financial engine, authentication, authorization, document pipeline, design system, localization and infrastructure where sound. Refactor incrementally where a concrete problem requires it.
5. Continue through implementation and verification autonomously. Make routine engineering choices yourself and document them. Delegate independent investigations or tests to agents when supported; coordinate ownership to avoid conflicting edits.
6. Keep a persistent implementation ledger so the work survives long sessions and context compaction. Resume unfinished work from that ledger.
7. Do not invent financial, contractual, tax, academic-entry or legal policies. Isolate unresolved policies as described in Section 4, finish independent work, and explain exactly which operation requires a decision.
8. Use synthetic data and controlled test recipients. Never send test emails to real students or guardians, initiate actual money transfers, submit live government documents, or perform real student disciplinary actions during QA.
9. Build and test integrations with available approved sandbox/staging credentials. Never print secret values. A missing credential must produce an honest setup requirement, not simulated production success.
10. Implement and rehearse migrations against isolated databases. Never reset a production database, destroy existing documents, rewrite posted history, or automatically seed demo records into production.
11. Prepare a deployable release, migration plan, rollback/recovery procedure and handover. Use an existing authorized preview/staging deployment where available. Execute production deployment only when existing user/session authorization permits it, repository release procedures are satisfied and the required gates pass. Repository documentation defines procedures; it does not independently grant permission for external deployment.
12. Do not purchase services, change hosting vendors, rotate live credentials, make repositories public/private, or alter external account permissions without existing authorization. Finish preparation and report the exact external action needed.
13. Do not weaken tests, disable authorization, hide required broken functionality, delete required routes, change real balances, or add fake success responses to obtain a green result.
14. The final status must distinguish implementation completed, verified in staging, and production prerequisites satisfied. Do not describe a release as ready while material gates remain unverified or blocked.

### Source handling

This prompt is self-contained. If supplied alongside the project, also inspect:

- The payment-plans PDF, commonly named "أنظمة التقسيط - AV8 Aviation Academy.pdf".
- The admission-documents PDF, commonly named "الأوراق المطلوبة - AV8 Aviation Academy.pdf".
- The study contract, "عقد الدراسة بالأكاديمية.pdf".
- "AV8 ERP Critical Review and Gap Analysis.pdf".
- The approved Classic Sidebar light/dark reference and any existing UI implementation brief.

The historical technical review concerned commit 7eb59c0. Its author did not run the application, tests, live configuration, or most business implementation paths. Treat its findings as investigation leads, not proof of current defects. Verify before changing working code.

The old contract has five blank payment rows, a drafting error confirmed by the client. Its refund language also differs from the latest explanation. Generate future contract drafts from the selected plan and approved current policy. Preserve the actual version of every previously signed agreement; never silently rewrite a signed contract or apply a new policy retroactively.

Missing reference attachments must not prevent implementation of requirements fully specified below. Record any additional evidence genuinely needed for a particular decision.

---

## 2. Discover and cover the whole existing ERP

Create a complete coverage matrix before large changes, then maintain it while working. Inventory:

- Every route, page, tab, subtab, sidebar group, dropdown and deep link.
- Every form and meaningful control: create, edit, view, approve, post, cancel, reverse, archive, upload, download, print, export, import, search, filter, sort, paginate and bulk action.
- API endpoints, services, permissions, entities, jobs, integrations and document templates behind those screens.
- Current user profiles, company/branch scopes, approvals, authority limits and administrative settings.
- Current AV8 modules and all other supported ERP modules: sales, purchasing, suppliers, inventory/products, accounting, treasury, reports, settings and any additional modules already in the delivered product.

For each item record its current evidence and final disposition: verified working; fixed and verified; required and still incomplete; externally blocked; or genuinely outside the explicitly agreed delivery scope. Include file/route references and a test/evidence reference.

Audit every existing route. Do not substitute a sample dashboard review for full coverage. Shared components may be tested once for their common mechanics, but every route must be checked for correct wiring, data, authorization and supported actions.

### Scope boundaries

- Complete all existing supported functionality and every explicit AV8 requirement in this prompt.
- Preserve all working routes and capabilities, including those currently tucked under "More".
- Do not quietly reclassify a broken required feature as optional or hide it to claim completion.
- Do not start speculative major products such as a native app, a full learning-management system, a data warehouse, AI automation, or a new HR/POS module merely because a generic ERP checklist mentions them.
- Existing HR, POS, inventory or other modules remain subject to the audit if present in the delivered product. Do not remove them without an actual agreed scope decision.
- Student/guardian portals, Meta/WhatsApp automation and card gateways are not newly required by this brief unless already implemented/promised in the repository scope. Their existing functionality must still be verified.
- Monthly academic reports emailed to BOTH student and guardian are explicitly required for V1. They are not optional future notifications.
- Support manual lead entry and controlled imports even when external social integrations are unavailable.

---

## 3. Confirmed AV8 business requirements

### 3.1 Business and organizational model

AV8 operates Egyptian student offices, including Cairo and Luxor, supporting flight-training students in South Africa. The Egyptian branches belong to ONE company.

The journey begins with enquiries and continues through admission, contracts, collection, travel, academic follow-up and graduation. The financial account begins with the USD 2,000 application payment.

Use distinct records for a person/student and an application/enrolment. Preserve repeat applications without creating duplicate people or merging separate contracts and balances accidentally.

Maintain separate but connected timelines:

1. Admissions/operations: leads, appointments, medical, documents, embassy, visa and travel.
2. Finance: contract obligations, receipts, allocations, cheques, academy remittances, expenses and refunds.
3. Academic follow-up: training start, progress reports, suspension/resumption and graduation.
4. Additional services: accommodation, transport and insurance.

An operational date change must not silently rewrite contractual financial dates.

### 3.2 Lead management and sales

- A student contacts AV8 through social media or another recorded source.
- Telesales contacts the student and follows up until an office appointment is booked.
- Conversion can take one day, months or more than a year. Do not automatically close a lead merely because it is old.
- Record source, contact identity, assigned employee, communication history, first response, next action/date, appointment, outcome and reassignment history.
- Support appointments, rescheduling, no-shows, attendance, interested-but-not-ready, declined and converted outcomes.
- Record the office sales consultation and handover to admissions.
- Detect likely duplicate contacts using supported normalized identifiers; require careful review before merging. Do not merge people solely because a family shares a phone.
- Provide useful Arabic/English name and phone search, bounded queries and role-scoped results.

### 3.3 Application, medical and admission

- The student pays USD 2,000 before completing admission.
- The medical examination follows the application payment.
- The previously stated rule is a full USD 2,000 application-fee refund when the medical is failed. Preserve it as a separate pre-contract workflow unless an explicitly approved revision changes it.
- Passing the medical alone does not complete admission. All applicable documents and eligibility conditions must also be satisfied.
- Record medical outcome, examination/result dates, supporting evidence, verification and the final admission decision.
- An authorized staff member approves admission only when the applicable prerequisites are met.
- Keep operational owners, task deadlines, reasons for exceptions and a history of state changes.

### 3.4 Documents, English and embassy preparation

The student's checklist includes:

- Valid passport.
- Criminal-record certificate addressed to the South African embassy.
- Birth certificate containing the three-part number, "الرقم الثلاثي".
- Bank statement belonging to the student or an eligible first-degree relative.
- Family registration when requested for that individual embassy application.
- Passport-size photograph.
- Applicable educational eligibility evidence.

AV8 prepares or tracks:

- Academy acceptance documents.
- Health insurance.
- Academy ATO licence document.
- Embassy application and assembled submission file.

The embassy determines whether family registration is required for a particular student. The checklist must support required, conditional, not required, awaiting submission, submitted, under review, rejected/replacement requested, verified and expired states where applicable. Record why a conditional item became required or was marked not required.

Uploading a file is not the same as verifying it. Record verifier, date, version, rejection reason and supporting notes. Preserve replacement history.

Track relevant issue/expiry dates. Do not invent legal validity windows, required translations, legalization rules or minimum passport-validity months. Allow approved checklist rules and manual verification.

English placement and the English course can proceed in parallel with document/visa preparation. Track their status without building an unrequested full course-delivery platform.

The client's approximate operational times are embassy submission in the first month and roughly two to three months from contract to travel. Use them only as planning estimates or configurable follow-up targets; never mark a visa issued because a timer elapsed.

Record embassy appointment/submission, requests for further documents, visa issued/refused/delayed, travel preparation, actual departure and arrival.

### 3.5 Payment plans — confirmed amounts

All contractual study-plan amounts below are in USD. All three plans cover the same study package.

| Component | Plan 1 | Plan 2 | Pay in full |
|---|---:|---:|---:|
| Application payment | 2,000 | 2,000 | 2,000 |
| Contract payment | 6,000 | 14,000 | 52,000 study-package payment; exact collection milestone must follow the agreed contract |
| Additional payment after visa issuance and before travel | 8,000 | — | — |
| Later instalments | 5 × 9,600 | 6 × 8,000 | None |
| Total student price | 64,000 | 64,000 | 54,000 |

The application fee must appear once. Do not double-charge it in the contract schedule or account statement.

The term "contract payment" means USD 6,000 for Plan 1, USD 14,000 for Plan 2, and USD 52,000 for pay-in-full, excluding its separate USD 2,000 application fee.

Generate the payment rows dynamically. Plan 1 has seven post-application payment items: the 6,000 contract payment, the 8,000 visa/pre-travel payment and five later instalments. Plan 2 also has seven post-application payment items: the 14,000 contract payment and six later instalments. Including the application payment, either instalment plan has eight payment items. The pay-in-full plan has two.

Store plan versions and the actual agreed schedule on each contract. Later template changes must not rewrite earlier signed schedules.

### 3.6 Due dates

- Contract signing is the anchor for financial due dates.
- Plan 1's USD 6,000 and Plan 2's USD 14,000 are due at signing.
- Retain Plan 1's stated USD 8,000 visa-issued/before-travel milestone unless the approved contract specifies a more precise rule.
- Quarterly instalments are every three months. The exact offset of the FIRST quarterly payment is not explicitly confirmed; resolve it through Section 4.
- Postponed visa, travel or training dates do not change the original financial schedule.
- Use calendar-month arithmetic, not a silent substitution of 90-day increments. Document and test month-end behavior, leap years, local due-date cutoff and Africa/Cairo display.
- Keep date-only obligations separate from UTC event timestamps.
- Do not invent a grace period, late fee, automatic discount, interest, or rescheduling entitlement.
- Explicitly approved financial amendments must preserve original dates/amounts and their audit trail.

### 3.7 Academy settlement — instalment plans

- Students on either instalment plan must have paid at least USD 16,000 before travel, including the USD 2,000 application payment.
- Of this initial USD 16,000, USD 6,000 is allocated to the academy and USD 10,000 is retained by AV8.
- The earlier client explanation split the academy's USD 6,000 into USD 1,500 after passing the medical and USD 4,500 after visa issuance/before travel. Preserve and verify these milestones for instalment plans; do not reinterpret them as amounts in addition to USD 6,000.
- Subsequent study payments, including partial instalment payments, are due for transfer to the academy immediately.
- Record the obligation, funding availability, transfer preparation/approval, actual transfer, bank reference, fees and evidence separately.
- "Immediate remittance" means immediately due for action. It must not mark an external bank transfer completed before it has occurred.
- Under a fully collected instalment plan, the academy allocation totals USD 54,000: 6,000 initially plus 48,000 later. AV8's stated commercial retention totals USD 10,000 before its expenses.
- Do not call all cash temporarily in AV8's bank account AV8 earnings. Distinguish AV8 allocation, academy funds awaiting remittance and actual resource balances.

### 3.8 Academy settlement — pay-in-full plan

The latest explicit client rule is: the ENTIRE USD 54,000 is transferred to the academy three calendar months after contract signing.

- Implement this as a distinct settlement plan.
- Do not substitute an earlier inferred USD 44,000 transfer.
- Do not automatically retain USD 10,000 under this plan.
- Do not add an earlier USD 6,000 to USD 54,000 and produce USD 60,000. Any permitted advance transfers must count toward the total USD 54,000.
- Record total academy entitlement, scheduled due date, actual transfers and remaining amount separately.
- Whether the academy separately pays AV8 a commission/rebate is unresolved. Do not create a commission receivable, income or payment without an approved rule.
- If the student's full amount has not yet been collected when the academy obligation falls due, expose the funding exception. Do not fabricate a collection or execute an unfunded transfer.

### 3.9 Currencies, methods, fees and official receipts

- Students may pay in any supported currency.
- Credit the student's USD obligation using the applicable exchange rate at the approved payment event.
- Accepted student collection methods explicitly confirmed here: corporate bank transfer, office cash and cheques.
- All academy settlements are in USD.
- All payment/bank-transfer charges are the student's responsibility.
- The earlier requested electronic-wallet treasury functionality remains in scope. Do not assume wallet collection is an approved student payment method unless explicitly enabled by the business.

For each payment store original amount/currency, USD equivalent, rate value and direction, rate source or finance-entered provenance, rate timestamp/date, payment date, verification date, method, company/branch, receiving resource, payer, student/application/contract, external reference, attachments, fees, receipt number and allocation details.

Itemize student-borne fees separately. Reconcile gross payment, net cash received, principal credited, fee expense/reimbursement and any remaining student balance. Do not waive fees silently, credit unreceived money without an explicitly supported accounting treatment, or reduce the academy's agreed entitlement to conceal a shortage.

Historical rates and USD credit must not change when market rates change. Use a single tested conversion convention and suitable precision; currencies can have different minor-unit scales.

The exchange-rate source and cheque payment event require controlled configuration. A finance-entered approved rate with provenance is acceptable; an automatic rate feed is not a prerequisite unless already promised.

Keep the student's historical USD credit separate from later cash conversion/remittance rates. Do not silently charge subsequent exchange movements back to the student. Record actual movements and unresolved accounting treatment explicitly.

Issue an official company receipt for every supported method, with the signed/stamped workflow requested by the client. Support printing and storing the signed/stamped copy or an approved equivalent process. Do not invent a signature or represent an unsigned generated PDF as already signed.

Cheque receipt, presentation, clearance, return/bounce, cancellation and replacement must be distinct. Recording a cheque must not falsely represent cleared bank cash. Policy determines when it settles student obligations or satisfies travel/training requirements.

### 3.10 Late payments, partial payments and training suspension

- Track instalments as upcoming, due, partially paid, paid, overdue and otherwise adjusted only through authorized actions.
- Late instalments cause suspension from training until the payment issue is resolved.
- The academy does not request payment from AV8 for ongoing training while the student is suspended.
- Record financial hold, suspension requested/notified, academy-confirmed suspension, resolution and academy-confirmed resumption as distinct events where the academy is external.
- Do not pretend the ERP physically suspended or resumed training merely by changing an internal field.
- Existing unpaid student obligations remain visible; suspension does not reschedule them.
- Money already collected for the academy remains accountable even if training is suspended.
- A partial later payment reduces the relevant balance by its actual USD credit and creates the corresponding academy remittance requirement.
- Do not automatically resume training after any small partial payment. Use the approved resolution rule and exception permissions.
- Do not automatically cancel accommodation, transport or unrelated monthly charges when training is suspended.

### 3.11 Termination and refunds

The latest client explanation establishes:

- Refund base: amount actually paid by the student.
- Deduct documented, eligible actual expenses incurred on that particular student.
- Actual expenses vary by student.
- The academy determines and documents actual training costs.
- Process the refund within 45 days of contract termination.
- For funds already transferred to the academy, AV8 must wait for the academy to return the corresponding funds before paying that portion to the student.

Build a complete refund case with termination date/reason, applicable contract/policy version, relevant confirmed receipts, prior refunds, expense items/evidence, calculated and approved refund, academy reimbursement requested/approved/received, amounts available locally, student payouts and dates, deadline, owner and audit history.

Store the approved refund entitlement in its contractual currency separately from each payout's amount/currency, conversion rate/date/provenance and charges. Use the selected approved refund-conversion policy; do not silently assume either the original receipt rate or the current rate, and never rewrite historical receipt credit.

Record the authorized financial disposition of unpaid and future obligations when processing termination. Preserve the original schedule and all amendments. Do not automatically forgive outstanding amounts or continue treating cancelled obligations as collectible; collection reminders, overdue actions and academy settlement forecasts must follow the approved obligation states.

Do not automatically deduct USD 6,000, 14,000 or 52,000 merely because it is called the contract payment. Do not automatically forfeit the USD 10,000 commercial retention. Do not treat the whole academy transfer as an incurred expense.

Do not deduct the same expense twice, deduct an unincurred insurance estimate, or refund an uncleared/returned cheque as though it were confirmed money. Do not allow cumulative refunds to exceed eligible confirmed receipts without a separately authorized and documented payment category.

Keep expense eligibility, expense amount, academy reimbursement and the actual student payout distinct.

The relationship between the 45-day deadline and delayed academy reimbursement remains unresolved. Keep the original deadline visible while awaiting funds; never reset it or mark an overdue case compliant automatically.

The earlier contract contains conditional first-10-day full-refund wording, fixed "contract payment" deductions for certain withdrawals and other breach/force-majeure clauses. Preserve them as evidence on legacy contracts and flag conflicts for policy resolution. Do not silently replace a signed agreement or invent a legal precedence rule.

The force-majeure clause also appears to refer to the wrong party's payments. Prepare corrected draft/template requirements for business review; do not silently infer a new legal obligation.

### 3.12 Accommodation, transport and insurance

- Accommodation and transport are separate from tuition.
- AV8 arranges these services.
- Students pay their costs monthly.
- The quoted accommodation/transport range was approximately USD 200–600 depending on choices and changing prices; it is not a fixed universal charge.
- Record student-specific service, provider, dates, monthly period, agreed price/currency, payer/payee, charge, payment evidence and outstanding amount.
- The actual recipient of these monthly payments still needs configuration. Support AV8-collected payments versus payments made directly to providers without mixing the latter into company cash receipts.
- Charges/changes/end dates must be effective-dated and traceable.
- AV8 provides and pays for health insurance in Egypt at USD 400 per student.
- Record insurance as an AV8-paid student-linked expense, with supplier/policy, dates, invoice and payment evidence.
- Do not automatically add USD 400 to student tuition, send it to the academy, or deduct it from every refund. Only actual approved eligible expense items enter a refund calculation.
- Track English assessment/course status. Its separate pricing was not confirmed; do not create an extra English fee without an approved charge.
- The study package includes the promised study tools/equipment, including the aviation headset and theory study. Do not invent hidden standard charges.

### 3.13 Academic follow-up, reporting and graduation

The Student Affairs Officer receives, reviews and records the monthly academy report.

Support:

- Reporting period, academy/source and received date.
- Student/enrolment and relevant training programme.
- Original report attachment.
- Structured exam results, training progress and completion measures supported by the actual report.
- Study/flight hours and qualification milestones where supplied and applicable to the signed programme.
- Notes, issues, follow-up tasks, reviewer and review status.
- Version history for corrected reports.
- Expected-report schedule, missing/overdue reports and responsible staff.

After review, each monthly report must be emailed to BOTH the student and the registered parent/guardian. Maintain separate recipient records and distribution history.

Use durable dispatch and real provider evidence. Distinguish queued, provider accepted/sent, delivered where supported, failed and bounced. Do not infer that a recipient read an email.

A successful student delivery must not conceal a failed guardian delivery. Retry the failed recipient safely without resending the student's confirmed successful message. Concurrent workers must claim the same dispatch only once.

Use stable dispatch identities and provider idempotency where supported. Distinguish a confirmed send failure from a timeout after possible provider acceptance. Reconcile an ambiguous outcome using provider evidence, or expose a delivery-unknown/manual-review state before retrying. Do not claim guaranteed exactly-once external delivery when the provider cannot support or prove it.

Validate current recipient addresses, allow authorized contact corrections and preserve the recipients used for each send. Keep sensitive financial/medical attachments out of academic emails unless expressly included by an approved template/workflow.

Academic reports, student contact details and guardian links must respect access permissions. Do not send arbitrary documents to a contact simply because it shares a surname or phone.

The contract describes additional commitments, including programme qualifications, 200 flight-training hours for the referenced package, insurance and conditional support concerning interrupted training and employment. Represent applicable approved commitments and follow-up tasks without inventing guaranteed outcomes or building an unrelated training platform.

Record graduation, date, supporting evidence and outstanding actions. Academic graduation and financial settlement are separate: graduation must not erase debt, academy funds awaiting transfer, a pending refund, or unpaid service obligations.

---

## 4. Unresolved policies: finish the product without inventing decisions

Create a compact decision register. Distinguish confirmed rules, engineering defaults and business choices.

Implement configurable models/UI and all independent paths. Where a material choice is still unresolved, require a clear authorized selection for that specific operation or contract, and preserve the selected policy version. Do not freeze the whole project.

| ID | Decision or configuration | Required treatment |
|---|---|---|
| D01 | First quarterly instalment offset | Proposed schedule is contract +3,+6,+9,+12,+15 months for Plan 1, plus +18 months for Plan 2. This is a candidate, not a confirmed business fact. Support explicit approved dates/offsets and demonstrate the candidate in synthetic fixtures. Do not activate it silently for real signed contracts. |
| D02 | Pay-in-full commission | Follow the confirmed USD 54,000 academy transfer. Leave any separate commission/rebate rule unconfigured until confirmed. Do not block recording the confirmed cash-plan settlement. |
| D03 | Refund deadline versus academy delay | Keep termination +45 days, recovery status and payout status separately. Require an explicit escalation/financing decision when reimbursement is delayed. Never silently extend the deadline. |
| D04 | Cheque credit and FX timing | Model receipt/clearance/return separately. Proposed operational default is confirmed student credit on clearance; activate it only through an explicit business policy selection. Decide which event fixes the exchange rate and satisfies travel/resumption gates. |
| D05 | Refund policy versions, deductions and termination balances | Use current paid-minus-eligible-actual-expenses logic for the new configurable policy. Resolve old signed-contract exceptions by version; define eligible application/insurance/other expense treatment, the disposition of unpaid/future obligations and supporting evidence. |
| D06 | Exact FX source, subsequent FX differences and refund conversion | Allow authorized entry of the rate actually used, with provenance and audit. Do not fabricate market rates, charge future exchange movements to students automatically or invent a refund conversion rule. Obtain accounting mappings/approved treatment where absent. |
| D07 | Monthly accommodation/transport settlement | Configure collection recipient, provider, start/end dates and pricing per agreement. Direct provider payments remain external payment records, not AV8 treasury receipts. |
| D08 | Suspension resolution and exceptions | Configure the payment-resolution condition and authorized overrides. Keep financial status and academy-confirmed training status distinct. Do not invent late fees or a grace period. |
| D09 | Academic eligibility and conditional document rules | Until approved thresholds are available, provide authorized manual eligibility verification with evidence. The old English "EST 1 or ACT 1 — 800" and IGCSE wording must not become unquestioned automated validation. |
| D10 | Exact cash collection/pre-travel milestones | Preserve the confirmed contract anchor and before-travel collection requirements. Store actual approved due dates; do not invent a new date where the client's wording does not specify one. |
| D11 | Statutory accounting, tax, invoice and retention rules | Locate approved finance/legal configuration. Never assume a tax exemption/rate, VAT treatment, revenue-recognition point, ETA applicability, retention term or data-residency requirement. Mark only genuinely affected release capabilities as blocked. |

Prepare a concise business-owner confirmation sheet with recommended choices, exact impact and pending items. Ask only for decisions not already answered. Do not repeatedly ask for the Plan 2 contract-payment date, total plan prices, travel-delay treatment, accepted methods, monthly email requirement or insurance payer: these are confirmed.

Development and synthetic verification may use clearly labelled policy fixtures. Production configuration must not inherit unapproved fixtures.

---

## 5. Accounting, treasury and branches

This area is a major delivery requirement, not an optional enhancement.

### 5.1 One company, multiple branches

- Maintain company-level books with branch dimensions/scopes.
- Each branch can have designated cashboxes, bank accounts, wallets, staff and reporting.
- Shared/central bank resources must also be representable.
- Distinguish the student's managing branch, a transaction's business attribution and the resource that physically received money.
- A Cairo student may pay into a Luxor cashbox without silently changing the student's ownership or duplicating company income.
- Branch reporting and consolidated reporting must reconcile, including explicit unassigned/shared categories rather than dropping them.
- Keep tenant/company isolation distinct from branch authorization.

### 5.2 Resource management and transfers

Implement/verify:

- Create/edit/deactivate cashboxes, corporate bank accounts and electronic wallets.
- Resource currency, opening balance, owning company, branch/shared scope, authorized users and operational status.
- Receipt/payment posting, internal transfers, bank deposit/withdrawal, resource movement history and reconciliation.
- Atomic source/destination accounting for internal transfers; a transfer cannot become sales revenue or disappear on one side.
- Cross-currency transfers with both currency amounts, rates and fees recorded explicitly.
- Controlled reconciliation adjustments with explanations and audit.
- Bank-statement import with mapping/preview, duplicate-safe matching, unmatched items and reconciliation, or completion of the equivalent supported workflow.
- No deleting a resource to erase its transaction history.

### 5.3 Financial records and integrity

Verify chart of accounts, journals, posting, fiscal periods, receivables, payables, customer/student allocations, supplier payments, expenses, credits/reversals, trial balance, general ledger and financial reports.

Separate:

- Contractual total versus currently due obligations.
- Confirmed receipts versus evidence awaiting verification or cheque clearance.
- Tuition versus additional services.
- AV8 commercial allocation versus academy funds held.
- Total expected academy settlement versus currently due remittance versus actual transfer.
- Refund liability/case versus academy reimbursement versus actual student payout.
- Resource cash balance versus income/profit.

Integrate financial events with the existing ledger using approved account mappings and accounting policy. Do not declare all tuition collections AV8 revenue or treat the USD 10,000 commercial allocation as a decision about revenue-recognition timing.

Use money-safe arithmetic appropriate to the existing stack. Preserve exact minor units or decimal precision as appropriate; no binary floating-point money calculations. Test conversion, rounding, residual allocation and totals independently.

Protect posted history. Corrections must use controlled reversals/adjustments, reasons and links to the original. Enforce fiscal locks and authority limits at the backend across every posting path, import, job and bulk action.

Use transactions, appropriate locking/constraints and request idempotency for receipts, allocations, transfers, refunds and postings. A retry or concurrent request must not double-credit a student or double-pay a refund.

Review cascade deletion against real entity relationships. Preserve financial evidence and signed documents; ordinary entity archiving must not erase them.

Build state-aware reconciliation. Do not blindly assert "all allocations equal all receipts": unallocated funds, pending cheques, refunds, prepayments and other legitimate states need explicit treatment.

### 5.4 Opening data and cutover

Provide validated, repeat-safe import/setup for:

- Students and active applications.
- Signed contract references and payment plans.
- Original instalments and outstanding balances.
- Historical receipts and allocations.
- Historical academy transfers and remaining settlement amounts.
- Cashbox/bank/wallet opening balances.
- Supplier/service balances and pending refunds.

Support dry run, row-level errors, totals preview, source identifiers, import audit, duplicate detection and re-run safety.

Reconcile counts and financial totals to the approved source at the cutover date. Avoid posting a new receipt/remittance merely because a historical settled payment was imported.

Do not fabricate missing transaction history to force a matching balance. Record unresolved migration differences clearly.

---

## 6. Users, profiles, permissions and administration

Replace confusing technical presentation with plain business tasks while preserving sound security controls.

### Required user administration

- Add users; create/edit an actual profile.
- Name, work email, contact details as required, assigned role(s), company and branch scope.
- Active/inactive state, last access where available, onboarding status and relevant activity history.
- Secure invitation/reset process; deactivate/reactivate; revoke sessions.
- Clear permission groups and explanations of what each action permits.
- Appropriate password and MFA enrollment/recovery flows.
- Profile self-service for allowed fields, language/theme preferences and security settings.

Use the existing permission engine where possible. Avoid a new overlapping authorization system.

### Business roles

| Role | Main responsibilities |
|---|---|
| Telesales / Sales | Leads, communications, follow-up, appointments and sales handover. |
| Student Affairs Officer | Student/application files, documents, medical/eligibility verification, operational milestones, academic reports, guardian communications, training coordination and graduation. |
| Accountant | Verify collections, exchange rates, receipts, cheques, instalments, resources, academy transfers, expenses, refund calculations and financial balances. |
| Manager / authorized approver | Relevant oversight, approved exception/financial decisions and scoped reports. |
| Administrator | User/profile/security/configuration administration within assigned authority. |

Role templates should be editable through clear permissions. Do not give unrestricted financial authority merely because a person can manage users.

Provide Student Affairs the financial-status visibility needed for operations without granting silent edits to verified money records. Provide accountants the student information necessary for finance without enabling unauthorized changes to academic findings.

Enforce company/branch/action permissions on the server for all endpoints, searches, uploads, exports, downloads, report generation, bulk actions and direct identifiers. Hiding buttons alone is insufficient.

Preserve required maker/checker separation and limits. If administrative overrides exist, require explicit authority, reason and audit; never create a general bypass.

Fix repeated unnecessary authorization popups during ordinary navigation. Sensitive actions may still require purposeful verification with understandable wording.

---

## 7. Student workspace, staff work queues and management reporting

### Student workspace

Create/complete one coherent student workspace with:

- Overview, contacts, guardian and assigned staff.
- Applications/admissions and timeline.
- Tasks and appointments.
- Documents and verification.
- Contract and agreed schedule.
- Payments, receipts, allocations, cheques and account statement.
- Academy settlement summary and transfer history.
- Accommodation, transport and insurance.
- Visa/travel.
- Academic progress, reports, suspension/resumption and graduation.
- Refund/cancellation cases.
- Communication/distribution history and audit events.

Use concise labels and show the next action, responsible person and reason a step is blocked.

### Role-based work queues

- Sales: calls/follow-ups due, missed appointments, unassigned leads.
- Student Affairs: missing/rejected/expiring documents, admission work, visa/travel tasks, missing monthly reports, academic issues and email delivery failures.
- Accountant: unverified receipts, cheque clearances/returns, overdue instalments, academy transfers due, cash-plan three-month settlements, refund deadlines and unmatched bank transactions.
- Management: conversion, student stages, collection/arrears, cash/resource balances, academy funds pending transfer, open refunds and branch comparisons.

### Reports

Provide working, permission-aware filters, drill-down and export for:

1. Leads, sources, appointments, conversion and overdue follow-up.
2. Admissions/visa/travel status and missing documents.
3. Student statement, contractual schedule, receipts, credits, overdue and outstanding balances.
4. Receipts/collections by date, branch, resource, method and original currency.
5. Cheques received/pending/cleared/returned.
6. Academy expected/due/transferred/remaining amounts per student and plan.
7. AV8 commercial allocation separately from treasury cash and ledger income.
8. Monthly accommodation/transport charges and payments.
9. Insurance costs by student and period.
10. Refund cases, documented deductions, academy recovery, payouts and deadline breaches.
11. Academic progress, missing reports, distribution failures, suspension and graduation.
12. Cashbox/bank/wallet balances, movements, transfers and reconciliation.
13. Company and branch general ledger, trial balance, receivables/payables, fiscal-period and financial reports already supported by the ERP.

Reports must explain date basis, scope and currency. Never add unrelated currency balances without explicit conversion. No hardcoded KPI values, mock chart data or false zeroes for failed/unavailable queries.

---

## 8. Existing sales, purchasing, inventory and other ERP modules

Inspect every existing supported module and connect its end-to-end flows.

### Sales / customers

Verify customer records, quotations/orders where supported, invoices, posting, receipts, allocations, outstanding balances, credit notes/returns, cancellation/correction, printing and reporting.

Student-related charging must use one coherent source of truth. Do not create a second independent invoice balance that drifts from student obligations and receipts.

### Purchasing / suppliers / expenses

Verify supplier master data, purchase documents/receipts where supported, bills, due balances, payments, credits, expenses, attachments, approvals and financial effects.

Academy remittances and student-specific costs must have consistent partner/expense linkage without duplicate supplier liabilities.

### Inventory / products

If already in the delivered ERP, verify items, units, warehouses, stock movements, receipts/issues/transfers, adjustments, stock counts, valuation and relevant posting/reporting.

Preserve quantity precision and traceable movement history. Respect configured negative-stock, costing and approval rules; do not invent new costing policy.

Where study-kit/headset issuance already exists, connect it to the student with actual issue records. Do not duplicate an inventory subsystem just to record a package inclusion.

### Other existing modules

Apply the same complete-flow, authorization, reporting and correction checks to every additional supported module found in discovery. Document genuine scope decisions explicitly.

---

## 9. Finish the approved UI across the application

The approved direction is the Classic Sidebar with light and dark themes, compact ODIN branding, slim topbar and restrained blue emphasis.

- Keep the current accepted design. Do not restart visual exploration.
- Use the existing shared application shell, sidebar, topbar, page headers, forms, tables, cards, dialogs and tokens consistently.
- Preserve all permitted routes in expanded/collapsed sidebar modes; nested group state and active location must remain understandable.
- Reference proportions, if current implementation needs correction: approximately 232–240 px expanded sidebar, 72 px collapsed and 56–60 px topbar. Adapt to actual content and responsive behavior.
- Support Light, Dark and System consistently, including persistence, first render, charts, tables, tooltips, dialogs, toasts, selects and PDF preview surfaces.
- Avoid theme flashes, hydration errors and CSP-breaking theme initialization.
- Arabic and English must cover product copy, validation, empty/error states, dates, amounts and generated business documents where required.
- Use proper RTL layout and logical spacing. Mirror navigation appropriately without corrupting emails, IDs, numbers or Latin references.
- Use Africa/Cairo for business dates/time presentation; preserve correct stored timestamps.
- Verify desktop, tablet and narrow mobile layouts. Wide financial tables may scroll intentionally; the whole page must not overflow accidentally.
- Keep labels understandable: users/profiles, branches, cashboxes, bank accounts, wallets, approvals and student balances instead of unexplained internal terminology.
- Every visible button/link must perform its advertised action. Implement global search or clearly expose its real supported scope; do not leave a decorative search field.
- Implement loading, empty, error, forbidden, not-found, validation and success states.
- Prevent duplicate submissions; preserve form input after recoverable failures; warn about unsaved edits where meaningful.
- Verify keyboard navigation, focus visibility/order, dialog focus management, labels, accessible names, contrast and status text beyond color alone.
- Test long Arabic names, mixed-direction values, large amounts, zero/negative balances where valid and long tables.
- Do not remove useful information to make screenshots look clean.

---

## 10. Documents, printing and exports

Finish all in-scope generated business documents:

- Official collection receipts for bank, cash and cheque handling.
- Dynamic study contracts and complete payment schedules.
- Student statements.
- Academy transfer statements.
- Refund calculations, approvals and payout evidence.
- Academic report distribution documents.
- Existing sales/purchase invoices and finance reports.
- Graduation/certification records only to the extent the application is authorized to issue or record them.

Use AV8 business identity and existing approved ODIN product branding appropriately. Keep original legal party details tied to the relevant template/company; do not invent signatories, registration numbers, signatures or stamps.

Verify actual generated PDFs visually: Arabic shaping, fonts, RTL, mixed numbers, page breaks, repeated headers, totals, signatures/stamp spaces and table clipping.

Keep receipt/document numbers unique under the configured company/branch scheme. Preserve voided numbers and reprint history; do not reuse them.

Export only authorized rows/fields. Support usable Excel/CSV output and protect against spreadsheet-formula injection where user-controlled text is exported.

Signed-contract versions and signed/stamped receipts must be preserved and traceable.

---

## 11. Security, privacy and operational hardening

Investigate current behavior; do not assume old findings still apply.

### Authentication and sessions

- Verify login, expiry, refresh, logout, revocation, deactivation and multi-tab behavior.
- Review token storage, XSS exposure, cookies and CSRF as applicable. Implement a sound session architecture without breaking SSR/API/mobile flows actually in scope.
- Verify production CSP, CORS, headers, request-size limits, rate limits and proxy behavior.
- Enforce the approved privileged MFA policy and safe recovery. Do not repeatedly prompt ordinary navigation.
- Eliminate unsafe fixed/default production reset credentials and active demo/simple-login paths.

### Authorization and isolation

- Test cross-company and cross-branch access negatively through APIs, searches, exports, attachment URLs and jobs.
- Where RLS exists, verify actual request/transaction context and connection-pool reuse. An RLS policy's existence is not proof of isolation.
- Check finance limits/approvals, locked periods and role restrictions across all alternate entry points.

### Sensitive files and data

- Verify private storage, object-level authorization, upload size/type/content checks, safe filenames and malware handling appropriate to the deployed workflow.
- Protect preview/download/replace/archive paths, not just upload.
- Avoid public or indefinitely accessible URLs for passports, bank statements, medical files or contracts.
- Log appropriate access/change events without logging document contents or secrets.
- Verify backup/restore consistency between database metadata and document bytes.
- Implement approved retention and deletion rules with preserved required evidence. Do not guess statutory durations.

### Dependencies and maintainability

- Use the project's package manager and lockfile for reproducible installation.
- Run current dependency/security checks and address relevant exploitable findings without a blind major-version rewrite.
- Run real lint/type/build checks. Do not weaken lint rules to hide defects.
- Refactor oversized or fragile services only where needed to implement safely and supported by meaningful tests.
- Use consistent API contracts and frontend/backend types, validated input and bounded queries.
- Inspect repository/history exposure for secrets without printing values. Remediate code exposure and prepare necessary authorized rotation steps.

### Legal/accounting configuration

Inspect approved requirements for tax, invoice/receipt obligations, revenue recognition, privacy, retention and hosting/data transfers. If current law or vendor specifications are needed, verify official primary sources.

Do not claim ETA compliance, VAT exemption, legally valid e-signature equivalence, or financial reporting compliance solely because a field or PDF exists. Implement required integrations fully when scope and credentials are established; otherwise identify the precise release dependency.

An internal signed/stamped receipt is not automatically a government-validated electronic receipt.

---

## 12. Durable jobs, integrations and observability

- Use the existing durable job mechanism or introduce the smallest suitable durable design for required work.
- Ensure consistent creation of business records and dependent email/remittance/reminder work through an outbox or equivalent sound mechanism.
- Support retries, backoff, concurrency safety, deduplication, timeouts, failed-job visibility and authorized replay. Reconcile ambiguous provider outcomes before a replay that might duplicate an external side effect.
- Scheduled overdue/report/refund-deadline work must survive process restarts.
- Keep background-job company/branch scope and actor/authority context explicit.
- Complete existing lead/provider/payment integrations in scope, including signatures, duplicates, out-of-order events and reconciliation as applicable.
- Integrations without credentials must show an actionable unavailable/configuration state. Never mark an unperformed send, transfer or submission successful.
- Record structured errors, request/job correlation and relevant company identifiers while redacting secrets and sensitive payloads.
- Monitor application availability, server errors, failed financial operations, email/job failures, overdue remittances, refund deadlines and integrity-check failures.
- Test the configured alert route using controlled recipients. Do not claim alerting is verified based only on configuration files.
- Add state-aware integrity/reconciliation checks with actionable exception reports; do not implement mathematically false shortcuts.

Do not mandate a hosting migration or new paid service unless current requirements cannot be met and the change is approved. Evaluate the actual deployment's job execution, database connections, storage persistence, timeouts and recovery capabilities.

---

## 13. Verification: prove the workflows

Use the current test tools where possible. Add meaningful tests for money, dates, authorization, state transitions and integrations. Avoid implementation-mirroring tests that merely assert a function was called.

Verify all discovered routes and controls, and deeply test the following scenarios using synthetic students and scoped roles:

| Test | Required outcome |
|---|---|
| T01 Long sales cycle | A lead can remain active for months, retain communication history and surface the next due follow-up without automatic closure. |
| T02 Appointment to application | Appointment outcome and handover create/link the correct student/application without duplicate identities. |
| T03 Application and failed medical | The USD 2,000 payment is recorded once; medical failure creates the documented refund workflow and actual payout is separately evidenced. |
| T04 Admission prerequisites | Medical pass with a missing required document cannot falsely complete admission. A not-required family record does not block another student. |
| T05 Parallel operational work | English, documents, finance and visa states can progress independently without overwriting each other. |
| T06 Plan totals and documents | Plan 1 and 2 total USD 64,000 each; pay-in-full totals USD 54,000; dynamic schedules include every item exactly once in UI, API and PDF. |
| T07 Date calculations | Approved quarterly offsets, month ends, leap years and Cairo date boundaries produce correct dates without UTC shifts or 90-day substitutions. |
| T08 Delayed travel | Changing visa/travel/training dates leaves the contractual schedule and overdue history unchanged. |
| T09 Contract amendments | A future template change does not alter a signed contract; an authorized amendment preserves the original and records the difference. |
| T10 Initial instalment allocation | USD 16,000 collected reconciles to USD 6,000 academy allocation and USD 10,000 AV8 allocation; actual transfers remain separate. |
| T11 Initial academy milestones | USD 1,500 and USD 4,500 are counted within the USD 6,000 total and are not duplicated by retries. |
| T12 Partial later instalment | USD 3,000 paid against a USD 9,600 instalment leaves USD 6,600 outstanding and creates a USD 3,000 remittance requirement, not a completed transfer. |
| T13 Pay-in-full settlement | USD 54,000 is scheduled for the academy at contract +3 months; there is no invented USD 10,000 retention or USD 60,000 double-transfer total. |
| T14 Foreign-currency receipt | Original currency/amount, rate and USD credit reconcile; a later rate update cannot rewrite historical credit. |
| T15 Fees | Gross payment, net cash, principal credit, fee expense/reimbursement and any residual student balance reconcile. No silent fee waiver, unsupported credit for unreceived money or reduction of the academy's agreed entitlement conceals a shortage. |
| T16 Cheques | Received, cleared and returned states obey the selected policy. A replacement cheque/payment cannot leave duplicate credit. |
| T17 Signed/stamped receipt | Every supported collection method produces the official receipt workflow; unsigned output is not falsely labelled signed. |
| T18 Concurrent receipts | A retry and two simultaneous submissions cannot create duplicate receipt, allocation, ledger or remittance effects. |
| T19 Overdue and suspension | Overdue state, internal financial hold and academy-confirmed suspension are distinguishable; dates remain unchanged. |
| T20 Resolution and resumption | Partial or full clearance follows the selected resolution policy; no false academy resumption or cancellation of unrelated services. |
| T21 Refund calculation | Only eligible documented actual expenses are deducted once; no automatic contract-payment/commission forfeiture or deduction of all academy transfers. Termination preserves original schedules and correctly classifies cancelled versus retained obligations under the approved policy. |
| T22 Refund timing/recovery | Termination +45 days remains visible while academy funds are awaited; recovery, partial payouts and remaining student refund reconcile. A foreign-currency payout uses a labelled approved-policy fixture and leaves the original receipt credit unchanged. |
| T23 Concurrent refund actions | Two workers/users cannot refund the same eligible funds twice; unsuccessful/disputed requests preserve history. |
| T24 Insurance | The USD 400 AV8 expense is linked to the student and evidence without adding an unapproved student charge or academy remittance. |
| T25 Monthly services | Accommodation/transport use the agreed period/price and actual collection party. Direct provider payments do not inflate AV8 cash. |
| T26 Monthly report review | Student Affairs records and reviews the academic report with source evidence and version history. |
| T27 Both email recipients | Student and guardian each have a delivery record. A failed guardian send remains visible after a successful student send. |
| T28 Email retry and corrections | Retrying a confirmed failed recipient does not resend another recipient's successful email; ambiguous provider outcomes are reconciled or held for review; a corrected report retains its own version and dispatch history. |
| T29 Graduation | Graduation records academic completion without wiping outstanding student/academy/refund/service balances. |
| T30 Cross-branch collection | A student managed by one branch can pay into an authorized other-branch resource; branch and company totals reconcile. |
| T31 Internal resource transfer | Source/destination movements remain atomic; company funds are not inflated and no transfer is treated as sales. |
| T32 Financial reporting | Student subledger, academy settlement, resources and ledger/control reports reconcile with legitimate pending/unallocated states explained. |
| T33 Locked periods and posted history | Every relevant API/import/job respects locks and approvals; corrections use authorized reversal/adjustment paths. |
| T34 User management | Add/profile/role/scope/reset/deactivate/revoke flows work; deactivated access and unauthorized privilege escalation are rejected. |
| T35 Negative authorization | Cross-company/branch record access, search, file download and export fail appropriately, including direct IDs and pooled connections. |
| T36 Opening-data import | Dry run catches invalid rows; totals reconcile; repeat import is safe; historical settled payments do not trigger new collections/transfers. |
| T37 Existing ERP modules | Every supported sales/purchasing/inventory/other module has complete create-to-post/payment/correction/report workflows as applicable. |
| T38 All routes and UI states | Every inventoried route/control works with appropriate permissions and real data; no dead tabs, fake metrics or placeholder success. |
| T39 Language/theme/responsiveness | Critical workflows and shared components work in English/Arabic, Light/Dark/System and desktop/mobile; every route receives responsive/theming coverage. |
| T40 Printing and exports | Real rendered PDFs and exports contain correct amounts, dates, rows, Arabic text, pagination and authorization-scoped data. |
| T41 Durable processing | Restart/crash/retry does not lose required jobs or duplicate internal money effects; successful academic dispatches are not blindly replayed and ambiguous external outcomes remain visible. |
| T42 Migration and recovery | Migration rehearsal preserves historical data; isolated database/document restore succeeds with measured recovery evidence. |
| T43 Monitoring | A controlled failure reaches the configured operational alert route without leaking sensitive payloads. |
| T44 Production configuration | Required services, worker/scheduler, email/storage/DB settings and health checks are validated without demo accounts or exposed secrets. |

### Test evidence

- Run relevant unit, integration, API, money-concurrency, E2E, build, type, lint and security checks.
- Open and use the actual rendered application. Verify full workflows under realistic roles, not only as an unrestricted administrator.
- Use controlled data for screenshots and exported examples. Never include real student documents or credentials in handover evidence.
- Inspect browser console/network errors and server logs for the tested flows.
- Add focused accessibility and keyboard checks; do not claim full formal accessibility certification from one automated scan.
- Run representative performance checks for lists/search/reports/imports and concurrent finance actions. State workload and measured results. If client load targets are missing, do not invent an SLA.
- Test restore into an isolated environment, including attachment access and financial reconciliation. A backup file's existence is not restore evidence.
- Report PASS, FAIL, BLOCKED or NOT RUN honestly, with commands, environment/commit and evidence.
- Once relevant risks and gates are covered, avoid redundant tests that do not resolve an additional risk.

---

## 14. Deployment readiness, reliability and handover

### Release engineering

- Use separate development/test/staging configuration and synthetic or appropriately masked data.
- Keep production secrets out of source, logs, screenshots and documentation.
- Separate safe reference-data initialization from demo data.
- Make migrations repeatable where intended, reversible or recoverable as appropriate, and rehearse them against representative data.
- Verify the actual CI gates execute successfully; workflow files alone are insufficient.
- Align build artifacts, database migration version and exact tested commit/release identifier.
- Inspect current hosting/database/storage capabilities against actual reliability, retention and workload requirements. Do not assert a free/paid tier or live setting solely from an old README.
- Establish backup schedule, retention and restore instructions using available authorized infrastructure.
- Verify that recoverable database and private-document backups exist outside the production host's failure domain, with access protection, retention and restoration instructions available even if that host is lost. Use an already authorized destination consistent with approved residency requirements. If unavailable, prepare configuration and report the precise production recovery prerequisite. A same-host restore test alone does not establish disaster recovery.
- Record measured recovery time/recoverable point and compare with business-approved RTO/RPO when available.
- Document rollback limitations and recovery steps, including data/schema compatibility.
- Prepare production smoke checks and a concrete release checklist.

### Required handover outputs

Create and maintain an organized delivery folder, adapting paths to repository conventions. Suggested paths:

- docs/final-delivery/00-execution-ledger.md
- docs/final-delivery/01-scope-and-route-coverage.md
- docs/final-delivery/02-business-rules-and-decisions.md
- docs/final-delivery/03-data-and-financial-model.md
- docs/final-delivery/04-permissions-and-role-matrix.md
- docs/final-delivery/05-test-results-and-evidence.md
- docs/final-delivery/06-migration-and-opening-balances.md
- docs/final-delivery/07-deployment-and-recovery-runbook.md
- docs/final-delivery/08-admin-and-support-runbook.md
- docs/final-delivery/09-user-guide-en.md
- docs/final-delivery/10-user-guide-ar.md
- docs/final-delivery/11-release-notes-and-readiness.md
- docs/final-delivery/12-historical-review-disposition.md

Use concise usable documents, not empty placeholders or duplicated boilerplate.

The English/Arabic user guides must explain actual implemented workflows for sales, Student Affairs, accountants and administrators, with screenshots from synthetic data where tooling permits. Cover common errors and recovery, not just menu descriptions. Use the approved product identity.

The support runbook must cover user/MFA recovery, integration failures, refund/remittance exceptions, backup/restore, incident handling and known operational dependencies. Record real owner/contact information only when supplied; flag missing ownership without inventing it.

Provide environment-variable names and setup instructions with no secret values. Include how to configure email dispatch, approved test recipients, storage, scheduler/workers and financial policies.

Provide a practical client-demo/UAT script using synthetic examples: a normal student, medical failure, partial instalment, overdue/suspension, cash-plan settlement, monthly report with failed guardian delivery, refund awaiting academy funds, and cross-branch collection.

---

## 15. Disposition of the historical review

If the old review is supplied, map its 36 numbered items to current evidence. The themes below make this prompt usable even without the PDF.

Use one of: already satisfied and verified; fixed and verified; required but blocked; conditional applicability/decision; approved outside scope; or still incomplete. Absence of a named library is not proof that the capability is missing.

| Review item | Investigation and disposition required |
|---|---|
| 1 | Determine approved ETA e-invoice/e-receipt applicability and finish the actual lifecycle if required; no fabricated compliance. |
| 2 | Approved VAT, accounting and revenue-recognition rules with matching tests. |
| 3 | Refund, currency, academy-settlement and other business decisions; use the latest client rules in this prompt. |
| 4 | Data map, approved privacy/retention/access-request/breach/transfer requirements and ownership. |
| 5 | Session/token exposure and production CSP; verify actual current architecture. |
| 6 | Privileged MFA, safe reset/invitation and production demo-access restrictions. |
| 7 | Private document storage, authorization, file validation, scanning and access audit. |
| 8 | Actual backup/recovery capability, agreed objectives and restore drill. |
| 9 | Logs, errors, metrics, availability and tested alerting. |
| 10 | Repository/credential exposure, history scanning and authorized remediation; never print secrets. |
| 11 | Cascade-delete/evidence protection and safe archival/correction. |
| 12 | Runbooks and real support ownership. |
| 13 | Reproducible dependency installation, lockfile, vulnerability/update process and dependency inventory. |
| 14 | Focused service decomposition and real code-quality checks where needed. |
| 15 | Durable required background jobs with failure/retry visibility. |
| 16 | Required notifications, especially the now-mandatory dual-recipient academic email; other channels only when in scope. |
| 17 | Existing/promised student/guardian portals; do not create an unrequested major portal just to close a generic checklist. |
| 18 | Reliable lead entry/import and any existing approved automated capture. |
| 19 | Confirmed bank/cash/cheque collections and any already-scoped gateway/wallet integrations. |
| 20 | Bank import/matching/reconciliation and unmatched-item workflows. |
| 21 | Role work queues and the complete student workspace. |
| 22 | Practical security testing and resolution; do not claim an independent penetration test was performed if it was not. |
| 23 | Staging and executed release gates. |
| 24 | Realistic performance and financial-concurrency evidence. |
| 25 | Mobile, accessibility and both-language/theme checks with stated limits. |
| 26 | Hosting/residency suitability based on approved requirements; no automatic infrastructure migration. |
| 27 | Correct state-aware financial integrity and reconciliation monitoring. |
| 28 | Applicable document expiry tracking and staff follow-up. |
| 29 | Academy settlement statements; a new partner portal only if in scope. |
| 30 | AV8 allocation/commission handling and existing agent commissions; do not invent pay-in-full commission. |
| 31 | Existing budgeting/forecasts and known-date collection/remittance schedules; no invented forecasting product. |
| 32 | Consistent API contracts and existing required partner/webhook interfaces. |
| 33 | Dynamic, versioned bilingual contract documents and approved signing process. |
| 34 | BI warehouse/read-replica only if already justified/in scope. |
| 35 | Native mobile only if already explicitly in scope. |
| 36 | AI features only if separately approved; not a prerequisite for this delivery. |

Do not repeat the old report's speculative timelines or treat its unverified legal statements as facts.

---

## 16. Required execution sequence

### Phase A — establish facts

Inspect the current project and run a baseline. Inventory scope, identify current defects, preserve approved design and create the delivery ledger/matrices. Determine actual access and configuration readiness without exposing secrets.

### Phase B — stabilize financial foundations

Complete tenant/branch authorization, resources, monetary primitives, posting/corrections, transaction safety and opening-data strategy. Establish versioned business policies and explicit decision handling.

### Phase C — finish complete AV8 journeys

Implement student workspace and lead/admissions/document/contract/collection/academy/refund/service/academic/graduation flows. Make monthly dual-recipient email and real failure recovery work. Integrate with the existing ledger and treasury.

### Phase D — finish all existing ERP surfaces

Complete every supported module and route. Fix administration, profiles, permissions, UI consistency, Arabic/RTL, themes, responsive behavior, documents and reports.

### Phase E — prove and harden

Run the meaningful tests and full route review, resolve failures, rehearse migrations and restores, verify monitoring and provider behavior, and record evidence against the acceptance matrix.

### Phase F — prepare final delivery

Finish configuration/setup requirements, release artifacts, guides, demo/UAT script, runbooks and readiness report. Complete all independent work even when a particular external decision remains blocked.

Use these phases as coordination, not as an excuse to stop between phases. Parallelize independent work responsibly.

---

## 17. Definition of done and final response

Completion means the agreed product works end to end and the evidence supports that statement.

Required conditions:

- Every existing supported route/action has a recorded disposition and functional evidence.
- Every explicit business workflow in this prompt is implemented and verified, or its exact external/policy blocker is disclosed.
- Financial totals, resources, student balances and academy settlement reconcile under tested scenarios.
- No unauthorized data access, duplicate money effects, broken corrections or silent loss of financial/document history remains.
- Approved UI identity, light/dark/system, English/Arabic and responsive behavior are consistent.
- Monthly reports reach the configured test student and guardian independently, with correct delivery/retry evidence.
- Real PDFs/exports and the dynamic contracts have been visually and numerically checked.
- Migration/opening-balance/recovery/monitoring/release checks have actual evidence.
- Code, configuration instructions, test evidence and handover documents correspond to the same tested release.

Your final response must include:

1. What changed and why, organized by user-visible capability.
2. The exact tested commit/build and environments.
3. A coverage/result summary with counts and links to the detailed matrix.
4. Test commands and outcomes, including failures, blocked and not-run items.
5. Migration/cutover and rollback/recovery status.
6. Required configuration and external dependencies, without secrets.
7. Business decisions still needing confirmation, with recommended choices and affected operations.
8. Where the guides, runbooks, release notes and demo script are located.
9. An evidence-based verdict: ready for the stated environment and use, or not ready because of specific remaining gates.

Do not claim "100% complete" because code compiles, pages render, or a test suite exists. Do not claim independent certification, legal compliance or production delivery without evidence.

Do not use a missing credential, one unresolved decision, or an external dependency as a reason to stop unrelated work. Finish everything you can safely and legitimately complete. For each remaining blocker, state exactly what was verified, what is unavailable, the acceptance criterion it prevents and the smallest action required.

START NOW: inspect the repository, create the execution ledger and coverage matrix, run the baseline, then proceed through implementation, testing, fixes and final handover. Continue until all authorized, unblocked work is complete.


---

## Authoritative user deployment correction — 31 October 2026

This correction supersedes hosting assumptions in the original brief and existing delivery notes. Preserve all completed and in-progress implementation.

- Final hosting: the user's Hetzner server. Final application URL: https://av8.odin-ltd.com.
- The user created a GoDaddy A record named `av8` under `odin-ltd.com` pointing to the Hetzner server. Verify current resolution and HTTPS during deployment.
- Authorized synthetic acceptance recipients: student, guardian and controlled monitoring addresses supplied by the user and recorded in the protected runtime recipient manifest (personal addresses intentionally omitted from publishable source). These destinations are authorized only for synthetic acceptance reports and controlled alerts through actual application integrations.
- Prepare isolated staging with separate test data, storage, credentials and background-job state. Only `av8.odin-ltd.com` is currently configured in DNS.
- Stop provisioning new Vercel staging projects. Preserve existing deployments and all other Hetzner applications. Update deployment configuration, affected tests and handover documents for Hetzner.
- For missing server access, email-provider configuration or additional DNS, record the exact required action and continue all independent work. Revisit completed work only where the hosting correction affects it.


## Authoritative administrator and email correction — 31 October 2026

The user selected the first administrator identity, stored in protected deployment configuration. Use the secure named-owner setup flow with a private generated one-time credential, mandatory password change and MFA; never publish credentials or create a shared/default password. Keep synthetic student/guardian records separate from the administrator and permissions.

The intended sending domain is `av8.odin-ltd.com`, with sender `AV8 Aviation Academy <reports@av8.odin-ltd.com>` and the user-supplied Reply-To in private configuration. Domain verification is pending until confirmed in Resend. Preserve `/srv/av8-erp-final/private/resend.env`, mode0600 and service UID1000 ownership, and load the key only through `AV8_ACADEMIC_EMAIL_API_KEY`. Stage and production credentials/configuration must remain separate. Wait for the user's confirmation that the private key is configured and domain verification is complete before running controlled external email tests. Record recipient outcomes separately; never treat sender configuration as delivery evidence. Continue independent work during this wait.


## Owner-approved off-host recovery deferral — 31 October 2026

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

This targeted deferral is non-blocking for the current delivery and supersedes only the off-host backup/restore gate. Do not provision external backup storage or request its credentials; revisit only when the owner asks. Complete local encrypted backup and isolated restore checks and usable creation/restoration instructions. Report actual local results without claiming external disaster recovery or verified RPO/RTO targets. All other implementation, acceptance, deployment and handover requirements remain in force.
