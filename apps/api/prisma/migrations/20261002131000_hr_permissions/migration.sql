-- Extend existing HR role grants action-for-action. No unrelated roles are granted HR access.
INSERT INTO permissions (tenant_id, key, module, resource, action, description, updated_at)
SELECT t.id, 'hr.' || x.resource || '.' || x.action, 'hr', x.resource, x.action,
 'HR ' || x.resource || ' ' || x.action, CURRENT_TIMESTAMP
FROM tenants t CROSS JOIN (VALUES
 ('department','view'), ('department','create'), ('department','edit'),
 ('attendance','view'), ('attendance','create'), ('attendance','edit'),
 ('leave','view'), ('leave','create'), ('leave','edit'), ('leave','approve'), ('leave','reject'),
 ('payroll','view'), ('payroll','create'), ('payroll','edit'), ('payroll','approve'), ('payroll','reject')
) AS x(resource, action)
ON CONFLICT (tenant_id,key) DO NOTHING;
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT rp.tenant_id, rp.role_id, added.id
FROM role_permissions rp JOIN permissions existing ON existing.id = rp.permission_id
JOIN permissions added ON added.tenant_id = rp.tenant_id AND added.module = 'hr'
 AND added.resource IN ('department','attendance','leave','payroll') AND added.action = existing.action
WHERE existing.key = 'hr.employee.' || existing.action
ON CONFLICT (tenant_id,role_id,permission_id) DO NOTHING;
