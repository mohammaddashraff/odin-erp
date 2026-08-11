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
for command in curl npm openssl pg_dump pg_restore psql stat; do
  command -v "$command" >/dev/null || { echo "Required command is unavailable: ${command}" >&2; exit 2; }
done
if command -v sha256sum >/dev/null; then
  sha256_file() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then
  sha256_file() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo 'Required SHA-256 command is unavailable: install sha256sum or shasum.' >&2
  exit 2
fi

file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

restore_database_name="${RESTORE_DATABASE_NAME:-odin_restore}"
restore_database_owner="${RESTORE_DATABASE_OWNER:-odin}"
restore_api_port="${RESTORE_API_PORT:-8099}"
evidence_dir="${EVIDENCE_DIR:-restore-evidence}"
if [[ ! "$restore_database_name" =~ ^[a-zA-Z][a-zA-Z0-9_]*$ ]] || [[ ! "$restore_database_owner" =~ ^[a-zA-Z][a-zA-Z0-9_]*$ ]]; then
  echo 'Restore database and owner names must be simple SQL identifiers.' >&2
  exit 2
fi
source_database_name="$(psql "$DATABASE_ADMIN_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT current_database();')"
if [[ "$source_database_name" == "$restore_database_name" ]]; then
  echo 'Restore database must be different from the source database.' >&2
  exit 2
fi
restore_database_exists="$(psql "$RESTORE_SERVER_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command "SELECT count(*) FROM pg_database WHERE datname = '${restore_database_name}';")"
if [[ "$restore_database_exists" != '0' ]]; then
  echo "Restore database already exists; refusing to overwrite it: ${restore_database_name}" >&2
  exit 2
fi
if [[ -e "$evidence_dir" ]]; then
  echo "Evidence path already exists; refusing to mix current and stale evidence: ${evidence_dir}" >&2
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
source_attachment_manifest="$temporary_dir/source-attachments.csv"
restored_attachment_manifest="$temporary_dir/restored-attachments.csv"

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
source_attachment_count="$(psql "$DATABASE_ADMIN_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM private_attachments;')"
source_attachment_bytes="$(psql "$DATABASE_ADMIN_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT COALESCE(sum(size_bytes), 0) FROM private_attachments;')"
psql "$DATABASE_ADMIN_URL" --set ON_ERROR_STOP=on --output "$source_attachment_manifest" --command \
  "COPY (SELECT id::text, storage_key::text, company_id::text, document_id::text, size_bytes::text, sha256, md5(content) FROM private_attachments ORDER BY id) TO STDOUT WITH (FORMAT csv);"
source_attachment_manifest_checksum="$(sha256_file "$source_attachment_manifest")"
[[ "$source_attachment_count" -gt 0 ]]
record 'non-empty private attachment source manifest recorded'
pg_dump "$DATABASE_ADMIN_URL" --format=custom --compress=9 --no-owner --file "$raw_backup"
raw_checksum="$(sha256_file "$raw_backup")"
record 'logical backup completed and SHA-256 recorded'

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$raw_backup" -out "$encrypted_backup" -pass env:BACKUP_ENCRYPTION_KEY
chmod 600 "$encrypted_backup"
encrypted_mode="$(file_mode "$encrypted_backup")"
[[ "$encrypted_mode" == '600' ]]
record 'backup encrypted with restricted filesystem access'

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$encrypted_backup" -out "$decrypted_backup" -pass env:BACKUP_ENCRYPTION_KEY
verified_checksum="$(sha256_file "$decrypted_backup")"
[[ "$raw_checksum" == "$verified_checksum" ]]
pg_restore --list "$decrypted_backup" >/dev/null
record 'encrypted backup decrypted, checksum matched, and archive catalog validated'

restore_start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_start_epoch="$(date +%s)"
psql "$RESTORE_SERVER_URL" --set ON_ERROR_STOP=on --command "CREATE DATABASE \"${restore_database_name}\" OWNER \"${restore_database_owner}\";" >/dev/null
database_created=true
restore_url_database_name="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT current_database();')"
runtime_url_database_name="$(psql "$RESTORE_RUNTIME_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT current_database();')"
if [[ "$restore_url_database_name" != "$restore_database_name" || "$runtime_url_database_name" != "$restore_database_name" ]]; then
  echo 'Restore admin/runtime URLs must both target the newly created restore database.' >&2
  exit 2
fi
pg_restore --exit-on-error --no-owner --dbname "$RESTORE_DATABASE_URL" "$decrypted_backup"
record 'backup restored into a clean isolated PostgreSQL database'

DATABASE_ADMIN_URL="$RESTORE_DATABASE_URL" DATABASE_URL="$RESTORE_RUNTIME_DATABASE_URL" npm run db:migrate >> "$lifecycle_log" 2>&1
migration_count="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
tenant_count="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM tenants;')"
runtime_unscoped_rows="$(psql "$RESTORE_RUNTIME_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM tenants;')"
[[ "$migration_count" -gt 0 && "$tenant_count" -gt 0 && "$runtime_unscoped_rows" -eq 0 ]]
record 'migration compatibility and unscoped runtime RLS validated'

restored_attachment_count="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT count(*) FROM private_attachments;')"
restored_attachment_bytes="$(psql "$RESTORE_DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=on --command 'SELECT COALESCE(sum(size_bytes), 0) FROM private_attachments;')"
psql "$RESTORE_DATABASE_URL" --set ON_ERROR_STOP=on --output "$restored_attachment_manifest" --command \
  "COPY (SELECT id::text, storage_key::text, company_id::text, document_id::text, size_bytes::text, sha256, md5(content) FROM private_attachments ORDER BY id) TO STDOUT WITH (FORMAT csv);"
restored_attachment_manifest_checksum="$(sha256_file "$restored_attachment_manifest")"
[[ "$source_attachment_count" == "$restored_attachment_count" ]]
[[ "$source_attachment_bytes" == "$restored_attachment_bytes" ]]
[[ "$source_attachment_manifest_checksum" == "$restored_attachment_manifest_checksum" ]]
record 'DB-backed private attachment count, bytes, metadata hash and content hash manifest matched after restore'

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
printf '{\n  "status": "PASSED",\n  "backupId": "%s",\n  "backupTimestamp": "%s",\n  "backupChecksumSha256": "%s",\n  "encryption": "AES-256-CBC/PBKDF2-200000 plus verified SHA-256",\n  "encryptedFileMode": "%s",\n  "restoreStart": "%s",\n  "restoreEnd": "%s",\n  "restoreDurationSeconds": %s,\n  "postgresMajor": 17,\n  "completedMigrationCount": %s,\n  "tenantCount": %s,\n  "runtimeRowsWithoutTenantScope": %s,\n  "dbBackedAttachmentCount": %s,\n  "dbBackedAttachmentBytes": %s,\n  "dbBackedAttachmentManifestSha256": "%s",\n  "dbBackedAttachmentRecovery": "PASS",\n  "migrationCompatibility": "PASS",\n  "applicationStartup": "PASS",\n  "reconciliation": "PASS",\n  "workflowRunId": "%s",\n  "applicationSha": "%s",\n  "knownLimitations": "CI drill uses deterministic non-production seed data; provider PITR, cross-region retention, provider object storage and malware scanning require provider-level evidence."\n}\n' \
  "$backup_id" "$backup_timestamp" "$raw_checksum" "$encrypted_mode" "$restore_start" "$restore_end" "$restore_duration_seconds" \
  "$migration_count" "$tenant_count" "$runtime_unscoped_rows" "$restored_attachment_count" "$restored_attachment_bytes" "$restored_attachment_manifest_checksum" \
  "${GITHUB_RUN_ID:-local}" "${GITHUB_SHA:-unknown}" > "$evidence_json"
record 'restore drill passed; evidence written and isolated database scheduled for cleanup'
