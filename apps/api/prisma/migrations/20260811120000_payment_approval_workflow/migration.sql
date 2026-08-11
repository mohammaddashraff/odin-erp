-- Outgoing supplier payments are submitted first and posted only by an
-- authorized checker. Receipts retain their existing immediate-post path.
CREATE TYPE "PaymentStatus" AS ENUM ('SUBMITTED', 'POSTED', 'REJECTED');

-- Preserve each role's existing cash/bank visibility as its initial payment
-- scope. Permission checks remain separate and still gate every operation.
INSERT INTO role_data_scopes (tenant_id, role_id, resource, scope)
SELECT r.tenant_id, r.id, 'payment', COALESCE(bank_scope.scope, 'NONE'::"DataScopeType")
FROM roles r
LEFT JOIN role_data_scopes bank_scope ON bank_scope.role_id = r.id AND bank_scope.resource = 'bank_account'
ON CONFLICT (tenant_id, role_id, resource) DO NOTHING;

ALTER TABLE payments
  ADD COLUMN branch_id bigint,
  ADD COLUMN status "PaymentStatus" NOT NULL DEFAULT 'POSTED',
  ADD COLUMN allocation_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN approved_by_id bigint,
  ADD COLUMN rejected_by_id bigint,
  ADD COLUMN approved_at timestamptz(3),
  ADD COLUMN rejected_at timestamptz(3),
  ADD COLUMN decision_comment text,
  ALTER COLUMN journal_entry_id DROP NOT NULL;

UPDATE payments p
SET branch_id = j.branch_id,
    allocation_plan = COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'documentId', pa.document_id::text,
        'amountMinor', pa.amount_minor::text
      ) ORDER BY pa.id)
      FROM payment_allocations pa
      WHERE pa.payment_id = p.id
    ), '[]'::jsonb)
FROM journal_entries j
WHERE j.id = p.journal_entry_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payments WHERE branch_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate a payment without a journal-backed branch';
  END IF;
END $$;

ALTER TABLE payments ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'SUBMITTED';
ALTER TABLE payments ADD CONSTRAINT payments_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_approved_by_id_fkey
  FOREIGN KEY (approved_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_rejected_by_id_fkey
  FOREIGN KEY (rejected_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX payments_tenant_id_branch_id_kind_status_created_at_idx
  ON payments(tenant_id, branch_id, kind, status, created_at);

-- Defense in depth: payment identifiers must resolve to one active company and
-- pending/rejected payments may not point at a journal.
CREATE OR REPLACE FUNCTION enforce_payment_company_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE operation_company bigint;
DECLARE operation_tenant bigint;
BEGIN
  SELECT cb.company_id, b.tenant_id INTO operation_company, operation_tenant
  FROM company_branches cb
  JOIN branches b ON b.id = cb.branch_id
  WHERE cb.branch_id = NEW.branch_id AND cb.active;

  IF operation_company IS NULL OR operation_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Payment branch tenant/company binding is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM financial_resources
    WHERE tenant_id = NEW.tenant_id AND company_id = operation_company
      AND type = 'BANK_ACCOUNT' AND linked_bank_account_id = NEW.bank_account_id AND active
  ) THEN
    RAISE EXCEPTION 'Payment bank account belongs to another company' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'RECEIPT' AND (NEW.customer_id IS NULL OR NEW.supplier_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id AND company_id = operation_company)) THEN
    RAISE EXCEPTION 'Receipt customer belongs to another company' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'PAYMENT' AND (NEW.supplier_id IS NULL OR NEW.customer_id IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM suppliers WHERE id = NEW.supplier_id AND tenant_id = NEW.tenant_id AND company_id = operation_company)) THEN
    RAISE EXCEPTION 'Supplier payment belongs to another company' USING ERRCODE = '23514';
  END IF;
  IF NEW.journal_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM journal_entries
    WHERE id = NEW.journal_entry_id AND tenant_id = NEW.tenant_id AND branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Payment journal belongs to another branch or tenant' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'POSTED' AND NEW.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'An unposted payment cannot have a journal' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' AND NEW.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'A posted payment requires a journal' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.kind = 'RECEIPT' AND NEW.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Receipts must post immediately' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.kind = 'PAYMENT' AND NEW.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Outgoing payments must enter the submitted approval state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_company_binding
BEFORE INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_payment_company_binding();

-- Allocation rows are accounting effects, not a pending-workflow store. They
-- may only be inserted for the exact party, document type, tenant and branch
-- of their parent payment, and become immutable immediately.
CREATE OR REPLACE FUNCTION enforce_payment_allocation_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_tenant bigint;
DECLARE parent_branch bigint;
DECLARE parent_kind "PaymentKind";
DECLARE parent_status "PaymentStatus";
DECLARE parent_customer bigint;
DECLARE parent_supplier bigint;
DECLARE document_tenant bigint;
DECLARE document_branch bigint;
DECLARE document_type "DocumentType";
DECLARE document_customer bigint;
DECLARE document_supplier bigint;
BEGIN
  IF reset_mode_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Payment allocations are immutable' USING ERRCODE = '55000';
  END IF;
  SELECT tenant_id, branch_id, kind, status, customer_id, supplier_id
    INTO parent_tenant, parent_branch, parent_kind, parent_status, parent_customer, parent_supplier
    FROM payments WHERE id = NEW.payment_id;
  SELECT tenant_id, branch_id, type, customer_id, supplier_id
    INTO document_tenant, document_branch, document_type, document_customer, document_supplier
    FROM documents WHERE id = NEW.document_id;
  IF NEW.amount_minor <= 0 OR NEW.tenant_id IS DISTINCT FROM parent_tenant
    OR document_tenant IS DISTINCT FROM parent_tenant OR document_branch IS DISTINCT FROM parent_branch THEN
    RAISE EXCEPTION 'Payment allocation tenant/branch binding is invalid' USING ERRCODE = '23514';
  END IF;
  IF parent_kind = 'RECEIPT' AND (parent_status <> 'POSTED' OR document_type <> 'SALES_INVOICE'
    OR document_customer IS DISTINCT FROM parent_customer) THEN
    RAISE EXCEPTION 'Receipt allocation party or document binding is invalid' USING ERRCODE = '23514';
  END IF;
  IF parent_kind = 'PAYMENT' AND (parent_status <> 'SUBMITTED' OR document_type <> 'PURCHASE_BILL'
    OR document_supplier IS DISTINCT FROM parent_supplier) THEN
    RAISE EXCEPTION 'Outgoing payment allocation party or document binding is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payment_allocations_binding
BEFORE INSERT OR UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION enforce_payment_allocation_binding();

-- A checker transition is atomic: the posted journal and exact allocations
-- must already exist in the same transaction before the payment becomes final.
CREATE OR REPLACE FUNCTION enforce_payment_workflow_state() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allocated_total numeric;
DECLARE allocation_count integer;
DECLARE requested_total numeric;
DECLARE requested_count integer;
DECLARE actual_plan jsonb;
DECLARE requested_plan jsonb;
BEGIN
  IF reset_mode_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REJECTED') THEN
      RAISE EXCEPTION 'Finalized payments are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('POSTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Finalized payments are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.party_type IS DISTINCT FROM OLD.party_type
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
    OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.posting_date IS DISTINCT FROM OLD.posting_date
    OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.method IS DISTINCT FROM OLD.method
    OR NEW.reference IS DISTINCT FROM OLD.reference
    OR NEW.allocation_plan IS DISTINCT FROM OLD.allocation_plan
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Submitted payment instructions are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.kind <> 'PAYMENT' THEN
    RAISE EXCEPTION 'Only outgoing payments use the approval workflow' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION 'Submitted payments may only transition to a final decision' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'POSTED' THEN
    SELECT count(*), COALESCE(sum(amount_minor), 0),
      COALESCE(jsonb_object_agg(document_id::text, amount_minor::text), '{}'::jsonb)
      INTO allocation_count, allocated_total, actual_plan
      FROM payment_allocations WHERE payment_id = NEW.id;
    SELECT count(*), COALESCE(sum((entry->>'amountMinor')::numeric), 0),
      COALESCE(jsonb_object_agg(entry->>'documentId', entry->>'amountMinor'), '{}'::jsonb)
      INTO requested_count, requested_total, requested_plan
      FROM jsonb_array_elements(NEW.allocation_plan) entry;
    IF NEW.approved_by_id IS NULL OR NEW.approved_at IS NULL OR NEW.approved_by_id = NEW.created_by_id THEN
      RAISE EXCEPTION 'Outgoing payment requires an independent approver' USING ERRCODE = '23514';
    END IF;
    IF NEW.rejected_by_id IS NOT NULL OR NEW.rejected_at IS NOT NULL THEN
      RAISE EXCEPTION 'An approved payment cannot contain rejection metadata' USING ERRCODE = '23514';
    END IF;
    IF allocation_count < 1 OR allocation_count <> requested_count
      OR allocated_total <> NEW.amount_minor OR requested_total <> NEW.amount_minor
      OR actual_plan IS DISTINCT FROM requested_plan THEN
      RAISE EXCEPTION 'Outgoing payment allocations must exactly match its submitted plan and amount' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.journal_entry_id AND status = 'POSTED') THEN
      RAISE EXCEPTION 'Outgoing payment requires a posted journal' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'REJECTED' THEN
    IF NEW.rejected_by_id IS NULL OR NEW.rejected_at IS NULL OR NEW.rejected_by_id = NEW.created_by_id
      OR length(trim(COALESCE(NEW.decision_comment, ''))) < 3 THEN
      RAISE EXCEPTION 'Rejected payment requires an independent checker and reason' USING ERRCODE = '23514';
    END IF;
    IF NEW.approved_by_id IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'A rejected payment cannot contain approval metadata' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_workflow_state
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_payment_workflow_state();
