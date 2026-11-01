-- Actual academy fees and their separate reimbursable advance are opt-in accounting decisions.
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='av8_funds'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%ACADEMY_RECOVERY%'
 LOOP EXECUTE format('ALTER TABLE av8_funds DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_kind_allowed CHECK (kind IN ('RECEIPT','REMITTANCE','REFUND','ACADEMY_RECOVERY','FEE_REIMBURSEMENT'));
INSERT INTO av8_policies(tenant_id,kind,key,version,status,data)
SELECT DISTINCT tenant_id,'BANK_FEE','REMITTANCE',1,'DRAFT','{"rulesVersion":"2026-10-31","treatment":null,"expenseAccountCode":null,"receivableAccountCode":null,"reimbursementOffsetAccountCode":null,"fxDifferenceAccountCode":null}'::jsonb
FROM av8_policies p WHERE NOT EXISTS(SELECT 1 FROM av8_policies q WHERE q.tenant_id=p.tenant_id AND q.kind='BANK_FEE' AND q.key='REMITTANCE');
CREATE FUNCTION av8_bank_fee_immutable_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.kind<>OLD.kind OR NEW.application_id IS DISTINCT FROM OLD.application_id OR NEW.tenant_id<>OLD.tenant_id OR (NEW.data-ARRAY['cashReimbursedUsdMinor','remainingUsdMinor','lastReimbursementId']) IS DISTINCT FROM (OLD.data-ARRAY['cashReimbursedUsdMinor','remainingUsdMinor','lastReimbursementId']) THEN RAISE EXCEPTION 'Bank fee source and approved accounting snapshot are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_bank_fee_immutable_source BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN(OLD.kind='bank-fee') EXECUTE FUNCTION av8_bank_fee_immutable_source();
