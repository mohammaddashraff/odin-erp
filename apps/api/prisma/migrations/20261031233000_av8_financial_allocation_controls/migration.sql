-- Forward-only guards: tuition and monthly services share the same actual receipt.
CREATE FUNCTION av8_combined_funding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f av8_funds; tuition bigint; services bigint; adjusted bigint; transferred bigint;
BEGIN
 SELECT * INTO f FROM av8_funds WHERE id=NEW.fund_id FOR UPDATE;
 IF f.kind='RECEIPT' THEN
  SELECT COALESCE(sum(amount_minor),0) INTO tuition FROM av8_allocations WHERE fund_id=f.id;
  SELECT COALESCE(sum((data->>'usdMinor')::bigint),0) INTO services FROM av8_records
   WHERE tenant_id=f.tenant_id AND application_id=f.application_id AND kind='service-payment' AND status='RECORDED'
    AND data->>'collectionParty'='AV8' AND data->>'fundId'=f.id::text;
  IF tuition+services+NEW.amount_minor>f.usd_minor THEN RAISE EXCEPTION 'Receipt tuition and monthly services exceed cleared principal'; END IF;
  IF NEW.amount_minor>0 AND EXISTS(SELECT 1 FROM av8_records WHERE tenant_id=f.tenant_id AND application_id=f.application_id AND kind='cheque' AND status='RETURNED' AND data->>'fundId'=f.id::text) THEN RAISE EXCEPTION 'Returned cheque has no available principal'; END IF;
 ELSIF f.kind='REMITTANCE' THEN
  SELECT amount_minor INTO adjusted FROM av8_obligations WHERE id=NEW.obligation_id FOR UPDATE;
  SELECT adjusted+COALESCE(sum((data->>'amountMinor')::bigint),0) INTO adjusted FROM av8_records
   WHERE tenant_id=f.tenant_id AND kind='obligation-adjustment' AND status='APPROVED' AND data->>'obligationId'=NEW.obligation_id::text;
  SELECT COALESCE(sum(a.amount_minor),0) INTO transferred FROM av8_allocations a JOIN av8_funds x ON x.id=a.fund_id WHERE a.obligation_id=NEW.obligation_id AND x.status='CLEARED';
  IF transferred+NEW.amount_minor>adjusted THEN RAISE EXCEPTION 'Remittance exceeds adjusted academy obligation'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_combined_funding_guard BEFORE INSERT ON av8_allocations FOR EACH ROW EXECUTE FUNCTION av8_combined_funding_guard();
CREATE FUNCTION av8_service_funding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f av8_funds; original av8_records; tuition bigint; services bigint; credit bigint;
BEGIN
 IF NEW.kind<>'service-payment' OR NEW.status<>'RECORDED' THEN RETURN NEW; END IF;
 IF (NEW.data->>'amountMinor')::bigint<0 THEN
  SELECT * INTO original FROM av8_records WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->>'reversalOf')::bigint AND kind='service-payment' AND status='RECORDED' FOR UPDATE;
  IF original.id IS NULL OR original.application_id<>NEW.application_id OR (original.data->>'amountMinor')::bigint<=0 OR NEW.data->>'chargeId' IS DISTINCT FROM original.data->>'chargeId' OR NEW.data->>'collectionParty' IS DISTINCT FROM original.data->>'collectionParty' OR NEW.data->>'fundId' IS DISTINCT FROM original.data->>'fundId' OR NEW.data->>'currency' IS DISTINCT FROM original.data->>'currency' OR (NEW.data->>'amountMinor')::bigint<>-(original.data->>'amountMinor')::bigint OR (NEW.data->>'usdMinor')::bigint IS DISTINCT FROM -(original.data->>'usdMinor')::bigint THEN RAISE EXCEPTION 'Service reversal must exactly reverse its original payment'; END IF;
  IF EXISTS(SELECT 1 FROM av8_records WHERE tenant_id=NEW.tenant_id AND kind='service-payment' AND data->>'reversalOf'=original.id::text) THEN RAISE EXCEPTION 'Service payment already reversed'; END IF;
 ELSIF COALESCE((NEW.data->>'amountMinor')::bigint,0)=0 OR NEW.data->>'reversalOf' IS NOT NULL THEN RAISE EXCEPTION 'Service payment must be positive'; END IF;
 IF NEW.data->>'collectionParty'='PROVIDER' THEN
  IF NEW.data->>'fundId' IS NOT NULL OR NEW.data->>'usdMinor' IS NOT NULL THEN RAISE EXCEPTION 'Provider payment cannot consume AV8 cash'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.data->>'collectionParty' IS DISTINCT FROM 'AV8' THEN RAISE EXCEPTION 'Service payment recipient must be explicit'; END IF;
 SELECT * INTO f FROM av8_funds WHERE tenant_id=NEW.tenant_id AND id=(NEW.data->>'fundId')::bigint FOR UPDATE;
 IF f.id IS NULL OR f.kind<>'RECEIPT' OR f.status<>'CLEARED' OR f.application_id<>NEW.application_id OR f.currency<>NEW.data->>'currency' THEN RAISE EXCEPTION 'Service funding must use this student cleared receipt currency'; END IF;
 credit=(NEW.data->>'usdMinor')::bigint;
 IF credit IS NULL THEN RAISE EXCEPTION 'Service receipt USD credit is required'; END IF;
 IF credit>0 AND EXISTS(SELECT 1 FROM av8_records WHERE tenant_id=f.tenant_id AND application_id=f.application_id AND kind='cheque' AND status='RETURNED' AND data->>'fundId'=f.id::text) THEN RAISE EXCEPTION 'Returned cheque cannot fund services'; END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO tuition FROM av8_allocations WHERE fund_id=f.id;
 SELECT COALESCE(sum((data->>'usdMinor')::bigint),0) INTO services FROM av8_records WHERE tenant_id=f.tenant_id AND application_id=f.application_id AND kind='service-payment' AND status='RECORDED' AND data->>'collectionParty'='AV8' AND data->>'fundId'=f.id::text;
 IF tuition+services+credit>f.usd_minor OR services+credit<0 THEN RAISE EXCEPTION 'Monthly service allocation exceeds available receipt principal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_service_funding_guard BEFORE INSERT ON av8_records FOR EACH ROW EXECUTE FUNCTION av8_service_funding_guard();
CREATE TRIGGER av8_receipt_signature_immutable BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN(OLD.kind='receipt-signature' OR OLD.kind='allocation-correction' AND OLD.status IN ('APPROVED','REJECTED')) EXECUTE FUNCTION av8_immutable();
