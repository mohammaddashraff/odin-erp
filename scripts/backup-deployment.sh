#!/bin/bash
set -euo pipefail
umask 077
cd /srv/demo/odin-erp
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="/srv/demo/backups/odin-${stamp}.dump"
roles_file="/srv/demo/backups/odin-${stamp}.roles.sql"

cleanup() {
  rm -f "$backup_file.tmp" "$roles_file.tmp"
}
trap cleanup EXIT

# The database uses RLS policies that reference the runtime role. pg_dump does
# not include cluster roles, so every backup ships a password-free bootstrap
# file that can be applied before pg_restore on a new PostgreSQL cluster.
cat > "$roles_file.tmp" <<'SQL'
DO $odin$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odin_app') THEN
    CREATE ROLE odin_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$odin$;
SQL

docker compose -f compose.deploy.yml exec -T postgres pg_dump -U odin -d odin_erp -Fc > "$backup_file.tmp"
mv "$roles_file.tmp" "$roles_file"
mv "$backup_file.tmp" "$backup_file"

find /srv/demo/backups -maxdepth 1 \( -name 'odin-*.dump' -o -name 'odin-*.roles.sql' \) -mtime +14 -delete
