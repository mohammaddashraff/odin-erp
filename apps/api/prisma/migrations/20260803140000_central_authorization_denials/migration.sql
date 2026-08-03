ALTER TABLE access_audit_logs ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE access_audit_logs
  ADD COLUMN company_id text,
  ADD COLUMN warehouse_id bigint,
  ADD COLUMN resource_type text,
  ADD COLUMN resource_id text,
  ADD COLUMN requested_action text,
  ADD COLUMN route text,
  ADD COLUMN http_method text,
  ADD COLUMN user_agent text,
  ADD COLUMN session_id text,
  ADD COLUMN denial_reason text,
  ADD COLUMN data_scope_reason text,
  ADD COLUMN field_security_reason text,
  ADD COLUMN role_limit_reason text;

ALTER TABLE access_audit_logs ADD CONSTRAINT access_audit_logs_warehouse_id_fkey
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX access_audit_logs_tenant_id_denial_reason_created_at_idx
  ON access_audit_logs(tenant_id, denial_reason, created_at);
CREATE INDEX access_audit_logs_request_id_idx ON access_audit_logs(request_id);
