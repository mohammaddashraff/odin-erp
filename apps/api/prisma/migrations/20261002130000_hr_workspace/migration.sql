CREATE UNIQUE INDEX employees_tenant_id_id_key ON employees(tenant_id, id);
CREATE TABLE hr_records (
 id BIGSERIAL PRIMARY KEY,
 tenant_id BIGINT NOT NULL,
 employee_id BIGINT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('attendance', 'leave', 'payroll')),
 record_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RECORDED', 'SUBMITTED', 'APPROVED', 'REJECTED')),
 data JSONB NOT NULL,
 created_by BIGINT NOT NULL,
 reviewed_by BIGINT,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT hr_records_employee_fkey FOREIGN KEY (tenant_id, employee_id) REFERENCES employees(tenant_id, id) ON DELETE RESTRICT,
 CONSTRAINT hr_records_creator_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
 CONSTRAINT hr_records_reviewer_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX hr_records_tenant_employee_kind_key ON hr_records(tenant_id, employee_id, kind, record_key);
CREATE INDEX hr_records_tenant_kind_created_idx ON hr_records(tenant_id, kind, created_at);
ALTER TABLE hr_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_records FOR ALL TO odin_app
 USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_records TO odin_app;
GRANT USAGE, SELECT ON SEQUENCE hr_records_id_seq TO odin_app;
