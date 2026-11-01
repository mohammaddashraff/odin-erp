#!/bin/sh
set -eu
# Runs only for this new named PostgreSQL volume. It never modifies a host database.
# The inherited separate admin pool performs global authentication/bootstrap and migration work.
# Only that owner has BYPASSRLS; tenant business traffic uses the distinct restricted runtime role.
. /run/secrets/db_config
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres --set=owner="$AV8_DATABASE_OWNER" --set=owner_password="$AV8_DATABASE_OWNER_PASSWORD" --set=runtime_password="$AV8_DATABASE_RUNTIME_PASSWORD" --set=database="$AV8_DATABASE_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB CREATEROLE BYPASSRLS', :'owner', :'owner_password') \gexec
CREATE ROLE odin_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SELECT format('GRANT odin_app TO %I WITH ADMIN OPTION', :'owner') \gexec
SELECT format('CREATE ROLE av8_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT', :'runtime_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'owner') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I,av8_runtime', :'database', :'owner') \gexec
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$AV8_DATABASE_NAME" --set=owner="$AV8_DATABASE_OWNER" --set=resource="$AV8_DATABASE_RESOURCE" <<'SQL'
CREATE SCHEMA av8_guard;
CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY);
INSERT INTO av8_guard.av8_environment_identity VALUES (:'resource');
SELECT format('GRANT USAGE ON SCHEMA av8_guard TO %I,av8_runtime', :'owner') \gexec
SELECT format('GRANT SELECT ON av8_guard.av8_environment_identity TO %I,av8_runtime', :'owner') \gexec
SQL
