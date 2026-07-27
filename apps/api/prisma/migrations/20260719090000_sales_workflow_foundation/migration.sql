CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE tenants
  ADD COLUMN customer_code_prefix text NOT NULL DEFAULT 'CUS';

CREATE TABLE departments (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT departments_tenant_id_code_key UNIQUE (tenant_id, code)
);
CREATE INDEX departments_tenant_id_name_active_idx ON departments(tenant_id, name, active);

CREATE TABLE employees (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id bigint NOT NULL REFERENCES departments(id),
  code text NOT NULL,
  name text NOT NULL,
  job_title text,
  sales_eligible boolean NOT NULL DEFAULT false,
  branch_ids jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT employees_tenant_id_code_key UNIQUE (tenant_id, code)
);
CREATE INDEX employees_tenant_id_department_id_active_sales_eligible_idx
  ON employees(tenant_id, department_id, active, sales_eligible);
CREATE INDEX employees_tenant_id_name_idx ON employees(tenant_id, name);

CREATE TABLE currencies (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  precision integer NOT NULL DEFAULT 2,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT currencies_tenant_id_code_key UNIQUE (tenant_id, code),
  CONSTRAINT currencies_precision_check CHECK (precision BETWEEN 0 AND 6)
);
CREATE INDEX currencies_tenant_id_active_name_idx ON currencies(tenant_id, active, name);

CREATE TABLE currency_rates (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency text NOT NULL,
  target_currency text NOT NULL,
  rate_micros bigint NOT NULL,
  rate_date date NOT NULL,
  source text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT currency_rates_tenant_id_base_currency_target_currency_rate_date_key
    UNIQUE (tenant_id, base_currency, target_currency, rate_date),
  CONSTRAINT currency_rates_positive_check CHECK (rate_micros > 0)
);
CREATE INDEX currency_rates_tenant_id_target_currency_rate_date_idx
  ON currency_rates(tenant_id, target_currency, rate_date);

CREATE TABLE master_sequences (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  prefix text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  last_used_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX refresh_sessions_tenant_id_user_id_expires_at_idx
  ON refresh_sessions(tenant_id, user_id, expires_at);

ALTER TABLE customers
  ADD COLUMN customer_type text NOT NULL DEFAULT 'BUSINESS',
  ADD COLUMN registration_number text,
  ADD COLUMN billing_address text,
  ADD COLUMN shipping_address text,
  ADD COLUMN default_branch_id bigint REFERENCES branches(id),
  ADD COLUMN default_currency text,
  ADD COLUMN tax_treatment text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN credit_hold boolean NOT NULL DEFAULT false,
  ALTER COLUMN credit_limit_minor DROP DEFAULT,
  ALTER COLUMN credit_limit_minor DROP NOT NULL,
  ALTER COLUMN payment_terms_days DROP DEFAULT,
  ALTER COLUMN payment_terms_days DROP NOT NULL;

UPDATE customers
SET billing_address = address, shipping_address = address
WHERE address IS NOT NULL;

CREATE INDEX customers_tenant_id_name_active_idx ON customers(tenant_id, name, active);
CREATE INDEX customers_tenant_id_phone_idx ON customers(tenant_id, phone);
CREATE INDEX customers_tenant_id_email_idx ON customers(tenant_id, email);
CREATE INDEX customers_tenant_id_tax_number_idx ON customers(tenant_id, tax_number);

ALTER TABLE documents
  ADD COLUMN exchange_rate_date date,
  ADD COLUMN manual_exchange_rate boolean NOT NULL DEFAULT false,
  ADD COLUMN salesperson_id bigint REFERENCES employees(id);
CREATE INDEX documents_tenant_id_salesperson_id_status_idx
  ON documents(tenant_id, salesperson_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  departments, employees, currencies, currency_rates, master_sequences, refresh_sessions
TO odin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'departments', 'employees', 'currencies', 'currency_rates', 'master_sequences', 'refresh_sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;
