# Backup and restore runbook

Repository status: the pull-request quality gate performs an encrypted logical backup and a real clean-database restore on PostgreSQL 17. The drill verifies the archive checksum/catalog, applies migrations, starts the API against the restored database, validates unscoped runtime RLS, and runs journal, ledger, inventory, AR and AP reconciliation. CI evidence is retained for 35 days. Production provider PITR, cross-region storage and attachment recovery still require environment-specific evidence before production readiness.

## Recovery objectives and ownership

| Control | Production objective |
|---|---|
| RPO | 15 minutes for database transactions; attachment/object RPO must be equal or better |
| RTO | 4 hours to a reconciled replacement environment; service restoration is not approved before integrity checks |
| Backup frequency | Continuous WAL/PITR plus a nightly encrypted full backup |
| Retention | 35 daily recovery points, 13 weekly points and 12 immutable monthly points, subject to legal hold |
| Restore drill | Quarterly, before material database/platform changes, and after a backup-provider change |
| Responsible owner | Primary: Database/Platform owner; secondary: Security owner; Finance Control signs reconciliation evidence |
| Restore approval | Incident Commander plus Database owner and Finance Control; Security joins for compromise or credential exposure |

Production backups use a provider/KMS identity separate from application and migration identities. Storage must be account/project and failure-domain separated, encrypted with KMS-managed keys, access logged, immutable for the retention window, and readable only by the backup service and approved recovery operators. Backup freshness, duration, size, encryption, replication and restore validation failures page the Database/Platform owner and open an incident.

## Automated isolated drill

The CI `restore` job creates disposable demo data, runs `scripts/backup-restore-drill.sh`, uploads only evidence/logs, and destroys the restored database and temporary dump files. It never uses production data or commits a dump. The job performs:

1. PostgreSQL 17 custom-format `pg_dump` with ownership omitted and ACLs retained.
2. SHA-256 capture, AES-256-CBC encryption using PBKDF2 with 200,000 iterations, mode `0600`, decrypt-and-checksum verification, and `pg_restore --list` validation.
3. Restore into a newly created isolated database.
4. `prisma migrate deploy` compatibility validation against the restored schema.
5. Migration/tenant counts and a zero-row unscoped runtime-role RLS check.
6. Exact reconciliation through `npm run integrity`.
7. API startup and `/api/health` against the restored runtime connection.
8. JSON evidence with backup timestamp/ID/checksum, restore start/end/duration, application SHA and validation results.

Equivalent local/staging command, with non-production URLs and an ephemeral key:

```bash
BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 48)" \
DATABASE_ADMIN_URL='postgresql://backup_user:...@127.0.0.1:5432/odin_source' \
RESTORE_SERVER_URL='postgresql://restore_admin:...@127.0.0.1:5432/postgres' \
RESTORE_DATABASE_URL='postgresql://restore_admin:...@127.0.0.1:5432/odin_restore' \
RESTORE_RUNTIME_DATABASE_URL='postgresql://odin_app:...@127.0.0.1:5432/odin_restore' \
./scripts/backup-restore-drill.sh
```

Do not paste production credentials into shell history. Use the approved secret manager/job identity in production rehearsals. A CI failure is an alert and blocks the gate; `restore-evidence.json`, `reconciliation.json`, `restored-health.json`, the lifecycle log and API log are uploaded even on failure.

## Production backup lifecycle

1. Provider backup service creates encrypted PITR/full recovery points with the backup identity.
2. Monitoring records provider backup ID, database version, application SHA, migration head, start/end, size, checksum/provider integrity state and cross-region replication state.
3. Lifecycle policy applies daily/weekly/monthly retention and legal holds; deletion requires two-person approval and is separately audited.
4. A restore operator selects a recovery point under an approved ticket/incident, restores to a new network-isolated target and blocks outbound integrations/messages.
5. Rotate or reissue application, migration and backup credentials; never reuse a compromised target.
6. Apply only forward-compatible documented migrations, start the exact release artifact, and run tenant/RLS, authentication/session, posting and reconciliation checks.
7. Finance Control signs journal/global ledger/inventory/AR/AP/cash/POS results. Security signs access/RLS and credential checks.
8. Cut traffic over only after Incident Commander approval; preserve the former target read-only for the approved forensic window.
9. Record achieved RPO/RTO, excluded data, manual actions, failures and follow-up work.

## Emergency restore

Declare an incident, freeze affected writes, preserve logs/evidence, select the last known-good recovery point, and restore to a new target. Never overwrite the only affected database. Disable outbound integrations until reconciliation and duplicate/idempotency checks pass. Posted records are never repaired through direct edits; use a governed forward fix or business reversal after service recovery.

## Known limitations

- Repository CI proves a logical PostgreSQL restore of deterministic non-production data, not provider PITR or cross-region failover.
- Odin does not yet have a private attachment object model, so attachment/object-store recovery cannot be proven here.
- Provider IAM, KMS rotation, immutability, legal retention, monitoring delivery and production RPO/RTO remain deployment evidence, not repository assertions.
