-- Tenant-bound references complement RLS and API branch/assignment checks.
CREATE FUNCTION av8_reference_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb := to_jsonb(NEW); pair record; related_tenant bigint;
BEGIN
 FOR pair IN SELECT * FROM jsonb_each_text('{"branch_id":"branches","owner_id":"users","customer_id":"customers","academy_id":"suppliers","lead_id":"av8_leads","application_id":"av8_applications","created_by_id":"users","approved_by_id":"users","uploaded_by_id":"users","record_id":"av8_records","contract_id":"av8_records","refund_case_id":"av8_records","bank_account_id":"bank_accounts","bank_transaction_id":"bank_transactions","fund_id":"av8_funds","charge_id":"av8_charges","obligation_id":"av8_obligations","reversed_id":"av8_allocations","evidence_id":"av8_attachments"}'::jsonb)
 LOOP
  IF payload->>pair.key IS NOT NULL THEN
   EXECUTE format('SELECT tenant_id FROM %I WHERE id::text = $1', pair.value) INTO related_tenant USING payload->>pair.key;
   IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'AV8 reference is outside tenant scope'; END IF;
  END IF;
 END LOOP;
 IF TG_TABLE_NAME='av8_applications' AND NOT EXISTS (SELECT 1 FROM av8_leads WHERE id=NEW.lead_id AND customer_id=NEW.customer_id AND branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'Application must preserve its lead/contact/branch'; END IF;
 IF TG_TABLE_NAME='av8_attachments' AND NOT EXISTS (SELECT 1 FROM av8_records WHERE id=NEW.record_id AND application_id=NEW.application_id) THEN RAISE EXCEPTION 'Attachment owner mismatch'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['av8_leads','av8_applications','av8_records','av8_policies','av8_charges','av8_funds','av8_obligations','av8_allocations','av8_attachments'] LOOP
 EXECUTE format('CREATE TRIGGER av8_reference_binding BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION av8_reference_binding()',t);
END LOOP; END $$;
CREATE FUNCTION av8_allocation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f av8_funds; c av8_charges; o av8_obligations; a av8_applications; used bigint; original av8_allocations;
BEGIN
 SELECT * INTO f FROM av8_funds WHERE id=NEW.fund_id FOR UPDATE;
 IF f.status <> 'CLEARED' THEN RAISE EXCEPTION 'Only cleared AV8 funds may be allocated'; END IF;
 IF NEW.reversed_id IS NOT NULL THEN
  SELECT * INTO original FROM av8_allocations WHERE id=NEW.reversed_id;
  IF original.fund_id<>NEW.fund_id OR original.charge_id IS DISTINCT FROM NEW.charge_id OR NEW.amount_minor<>-original.amount_minor OR original.amount_minor<=0 THEN RAISE EXCEPTION 'Invalid allocation reversal'; END IF;
 ELSIF f.kind='REFUND' THEN
  IF NEW.amount_minor>=0 THEN RAISE EXCEPTION 'Refund allocation must be negative'; END IF;
 ELSIF NEW.amount_minor<=0 THEN RAISE EXCEPTION 'Positive allocation required'; END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO used FROM av8_allocations WHERE fund_id=NEW.fund_id;
 IF abs(used+NEW.amount_minor)>f.usd_minor OR (f.kind<>'REFUND' AND used+NEW.amount_minor<0) THEN RAISE EXCEPTION 'AV8 fund over-allocation'; END IF;
 IF NEW.charge_id IS NOT NULL THEN
  SELECT * INTO c FROM av8_charges WHERE id=NEW.charge_id FOR UPDATE;
  IF f.kind NOT IN ('RECEIPT','REFUND') OR f.application_id IS DISTINCT FROM c.application_id THEN RAISE EXCEPTION 'Student allocation owner mismatch'; END IF;
  SELECT COALESCE(sum(x.amount_minor),0) INTO used FROM av8_allocations x JOIN av8_funds y ON y.id=x.fund_id WHERE x.charge_id=c.id AND y.status='CLEARED';
  IF used+NEW.amount_minor>c.amount_minor-c.credit_minor OR used+NEW.amount_minor<0 THEN RAISE EXCEPTION 'AV8 charge over-allocation'; END IF;
 ELSE
  SELECT * INTO o FROM av8_obligations WHERE id=NEW.obligation_id FOR UPDATE;
  SELECT * INTO a FROM av8_applications WHERE id=o.application_id;
  IF f.kind<>'REMITTANCE' OR f.academy_id<>a.academy_id OR f.branch_id<>a.branch_id OR (f.application_id IS NOT NULL AND f.application_id<>a.id) THEN RAISE EXCEPTION 'Academy allocation owner mismatch'; END IF;
  SELECT COALESCE(sum(x.amount_minor),0) INTO used FROM av8_allocations x JOIN av8_funds y ON y.id=x.fund_id WHERE x.obligation_id=o.id AND y.status='CLEARED';
  IF used+NEW.amount_minor>o.amount_minor THEN RAISE EXCEPTION 'Academy obligation over-allocation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_allocation_binding BEFORE INSERT ON av8_allocations FOR EACH ROW EXECUTE FUNCTION av8_allocation_binding();
ALTER TABLE av8_funds ADD CHECK (kind IN ('RECEIPT','REMITTANCE','REFUND'));
ALTER TABLE av8_funds ADD CHECK (status IN ('PENDING','APPROVED','CLEARED','REJECTED'));
ALTER TABLE av8_funds ADD CHECK (status<>'CLEARED' OR (cleared_at IS NOT NULL AND bank_transaction_id IS NOT NULL));
ALTER TABLE av8_funds ADD CHECK (kind<>'REFUND' OR refund_case_id IS NOT NULL);
ALTER TABLE av8_policies ADD CHECK (status IN ('DRAFT','APPROVED'));
ALTER TABLE av8_policies ADD CHECK (status<>'APPROVED' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL));
