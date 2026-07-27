-- Runtime role: application traffic uses RLS; migrations/reset use the owner connection.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odin_app') THEN
    CREATE ROLE odin_app LOGIN PASSWORD 'odin_app_local_only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO odin_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO odin_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO odin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO odin_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO odin_app;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_tenant_id', true), '')::bigint
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'branches','warehouses','roles','users','fiscal_periods','accounts','document_sequences',
    'customers','suppliers','item_categories','units_of_measure','items','stock_balances',
    'stock_movements','documents','document_lines','journal_entries','journal_lines','payments',
    'payment_allocations','approval_events','audit_events','pos_shifts','pos_sales','pos_sale_lines',
    'pos_tenders','bank_accounts','bank_transactions','bank_statements','bank_statement_lines',
    'idempotency_keys'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO odin_app USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants FOR ALL TO odin_app
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '55000';
END $$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE OR REPLACE FUNCTION reject_posted_journal_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER posted_journal_no_update BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION reject_posted_journal_mutation();

CREATE OR REPLACE FUNCTION reject_posted_journal_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journal entries cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER posted_journal_no_delete BEFORE DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION reject_posted_journal_delete();

CREATE OR REPLACE FUNCTION reject_posted_journal_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status "JournalStatus";
BEGIN
  SELECT status INTO parent_status FROM journal_entries WHERE id = COALESCE(OLD.journal_entry_id, NEW.journal_entry_id);
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted journal entry are immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER posted_journal_lines_no_update BEFORE UPDATE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION reject_posted_journal_line_mutation();
CREATE TRIGGER posted_journal_lines_no_delete BEFORE DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION reject_posted_journal_line_mutation();

CREATE OR REPLACE FUNCTION enforce_journal_posting_controls() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE debit_total numeric;
DECLARE credit_total numeric;
DECLARE line_count integer;
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status <> 'POSTED' THEN
    SELECT count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0)
      INTO line_count, debit_total, credit_total
      FROM journal_lines WHERE journal_entry_id = NEW.id;
    IF line_count < 2 OR debit_total <= 0 OR debit_total <> credit_total THEN
      RAISE EXCEPTION 'Unbalanced journal entry: debit % does not equal credit %', debit_total, credit_total
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_balance_before_post BEFORE UPDATE OF status ON journal_entries
FOR EACH ROW EXECUTE FUNCTION enforce_journal_posting_controls();

CREATE OR REPLACE FUNCTION reject_posted_document_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted documents are immutable; use a return or reversal' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER posted_document_no_update BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION reject_posted_document_mutation();

CREATE OR REPLACE FUNCTION reject_posted_document_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted documents cannot be deleted; use a return or reversal' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER posted_document_no_delete BEFORE DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION reject_posted_document_delete();

CREATE OR REPLACE FUNCTION reject_posted_document_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_status "WorkflowStatus";
BEGIN
  SELECT status INTO parent_status FROM documents WHERE id = COALESCE(OLD.document_id, NEW.document_id);
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'Lines of a posted document are immutable; use a return or reversal' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER posted_document_lines_no_update BEFORE UPDATE ON document_lines
FOR EACH ROW EXECUTE FUNCTION reject_posted_document_line_mutation();
CREATE TRIGGER posted_document_lines_no_delete BEFORE DELETE ON document_lines
FOR EACH ROW EXECUTE FUNCTION reject_posted_document_line_mutation();

CREATE OR REPLACE FUNCTION prevent_negative_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE allow_negative boolean;
BEGIN
  SELECT negative_stock INTO allow_negative FROM tenants WHERE id = NEW.tenant_id;
  IF NOT allow_negative AND NEW.quantity_milli < 0 THEN
    RAISE EXCEPTION 'Insufficient stock; negative inventory is disabled' USING ERRCODE = '23514';
  END IF;
  IF NEW.value_minor < 0 THEN
    RAISE EXCEPTION 'Inventory value cannot be negative' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stock_balance_nonnegative BEFORE INSERT OR UPDATE ON stock_balances
FOR EACH ROW EXECUTE FUNCTION prevent_negative_stock();
