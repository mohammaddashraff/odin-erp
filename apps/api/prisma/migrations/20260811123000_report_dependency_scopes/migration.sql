-- Items are an explicit report dependency. Preserve the existing warehouse
-- visibility policy for current roles, while defaulting roles without one to
-- NONE. Future roles receive an item scope from the central registry/seed.
INSERT INTO role_data_scopes (tenant_id, role_id, resource, scope, config, created_at, updated_at)
SELECT
  r.tenant_id,
  r.id,
  'item',
  CASE
    WHEN warehouse_scope.scope IN ('ALL'::"DataScopeType", 'BRANCH'::"DataScopeType", 'WAREHOUSE'::"DataScopeType") THEN warehouse_scope.scope
    ELSE 'NONE'::"DataScopeType"
  END,
  NULL,
  now(),
  now()
FROM roles r
LEFT JOIN role_data_scopes warehouse_scope
  ON warehouse_scope.tenant_id = r.tenant_id
 AND warehouse_scope.role_id = r.id
 AND warehouse_scope.resource = 'warehouse'
ON CONFLICT (tenant_id, role_id, resource) DO NOTHING;
