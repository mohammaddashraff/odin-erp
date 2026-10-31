# Release notes and readiness

Release candidate: `codex/av8-final-delivery-20261031`, based on `828ae27bd17682739d192115ed163781f2388bea`. Final integrated checks and the exact tested release identifier are still being recorded. This is not a production go-live certificate.

## Delivered behavior

The approved Classic Sidebar, module navigation and shared visual design are retained. The delivery implements the confirmed USD64,000 instalment plans and USD54,000 cash plan with immutable signed snapshots, calendar-month dates, explicit unresolved-policy choices, and actual collection/academy/refund histories. Bank fees, returned cheques, cross-branch collection, academy recovery and partial refunds retain their original amounts and accounting basis. Corrections reverse original ledger accounts even when current mappings change.

Student Affairs can verify admission evidence, record actual training/suspension/resumption/graduation, manage monthly services and insurance, and review versioned academic reports. Student and guardian deliveries have independent durable states, retry controls and ambiguous-provider reconciliation. Hosted invocation is explicitly authenticated and disabled until configured.

Treasury supports scoped bank/cash/wallet resources, paired transfers, original versus book balances, mapped statement preview/import and direction-aware matching. Opening import reconciles immutable original histories to an independently approved journal without recreating cash. Supplier opening balances remain payable/recoverable through actual posted settlement evidence. Existing POS now handles uncertain-response retries, scoped terminal access, explicit open-shift recovery, original split-tender refunds and exact inventory-cost restoration.

Security changes include memory-only browser bearer sessions, HttpOnly refresh restoration and cross-tab revocation, per-request script nonces, privileged hosted MFA, prohibited hosted synthetic seeding and removal of the fixed-password recovery bypass. CI uses isolated PostgreSQL, real lint/type/security checks, actual browser acceptance and an encrypted clean restore drill.

## Verification and artifacts

The authoritative acceptance table is [05-test-results-and-evidence.md](05-test-results-and-evidence.md). The full route, endpoint and control inventory is [01-scope-and-route-coverage.md](01-scope-and-route-coverage.md); route rendering alone is not evidence that every individual action was exercised. Synthetic bilingual PDFs, browser screenshots, measured workloads and recovery manifests are retained with their stated scope. [Dependency inventory](evidence/dependency-inventory.json) records the lockfile package versions; moderate/low development-tool advisories are not hidden by the production dependency result.

Final release evidence must identify the tested commit/tree, exact commands and exit codes, migration checksums, browser build mode, CI run and any remaining gate. Historical main-branch test totals are not reused as current results.

## Migration and deployment status

Forward migrations have been rehearsed only in dedicated local development/test PostgreSQL databases. No real client data was imported. No production migration, promotion or real email delivery has been performed. The user confirmed Hetzner as the final host; isolated AV8-specific staging preparation is in progress. The live Vercel web/API were inspected read-only and still pointed to the original main commit. Follow [06](06-migration-and-opening-balances.md) for cutover and [07](07-deployment-and-recovery-runbook.md) for deployment/recovery.

The supplier-settlement migration's first local attempt failed on SQL syntax. Only its own partial objects were removed, the failed attempt was marked rolled back, and the corrected unpublished migration was applied successfully. Earlier applied migration checksums were preserved. Production rollback requires data/schema compatibility review; deleting immutable money history is not a rollback procedure.

## Remaining external gates

| Gate | What is verified locally | Required owner action / affected acceptance |
|---|---|---|
| Isolated hosted staging | Explicit Hetzner target guards, role isolation and synthetic local acceptance; server access/DNS verified | Complete the dedicated AV8 stack and SSH-tunnel staging, then deployed health, MFA, role, PDF and browser smoke checks. No additional staging DNS is required for the tunnel. T44. |
| Real academic delivery | Independent recipient state, controlled provider tests, retry/unknown handling | Configure verified sender/provider; the user has authorized controlled student/guardian recipients; capture real delivered/failed/reconciled outcomes. T27–28. |
| Hosted scheduled processing | Authenticated bounded invocation, persisted claims and repeat-safe maintenance | Configure protected scheduler destination, secret and named scoped worker accounts; prove invocation after process termination and record logs. T41. |
| Operational alerts | Redacted structured controlled-failure sink | Configure actual alert transport to the user-authorized monitoring address and name the responder; prove alert arrival. T43. |
| Off-host recovery | OWNER-DEFERRED — non-blocking for current delivery | No external provisioning or credential request until the owner asks. Local recovery remains required; no external DR/RPO/RTO verification is claimed. |
| Client financial/legal policies | Confirmed rules implemented; remaining choices are explicit versioned configuration | Authorize D01–D11 where applicable, actual ledger/FX mappings, receipt/agreement wording and regulatory scope. No synthetic test approval is a business approval. |
| Real cutover and sign-off | Source-identified dry run, control totals and immutable history paths | Supply approved opening sources and journal, reconcile actual balances and approve client UAT. |

The user confirmed Hetzner and https://av8.odin-ltd.com, with authorized student/guardian/alert test destinations stored privately. SSH access works and DNS resolves to the server. A dedicated AV8 HTTPS certificate is still needed; the current certificate does not cover the hostname. Email provider credentials and verified sender, production administrator identity, client policy sign-off remain required; off-host recovery is owner-deferred and non-blocking. These dependencies do not waive independent implementation or verification.

## Client handover

Use the [English guide](09-user-guide-en.md), [Arabic guide](10-user-guide-ar.md), [administrator/support runbook](08-admin-and-support-runbook.md), [decision sheet](02-business-rules-and-decisions.md) and [synthetic client UAT script](13-client-uat-script.md). Named finance, release, privacy and support owners must be supplied by the client; no personal contact information has been invented.

Current verdict: **not ready for production promotion**. Final local/CI readiness will be updated after the frozen release checks; the external gates above require real environment evidence and owner decisions.

## Owner-approved deferral

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

This requirement is non-blocking for the current delivery. External provisioning/credential requests are pending until the owner asks to revisit them. Local backup and isolated restore verification remain required. No external disaster recovery or proposed RPO/RTO has been verified; earlier references to off-host recovery as a mandatory current-delivery gate are superseded by this decision.
