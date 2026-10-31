# AV8 administration and support

Use named accounts and assigned company, branch and financial resources. Production startup rejects the legacy simple-login bypass and demo deployment. Configure MFA and the authenticated access-recovery workflow before rollout; never use a shared fallback password or disable MFA to recover access. Deployment, backup and recovery commands are in the release/migration runbook. The exact technical production rollout is recorded in 14-release-verification.md; live-business activation remains conditional as listed in 11-release-notes-and-readiness.md.

## Academic delivery

Academic report review requires meaningful results, the academy source, and the original report attachment. A review creates an immutable `report-version` and one durable `academic-dispatch` for the student and another for the guardian. Each version retains its exact attachment IDs. A correction returns the working report to received, increments its version, and needs fresh review. Earlier evidence and delivery history remain available.

The delivery adapter is Resend over HTTPS. Configuration values are private deployment secrets:

| Variable | Meaning |
| --- | --- |
| `AV8_ACADEMIC_EMAIL_ENABLED` | Explicit `true` enables this adapter; default is `false`. |
| `AV8_ACADEMIC_EMAIL_PROVIDER` | `resend`. |
| `AV8_ACADEMIC_EMAIL_FROM` | One verified plain address or safe display-name mailbox; no control characters or recipient list. |
| `AV8_ACADEMIC_EMAIL_REPLY_TO` | Optional single plain email address; sent as the provider’s `reply_to` field. |
| `AV8_ACADEMIC_EMAIL_API_KEY` | Provider credential; never include in screenshots, exports or logs. |
| `AV8_ACADEMIC_TEST_RECIPIENTS` | Comma-separated exact allowed recipients; mandatory outside production. |
| `AV8_ACADEMIC_WORKER_ENABLED` | Explicit `true` permits the named academic dispatcher. |
| `AV8_ACADEMIC_WORKER_USER_ID` | Active named actor with assigned application scope, Affairs edit and guardian view. |
| `AV8_OPERATIONS_WORKER_ENABLED` | Explicit `true` permits maintenance of expected report periods, financial holds and refund deadline tasks. |
| `AV8_OPERATIONS_WORKER_USER_ID` | Active actor with the operational permissions and assigned application scope. |

Keep inherited `AV8_OUTBOUND=disabled` and `AV8_JOBS=disabled`. The named academic/operations switches are independently validated exceptions for these implemented workflows. A disabled worker account or lost permission prevents that worker from bypassing access controls. A continuously running local process uses a 30-second interval. Vercel and externally scheduled mode suppress that timer; hosted processing uses the authenticated endpoint below. Queue state is in PostgreSQL, so process restart does not erase required work.

### Hosted scheduling

`GET` or `POST /api/av8/scheduler/tick` requires `Authorization: Bearer <AV8_SCHEDULER_SECRET>`. No ordinary browser/session token substitutes for this distinct 32–512 character secret. Configure the hosting scheduler's encrypted header; never put the secret in a URL, committed configuration or screenshots. The endpoint is disabled by default. Set `AV8_SCHEDULER_ENABLED=true` only after configuring the active named worker identities and required permissions/provider settings above. Do not change the inherited integration switches.

Each invocation processes at most `AV8_SCHEDULER_APPLICATION_LIMIT` applications (default 20; maximum 50) and `AV8_SCHEDULER_DISPATCH_LIMIT` recipient requests (default 1; maximum 2). PostgreSQL retains the maintenance cursor and a 90-second lease. A concurrent invocation skips a claimed maintenance batch; failure preserves its cursor. A restarted process resumes it. Recipient delivery has its own durable claim and ambiguous-send state. Maintenance and delivery run independently so one failure cannot silently hide the other's result. Increasing limits requires measuring the hosting function timeout; schedule repeated bounded invocations to drain the queues.

Configure the actual hosting schedule against the chosen staging endpoint first, then run with a controlled sender/recipient allowlist. Observe successful invocations, a controlled failure, resumed cursor, and recipient delivery evidence before enabling production. This delivery verified the endpoint and durable state on isolated PostgreSQL. The Hetzner package now includes a private, persisted host monitor and bounded scheduler invocation; see [hetzner-deployment.md](hetzner-deployment.md). Actual final-image schedules passed in both environments. Staging report/alert delivery is verified; production report emails and email alerts remain disabled pending its distinct provider key.

Review the Delivery history on the student and the Academic delivery report daily. Report filters use record-creation dates in Africa/Cairo and state this basis. Meaning of delivery states:

| State | Action |
| --- | --- |
| `BLOCKED_CONTACT` | Correct the missing/invalid student or guardian email, record guardian progress consent, then explicitly retry. |
| `BLOCKED_CONFIGURATION` | Resolve configured provider/sender/allowlist, then retry. |
| `QUEUED` / `SENDING` | Wait for the worker; avoid repeated manual processing. |
| `ACCEPTED` | Provider accepted the request. This is not delivery or a read receipt. |
| `FAILED` | Confirmed failure. Correct the cause and retry this recipient only; backoff and attempt history remain. |
| `DELIVERY_UNKNOWN` | Timeout, ambiguous response, or expired sending lease. Never blindly retry. Retrieve the provider message reference and use Reconcile. |
| `DELIVERED` | Provider retrieval verified the exact recipient and report-version subject and reported delivered. It does not prove the recipient read it. |
| `BOUNCED` | Investigate the actual contact/provider event; preserve the failed evidence. |

The provider's [send API](https://resend.com/docs/api-reference/emails/send-email) and [message retrieval API](https://resend.com/docs/api-reference/emails/retrieve-email) define acceptance and retrieval. Its [idempotency window is 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). The application additionally claims each queued recipient in the database and holds uncertain outcomes; it does not claim exactly-once external email delivery. A successful recipient is not re-enqueued when the other recipient fails. Report correction creates a new version with new intended deliveries.

Controlled automated tests stub provider responses for success, guardian failure, timeout and reconciliation using `.invalid` addresses. Actual authorized staging reports are now DELIVERED independently for student and guardian, one attempt each, with provider retrieval plus recipient/inbox confirmation. Staged DOWN and RECOVERED alerts also arrived. The current replacement key is loaded by the actual API process. [Redacted evidence](evidence/hosted-email.json) preserves original send provenance and final-image checks. Production intentionally awaits its own key in `/srv/av8-erp-final/production/private/provider.env`; enable and recheck its provider/alerts only after private configuration is confirmed. Do not resend successful staging reports to test a key.

## Monitoring and incident handling

The local worker emits structured stderr event `av8.operations.worker.failed`; the hosted endpoint emits `av8.scheduler.failed` and returns HTTP 503 when processing fails. Both use fixed safe messages. Tests verify deliberately raised failures reach this route without exception payloads, student email or synthetic credentials. Production operators must subscribe the hosting log/alert route and failed-schedule status to these events and test that the designated responder receives them. A local captured log is not evidence of an external pager/email subscription.

When alerted, check environment validation, active configured worker identity, then the scoped delivery and operational reports. Inspect safe provider status codes rather than copying attachment bytes, contact data or credentials into tickets. Disabled configuration should remain disabled until its cause is understood. Retry confirmed failures after correction; reconcile unknown deliveries. Preserve the original audit and record IDs in incident notes. An expired sending lease is deliberately marked unknown, because a process could have died after provider acceptance.

The maintenance pass is bounded and repeat-safe. It creates missing expected-report periods, records internal `HOLD`/`RESOLVED` events from actual overdue balances, and adds one refund deadline task per case. It does not post cash, alter contract due dates, tell an academy that training is suspended, or cancel monthly services. Staff record academy suspension/resumption separately with date and evidence. Select either all overdue cleared or an explicitly authorized exception when requesting resumption.

## Services and insurance

Accommodation and transport agreements record provider, collection party, monthly original currency, price, and effective dates. A changed price needs a later agreement version. Generate the correct month once. A direct-provider payment records evidence without an AV8 receipt or treasury event. An AV8-collected service payment links a cleared receipt in the same currency and consumes its available credit; the same money cannot also pay tuition.

Correct a service payment with its explicit reversal action, a date, reason and evidence. The system appends an exact negative record once; it preserves the original. Reverse a service allocation before processing a returned cheque that funded it. The reversal itself records allocation evidence, not a new cash refund.

Insurance is an AV8-paid USD 400 expense. Create a draft with the supplier/invoice/policy and explicit refund eligibility decision. Record paid only after linking the actual posted supplier expense payment and evidence, original payout currency/rate and payment date. The linked payment date and amount must match. It creates no extra student tuition charge or academy remittance. Refund deduction remains a separate approved policy decision; a recorded expense alone does not authorize it.

## Opening data and cutover

Use Business settings → Opening balances with a UTF-8 JSON manifest. A dry run returns source row errors and exact control totals without writes. Commit uses the hash of that exact preview and a reason. An edited file needs a new preview. The file upload limit is 20 MB; each original signed agreement attachment is limited to 4 MB. Split unrelated branch cutovers into separate files and approved journals. Large imports should use bounded reviewed batches; do not hide failed rows by silently dropping them.

The source is an end-of-day calendar cutover. Include original dates up to and including `cutoverDate`; begin ordinary new movements on the next day. Freeze entry during the reconciled cutover, because this model does not distinguish intraday opening and closing movements on the same date. Treasury combines the one original resource baseline with movements strictly after that date. A resource cannot receive another opening baseline from another source or batch.

Prepare a separately approved posted manual opening journal in Accounting at the cutoff date before commit. The importer does not invent offset accounts, post historical cash again, or create new academy milestones from settled transfers. Missing/unapproved journal references appear as blockers in preview. Resource balances must match their distinct GL account lines in that journal; customer/supplier liability control totals must match liability credit-minus-debit lines. Retain original currency amounts and documented rates as well as book amounts. Existing assigned resource/company/branch checks apply.

Required manifest fields and a deliberately non-committable template are described in [opening-manifest.md](opening-manifest.md). Use stable source system, person, application, fund, schedule and obligation IDs. An exact repeated file returns its original import; changed source identity/content fails for reviewed correction. Original settled receipts/remittances, signed files, due dates and allocations are retained. No new bank transaction or journal is created by import. The source registry, imported paid history and signed snapshots are immutable. A supporting opening journal cannot be reversed out from under imported history.

Imported pending refunds start in `DECISION_REQUIRED`. Review the original case and policy explicitly through the refund workflow, preserving termination date/deadline and the source approval reference. The importer does not authorize another payout. Historical services default to their supplied month's end unless ongoing service is explicitly specified. Original accounting control balances remain separate from operational student receivable/academy obligation totals; do not force those different figures to be identical.

Supplier opening balances remain payable/receivable through Business settings → Opening balances and the supplier statement. Select the imported supplier balance and link its actual posted bank payment; a supplier credit uses an actual receipt. Alternatively select an independently approved posted manual payment journal with its bank resource, original amount, documented conversion rate and source evidence. Linking records settlement evidence and creates no new cash or journal. The source must match the supplier control, currency, company/branch and date after cutoff. A source cannot fund another supplier/student/fee settlement. Partial settlements reduce both original and book balances; the last consumes the exact remainder. Unsupported historical-versus-actual FX differences block that settlement with an explicit reconciliation requirement. Do not fabricate a zero-difference rate or reverse linked journals outside a reviewed correction process.

Run `npm run integrity --workspace @odin/api` through the correct isolated/hosted environment launcher before cutover and after reconciliation. Optional `--tenant=<id> --company=<id>` narrows the report; a company requires its tenant. It separately reports pending instructions, unused receipt credit, valid negative corrections, returned cheques, service usage, academy advances, actual refunds/recoveries, fees, original receipt basis and supplier opening settlements. Exceptions carry entity IDs and required action. Legacy missing source attribution appears as an explicit review note; a clean exception count does not replace reviewing those notes or approving actual client opening data.

Retain the approved source file securely outside ordinary code/log artifacts, its preview hash, reviewer sign-off, journal reference and imported ID mapping. Reconcile student schedule balances, unapplied receipts, academy obligations/remittances, service balances, pending refunds, each original-currency resource and book GL controls before unlocking new entry. For a failed transaction, no partial application set commits. For a successful but incorrect import, preserve evidence and use an approved correcting process or restore the isolated pre-cutover backup before production entry; do not delete posted history ad hoc.


## Delivered environment and initial owner

Open https://av8.odin-ltd.com. The named owner uses the protected server setup file `/srv/av8-erp-final/production/private/bootstrap/initial-owner.json`; retrieve it only through the authorized private administrator connection. Enroll MFA, save recovery codes privately and change the temporary password before its recorded 24-hour expiry. No shared/default password was created. Set up named human finance/affairs accounts with reviewed scopes; the separate background service identity is not a human login.

Production maintenance is active through its dedicated nonfinancial identity and branch/company scope. Add further approved branch scope deliberately as the organization is configured. Academic sending and email alerts remain disabled until a distinct production Resend key is configured in `/srv/av8-erp-final/production/private/provider.env` and confirmed. The service reads `AV8_ACADEMIC_EMAIL_API_KEY`; do not copy the staging key. Keep UID 1000:GID 1000 / mode 0600 and root-only parent directories. After validation, set `AV8_ACADEMIC_EMAIL_ENABLED`, `AV8_ACADEMIC_WORKER_ENABLED` and `AV8_ALERT_EMAIL_ENABLED` to `true` in the private production configuration, recreate only the production API, and verify actual process loading plus the authorized controlled recipient/alert checks. The monitor starts a fresh container each timer run. Never print the key or re-send a previously DELIVERED staging report.

Both environments have independent daily 03:15 UTC encrypted backups, retained keys and no automatic deletion. Inspect the matching `av8-backup@staging` or `av8-backup@production` service result, archive metadata and available disk. Approve a retention/capacity policy before large imports; external backup remains owner-deferred.
