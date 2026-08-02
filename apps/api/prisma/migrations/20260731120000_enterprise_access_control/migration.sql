-- Enterprise access control is additive. Legacy role.permissions and users.role_id
-- remain in place so existing sessions and integrations continue to work.
CREATE TYPE "PermissionOverrideEffect" AS ENUM ('GRANT', 'DENY');
CREATE TYPE "DataScopeType" AS ENUM ('OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'WAREHOUSE', 'DEPARTMENT', 'ALL');
CREATE TYPE "FieldAccessLevel" AS ENUM ('HIDDEN', 'VIEW', 'EDIT');

ALTER TABLE roles
  ADD COLUMN key text,
  ADD COLUMN description text,
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN archived_at timestamptz(3),
  ADD COLUMN created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX roles_tenant_id_key_key ON roles(tenant_id, key);
CREATE INDEX roles_tenant_id_active_archived_at_idx ON roles(tenant_id, active, archived_at);

ALTER TABLE employees ADD COLUMN user_id bigint, ADD COLUMN salary_minor bigint;
ALTER TABLE employees ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX employees_user_id_key ON employees(user_id);
ALTER TABLE customers ADD COLUMN owner_user_id bigint;
ALTER TABLE customers ADD CONSTRAINT customers_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX customers_tenant_id_owner_user_id_idx ON customers(tenant_id, owner_user_id);

-- An existing wildcard administrator becomes the tenant Super Admin. No users,
-- role assignments, or legacy permissions are removed by this migration.
WITH ranked AS (
  SELECT id, tenant_id, row_number() OVER (PARTITION BY tenant_id ORDER BY id) AS position
  FROM roles
  WHERE permissions::jsonb ? '*'
)
UPDATE roles r
SET key = CASE WHEN ranked.position = 1 THEN 'super_admin' ELSE NULL END,
    description = CASE WHEN ranked.position = 1 THEN 'Unrestricted tenant administration' ELSE r.description END
FROM ranked
WHERE r.id = ranked.id;

CREATE TABLE permissions (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  module text NOT NULL,
  resource text NOT NULL,
  action text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX permissions_tenant_id_key_key ON permissions(tenant_id, key);
CREATE INDEX permissions_tenant_id_module_resource_action_idx ON permissions(tenant_id, module, resource, action);

CREATE TABLE role_permissions (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX role_permissions_tenant_id_role_id_permission_id_key ON role_permissions(tenant_id, role_id, permission_id);
CREATE INDEX role_permissions_tenant_id_permission_id_idx ON role_permissions(tenant_id, permission_id);

CREATE TABLE user_roles (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX user_roles_tenant_id_user_id_role_id_key ON user_roles(tenant_id, user_id, role_id);
CREATE INDEX user_roles_tenant_id_role_id_idx ON user_roles(tenant_id, role_id);

CREATE TABLE user_permission_overrides (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect "PermissionOverrideEffect" NOT NULL,
  reason text,
  created_by_id bigint,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE user_permission_overrides ADD CONSTRAINT user_permission_overrides_created_by_id_fkey
  FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX user_permission_overrides_tenant_id_user_id_permission_id_key ON user_permission_overrides(tenant_id, user_id, permission_id);
CREATE INDEX user_permission_overrides_tenant_id_permission_id_effect_idx ON user_permission_overrides(tenant_id, permission_id, effect);

CREATE TABLE role_limits (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX role_limits_tenant_id_role_id_key_key ON role_limits(tenant_id, role_id, key);

CREATE TABLE role_data_scopes (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource text NOT NULL,
  scope "DataScopeType" NOT NULL,
  config jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX role_data_scopes_tenant_id_role_id_resource_key ON role_data_scopes(tenant_id, role_id, resource);
CREATE INDEX role_data_scopes_tenant_id_resource_scope_idx ON role_data_scopes(tenant_id, resource, scope);

CREATE TABLE role_field_permissions (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  resource text NOT NULL,
  field text NOT NULL,
  access "FieldAccessLevel" NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX role_field_permissions_tenant_id_role_id_resource_field_key ON role_field_permissions(tenant_id, role_id, resource, field);
CREATE INDEX role_field_permissions_tenant_id_resource_field_access_idx ON role_field_permissions(tenant_id, resource, field, access);

CREATE TABLE access_audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  subject_role_id bigint REFERENCES roles(id) ON DELETE SET NULL,
  action text NOT NULL,
  permission_key text,
  previous_value jsonb,
  new_value jsonb,
  ip_address text,
  branch_id bigint,
  request_id text,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE access_audit_logs ADD CONSTRAINT access_audit_logs_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX access_audit_logs_tenant_id_created_at_idx ON access_audit_logs(tenant_id, created_at);
CREATE INDEX access_audit_logs_tenant_id_actor_user_id_action_idx ON access_audit_logs(tenant_id, actor_user_id, action);

-- Preserve existing permission behavior in the normalized tables immediately.
INSERT INTO permissions (tenant_id, key, module, resource, action, description)
SELECT DISTINCT r.tenant_id,
  CASE WHEN p.key = '*' THEN 'system.super_admin' ELSE p.key END,
  CASE WHEN p.key = '*' THEN 'system' ELSE split_part(p.key, '.', 1) END,
  CASE WHEN p.key = '*' THEN 'access' ELSE split_part(p.key, '.', 1) END,
  CASE WHEN p.key = '*' THEN 'manage' ELSE coalesce(nullif(split_part(p.key, '.', 2), ''), 'use') END,
  'Migrated from the legacy role permission list'
FROM roles r
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(r.permissions::jsonb) = 'array' THEN r.permissions::jsonb ELSE '[]'::jsonb END
) AS p(key)
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM roles r
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(r.permissions::jsonb) = 'array' THEN r.permissions::jsonb ELSE '[]'::jsonb END
) AS legacy(key)
JOIN permissions p ON p.tenant_id = r.tenant_id AND p.key = CASE WHEN legacy.key = '*' THEN 'system.super_admin' ELSE legacy.key END
ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON permissions, role_permissions, user_roles, user_permission_overrides,
  role_limits, role_data_scopes, role_field_permissions, access_audit_logs TO odin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'permissions','role_permissions','user_roles','user_permission_overrides','role_limits',
    'role_data_scopes','role_field_permissions','access_audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER access_audit_logs_no_update BEFORE UPDATE ON access_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER access_audit_logs_no_delete BEFORE DELETE ON access_audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
