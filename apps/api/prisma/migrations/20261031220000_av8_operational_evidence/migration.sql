-- Additive evidence protections; existing operational history is preserved.
CREATE FUNCTION av8_operational_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.kind IN ('report-version','eligibility','admission','training','graduation','service','service-charge','service-payment')
     OR (OLD.kind = 'expense' AND OLD.status = 'PAID') THEN
    RAISE EXCEPTION 'AV8 operational evidence is immutable; record a new version or authorized correction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER av8_operational_evidence_immutable
  BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW
  WHEN (OLD.kind IN ('report-version','eligibility','admission','training','graduation','service','service-charge','service-payment','expense'))
  EXECUTE FUNCTION av8_operational_evidence_guard();

CREATE INDEX av8_dispatch_work_idx ON av8_records (tenant_id, status, id)
  WHERE kind = 'academic-dispatch';

-- A single actual supplier payment cannot masquerade as multiple student costs.
CREATE UNIQUE INDEX av8_expense_bank_payment_once
  ON av8_records (tenant_id, (data->>'bankTransactionId'))
  WHERE kind = 'expense' AND status = 'PAID';
