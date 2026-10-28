-- Remove approval-lifecycle wording from ordinary payment-plan names. This is
-- configuration metadata only; signed contract snapshots remain immutable.
UPDATE av8_policies
SET data = jsonb_set(
  data,
  '{name}',
  to_jsonb(regexp_replace(data ->> 'name', '\s+[—-]\s+DRAFT\s*$', '', 'i'))
)
WHERE kind = 'PLAN'
  AND key IN ('A','B')
  AND status <> 'APPROVED'
  AND data ->> 'name' ~* '\s+[—-]\s+DRAFT\s*$';

INSERT INTO av8_policies (tenant_id, kind, key, version, status, data)
SELECT
  p.tenant_id,
  p.kind,
  p.key,
  p.version + 1,
  'ACTIVE',
  jsonb_set(
    p.data,
    '{name}',
    to_jsonb(regexp_replace(p.data ->> 'name', '\s+[—-]\s+DRAFT\s*$', '', 'i'))
  )
FROM av8_policies p
WHERE p.kind = 'PLAN'
  AND p.key IN ('A','B')
  AND p.status = 'APPROVED'
  AND p.data ->> 'name' ~* '\s+[—-]\s+DRAFT\s*$'
  AND NOT EXISTS (
    SELECT 1 FROM av8_policies newer
    WHERE newer.tenant_id = p.tenant_id
      AND newer.kind = p.kind
      AND newer.key = p.key
      AND newer.version > p.version
  );
