-- Company-aware access governance is additive. Existing tenants receive one
-- deterministic default company and existing branches/users are mapped to it.
-- This migration backfills company metadata onto existing audit records. The
-- append-only trigger permits the established transaction-local reset mode for
-- maintenance operations; it automatically clears when the migration commits.
SELECT set_config('app.reset_mode', 'on', true);
CREATE TYPE "CompanyMembershipRole" AS ENUM ('MEMBER', 'ADMINISTRATOR');
CREATE TYPE "FinancialResourceType" AS ENUM ('TREASURY', 'WALLET', 'PAYMENT_CARD', 'CASH_SOURCE', 'CHEQUE_BOOK', 'COST_CENTER', 'PROJECT', 'BANK_ACCOUNT', 'GL_ACCOUNT');
CREATE TYPE "SodEnforcement" AS ENUM ('WARN', 'BLOCK');
CREATE TYPE "AccessReviewDecision" AS ENUM ('CONFIRMED', 'REVOKE_REQUIRED', 'ESCALATED');
CREATE TYPE "AttachmentScanStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'CLEAN', 'QUARANTINED', 'REJECTED');

CREATE TABLE companies (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  base_currency text NOT NULL DEFAULT 'EGP',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT companies_tenant_code_key UNIQUE (tenant_id, code)
);
CREATE INDEX companies_tenant_active_name_idx ON companies(tenant_id, active, name);

CREATE TABLE company_memberships (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role "CompanyMembershipRole" NOT NULL DEFAULT 'MEMBER',
  active boolean NOT NULL DEFAULT true,
  valid_from timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz(3),
  created_by_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_memberships_tenant_company_user_key UNIQUE (tenant_id, company_id, user_id),
  CONSTRAINT company_memberships_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX company_memberships_tenant_user_active_valid_idx ON company_memberships(tenant_id, user_id, active, valid_until);

CREATE TABLE company_branches (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id bigint NOT NULL UNIQUE REFERENCES branches(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_branches_tenant_company_branch_key UNIQUE (tenant_id, company_id, branch_id)
);
CREATE INDEX company_branches_tenant_company_active_idx ON company_branches(tenant_id, company_id, active);

CREATE TABLE financial_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type "FinancialResourceType" NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  linked_bank_account_id bigint UNIQUE REFERENCES bank_accounts(id) ON DELETE CASCADE,
  linked_account_id bigint REFERENCES accounts(id) ON DELETE CASCADE,
  metadata jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT financial_resources_company_type_code_key UNIQUE (tenant_id, company_id, type, code),
  CONSTRAINT financial_resources_link_type CHECK (
    (type = 'BANK_ACCOUNT' AND linked_bank_account_id IS NOT NULL AND linked_account_id IS NULL)
    OR (type = 'GL_ACCOUNT' AND linked_account_id IS NOT NULL AND linked_bank_account_id IS NULL)
    OR (type NOT IN ('BANK_ACCOUNT', 'GL_ACCOUNT') AND linked_bank_account_id IS NULL AND linked_account_id IS NULL)
  )
);
CREATE INDEX financial_resources_tenant_company_type_active_idx ON financial_resources(tenant_id, company_id, type, active);

CREATE TABLE financial_resource_assignments (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id uuid NOT NULL REFERENCES financial_resources(id) ON DELETE CASCADE,
  valid_from timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz(3),
  reason text NOT NULL,
  granted_by_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT financial_resource_assignments_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT financial_resource_assignments_reason CHECK (length(btrim(reason)) >= 10)
);
CREATE INDEX financial_resource_assignments_user_valid_idx ON financial_resource_assignments(tenant_id, user_id, revoked_at, valid_until);
CREATE INDEX financial_resource_assignments_resource_idx ON financial_resource_assignments(tenant_id, resource_id, revoked_at);

CREATE TABLE temporary_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  permissions jsonb NOT NULL,
  resource_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  valid_from timestamptz(3) NOT NULL,
  valid_until timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT temporary_access_grants_validity CHECK (valid_until > valid_from),
  CONSTRAINT temporary_access_grants_reason CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT temporary_access_grants_permissions_array CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT temporary_access_grants_resources_object CHECK (jsonb_typeof(resource_assignments) = 'object')
);
CREATE INDEX temporary_access_grants_user_valid_idx ON temporary_access_grants(tenant_id, user_id, valid_from, valid_until, revoked_at);

CREATE TABLE delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  delegator_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegatee_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL,
  resource_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  valid_from timestamptz(3) NOT NULL,
  valid_until timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT delegations_distinct_users CHECK (delegator_id <> delegatee_id),
  CONSTRAINT delegations_validity CHECK (valid_until > valid_from),
  CONSTRAINT delegations_reason CHECK (length(btrim(reason)) >= 10),
  CONSTRAINT delegations_permissions_array CHECK (jsonb_typeof(permissions) = 'array'),
  CONSTRAINT delegations_resources_object CHECK (jsonb_typeof(resource_assignments) = 'object')
);
CREATE INDEX delegations_delegatee_valid_idx ON delegations(tenant_id, delegatee_id, valid_from, valid_until, revoked_at);
CREATE INDEX delegations_delegator_idx ON delegations(tenant_id, delegator_id, revoked_at);

CREATE TABLE sod_rules (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  left_permissions jsonb NOT NULL,
  right_permissions jsonb NOT NULL,
  enforcement "SodEnforcement" NOT NULL DEFAULT 'WARN',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sod_rules_tenant_key_key UNIQUE (tenant_id, key),
  CONSTRAINT sod_rules_left_array CHECK (jsonb_typeof(left_permissions) = 'array'),
  CONSTRAINT sod_rules_right_array CHECK (jsonb_typeof(right_permissions) = 'array')
);
CREATE INDEX sod_rules_tenant_active_enforcement_idx ON sod_rules(tenant_id, active, enforcement);

CREATE TABLE access_review_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision "AccessReviewDecision" NOT NULL,
  reason text NOT NULL,
  snapshot jsonb NOT NULL,
  reviewed_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT access_review_records_reason CHECK (length(btrim(reason)) >= 10)
);
CREATE INDEX access_review_records_subject_idx ON access_review_records(tenant_id, company_id, subject_user_id, reviewed_at);

CREATE TABLE authority_limit_policies (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id bigint REFERENCES branches(id) ON DELETE CASCADE,
  role_id bigint REFERENCES roles(id) ON DELETE CASCADE,
  department_id bigint REFERENCES departments(id) ON DELETE CASCADE,
  key text NOT NULL,
  document_type text,
  currency text NOT NULL,
  max_amount_minor bigint,
  max_percent_bps integer,
  priority integer NOT NULL DEFAULT 0,
  valid_from timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz(3),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT authority_limit_policies_validity CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT authority_limit_policies_amount CHECK (max_amount_minor IS NULL OR max_amount_minor >= 0),
  CONSTRAINT authority_limit_policies_percent CHECK (max_percent_bps IS NULL OR max_percent_bps BETWEEN 0 AND 10000),
  CONSTRAINT authority_limit_policies_has_limit CHECK (max_amount_minor IS NOT NULL OR max_percent_bps IS NOT NULL)
);
CREATE INDEX authority_limit_policies_lookup_idx ON authority_limit_policies(tenant_id, company_id, key, currency, active, priority DESC);

CREATE TABLE private_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  uploaded_by_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  scan_status "AttachmentScanStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  content bytea NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT private_attachments_size CHECK (size_bytes > 0 AND size_bytes = octet_length(content)),
  CONSTRAINT private_attachments_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX private_attachments_document_idx ON private_attachments(tenant_id, company_id, document_id, created_at);

ALTER TABLE audit_events ADD COLUMN company_id text, ADD COLUMN branch_id bigint;
CREATE INDEX audit_events_company_branch_created_idx ON audit_events(tenant_id, company_id, branch_id, created_at);

-- Deterministic compatibility backfill.
INSERT INTO companies (tenant_id, code, name, base_currency)
SELECT id, 'DEFAULT', name, base_currency FROM tenants
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Customer and supplier masters have explicit company ownership. The Prisma
-- fields remain nullable only so older integrations can omit the field while
-- the BEFORE INSERT trigger below resolves DEFAULT; the physical columns are
-- deliberately NOT NULL.
ALTER TABLE customers ADD COLUMN company_id bigint;
ALTER TABLE suppliers ADD COLUMN company_id bigint;
UPDATE customers p SET company_id = c.id FROM companies c WHERE c.tenant_id = p.tenant_id AND c.code = 'DEFAULT';
UPDATE suppliers p SET company_id = c.id FROM companies c WHERE c.tenant_id = p.tenant_id AND c.code = 'DEFAULT';
ALTER TABLE customers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE customers ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
CREATE INDEX customers_tenant_company_active_name_idx ON customers(tenant_id, company_id, active, name);
CREATE INDEX suppliers_tenant_company_active_name_idx ON suppliers(tenant_id, company_id, active, name);

INSERT INTO company_branches (tenant_id, company_id, branch_id)
SELECT b.tenant_id, c.id, b.id
FROM branches b JOIN companies c ON c.tenant_id = b.tenant_id AND c.code = 'DEFAULT'
ON CONFLICT (branch_id) DO NOTHING;

INSERT INTO company_memberships (tenant_id, company_id, user_id, role)
SELECT u.tenant_id, c.id, u.id,
  CASE WHEN r.key = 'super_admin' THEN 'ADMINISTRATOR'::"CompanyMembershipRole" ELSE 'MEMBER'::"CompanyMembershipRole" END
FROM users u
JOIN roles r ON r.id = u.role_id
JOIN companies c ON c.tenant_id = u.tenant_id AND c.code = 'DEFAULT'
ON CONFLICT (tenant_id, company_id, user_id) DO NOTHING;

UPDATE audit_events a SET branch_id = d.branch_id, company_id = cb.company_id::text
FROM documents d JOIN company_branches cb ON cb.branch_id = d.branch_id
WHERE a.entity_type = 'DOCUMENT' AND a.entity_id ~ '^[0-9]+$' AND d.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = j.branch_id, company_id = cb.company_id::text
FROM journal_entries j JOIN company_branches cb ON cb.branch_id = j.branch_id
WHERE a.entity_type = 'JOURNAL' AND a.entity_id ~ '^[0-9]+$' AND j.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = j.branch_id, company_id = cb.company_id::text
FROM payments p JOIN journal_entries j ON j.id = p.journal_entry_id JOIN company_branches cb ON cb.branch_id = j.branch_id
WHERE a.entity_type = 'PAYMENT' AND a.entity_id ~ '^[0-9]+$' AND p.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = b.branch_id, company_id = cb.company_id::text
FROM bank_transactions b JOIN company_branches cb ON cb.branch_id = b.branch_id
WHERE a.entity_type = 'BANK_TRANSACTION' AND a.entity_id ~ '^[0-9]+$' AND b.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = s.branch_id, company_id = cb.company_id::text
FROM pos_shifts s JOIN company_branches cb ON cb.branch_id = s.branch_id
WHERE a.entity_type = 'POS_SHIFT' AND a.entity_id ~ '^[0-9]+$' AND s.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = c.default_branch_id, company_id = c.company_id::text
FROM customers c
WHERE a.entity_type = 'CUSTOMER' AND a.entity_id ~ '^[0-9]+$' AND c.id = a.entity_id::bigint;
UPDATE audit_events a SET branch_id = s.branch_id, company_id = cb.company_id::text
FROM pos_sales p JOIN pos_shifts s ON s.id = p.shift_id JOIN company_branches cb ON cb.branch_id = s.branch_id
WHERE a.entity_type = 'POS_SALE' AND a.entity_id ~ '^[0-9]+$' AND p.id = a.entity_id::bigint;

INSERT INTO financial_resources (tenant_id, company_id, type, code, name, linked_bank_account_id)
SELECT b.tenant_id, c.id, 'BANK_ACCOUNT', b.code, b.name, b.id
FROM bank_accounts b JOIN companies c ON c.tenant_id = b.tenant_id AND c.code = 'DEFAULT'
ON CONFLICT (tenant_id, company_id, type, code) DO NOTHING;

INSERT INTO financial_resources (tenant_id, company_id, type, code, name, linked_account_id)
SELECT a.tenant_id, c.id, 'GL_ACCOUNT', a.code, a.name, a.id
FROM accounts a JOIN companies c ON c.tenant_id = a.tenant_id AND c.code = 'DEFAULT'
ON CONFLICT (tenant_id, company_id, type, code) DO NOTHING;

INSERT INTO sod_rules (tenant_id, key, name, description, left_permissions, right_permissions)
SELECT t.id, rule.key, rule.name, rule.description, rule.left_permissions::jsonb, rule.right_permissions::jsonb
FROM tenants t CROSS JOIN (VALUES
  ('supplier-maker-approver', 'Supplier maker and approver', 'Creating and approving suppliers should be separated.', '["purchasing.supplier.create"]', '["purchasing.supplier.approve"]'),
  ('payment-maker-approver', 'Payment maker and approver', 'Creating and approving outgoing payments should be separated.', '["payments.payment.create"]', '["payments.payment.approve"]'),
  ('journal-maker-approver-poster', 'Journal maker and approver/poster', 'Journal creation or editing should be separated from approval and posting.', '["accounting.journal.create","accounting.journal.edit"]', '["accounting.journal.approve","accounting.journal.post"]'),
  ('purchase-order-maker-approver', 'Purchase order maker and approver', 'Creating and approving purchase orders should be separated.', '["purchasing.order.create"]', '["purchasing.order.approve"]')
) AS rule(key, name, description, left_permissions, right_permissions)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- Preserve compatibility for tenants, users, and branches created by tests,
-- seed scripts, and existing integrations after this migration.
CREATE OR REPLACE FUNCTION provision_default_company_for_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO companies (tenant_id, code, name, base_currency)
  VALUES (NEW.id, 'DEFAULT', NEW.name, NEW.base_currency)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER tenants_default_company AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION provision_default_company_for_tenant();

CREATE OR REPLACE FUNCTION provision_default_company_for_branch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO company_branches (tenant_id, company_id, branch_id)
  SELECT NEW.tenant_id, id, NEW.id FROM companies
  WHERE tenant_id = NEW.tenant_id AND code = 'DEFAULT'
  ON CONFLICT (branch_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER branches_default_company AFTER INSERT ON branches
FOR EACH ROW EXECUTE FUNCTION provision_default_company_for_branch();

CREATE OR REPLACE FUNCTION provision_default_company_for_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO company_memberships (tenant_id, company_id, user_id, role)
  SELECT NEW.tenant_id, c.id, NEW.id,
    CASE WHEN r.key = 'super_admin' THEN 'ADMINISTRATOR'::"CompanyMembershipRole" ELSE 'MEMBER'::"CompanyMembershipRole" END
  FROM companies c JOIN roles r ON r.id = NEW.role_id
  WHERE c.tenant_id = NEW.tenant_id AND c.code = 'DEFAULT'
  ON CONFLICT (tenant_id, company_id, user_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER users_default_company AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION provision_default_company_for_user();

CREATE OR REPLACE FUNCTION provision_default_company_financial_resource() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE default_company_id bigint;
BEGIN
  SELECT id INTO default_company_id FROM companies WHERE tenant_id = NEW.tenant_id AND code = 'DEFAULT';
  IF TG_TABLE_NAME = 'bank_accounts' THEN
    INSERT INTO financial_resources (tenant_id, company_id, type, code, name, linked_bank_account_id)
    VALUES (NEW.tenant_id, default_company_id, 'BANK_ACCOUNT', NEW.code, NEW.name, NEW.id)
    ON CONFLICT (tenant_id, company_id, type, code) DO NOTHING;
  ELSIF TG_TABLE_NAME = 'accounts' THEN
    INSERT INTO financial_resources (tenant_id, company_id, type, code, name, linked_account_id)
    VALUES (NEW.tenant_id, default_company_id, 'GL_ACCOUNT', NEW.code, NEW.name, NEW.id)
    ON CONFLICT (tenant_id, company_id, type, code) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_accounts_default_financial_resource AFTER INSERT ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION provision_default_company_financial_resource();
CREATE TRIGGER accounts_default_financial_resource AFTER INSERT ON accounts
FOR EACH ROW EXECUTE FUNCTION provision_default_company_financial_resource();

CREATE OR REPLACE FUNCTION provision_default_party_company() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id FROM companies WHERE tenant_id = NEW.tenant_id AND code = 'DEFAULT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_customers_default_company BEFORE INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION provision_default_party_company();
CREATE TRIGGER a_suppliers_default_company BEFORE INSERT ON suppliers
FOR EACH ROW EXECUTE FUNCTION provision_default_party_company();

-- Fail closed when a caller attempts to combine identifiers from different
-- tenants or companies. RLS constrains rows; these triggers constrain FKs.
CREATE OR REPLACE FUNCTION enforce_governance_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_tenant bigint;
DECLARE object_company bigint;
BEGIN
  IF TG_TABLE_NAME = 'company_memberships' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id)
      OR (NEW.created_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.created_by_id AND tenant_id = NEW.tenant_id)) THEN
      RAISE EXCEPTION 'Company membership tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'company_branches' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM branches WHERE id = NEW.branch_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Company branch tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'financial_resources' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id
      OR (NEW.linked_bank_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bank_accounts WHERE id = NEW.linked_bank_account_id AND tenant_id = NEW.tenant_id))
      OR (NEW.linked_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.linked_account_id AND tenant_id = NEW.tenant_id)) THEN
      RAISE EXCEPTION 'Financial resource tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'financial_resource_assignments' THEN
    SELECT tenant_id INTO expected_tenant FROM financial_resources WHERE id = NEW.resource_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id)
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.granted_by_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Financial resource assignment tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'temporary_access_grants' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND tenant_id = NEW.tenant_id)
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.granted_by_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Temporary grant tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'delegations' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.delegator_id AND tenant_id = NEW.tenant_id)
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.delegatee_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Delegation tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'access_review_records' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.subject_user_id AND tenant_id = NEW.tenant_id)
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.reviewer_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Access review tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'authority_limit_policies' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id
      OR (NEW.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND tenant_id = NEW.tenant_id))
      OR (NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments WHERE id = NEW.department_id AND tenant_id = NEW.tenant_id))
      OR (NEW.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM company_branches WHERE branch_id = NEW.branch_id AND company_id = NEW.company_id AND tenant_id = NEW.tenant_id AND active)) THEN
      RAISE EXCEPTION 'Authority policy company binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'private_attachments' THEN
    SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id;
    SELECT cb.company_id INTO object_company FROM documents d JOIN company_branches cb ON cb.branch_id = d.branch_id AND cb.active WHERE d.id = NEW.document_id AND d.tenant_id = NEW.tenant_id;
    IF expected_tenant IS DISTINCT FROM NEW.tenant_id OR object_company IS DISTINCT FROM NEW.company_id
      OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.uploaded_by_id AND tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Attachment company binding is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER company_memberships_binding BEFORE INSERT OR UPDATE ON company_memberships FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER company_branches_binding BEFORE INSERT OR UPDATE ON company_branches FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER financial_resources_binding BEFORE INSERT OR UPDATE ON financial_resources FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER financial_resource_assignments_binding BEFORE INSERT OR UPDATE ON financial_resource_assignments FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER temporary_access_grants_binding BEFORE INSERT OR UPDATE ON temporary_access_grants FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER delegations_binding BEFORE INSERT OR UPDATE ON delegations FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER access_review_records_binding BEFORE INSERT OR UPDATE ON access_review_records FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER authority_limit_policies_binding BEFORE INSERT OR UPDATE ON authority_limit_policies FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();
CREATE TRIGGER private_attachments_binding BEFORE INSERT OR UPDATE ON private_attachments FOR EACH ROW EXECUTE FUNCTION enforce_governance_binding();

CREATE OR REPLACE FUNCTION enforce_party_company_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected_tenant bigint;
BEGIN
  SELECT tenant_id INTO expected_tenant FROM companies WHERE id = NEW.company_id AND active;
  IF expected_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Party company tenant binding is invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Party company ownership is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER z_customers_company_binding BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION enforce_party_company_binding();
CREATE TRIGGER z_suppliers_company_binding BEFORE INSERT OR UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION enforce_party_company_binding();

-- Keep customer-only fields out of the shared party trigger. PostgreSQL binds
-- NEW to the concrete trigger table, so even an unreachable reference to
-- default_branch_id fails when the shared function runs for suppliers.
CREATE OR REPLACE FUNCTION enforce_customer_default_branch_company() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE branch_company bigint;
BEGIN
  IF NEW.default_branch_id IS NOT NULL THEN
    SELECT company_id INTO branch_company FROM company_branches WHERE branch_id = NEW.default_branch_id AND active;
    IF branch_company IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Customer default branch must belong to its company' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_customers_default_branch_company BEFORE INSERT OR UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION enforce_customer_default_branch_company();

-- Operational rows may never combine identifiers from different companies.
-- Intercompany transfers require a separately modelled workflow and are not
-- represented by these direct mutation paths.
CREATE OR REPLACE FUNCTION enforce_operational_company_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE operation_company bigint;
DECLARE related_company bigint;
DECLARE operation_branch bigint;
DECLARE operation_tenant bigint;
DECLARE payload jsonb := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'documents' THEN
    SELECT cb.company_id, b.tenant_id INTO operation_company, operation_tenant FROM company_branches cb JOIN branches b ON b.id = cb.branch_id WHERE cb.branch_id = (payload->>'branch_id')::bigint AND cb.active;
    IF operation_company IS NULL OR operation_tenant IS DISTINCT FROM (payload->>'tenant_id')::bigint THEN
      RAISE EXCEPTION 'Document branch tenant/company binding is invalid' USING ERRCODE = '23514';
    END IF;
    IF payload->>'warehouse_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses WHERE id = (payload->>'warehouse_id')::bigint AND branch_id = (payload->>'branch_id')::bigint AND active) THEN
      RAISE EXCEPTION 'Document warehouse must belong to its branch' USING ERRCODE = '23514';
    END IF;
    IF payload->>'destination_warehouse_id' IS NOT NULL THEN
      SELECT cb.company_id INTO related_company FROM warehouses w JOIN company_branches cb ON cb.branch_id = w.branch_id AND cb.active WHERE w.id = (payload->>'destination_warehouse_id')::bigint AND w.active;
      IF related_company IS DISTINCT FROM operation_company THEN
        RAISE EXCEPTION 'Cross-company warehouse transfer requires an intercompany workflow' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF payload->>'customer_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id = (payload->>'customer_id')::bigint AND company_id = operation_company) THEN
      RAISE EXCEPTION 'Document customer belongs to another company' USING ERRCODE = '23514';
    END IF;
    IF payload->>'supplier_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM suppliers WHERE id = (payload->>'supplier_id')::bigint AND company_id = operation_company) THEN
      RAISE EXCEPTION 'Document supplier belongs to another company' USING ERRCODE = '23514';
    END IF;
    IF payload->>'source_document_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM documents source
      JOIN company_branches source_company ON source_company.branch_id = source.branch_id AND source_company.active
      WHERE source.id = (payload->>'source_document_id')::bigint AND source.tenant_id = (payload->>'tenant_id')::bigint AND source_company.company_id = operation_company
    ) THEN
      RAISE EXCEPTION 'Document source belongs to another company' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'document_lines' THEN
    SELECT cb.company_id, d.tenant_id INTO operation_company, operation_tenant
    FROM documents d JOIN company_branches cb ON cb.branch_id = d.branch_id AND cb.active WHERE d.id = (payload->>'document_id')::bigint;
    IF operation_tenant IS DISTINCT FROM (payload->>'tenant_id')::bigint THEN
      RAISE EXCEPTION 'Document line tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
    IF payload->>'source_line_id' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM document_lines source_line
      JOIN documents source_document ON source_document.id = source_line.document_id
      JOIN company_branches source_company ON source_company.branch_id = source_document.branch_id AND source_company.active
      WHERE source_line.id = (payload->>'source_line_id')::bigint AND source_line.tenant_id = (payload->>'tenant_id')::bigint AND source_company.company_id = operation_company
    ) THEN
      RAISE EXCEPTION 'Document source line belongs to another company' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'pos_shifts' THEN
    IF NOT EXISTS (SELECT 1 FROM branches WHERE id = (payload->>'branch_id')::bigint AND tenant_id = (payload->>'tenant_id')::bigint)
      OR NOT EXISTS (SELECT 1 FROM warehouses WHERE id = (payload->>'warehouse_id')::bigint AND tenant_id = (payload->>'tenant_id')::bigint AND branch_id = (payload->>'branch_id')::bigint AND active) THEN
      RAISE EXCEPTION 'POS warehouse must belong to its branch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'pos_sales' AND payload->>'customer_id' IS NOT NULL THEN
    SELECT s.branch_id, cb.company_id, s.tenant_id INTO operation_branch, operation_company, operation_tenant
    FROM pos_shifts s JOIN company_branches cb ON cb.branch_id = s.branch_id AND cb.active WHERE s.id = (payload->>'shift_id')::bigint;
    IF operation_tenant IS DISTINCT FROM (payload->>'tenant_id')::bigint OR NOT EXISTS (SELECT 1 FROM customers WHERE id = (payload->>'customer_id')::bigint AND tenant_id = (payload->>'tenant_id')::bigint AND company_id = operation_company) THEN
      RAISE EXCEPTION 'POS customer belongs to another company' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'pos_sales' THEN
    IF NOT EXISTS (SELECT 1 FROM pos_shifts WHERE id = (payload->>'shift_id')::bigint AND tenant_id = (payload->>'tenant_id')::bigint) THEN
      RAISE EXCEPTION 'POS sale tenant binding is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'bank_transactions' THEN
    SELECT cb.company_id, b.tenant_id INTO operation_company, operation_tenant FROM company_branches cb JOIN branches b ON b.id = cb.branch_id WHERE cb.branch_id = (payload->>'branch_id')::bigint AND cb.active;
    IF operation_company IS NULL OR operation_tenant IS DISTINCT FROM (payload->>'tenant_id')::bigint THEN
      RAISE EXCEPTION 'Bank transaction branch tenant/company binding is invalid' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM financial_resources WHERE company_id = operation_company AND type = 'BANK_ACCOUNT' AND linked_bank_account_id = (payload->>'bank_account_id')::bigint AND active) THEN
      RAISE EXCEPTION 'Bank transaction account belongs to another company' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM financial_resources WHERE company_id = operation_company AND type = 'GL_ACCOUNT' AND linked_account_id = (payload->>'counterparty_account_id')::bigint AND active) THEN
      RAISE EXCEPTION 'Bank transaction GL account is not enabled for the company' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'journal_lines' THEN
    SELECT cb.company_id, j.tenant_id INTO operation_company, operation_tenant FROM journal_entries j JOIN company_branches cb ON cb.branch_id = j.branch_id AND cb.active WHERE j.id = (payload->>'journal_entry_id')::bigint;
    IF operation_tenant IS DISTINCT FROM (payload->>'tenant_id')::bigint OR NOT EXISTS (SELECT 1 FROM financial_resources WHERE company_id = operation_company AND tenant_id = (payload->>'tenant_id')::bigint AND type = 'GL_ACCOUNT' AND linked_account_id = (payload->>'account_id')::bigint AND active) THEN
      RAISE EXCEPTION 'Journal GL account is not enabled for the company' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_company_binding BEFORE INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();
CREATE TRIGGER document_lines_company_binding BEFORE INSERT OR UPDATE ON document_lines FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();
CREATE TRIGGER pos_shifts_company_binding BEFORE INSERT OR UPDATE ON pos_shifts FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();
CREATE TRIGGER pos_sales_company_binding BEFORE INSERT OR UPDATE ON pos_sales FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();
CREATE TRIGGER bank_transactions_company_binding BEFORE INSERT OR UPDATE ON bank_transactions FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();
CREATE TRIGGER journal_lines_company_binding BEFORE INSERT OR UPDATE ON journal_lines FOR EACH ROW EXECUTE FUNCTION enforce_operational_company_binding();

CREATE OR REPLACE FUNCTION enforce_revocation_only_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    AND (to_jsonb(OLD) - 'revoked_at') = (to_jsonb(NEW) - 'revoked_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Access lifecycle records are immutable; only first revocation is allowed' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER financial_resource_assignments_revocation_only BEFORE UPDATE ON financial_resource_assignments FOR EACH ROW EXECUTE FUNCTION enforce_revocation_only_update();
CREATE TRIGGER temporary_access_grants_revocation_only BEFORE UPDATE ON temporary_access_grants FOR EACH ROW EXECUTE FUNCTION enforce_revocation_only_update();
CREATE TRIGGER delegations_revocation_only BEFORE UPDATE ON delegations FOR EACH ROW EXECUTE FUNCTION enforce_revocation_only_update();

GRANT SELECT, INSERT, UPDATE, DELETE ON companies, company_memberships, company_branches,
  financial_resources, financial_resource_assignments, temporary_access_grants, delegations,
  sod_rules, access_review_records, authority_limit_policies, private_attachments TO odin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies','company_memberships','company_branches','financial_resources',
    'financial_resource_assignments','temporary_access_grants','delegations','sod_rules',
    'access_review_records','authority_limit_policies','private_attachments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER access_review_records_no_update BEFORE UPDATE ON access_review_records
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER access_review_records_no_delete BEFORE DELETE ON access_review_records
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
