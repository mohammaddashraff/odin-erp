CREATE UNIQUE INDEX av8_service_payment_reversal_unique
 ON av8_records(tenant_id,(data->>'reversalOf'))
 WHERE kind='service-payment' AND data->>'reversalOf' IS NOT NULL;
