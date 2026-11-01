-- Customer-name/phone/email search joins back to tenant-scoped leads. Without
-- this index, fresh bulk data can make a stale-statistics nested loop scan every
-- tenant lead for each matching contact (100M comparisons for 10k contacts).
-- Preserve RLS and the actual search predicate; index the foreign-key lookup.
CREATE INDEX av8_leads_tenant_id_customer_id_idx ON av8_leads (tenant_id, customer_id);
