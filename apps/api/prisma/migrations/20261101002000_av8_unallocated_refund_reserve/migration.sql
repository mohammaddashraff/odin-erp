CREATE FUNCTION av8_unallocated_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id bigint; change_amount bigint; f av8_funds; tuition bigint; services bigint; reserved bigint;
BEGIN
 IF TG_TABLE_NAME='av8_allocations' THEN source_id=NEW.fund_id; change_amount=NEW.amount_minor;
 ELSE
  IF NEW.kind<>'service-payment' OR NEW.status<>'RECORDED' OR NEW.data->>'collectionParty'<>'AV8' THEN RETURN NEW; END IF;
  source_id=(NEW.data->>'fundId')::bigint;change_amount=(NEW.data->>'usdMinor')::bigint;
 END IF;
 SELECT * INTO f FROM av8_funds WHERE id=source_id FOR UPDATE;
 IF f.kind<>'RECEIPT' THEN RETURN NEW; END IF;
 SELECT COALESCE(sum(amount_minor),0) INTO tuition FROM av8_allocations WHERE fund_id=f.id;
 SELECT COALESCE(sum((data->>'usdMinor')::bigint),0) INTO services FROM av8_records WHERE tenant_id=f.tenant_id AND application_id=f.application_id AND kind='service-payment' AND status='RECORDED' AND data->>'collectionParty'='AV8' AND data->>'fundId'=f.id::text;
 SELECT COALESCE(sum((entry->>'usdMinor')::bigint),0) INTO reserved FROM av8_funds refund CROSS JOIN LATERAL jsonb_array_elements(COALESCE(refund.metadata->'originalReceiptAllocations','[]'::jsonb)) entry WHERE refund.tenant_id=f.tenant_id AND refund.application_id=f.application_id AND refund.kind='REFUND' AND refund.status IN ('PENDING','APPROVED','CLEARED') AND entry->>'fundId'=f.id::text AND entry->>'chargeId' IS NULL;
 IF tuition+services+reserved+change_amount>f.usd_minor THEN RAISE EXCEPTION 'Receipt credit is already spent or reserved by an unallocated refund'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_unallocated_refund_guard BEFORE INSERT ON av8_allocations FOR EACH ROW EXECUTE FUNCTION av8_unallocated_refund_guard();
CREATE TRIGGER av8_unallocated_refund_guard BEFORE INSERT ON av8_records FOR EACH ROW EXECUTE FUNCTION av8_unallocated_refund_guard();
