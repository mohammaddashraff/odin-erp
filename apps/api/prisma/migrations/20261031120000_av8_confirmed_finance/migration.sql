-- Additive delivery migration. Existing signed contracts, posted funds and obligations are unchanged.
ALTER TABLE av8_obligations ADD COLUMN due_date date;
DROP INDEX av8_funds_refund_case_id_key;
CREATE INDEX av8_funds_tenant_id_refund_case_id_idx ON av8_funds(tenant_id,refund_case_id);
ALTER TABLE av8_funds DROP CONSTRAINT av8_funds_kind_check;
ALTER TABLE av8_funds ADD CONSTRAINT av8_funds_kind_check CHECK(kind IN ('RECEIPT','REMITTANCE','REFUND','ACADEMY_RECOVERY'));

-- New policy versions only. Unconfirmed dates/conversion/termination choices remain draft.
WITH definitions(kind,key,status,data) AS (VALUES
 ('PLAN','A','DRAFT','{"name":"Installment A","rulesVersion":"2026-10-31","interpretation":"EACH","anchor":"CONTRACT","offsetMonths":null,"frequencyMonths":3,"firstMilestone":"CONTRACT","inclusions":["Study materials","Aviation headset","Theoretical study","Described training package"]}'::jsonb),
 ('PLAN','B','DRAFT','{"name":"Installment B","rulesVersion":"2026-10-31","interpretation":"EACH","anchor":"CONTRACT","offsetMonths":null,"frequencyMonths":3,"firstMilestone":"CONTRACT","inclusions":["Study materials","Aviation headset","Theoretical study","Described training package"]}'::jsonb),
 ('PLAN','CASH','DRAFT','{"name":"Pay in full","rulesVersion":"2026-10-31","collectionMilestone":null,"collectionDate":null,"inclusions":["Study materials","Aviation headset","Theoretical study","Described training package"]}'::jsonb),
 ('SETTLEMENT','CASH','ACTIVE','{"rulesVersion":"2026-10-31","totalAcademyMinor":"5400000","commissionMinor":null,"dueOffsetMonths":3,"anchor":"CONTRACT"}'::jsonb),
 ('REFUND','TERMINATION','DRAFT','{"rulesVersion":"2026-10-31","formula":"CONFIRMED_PAID_MINUS_ELIGIBLE_ACTUAL_EXPENSES","deadlineDays":45,"refundConversion":null,"unpaidObligations":null,"legacyConflictTreatment":null}'::jsonb)
)
INSERT INTO av8_policies(tenant_id,kind,key,version,status,data)
SELECT tenant_id,d.kind,d.key,COALESCE((SELECT max(p.version) FROM av8_policies p WHERE p.tenant_id=t.tenant_id AND p.kind=d.kind AND p.key=d.key),0)+1,d.status,d.data
FROM (SELECT DISTINCT tenant_id FROM av8_policies) t CROSS JOIN definitions d;
