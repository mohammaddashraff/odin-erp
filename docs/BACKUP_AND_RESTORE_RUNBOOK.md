# Backup and restore runbook

Current status: repository automation and restore evidence are missing. Provider-specific commands and retention must be finalized before production.

## Policy decisions required

- Target RPO/RTO by environment and business tier.
- Point-in-time recovery window, full-backup frequency and retention tiers.
- Encryption keys, regions, legal retention and deletion authority.
- Attachment/object-storage backup consistency with database references.

Recommended starting objective pending approval: production RPO 15 minutes and RTO 4 hours, with daily logical/physical backup, continuous WAL/PITR, 35-day operational retention and monthly immutable copies.

## Backup controls

- Automated, encrypted, cross-failure-domain and access-logged.
- Backup identity is separate from application/migration identities.
- Monitor freshness, size, duration and verification; alert on missed objectives.
- Capture database version, migration table, application SHA and object-store manifest.
- Never place secrets or production dumps in the Git workspace.

## Restore drill

1. Select a recovery point and record expected data-loss window.
2. Restore to an isolated new PostgreSQL 17 instance; never overwrite production during a drill.
3. Apply only documented provider recovery steps and verify checksums.
4. Configure isolated application identities and block external integrations/messages.
5. Verify migration history, tenant RLS, identity/session handling and attachment references.
6. Run exact integrity checks: posted journal balance; global trial balance; negative stock; inventory-to-GL; AR-to-GL; AP-to-GL; cash/bank and POS where available.
7. Run representative quote-to-cash, procure-to-pay and denial smoke tests without contacting customers/suppliers.
8. Measure achieved RPO/RTO and securely destroy the drill environment under retention policy.

## Emergency recovery

Declare an incident, freeze writes, preserve evidence, choose restore/forward-fix under finance/security approval, restore to a new target, reconcile before cutover, rotate compromised credentials if applicable, and document every manual adjustment. Posted records are not repaired by direct editing.
