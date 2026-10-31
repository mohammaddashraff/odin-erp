-- Existing signed and posted records remain unchanged.
INSERT INTO av8_policies(tenant_id,kind,key,version,status,data)
SELECT DISTINCT tenant_id,'CHEQUE','COLLECTION',1,'DRAFT','{"rulesVersion":"2026-10-31","creditEvent":null,"fxEvent":null,"travelGate":null}'::jsonb
FROM av8_policies p WHERE NOT EXISTS(SELECT 1 FROM av8_policies q WHERE q.tenant_id=p.tenant_id AND q.kind='CHEQUE' AND q.key='COLLECTION');
CREATE TRIGGER av8_financial_evidence_immutable BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN(OLD.kind IN ('refund-approval','cheque-event','obligation-adjustment','obligation-funding-restored')) EXECUTE FUNCTION av8_immutable();
