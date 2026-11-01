-- Imported paid history is linked to an independently approved opening journal.
-- It must never be posted as a new receipt/remittance or bypass ordinary cash guards.
CREATE TABLE av8_opening_sources (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('BATCH','APPLICATION','PERSON','FUND')),
  source_id text NOT NULL,
  checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
  data jsonb NOT NULL,
  created_by_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,source_system,kind,source_id)
);
ALTER TABLE av8_opening_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON av8_opening_sources FOR ALL TO odin_app
 USING(tenant_id=current_tenant_id()) WITH CHECK(tenant_id=current_tenant_id());
GRANT SELECT,INSERT ON av8_opening_sources TO odin_app;
GRANT USAGE,SELECT ON SEQUENCE av8_opening_sources_id_seq TO odin_app;
CREATE TRIGGER av8_opening_source_scope BEFORE INSERT ON av8_opening_sources FOR EACH ROW EXECUTE FUNCTION av8_reference_binding();
CREATE TRIGGER av8_opening_source_immutable BEFORE UPDATE OR DELETE ON av8_opening_sources FOR EACH ROW EXECUTE FUNCTION av8_immutable();
CREATE TRIGGER av8_opening_record_immutable BEFORE UPDATE OR DELETE ON av8_records
 FOR EACH ROW WHEN(OLD.kind IN ('opening-source','financial-hold','imported-refund-review')) EXECUTE FUNCTION av8_immutable();

DO $$ DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='av8_funds'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%bank_transaction_id IS NOT NULL%' AND pg_get_constraintdef(oid) LIKE '%cleared_at IS NOT NULL%'
 LOOP EXECUTE format('ALTER TABLE av8_funds DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE av8_funds ADD CONSTRAINT av8_cleared_cash_or_opening_history CHECK (
 status<>'CLEARED' OR (cleared_at IS NOT NULL AND (bank_transaction_id IS NOT NULL
 OR (metadata->>'importKind'='OPENING_HISTORY' AND metadata->>'openingJournalId' ~ '^[0-9]+$')))
);
CREATE FUNCTION av8_opening_fund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j journal_entries;
BEGIN
 IF NEW.metadata->>'importKind'='OPENING_HISTORY' THEN
  IF TG_OP<>'INSERT' OR NEW.kind NOT IN ('RECEIPT','REMITTANCE') OR NEW.status<>'CLEARED'
    OR NEW.bank_transaction_id IS NOT NULL OR NEW.application_id IS NULL
    OR NEW.metadata->>'sourceId' IS NULL OR NEW.metadata->>'sourceSystem' IS NULL
    OR NEW.metadata->>'openingJournalId' IS NULL THEN RAISE EXCEPTION 'Invalid imported historical fund'; END IF;
  SELECT * INTO j FROM journal_entries WHERE id=(NEW.metadata->>'openingJournalId')::bigint AND tenant_id=NEW.tenant_id FOR SHARE;
  IF j.id IS NULL OR j.status<>'POSTED' OR j.source_type<>'MANUAL' OR j.approved_by_id IS NULL
    OR j.approved_by_id=j.created_by_id OR j.branch_id<>NEW.branch_id
    OR j.posting_date::text IS DISTINCT FROM NEW.metadata->>'cutoverDate'
    OR NEW.posting_date>j.posting_date OR NEW.rate_date>j.posting_date
    OR EXISTS(SELECT 1 FROM journal_entries WHERE reverses_entry_id=j.id AND status='POSTED')
    THEN RAISE EXCEPTION 'Imported paid history needs a separately approved posted opening journal in its branch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM bank_accounts b JOIN journal_lines l ON l.account_id=b.gl_account_id
    WHERE b.id=NEW.bank_account_id AND b.tenant_id=NEW.tenant_id AND b.currency=NEW.currency AND l.journal_entry_id=j.id)
    THEN RAISE EXCEPTION 'Historical fund resource is missing from its opening journal'; END IF;
  IF NEW.kind='RECEIPT' AND NOT EXISTS(SELECT 1 FROM accounts a JOIN journal_lines l ON l.account_id=a.id
    WHERE a.id=(NEW.metadata->>'liabilityAccountId')::bigint AND a.tenant_id=NEW.tenant_id AND a.type='LIABILITY' AND l.journal_entry_id=j.id)
    THEN RAISE EXCEPTION 'Historical receipt must preserve its opening liability control'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_opening_fund_guard BEFORE INSERT OR UPDATE ON av8_funds FOR EACH ROW EXECUTE FUNCTION av8_opening_fund_guard();
CREATE UNIQUE INDEX av8_imported_fund_source_unique ON av8_funds(tenant_id,(metadata->>'sourceSystem'),(metadata->>'sourceId')) WHERE metadata->>'importKind'='OPENING_HISTORY';

CREATE FUNCTION av8_opening_journal_reversal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='POSTED' AND NEW.reverses_entry_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM av8_funds WHERE tenant_id=NEW.tenant_id AND metadata->>'openingJournalId'=NEW.reverses_entry_id::text
 ) THEN RAISE EXCEPTION 'Opening journal supports imported history; use a reviewed cutover correction without invalidating original evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_opening_journal_reversal_guard BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION av8_opening_journal_reversal_guard();
