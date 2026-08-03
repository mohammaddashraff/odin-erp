# Release and rollback runbook

## Preconditions

- Approved change and reviewed migration/ADR.
- Clean protected branch, CI green on Node 24/PostgreSQL 17, immutable commit SHA.
- Staging rehearsal completed on production-shaped sanitized data.
- Verified backup and restore point created; no demo seed command in the release plan.
- Feature flags and forward-fix/rollback owner identified.

## Release sequence

1. Record commit SHA, image/artifact digest, migration list and current application/database versions.
2. Put risky background consumers in controlled drain mode.
3. Create and verify the pre-release backup according to `BACKUP_AND_RESTORE_RUNBOOK.md`.
4. Run migration validation, then `prisma migrate deploy` as an explicit database step using the migration identity.
5. Run schema/constraint/RLS smoke checks and backward-compatibility probes.
6. Deploy API and web artifacts built from the same SHA. Do not rebuild differently per environment.
7. Run health, authentication, permission denial, read/write, posting and reconciliation smoke checks.
8. Observe errors, latency, connections, locks, queues and reconciliation exceptions through the stabilization window.
9. Tag the release only after evidence is attached. At the 2026-08-03 baseline, no Git release tags exist.

## Stop conditions

Stop or forward-fix immediately for authentication bypass, tenant/company leakage, unbalanced journal, stock/GL difference, failed migration, sustained 5xx/latency regression, duplicate posting, unavailable restore point or unexpected destructive plan.

## Rollback policy

Application rollback is allowed only while the previous binary is schema-compatible. Applied destructive migrations are not blindly reversed. Prefer a tested forward fix. If data restoration is required, declare an incident, stop writes, preserve forensic evidence, restore to a new database, validate RPO/reconciliations, then switch traffic under approval.

## Post-release record

Record SHA/tag, migrations, feature flags, exact test/smoke results, reconciliations, monitoring window, incidents, known limitations and the named rollback/forward-fix decision.
