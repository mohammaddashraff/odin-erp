# Production operations runbook

## Current evidence classification

| Operational capability | Classification | Boundary |
|---|---|---|
| API/database health and safe JSON request logging | Tested | Current built API/web browser verification and restored API health checks passed for `7d747fb` |
| Authorization-denial and append-only audit evidence | Tested | Current direct-API, security and persisted database mutation-negative suites passed for `7d747fb` |
| Provider monitoring, alert delivery and on-call integration | Requires external/provider evidence | No production metrics, alert route, error tracker or paging evidence is present in the repository |
| Provider PITR, cross-region backup, IAM and KMS controls | Requires external/provider evidence | Use the backup runbook evidence packet; repository restore evidence alone is insufficient |
| DB-backed private attachment logical recovery | Tested | Attachment bytes are part of the PostgreSQL logical backup; the current drill matched 2 rows/105 bytes and deterministic metadata/content-hash manifests |
| Provider object storage recovery and malware-scanner operations | Requires external/provider evidence | No provider object store or malware scanner is integrated. Object versioning/replication/recovery, provider IAM/KMS and scanner operation cannot be inferred from the DB-backed drill |
| Production deployment promotion and automated rollback | Not implemented | The release checklist is documented, but there is no repository-evidenced production deployment automation or rollback rehearsal |

## Ownership

Name primary and secondary owners for application, database, security, finance integrity and business operations. Maintain an escalation path and break-glass procedure with MFA, reason, expiry and audit.

## Required telemetry

- Availability and latency: web/API/database/queue P50, P95 and P99.
- Errors: structured exceptions by request/correlation ID without sensitive payloads.
- Database: connections, saturation, locks, deadlocks, replication/PITR, slow queries and migration state.
- Security: login failures/throttling, privileged changes, denials, temporary grants, SoD conflicts, sensitive exports/downloads and session revocations.
- ERP integrity: failed postings, unbalanced exceptions, negative stock, AR/AP/inventory/cash reconciliation differences, stuck approvals and integration dead letters.

The current `/api/health` checks API/database only. Add readiness/liveness dependencies without exposing versions or secrets publicly.

## DB-backed private attachment recovery

The current attachment implementation stores private metadata and bytes in PostgreSQL. The logical
backup/restore drill therefore treats attachments as database recovery scope: it refuses an empty
source fixture and compares source/restored counts, byte totals, stored SHA-256 values and hashes of
the recovered bytes. The script and checks are implemented and tested: the 2026-08-11 release drill
matched two attachments/105 bytes and completed restore, migration, RLS, reconciliation and API-startup checks.

This does not establish production PITR, achieved RPO/RTO, provider object recovery, cross-region
replication, IAM/KMS controls or malware-scanner operation. Those controls require provider and
environment evidence before operational sign-off.

## Daily checks

- Backup freshness and restore-point health.
- Error/latency/connection alerts and failed jobs.
- Posting and reconciliation exception queues.
- Expired temporary access/delegation and privileged denials.
- Integration retry/dead-letter and electronic submission state.

## Weekly/monthly checks

- Slow-query/index review and capacity trend.
- Privileged/inactive/service account review.
- Dependency and vulnerability review.
- Restore drill cadence, period-close readiness and access-review completion.
- Verify deployed SHA/tag matches release record.

## Incident priorities

P0: tenant/company leak, authentication bypass, unbalanced posting, stock corruption, unrecoverable data loss. Stop affected writes and page security/database/finance owners.

P1: broad outage, payment/invoice duplication, sustained failed postings, backup objective breach. Contain, preserve evidence and initiate tested recovery/forward fix.

P2: degraded report/export/integration with safe transactional core. Queue/retry where idempotent and communicate impact.

## Safe operational rules

- Never run `npm run db:seed` or tenant reset against production.
- Never use the owner/admin database identity for application traffic.
- Never directly edit posted journals, documents, stock movements or audit rows.
- Never log secrets, tokens, full request bodies or sensitive field values.
- Long reports/imports/integrations run as idempotent background jobs with bounded retries and dead-letter evidence.

## Maintenance and close

Announce windows, drain jobs, verify backup, execute the release runbook, run reconciliations, observe stabilization and record outcomes. Period close requires finance checklist, reconciliation, maker-checker approval and a governed reopen path; the current simple status toggle is not sufficient for enterprise close.
