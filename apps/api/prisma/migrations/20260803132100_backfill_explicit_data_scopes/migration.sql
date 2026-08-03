-- Preserve existing, explicitly configured policy intent for current document
-- families. Resources that cannot be derived safely remain absent and therefore
-- evaluate to NONE.
WITH mappings(resource, source_resource) AS (
  VALUES
    ('credit_note', 'return'),
    ('purchase_request', 'purchase_order'),
    ('rfq', 'purchase_order'),
    ('receipt', 'purchase_order'),
    ('bill', 'purchase_order'),
    ('purchase_return', 'purchase_order'),
    ('transfer', 'warehouse'),
    ('adjustment', 'warehouse'),
    ('stock_count', 'warehouse'),
    ('approval_queue', 'report'),
    ('export', 'report'),
    ('print', 'report')
)
INSERT INTO role_data_scopes (tenant_id, role_id, resource, scope, config, created_at, updated_at)
SELECT source.tenant_id, source.role_id, mappings.resource, source.scope, source.config, now(), now()
FROM role_data_scopes source
JOIN mappings ON mappings.source_resource = source.resource
ON CONFLICT (tenant_id, role_id, resource) DO NOTHING;

-- Financial masters had tenant-wide behavior before this migration. Preserve it
-- only for roles that already hold the corresponding action permission, making
-- the prior behavior explicit instead of relying on a fallback.
INSERT INTO role_data_scopes (tenant_id, role_id, resource, scope, created_at, updated_at)
SELECT DISTINCT rp.tenant_id, rp.role_id, 'bank_account', 'ALL'::"DataScopeType", now(), now()
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id AND p.tenant_id = rp.tenant_id
WHERE p.active = true
  AND (p.key LIKE 'banking.%' OR p.key LIKE 'payments.%')
ON CONFLICT (tenant_id, role_id, resource) DO NOTHING;

UPDATE role_data_scopes scope
SET scope = 'ALL'::"DataScopeType", config = NULL, updated_at = now()
WHERE scope.resource = 'supplier'
  AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id AND p.tenant_id = rp.tenant_id
    WHERE rp.tenant_id = scope.tenant_id
      AND rp.role_id = scope.role_id
      AND p.active = true
      AND p.key = 'purchasing.supplier.view'
  );

INSERT INTO role_data_scopes (tenant_id, role_id, resource, scope, created_at, updated_at)
SELECT DISTINCT rp.tenant_id, rp.role_id, 'account', 'ALL'::"DataScopeType", now(), now()
FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id AND p.tenant_id = rp.tenant_id
WHERE p.active = true
  AND (p.key LIKE 'accounting.account.%' OR p.key = 'banking.transaction.create')
ON CONFLICT (tenant_id, role_id, resource) DO NOTHING;
