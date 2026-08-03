ALTER TABLE users
  ADD COLUMN auth_version integer NOT NULL DEFAULT 0,
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_encrypted text,
  ADD COLUMN mfa_recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN mfa_enrolled_at timestamptz(3);

ALTER TABLE refresh_sessions ADD COLUMN mfa_verified_at timestamptz(3);

CREATE TABLE mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL,
  remember_me boolean NOT NULL DEFAULT true,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX mfa_challenges_tenant_id_user_id_expires_at_idx ON mfa_challenges(tenant_id, user_id, expires_at);

CREATE TABLE auth_throttles (
  key_hash text PRIMARY KEY,
  kind text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz(3),
  last_attempt_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_throttles_blocked_until_idx ON auth_throttles(blocked_until);

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_challenges TO odin_app;
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mfa_challenges FOR ALL TO odin_app
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Authentication throttles contain only keyed hashes and are accessed through
-- the owner connection before tenant identity is known. They are never exposed
-- through an application route.
REVOKE ALL ON auth_throttles FROM odin_app;
