CREATE UNIQUE INDEX av8_remittance_basis_fund_key ON av8_records(tenant_id,(data->>'fundId')) WHERE kind='remittance-basis';
CREATE TRIGGER av8_remittance_basis_immutable BEFORE UPDATE OR DELETE ON av8_records FOR EACH ROW WHEN(OLD.kind='remittance-basis') EXECUTE FUNCTION av8_immutable();
