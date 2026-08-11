# Backup and restore runbook

Repository status: the encrypted logical backup and clean-database restore drill is verified locally on PostgreSQL 17 for application commit `7d747fb26cacc7874bc8753e416156a0347a3aa9`. It verifies the archive checksum/catalog, applies migrations, starts the API against the restored database, validates unscoped runtime RLS, compares a non-empty DB-backed private-attachment content manifest, and runs journal, ledger, inventory, AR and AP reconciliation. CI retention and production provider PITR, cross-region storage, provider object recovery and malware-scanner operation still require environment-specific evidence before production readiness.

## Evidence classification

| Control | Classification | Current evidence and boundary |
|---|---|---|
| Repository logical backup and isolated restore | Tested | 2026-08-11 local drill passed against deterministic non-production data at application commit `7d747fb`; prior quality run `31256037111` remains historical |
| Cross-platform drill mechanics | Tested | The script accepted macOS `shasum`/BSD `stat`; it refuses a source-target match, pre-existing restore database, stale evidence directory, or admin/runtime URL that is not bound to the new restore database |
| Migration compatibility and reconciliation rehearsal | Tested | The current drill applied/validated 17 migrations, started the restored API, checked unscoped RLS and produced zero reconciliation differences |
| Provider-managed PITR and continuous WAL recovery | Requires external/provider evidence | No repository test can prove provider recovery-point creation, freshness, restore precision or achieved RPO |
| Cross-region replication and immutable retention | Requires external/provider evidence | Provider policy, replication state, legal hold and deletion controls require environment evidence |
| Production IAM, KMS and key rotation | Requires external/provider evidence | Repository encryption uses an ephemeral drill key; production identities, KMS policy, key rotation and audit logs are external controls |
| Database rollback by destructive migration reversal | Not implemented | Releases use compatibility plus forward-fix; an applied destructive migration is never blindly reversed |
| DB-backed private attachment recovery | Tested | Current drill compared 2 rows / 105 bytes plus stored SHA-256 and actual-content MD5 values through a matching SHA-256 manifest |
| Provider object attachment recovery | Requires external/provider evidence | No provider object store is integrated, so repository evidence cannot establish object version recovery, replication, IAM or KMS behavior |

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
6. Non-empty DB-backed private-attachment recovery through source/restored count, byte total and deterministic metadata/content-hash manifest equality.
7. Exact reconciliation through `npm run integrity`.
8. API startup and `/api/health` against the restored runtime connection.
9. JSON evidence with backup timestamp/ID/checksum, attachment recovery measurements, restore start/end/duration, application SHA and validation results.

## Current local drill evidence (2026-08-11)

The local release drill for application `7d747fb` passed in four seconds. It created backup
`odin-drill-20260811T104457Z-local-release-20260811`, verified archive checksum
`ff90dee6b69143c41e19d0c1792b227a2907f31b82b65429a1457b5ee8c54668`, applied/validated 17
migrations, found one tenant and zero runtime rows without tenant scope, and started the restored
API successfully. The two DB-backed attachments (105 bytes) matched before and after restore with
manifest SHA-256 `f370e7afa095e96301fab2fcb0d423f76865ca3c405b379a0eb43e691232f52c`.

The reproducible evidence JSON, health response, reconciliation result and lifecycle log are outside
the repository at `/private/tmp/odin-restore-evidence-release-final/`. The temporary restored
database was confirmed absent after the drill cleanup. This is local, deterministic,
non-production evidence; it does not prove provider controls listed below.

Equivalent local/staging command, with non-production URLs and an ephemeral key:

```bash
BACKUP_ENCRYPTION_KEY="$(openssl rand -base64 48)" \
DATABASE_ADMIN_URL='postgresql://backup_user:...@127.0.0.1:5432/odin_source' \
RESTORE_SERVER_URL='postgresql://restore_admin:...@127.0.0.1:5432/postgres' \
RESTORE_DATABASE_URL='postgresql://restore_admin:...@127.0.0.1:5432/odin_restore' \
RESTORE_RUNTIME_DATABASE_URL='postgresql://odin_app:...@127.0.0.1:5432/odin_restore' \
./scripts/backup-restore-drill.sh
```

The command requires Bash, PostgreSQL 17 client tools, `curl`, `npm`, and OpenSSL. SHA-256 and file
mode checks support both the standard GNU/Linux commands and the default macOS `shasum`/BSD `stat`
forms. Use a disposable restore database name and never point the restore target at the source.

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
- The current private attachment implementation is database-backed and is covered by the logical restore manifest. A future provider object-store implementation needs its own version, replication, IAM, KMS and recovery evidence.
- Provider IAM, KMS rotation, immutability, legal retention, monitoring delivery and production RPO/RTO remain deployment evidence, not repository assertions.
