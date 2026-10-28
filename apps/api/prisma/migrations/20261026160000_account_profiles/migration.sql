-- Additive: existing credentials and grants are unchanged. Historical sign-in gaps stay unknown.
ALTER TABLE users ADD COLUMN phone TEXT, ADD COLUMN job_title TEXT, ADD COLUMN home_branch_id BIGINT,
 ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN temporary_password_expires_at TIMESTAMPTZ(3), ADD COLUMN last_sign_in_at TIMESTAMPTZ(3),
 ADD COLUMN sign_in_tracked_since TIMESTAMPTZ(3), ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ALTER COLUMN sign_in_tracked_since SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE branches ADD COLUMN operational BOOLEAN NOT NULL DEFAULT true;
-- Only the exact seeded fixture in an explicitly recorded AV8 isolated bootstrap is non-operational.
UPDATE branches b SET operational=false WHERE b.code='TEST' AND b.name='Synthetic second branch'
 AND EXISTS (SELECT 1 FROM audit_events a WHERE a.tenant_id=b.tenant_id AND a.action='AV8_ISOLATED_BOOTSTRAP'
 AND a.new_values->>'synthetic'='true');
