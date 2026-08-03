-- Shared demo identities are never valid production identities. Existing databases that
-- previously received the historical demo-password migration are made safe on upgrade;
-- an explicitly enabled non-production seed recreates disposable demo identities afterward.
UPDATE "users"
SET "active" = FALSE,
    "auth_version" = "auth_version" + 1
WHERE lower("email") LIKE '%@odin.demo';

UPDATE "refresh_sessions"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP)
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE lower("email") LIKE '%@odin.demo');
