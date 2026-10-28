ALTER TABLE employees
 ADD COLUMN name_ar TEXT,
 ADD COLUMN email TEXT,
 ADD COLUMN phone TEXT,
 ADD COLUMN hire_date DATE,
 ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'FULL_TIME' CHECK (employment_type IN ('FULL_TIME','PART_TIME','CONTRACT')),
 ADD COLUMN annual_leave_days INTEGER CHECK (annual_leave_days BETWEEN 0 AND 366),
 ADD COLUMN work_days JSONB NOT NULL DEFAULT '[0,1,2,3,4]'::jsonb;
ALTER TABLE hr_records DROP CONSTRAINT hr_records_status_check;
ALTER TABLE hr_records ADD CONSTRAINT hr_records_status_check CHECK (status IN ('DRAFT','RECORDED','SUBMITTED','APPROVED','REJECTED','CANCELLED'));
INSERT INTO permissions (tenant_id,key,module,resource,action,description,updated_at)
SELECT id, 'hr.leave.cancel', 'hr', 'leave', 'cancel', 'Cancel leave requests', CURRENT_TIMESTAMP FROM tenants
ON CONFLICT (tenant_id,key) DO NOTHING;
INSERT INTO role_permissions (tenant_id,role_id,permission_id)
SELECT rp.tenant_id,rp.role_id,added.id FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.key = 'hr.employee.cancel'
JOIN permissions added ON added.tenant_id = rp.tenant_id AND added.key = 'hr.leave.cancel'
ON CONFLICT (tenant_id,role_id,permission_id) DO NOTHING;
