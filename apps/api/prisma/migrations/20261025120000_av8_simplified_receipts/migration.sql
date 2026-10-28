-- A receipt now carries its own note and is posted/allocated in one transaction.
ALTER TABLE av8_funds ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

-- Everyday business settings are immediately usable. APPROVED is retained only
-- for immutable historical versions created by the former approval workflow.
ALTER TABLE av8_policies DROP CONSTRAINT IF EXISTS av8_policies_status_check;
ALTER TABLE av8_policies DROP CONSTRAINT IF EXISTS av8_policies_status_check1;
ALTER TABLE av8_policies ADD CONSTRAINT av8_policies_status_check
  CHECK (status IN ('DRAFT','APPROVED','ACTIVE'));
ALTER TABLE av8_policies ADD CONSTRAINT av8_policies_approved_fields_check
  CHECK (status <> 'APPROVED' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL));

-- Make the student-collections control mapping an internal, company-scoped
-- resource. Prefer an already valid mapping, then a valid legacy policy value;
-- only create a zero-balance control account when neither exists.
DO $$
DECLARE
  company_row record;
  control_account_id bigint;
  control_code text;
BEGIN
  FOR company_row IN
    SELECT id, tenant_id, code
    FROM companies
    WHERE active
    ORDER BY tenant_id, id
  LOOP
    control_account_id := NULL;

    SELECT a.id INTO control_account_id
    FROM financial_resources r
    JOIN accounts a ON a.id = r.linked_account_id
    WHERE r.tenant_id = company_row.tenant_id
      AND r.company_id = company_row.id
      AND r.type = 'GL_ACCOUNT'
      AND r.code = 'AV8_STUDENT_COLLECTIONS'
      AND r.active
      AND a.tenant_id = company_row.tenant_id
      AND a.type = 'LIABILITY'
      AND a.active
      AND a.posting_allowed
    LIMIT 1;

    IF control_account_id IS NULL THEN
      SELECT a.id INTO control_account_id
      FROM av8_policies p
      JOIN accounts a
        ON a.tenant_id = p.tenant_id
       AND a.code = p.data ->> 'agencyAccountCode'
      WHERE p.tenant_id = company_row.tenant_id
        AND p.kind = 'ACCOUNTING'
        AND p.key = 'AGENCY'
        AND a.type = 'LIABILITY'
        AND a.active
        AND a.posting_allowed
      ORDER BY p.version DESC
      LIMIT 1;
    END IF;

    IF control_account_id IS NULL THEN
      SELECT a.id INTO control_account_id
      FROM financial_resources r
      JOIN accounts a ON a.id = r.linked_account_id
      WHERE r.tenant_id = company_row.tenant_id
        AND r.company_id = company_row.id
        AND r.type = 'GL_ACCOUNT'
        AND r.active
        AND a.control_type = 'AV8_STUDENT_COLLECTIONS'
        AND a.type = 'LIABILITY'
        AND a.active
        AND a.posting_allowed
      LIMIT 1;
    END IF;

    IF control_account_id IS NULL THEN
      control_code := LEFT(
        'AV8_' || regexp_replace(UPPER(company_row.code), '[^A-Z0-9_-]', '_', 'g') || '_COLL',
        40
      );
      INSERT INTO accounts (tenant_id, code, name, type, posting_allowed, control_type, active)
      VALUES (
        company_row.tenant_id,
        control_code,
        'AV8 student collections',
        'LIABILITY',
        true,
        'AV8_STUDENT_COLLECTIONS',
        true
      )
      ON CONFLICT (tenant_id, code) DO NOTHING;

      SELECT id INTO control_account_id
      FROM accounts
      WHERE tenant_id = company_row.tenant_id
        AND code = control_code
        AND type = 'LIABILITY'
        AND active
        AND posting_allowed;
    END IF;

    IF control_account_id IS NULL THEN
      RAISE EXCEPTION 'Unable to initialize AV8 collections account for company %', company_row.id;
    END IF;

    INSERT INTO financial_resources (
      tenant_id, company_id, type, code, name, linked_account_id, metadata, active
    ) VALUES (
      company_row.tenant_id,
      company_row.id,
      'GL_ACCOUNT',
      'AV8_STUDENT_COLLECTIONS',
      'AV8 student collections',
      control_account_id,
      jsonb_build_object('purpose', 'AV8_STUDENT_COLLECTIONS', 'managedBy', 'AV8'),
      true
    )
    ON CONFLICT (tenant_id, company_id, type, code) DO UPDATE
      SET linked_account_id = EXCLUDED.linked_account_id,
          active = true,
          updated_at = CURRENT_TIMESTAMP;
  END LOOP;
END $$;

-- Existing installations did not have a plain programs/fees setting. Add the
-- confirmed AV8 defaults once without changing any existing contract snapshot.
INSERT INTO av8_policies (tenant_id, kind, key, version, status, data)
SELECT
  t.id,
  'PROGRAM',
  'DEFAULT',
  1,
  'ACTIVE',
  jsonb_build_object(
    'name', 'Flight training',
    'currency', 'USD',
    'applicationFeeMinor', '200000',
    'cashStudentTotalMinor', '5400000'
  )
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM av8_policies p
  WHERE p.tenant_id = t.id AND p.kind = 'PROGRAM' AND p.key = 'DEFAULT'
);
