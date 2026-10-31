# Permissions and role matrix

This matrix describes the current code and isolated seed templates. It is not evidence that a production account has been reviewed. Current-release runtime evidence is recorded in [scope coverage](01-scope-and-route-coverage.md) and the verification report. Permissions are enforced again on the API; menu visibility is not the authorization boundary.

## Role templates

| Template | Intended work | Explicit limits in the isolated template |
|---|---|---|
| Telesales | Lead entry/import, communications, appointments and follow-up | No application conversion, student finance, medical, guardian or policies access |
| Sales | Lead lifecycle and conversion, application and contract preparation, medical results, guardian consent | No student-finance create/approve/confirm permissions; assigned-record scope |
| Student Affairs | Documents, English, visa/travel, eligibility/admission decisions, monthly services, progress and delivery, training/graduation, guardian details | No finance view/create/confirm; cannot record provider payment or approve monetary decisions |
| Accountant / Finance | Student balances/receipts, academy transfers, refunds, cheques, financial reports, treasury and accounting | No general Student Affairs or guardian access; policy view alone does not permit changing policy |
| Management | AV8 policies and exceptions, financial approvals, scoped reporting/accounting/treasury | Requires assigned financial resources and applicable company/branch scope; not automatically user administration |
| Super Admin | Tenant administration, roles/scopes, diagnostics and emergency access | Broad authority; use named business roles for ordinary work and preserve audit evidence |

Source: `apps/api/prisma/av8-seed.ts`. Seed identities are synthetic and are not production starter accounts. The normal role editor and permission registry remain available. User-management permission does not imply unrestricted finance permission. Access assignments, denials and authority limits must be reviewed for each named production user.

## AV8 action controls

| Screen/action | Server permission | Additional conditions |
|---|---|---|
| Leads list/detail/create/edit/import/convert | `av8.leads.view/create/edit/import/convert` respectively | Tenant, branch and assignment scope; conversion prerequisites and repeat protection |
| Application detail/contact/assignment/contract | `av8.applications.view/edit` | Scoped record; stale-version checks; signed contracts retain policy snapshots |
| Medical view/result | `av8.medical.view/edit` | Medical outcome is independent from student-payment posting |
| Sensitive documents | `av8.affairs.*` plus `av8.passport.*`, `av8.bank.*`, `av8.criminal.*` as applicable | Protected metadata, uploads and downloads; document-specific permissions |
| Eligibility/admission; English, visa and travel | `av8.affairs.edit` | Evidence and real prerequisite validation; departure exception additionally requires `av8.exceptions.approve` |
| Guardian view/edit | `av8.guardian.view/edit` | Registered relationship and sharing consent; missing permission redacts guardian data |
| Monthly service agreement/amendment | `av8.affairs.edit` | Explicit AV8/provider collection party; immutable prior agreement |
| Monthly charge / expense draft | `av8.finance.create` | Scoped student and supplier; a draft is not a paid expense |
| Service payment / actual expense payment | `av8.finance.confirm` (expense also requires create) | Evidence; AV8 service receipts cannot also settle tuition; actual expense links to posted payment |
| Monthly report revision/review | `av8.affairs.edit` | Original attachment and versioned correction; no overwrite of reviewed report |
| Queue report delivery | `av8.affairs.edit` and `av8.guardian.view` | Student and registered guardian tracked separately; eligible reviewed version only |
| Retry/reconcile delivery | `av8.affairs.edit` | Retry only permitted failure/blocked states; ambiguous delivery needs provider reconciliation |
| Training and graduation | `av8.affairs.edit` | Academy evidence for confirmed suspension/resumption; exception resolution additionally needs exception approval |
| Immediate actual receipt | `av8.finance.create` | Configured account/mapping/rate, open period, scope and remaining charge balance; posted atomically |
| Transfer/refund/recovery request | `av8.finance.create` | Actual references/evidence, independent entitlements and recoveries, capped allocations |
| Bank-fee reimbursement request / approval / actual receipt | `av8.finance.create/approve/confirm` | Actual remittance fee and approved account mapping; explicit reconciled student shares for batches; fee cap independent from tuition |
| Opening history / preview / commit | History: `av8.finance.view`; preview: `av8.finance.adjust`; commit additionally `accounting.journal.post` | Same scoped source and reviewed preview; independently approved opening journal; no new cash/journal posting |
| Link opening supplier settlement | `av8.finance.confirm` | Existing posted bank movement or independently approved manual settlement journal; same company/branch, documented source conversion and one-use linkage; creates no new cash/journal |
| Payment instruction approval | `av8.finance.approve` | Maker/checker rules and workflow prerequisites |
| Confirm actual cash movement | `av8.finance.confirm` | Approved instruction, evidence, scoped account and open period |
| Allocation correction / plan amendment | `av8.finance.adjust` | Audited reversal/version and independent approval where applicable |
| Receive/present/return/cancel cheque | `av8.finance.create` | Receipt creates no cleared cash; only allowed current states |
| Clear presented cheque | `av8.finance.confirm` | Approved D04 policy, bank clearance evidence and dated FX |
| Approve reversal of cleared cheque | `av8.finance.approve` plus `av8.finance.adjust` | Approver must differ from requester; original cash/allocation links preserved |
| Receipt signed-copy certification | `av8.finance.confirm` | Actual attached signed/stamped copy; generated PDF does not fabricate a signature |
| Policy view / revision / approval | `av8.policies.view/manage/approve` | Accounting mapping additionally requires finance visibility and approval authority; drafts unusable for new contracts |
| Report view/export/print | `av8.reports.view/export/print` | Underlying financial, affairs, medical/guardian scopes still apply; CSV is the current filtered page |

Source: `av8-access.ts`, `av8.service.ts`, `av8-finance.service.ts`, `av8-operations.service.ts`, `av8.controller.ts`, and `screens/av8*.tsx`. The endpoint inventory records source references for the inherited ERP as well as AV8.

## Data scope and checks before assignment

A permission grant must be combined with the intended company, operational branches, record ownership/assignment and financial-resource assignments. Explicit deny and expired temporary access must remain effective. A saved URL or guessed numeric identifier does not grant access. Review exports, attachments, printed statements and bulk requests under the same scope as the interactive page.

Use two named users to rehearse maker/checker actions. Test a user from another branch and an unassigned financial resource. Verify inactive accounts/users cannot be used for new work. MFA, account recovery and production access review remain deployment responsibilities documented in the runbook; the isolated test environment intentionally does not send external messages.

## Browser session

Access tokens are held only in application memory. Restoration uses the existing HttpOnly refresh cookie and a non-secret browser hint. No JWT decoded from browser storage grants UI authority during a server failure. Cross-tab signals contain no persisted bearer; transient session messages are verified against `/api/auth/me`. Cookie rotation and logout are serialized with Web Locks where supported. A failed server sign-out is reported explicitly. The focused browser regression exercises restoration, transient outage, cross-tab logout and account switching; see release evidence for the final tested result.

The compiled browser maker/checker rehearsal also confirmed that the AV8 Management template does not automatically expose generic journal lines. The independent generic journal approval/posting test uses an authorized Admin and a separate Finance maker. Assigning an AV8 financial approval action is not a substitute for the generic journal field/action permissions.
