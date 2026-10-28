CREATE FUNCTION av8_approved_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='APPROVED' THEN RAISE EXCEPTION 'Approved amendments are immutable; create another version'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AV8 amendment history cannot be deleted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_amendment_immutable BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN (OLD.kind='amendment') EXECUTE FUNCTION av8_approved_record_guard();
CREATE FUNCTION av8_approved_fund_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status='APPROVED' AND (to_jsonb(NEW)-ARRAY['status','cleared_at','bank_transaction_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','cleared_at','bank_transaction_id']) THEN RAISE EXCEPTION 'Approved cash instructions cannot be changed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER av8_approved_fund_guard BEFORE UPDATE ON av8_funds FOR EACH ROW EXECUTE FUNCTION av8_approved_fund_guard();
