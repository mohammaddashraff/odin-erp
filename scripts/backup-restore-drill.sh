#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

required=(DATABASE_ADMIN_URL RESTORE_SERVER_URL RESTORE_DATABASE_URL RESTORE_RUNTIME_DATABASE_URL BACKUP_ENCRYPTION_KEY)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Required environment variable is missing: ${name}" >&2
    exit 2
  fi
done
for command in curl npm openssl pg_dump pg_restore psql sha256sum; do
  command -v "$command" >/dev/null || { echo "Required command is unavailable: ${command}" >&2; exit 2; }
done

restore_database_name="${RESTORE_DATABASE_NAME:-odin_restore}"
restore_database_owner="${RESTORE_DATABASE_OWNER:-odin}"
restore_api_port="${RESTORE_API_PORT:-8099}"
evidence_dir="${EVIDENCE_DIR:-restore-evidence}"
if [[ ! "$restore_database_name" =~ ^[a-zA-Z][a-zA-Z0-9_]*$ ]] || [[ ! "$restore_database_owner" =~ ^[a-zA-Z][a-zA-Z0-9_]*$ ]]; then
  echo 'Restore database and owner names must be simple SQL identifiers.' >&2
  exit 2
fi

mkdir -p "$evidence_dir"
chmod 700 "$evidence_dir"
temporary_dir="$(mktemp -d)"
backup_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
backup_id="odin-drill-$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_RUN_ID:-local}"
restore_start=""
api_pid=""
database_created=false
lifecycle_log="$evidence_dir/lifecycle.log"
evidence_json="$evidence_dir/restore-evidence.json"
raw_backup="$temporary_dir/${backup_id}.dump"
encrypted_backup="$temporary_dir/${backup_id}.dump.enc"
decrypted_backup="$temporary_dir/${backup_id}.verified.dump"

record() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$lifecycle_log"
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null || true; fi
  if [[ "$database_created" == true ]]; then
    psql "$RESTORE_SERVER_URL" --set ON_ERROR_STOP=on --command "DROP DATABASE IF EXISTS \"${restore_database_name}\" WITH (FORCE);" >/dev/null 2>&1 || true
  fi
  if [[ $exit_code -ne 0 && ! -f "$evidence_json" ]]; then
    printf '{\n  "status": "FAILED",\n  "backupId": "%s",\n  "backupTimestamp": "%s",\n  "failedAt": "%s",\n  "workflowRunId": "%s"\n}\n' \
      "$backup_id" "$backup_timestamp" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${GITHUB_RUN_ID:-local}" > "$evidence_json"
    record 'restore drill failed; workflow failure is the alert channel'
  fi
  chmod 600 "$evidence_dir"/* 2>/dev/null || true
  rm -rf "$temporary_dir"
  exit "$exit_code"
}
trap cleanup EXIT

record 'logical backup started'
pg_dump "$DATABASE_ADMIN_URL" --format=custom --compress=9 --no-owner --file "$raw_backup"
raw_checksum="$(sha256sum "$raw_backup" | cut -d' ' -f1)"
record 'logical backup completed and SHA-256 recorded'

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$raw_backup" -out "$encrypted_backup" -pass env:BACKUP_ENCRYPTION_KEY
chmod 600 "$encrypted_backup"
encrypted_mode="$(stat -c '%a' "$encrypted_backup")"
[[ "$encrypted_mode" == '600' ]]
record 'backup encrypted with restricted filesystem access'

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$encrypted_backup" -out "$decrypted_backup" -pass env:BACKUP_ENCRYPTION_KEY
verified_checksum="$(sha256sum "$decrypted_backup" | cut -d' ' -f1)"
[[ "$raw_checksum" == "$verified_checksum" ]]
pg_restore --list "$decrypted_backup" >/dev/null
record 'encrypted backup decrypted, checksum matched, and archive catalog validated'

restore_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_start_epoch="$(date +%s)"
psql "$RESTORE_SERVER_URL" --set ON_ERROR_STOP=on --command "DROP DATABASE IF EXISTS \"${restore_database_name}\" WITH (FORCE);" >/dev/null
psql "$RESTORE_SERVER_URL" --set ON_ERROR_STOP=on --command "CREATE DATABASE \"${restore_database_name}\" OWNER \"${restore_database_owner}\";" >/dev/null
database_created=true
pg_restore --exit-on-error --no-owner --dbname "$RESTORE_DATABASE_URL" "$decrypted_backup"
record 'backup restored into a clean isolated PostgreSQL database'

DATABASE_ADMIN_URL="$RESTORE_DATABASE_URL" DATABASE_URL="$RESTORE_RUNTIME_DATABASE_URL" npm run db:migrate >> "$lifecycle_log" 2>&1
migration_count="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
tenant_count="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM tenants;')"
runtime_unscoped_rows="$(psql "$RESTORE_RUNTIME_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM tenants;')"
[[ "$migration_count" -gt 0 && "$tenant_count" -gt 0 && "$runtime_unscoped_rows" -eq 0 ]]
record 'migration compatibility and unscoped runtime RLS validated'

DATABASE_ADMIN_URL="$RESTORE_DATABASE_URL" DATABASE_URL="$RESTORE_RUNTIME_DATABASE_URL" npm run integrity > "$evidence_dir/reconciliation.json"
record 'journal, ledger, inventory, AR and AP reconciliation checks passed'

NODE_ENV=test API_PORT="$restore_api_port" DATABASE_ADMIN_URL="$RESTORE_DATABASE_URL" DATABASE_URL="$RESTORE_RUNTIME_DATABASE_URL" \
  npm run start:prod -w @odin/api > "$evidence_dir/restored-api.log" 2>&1 &
api_pid=$!
application_ready=false
for attempt in {1..60}; do
  if curl --fail --silent "http://127.0.0.1:${restore_api_port}/api/health" > "$evidence_dir/restored-health.json"; then
    application_ready=true
    break
  fi
  sleep 1
done
[[ "$application_ready" == true ]]
record 'application started successfully against the restored database'

restore_end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_duration_seconds="$(( $(date +%s) - restore_start_epoch ))"
printf '{\n  "status": "PASSED",\n  "backupId": "%s",\n  "backupTimestamp": "%s",\n  "backupChecksumSha256": "%s",\n  "encryption": "AES-256-CBC/PBKDF2-200000 plus verified SHA-256",\n  "encryptedFileMode": "%s",\n  "restoreStart": "%s",\n  "restoreEnd": "%s",\n  "restoreDurationSeconds": %s,\n  "postgresMajor": 17,\n  "completedMigrationCount": %s,\n  "tenantCount": %s,\n  "runtimeRowsWithoutTenantScope": %s,\n  "migrationCompatibility": "PASS",\n  "applicationStartup": "PASS",\n  "reconciliation": "PASS",\n  "workflowRunId": "%s",\n  "applicationSha": "%s",\n  "knownLimitations": "CI drill uses deterministic non-production seed data; provider PITR, cross-region retention and object attachments require provider-level evidence."\n}\n' \
  "$backup_id" "$backup_timestamp" "$raw_checksum" "$encrypted_mode" "$restore_start" "$restore_end" "$restore_duration_seconds" \
  "$migration_count" "$tenant_count" "$runtime_unscoped_rows" "${GITHUB_RUN_ID:-local}" "${GITHUB_SHA:-unknown}" > "$evidence_json"
record 'restore drill passed; evidence written and isolated database scheduled for cleanup'
