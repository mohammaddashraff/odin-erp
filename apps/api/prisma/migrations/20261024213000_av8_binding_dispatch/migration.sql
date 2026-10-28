-- Dispatch per-table checks before evaluating table-specific fields.
CREATE OR REPLACE FUNCTION av8_reference_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb := to_jsonb(NEW); pair record; related_tenant bigint;
BEGIN
 FOR pair IN SELECT * FROM jsonb_each_text('{"branch_id":"branches","owner_id":"users","customer_id":"customers","academy_id":"suppliers","lead_id":"av8_leads","application_id":"av8_applications","created_by_id":"users","approved_by_id":"users","uploaded_by_id":"users","record_id":"av8_records","contract_id":"av8_records","refund_case_id":"av8_records","bank_account_id":"bank_accounts","bank_transaction_id":"bank_transactions","fund_id":"av8_funds","charge_id":"av8_charges","obligation_id":"av8_obligations","reversed_id":"av8_allocations","evidence_id":"av8_attachments"}'::jsonb)
 LOOP
  IF payload->>pair.key IS NOT NULL THEN
   EXECUTE format('SELECT tenant_id FROM %I WHERE id::text = $1', pair.value) INTO related_tenant USING payload->>pair.key;
   IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'AV8 reference is outside tenant scope'; END IF;
  END IF;
 END LOOP;
 IF TG_TABLE_NAME='av8_applications' THEN
 IF NOT EXISTS (SELECT 1 FROM av8_leads WHERE id=NEW.lead_id AND customer_id=NEW.customer_id AND branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Application must preserve its lead/contact/branch'; END IF;
 END IF;
 IF TG_TABLE_NAME='av8_attachments' THEN
 IF NOT EXISTS (SELECT 1 FROM av8_records WHERE id=NEW.record_id AND application_id=NEW.application_id) THEN RAISE EXCEPTION 'Attachment owner mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
