# Release notes and readiness

**Technical delivery is deployed and verified for secure initial configuration. Live financial and personal-data use remains conditional on the explicit activation decisions below.** The exact application release is `170b929bd4749e3ae53c7dcb0155e90d617210d9`, deployed at [https://av8.odin-ltd.com](https://av8.odin-ltd.com). The handover documentation commit is separate from this immutable application release.

## Delivered behavior

The approved Classic Sidebar and existing ERP modules are preserved. AV8 now supports the confirmed USD 64,000 instalment plans and USD 54,000 cash plan, immutable signed schedules, calendar-month dates, admission evidence, separate student/academy balances, actual collections and transfers, fees, returned/replacement cheques, independently approved refunds and academy recovery. Original amounts, exchange-rate evidence and posted history survive corrections.

Student Affairs has independent document, admission, training, suspension/resumption, monthly service, insurance, graduation and versioned academic-report workflows. Student and guardian dispatches have independent durable delivery/retry/reconciliation state. Both actual authorized staging recipients received their reports; each remains DELIVERED with one attempt after final-image restart and scheduled processing.

Treasury includes scoped cash/bank/wallet resources, paired atomic transfers, original and book balances, searchable paginated transaction/statement history, mapped CSV preview/import and direction-aware reconciliation. Operational bank deactivation preserves authorized history while blocking new bank postings. Opening import retains original signed evidence and settled source histories without creating new cash. Supplier settlements link real posted evidence. Existing accounting, sales, purchasing, inventory, HR, POS and access workflows remain covered within the detailed matrix.

Security changes include memory-only bearer sessions, HttpOnly refresh restoration, revocation, per-request script nonces, required hosted privileged MFA, safe account recovery and prohibited hosted demo seeding. Runtime business transactions use restricted PostgreSQL RLS. The inherited authentication/bootstrap pool still carries a separately privileged, nonsuperuser BYPASSRLS owner credential; this is an explicit application trust boundary, not a claim that every database connection is least-privileged.

## Verification

[Final CI 41235646385](https://github.com/mohammaddashraff/odin-erp/actions/runs/41235646385) passed on the exact release:

- 428/428 backend tests across 54 suites; 21/21 browser scenarios in 7.2 minutes.
- 78 routes across312 language/theme/viewport variants; 590 control declarations have recorded dispositions, not 590 individual click tests.
- Fresh install/migrations, lint, types, i18n, deployment checks, source/history/dependency security checks, production build and independent integrity checks.
- 19/19 actual Linux CI PDFs/pages visually and numerically verified, with retained original bytes, renders and hashes.
- CI encrypted restore 1.991 seconds; final native restore 1.550 seconds over 26,918 rows / 659 attachments; separate final-image hosted restore 15.535 seconds with real API restart, password/MFA and private-document download. No external DR/RPO/RTO claim.

The earlier 58e3a48 CI failure is preserved: one account-recovery lifecycle exceeded the default 5-second test timeout during approximately 13 real cost-12 bcrypt operations. Only that case received a 15-second integration budget; all assertions, hash strength and explicit performance thresholds remain unchanged. The final complete run passed.

See [acceptance results](05-test-results-and-evidence.md), [coverage](01-scope-and-route-coverage.md), [exact release manifest](evidence/release-manifest.json), [CI evidence](evidence/final-ci.json) and [PDF review](evidence/final-ci-pdf-visual-review.json).

## Actual deployment and recovery

Separate Hetzner staging/production projects use independent databases, volumes, credentials, signing/MFA/scheduler secrets and monitor state. API/database ports are private; staging uses the SSH loopback route and production uses the dedicated HTTPS hostname. All 43 migration checksums match both environments and the release source. Public DNS, trusted TLS, HTTP301, API/login200, anonymous401, no-store and actual browser CSP enforcement passed. All 6 previous nginx site hashes and 21 other existing container IDs remained unchanged. No new Vercel staging project was provisioned or existing deployment replaced.

Production contains one AV8 company/Cairo branch, the owner-requested named administrator, a separate scoped nonfinancial background account and 12 DRAFT policies. It contains zero students, customers, suppliers, cash movements or journals. The owner login requires MFA enrollment, issues no access token before it, and requires changing a private generated temporary password. The protected server file is `/srv/av8-erp-final/production/private/bootstrap/initial-owner.json`; no credential appears in this delivery. Its current setup credential expires `2026-11-01T19:58:58.645Z`.

Both environment-specific maintenance/health timers and daily 03:15 UTC encrypted local-backup timers are installed and their first invocations succeeded. No automatic archive deletion is configured. The operational archive and key are retained. The tested isolated restore is a staging copy; a production-data restore was not performed. Restore procedure, source-preservation checks and recovery limits are in [the runbook](07-deployment-and-recovery-runbook.md) and [local restore procedure](hetzner-local-restore-drill.md).

Approximately 2.43 GB of host disk remained after rollout. Only verified obsolete AV8 images and an exact allowlist of 34 AV8 cache records were removed. Current rollback images and all unrelated resources were preserved. Review capacity and archive retention before a large real-data import or another build; local timing is not a production workload/RPO/RTO guarantee.

## Remaining activation actions

| Action | Actual state and smallest next step |
|---|---|
| Production email and email alerts | Staging key/domain/delivery are verified. Production intentionally uses a separate file, `/srv/av8-erp-final/production/private/provider.env`, UID 1000:GID 1000 / mode 0600. Configure a distinct `AV8_ACADEMIC_EMAIL_API_KEY` privately and confirm. Then validate the verified sender, enable academic sending/worker and alerts, recreate only the production API, and run the already authorized controlled checks. Production sends/alerts are currently disabled; no production delivery success is claimed. |
| Owner onboarding | Privately retrieve the generated setup credential, enroll MFA, change the password and retain recovery codes. Configure named human staff and least necessary branch/resource access. The service account is separate and is not a shared human login. |
| Business and accounting decisions | Record actual D01–D11 selections/approvers/effective versions and real ledger, FX, fee, refund, receipt/agreement and applicable statutory mappings. Keep affected policies DRAFT/fail-closed until approved; synthetic test decisions are not client approvals. [Decision sheet](02-business-rules-and-decisions.md) gives implemented choices, suggested reviews and affected operations. |
| Personal documents and operational ownership | Approve privacy/residency, retention/deletion and malware-handling arrangements before live sensitive documents. Type/content/size/private-access checks are verified; antivirus-clean certification and statutory compliance are not claimed. Assign actual finance/security/support/incident responsibilities and backup retention. |
| Real cutover and client UAT | Supply original source histories and an independently approved opening journal, run the control-total dry run, then the witnessed import/UAT. No real balances or student data were imported and no client sign-off was invented. |
| Off-host recovery | Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner. This is non-blocking for current delivery; no external provisioning or credential request until the owner asks. |

## Handover

Use the [English guide](09-user-guide-en.md), [Arabic guide](10-user-guide-ar.md), [administrator/support runbook](08-admin-and-support-runbook.md), [deployment/recovery runbook](07-deployment-and-recovery-runbook.md), [decision sheet](02-business-rules-and-decisions.md), [client UAT script](13-client-uat-script.md) and [release verification record](14-release-verification.md). The evidence supports the deployed technical setup and stated staging acceptance. It does not support unrestricted live-business activation while the listed provider and client decisions remain open.
