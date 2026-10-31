CREATE UNIQUE INDEX av8_supplier_opening_cash_source_unique ON av8_records(tenant_id,(data->>'journalEntryId')) WHERE kind='supplier-opening-settlement';
CREATE TRIGGER av8_supplier_opening_immutable BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN(OLD.kind='supplier-opening-settlement') EXECUTE FUNCTION av8_immutable();
CREATE FUNCTION av8_supplier_opening_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; balance jsonb; previous numeric; previous_base numeric; expected_base numeric; value numeric; j journal_entries; bank bank_accounts; movement bank_transactions;
BEGIN
 IF NEW.kind<>'supplier-opening-settlement' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-opening:'||NEW.tenant_id||':'||(NEW.data->>'sourceSystem')||':'||(NEW.data->>'batchSourceId')||':'||(NEW.data->>'balanceIndex'),0));
 SELECT data INTO source FROM av8_opening_sources WHERE tenant_id=NEW.tenant_id AND kind='BATCH' AND source_system=NEW.data->>'sourceSystem' AND source_id=NEW.data->>'batchSourceId';
 balance:=source->'supplierBalances'->((NEW.data->>'balanceIndex')::integer);
 IF balance IS NULL OR balance->>'supplierId' IS DISTINCT FROM NEW.data->>'supplierId' OR balance->>'currency' IS DISTINCT FROM NEW.data->>'currency' THEN RAISE EXCEPTION 'Supplier settlement must bind its original source balance'; END IF;
 SELECT COALESCE(sum((data->>'amountMinor')::numeric),0) INTO previous FROM av8_records WHERE tenant_id=NEW.tenant_id AND kind='supplier-opening-settlement' AND data->>'sourceSystem'=NEW.data->>'sourceSystem' AND data->>'batchSourceId'=NEW.data->>'batchSourceId' AND data->>'balanceIndex'=NEW.data->>'balanceIndex';
 SELECT COALESCE(sum((data->>'baseMinor')::numeric),0) INTO previous_base FROM av8_records WHERE tenant_id=NEW.tenant_id AND kind='supplier-opening-settlement' AND data->>'sourceSystem'=NEW.data->>'sourceSystem' AND data->>'batchSourceId'=NEW.data->>'batchSourceId' AND data->>'balanceIndex'=NEW.data->>'balanceIndex';
 value:=(NEW.data->>'amountMinor')::numeric;
 IF value=0 OR sign(value)<>sign((balance->>'amountMinor')::numeric) OR abs(previous+value)>abs((balance->>'amountMinor')::numeric) THEN RAISE EXCEPTION 'Supplier opening settlement exceeds original remaining balance'; END IF;
 expected_base:=CASE WHEN abs(previous+value)=abs((balance->>'amountMinor')::numeric) THEN (balance->>'baseMinor')::numeric-previous_base ELSE round((balance->>'baseMinor')::numeric*abs(value)/abs((balance->>'amountMinor')::numeric)) END;
 IF (NEW.data->>'baseMinor')::numeric<>expected_base THEN RAISE EXCEPTION 'Supplier settlement must preserve the exact original book basis'; END IF;
 SELECT * INTO j FROM journal_entries WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->>'journalEntryId')::bigint;
 SELECT * INTO bank FROM bank_accounts WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->>'bankAccountId')::bigint;
 IF j.id IS NULL OR bank.id IS NULL OR j.status<>'POSTED' OR j.branch_id::text IS DISTINCT FROM source->>'branchId' OR bank.currency IS DISTINCT FROM balance->>'currency' OR j.posting_date<=(source->>'cutoverDate')::date OR EXISTS(SELECT 1 FROM journal_entries WHERE tenant_id=NEW.tenant_id AND status='POSTED' AND reverses_entry_id=j.id) THEN RAISE EXCEPTION 'Supplier settlement requires an actual unreversed posted source in its branch/currency after cutover'; END IF;
 IF NEW.data->>'bankTransactionId' IS NOT NULL THEN
  SELECT * INTO movement FROM bank_transactions WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->>'bankTransactionId')::bigint;
  IF movement.id IS NULL OR movement.journal_entry_id<>j.id OR movement.bank_account_id<>bank.id OR movement.counterparty_account_id<>(balance->>'accountId')::bigint OR movement.amount_minor<>abs(value) OR movement.kind::text<>(CASE WHEN value>0 THEN 'PAYMENT' ELSE 'RECEIPT' END) THEN RAISE EXCEPTION 'Supplier settlement differs from the actual bank movement'; END IF;
 ELSIF j.source_type<>'MANUAL' OR j.approved_by_id IS NULL OR j.approved_by_id=j.created_by_id THEN RAISE EXCEPTION 'Manual supplier payment needs independent approval'; END IF;
 IF EXISTS(SELECT 1 FROM av8_funds f JOIN bank_transactions b ON b.id=f.bank_transaction_id WHERE f.tenant_id=NEW.tenant_id AND b.journal_entry_id=j.id) OR EXISTS(SELECT 1 FROM payments WHERE tenant_id=NEW.tenant_id AND journal_entry_id=j.id) THEN RAISE EXCEPTION 'This cash source already settles another financial instruction'; END IF;
 IF (SELECT COALESCE(sum(debit_minor-credit_minor),0) FROM journal_lines WHERE journal_entry_id=j.id AND account_id=(balance->>'accountId')::bigint)<>(NEW.data->>'baseMinor')::numeric THEN RAISE EXCEPTION 'Supplier opening liability basis differs from actual posted control'; END IF;
 IF (SELECT COALESCE(sum(debit_minor-credit_minor),0) FROM journal_lines WHERE journal_entry_id=j.id AND account_id=bank.gl_account_id)<>-(NEW.data->>'baseMinor')::numeric THEN RAISE EXCEPTION 'Supplier settlement cash and original basis require an explicitly reviewed FX policy'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_supplier_opening_settlement_guard BEFORE INSERT ON av8_records FOR EACH ROW EXECUTE FUNCTION av8_supplier_opening_settlement_guard();
CREATE FUNCTION av8_supplier_settlement_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='POSTED' AND NEW.reverses_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM av8_records WHERE tenant_id=NEW.tenant_id AND kind='supplier-opening-settlement' AND data->>'journalEntryId'=NEW.reverses_entry_id::text) THEN RAISE EXCEPTION 'Supplier opening settlement references this payment; use a reviewed linked correction before reversing its actual evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_supplier_settlement_journal_guard BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION av8_supplier_settlement_journal_guard();
