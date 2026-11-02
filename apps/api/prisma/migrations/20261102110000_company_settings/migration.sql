ALTER TABLE users ADD COLUMN profile_image TEXT;

CREATE TABLE company_profiles (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  company_id BIGINT NOT NULL,
  name_ar TEXT,
  legal_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  address TEXT,
  commercial_registration TEXT,
  tax_number TEXT,
  logo_image TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_profiles_tenant_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT company_profiles_company_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT company_profiles_tenant_company_key UNIQUE (tenant_id, company_id)
);

CREATE UNIQUE INDEX company_profiles_company_id_key ON company_profiles(company_id);
CREATE INDEX company_profiles_tenant_updated_idx ON company_profiles(tenant_id, updated_at);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_profiles FOR ALL TO odin_app
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON company_profiles TO odin_app;
GRANT USAGE, SELECT ON SEQUENCE company_profiles_id_seq TO odin_app;
