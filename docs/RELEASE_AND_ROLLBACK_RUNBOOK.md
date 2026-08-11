# Release and rollback runbook

## Control classification

| Control | Classification | Evidence / remaining boundary |
|---|---|---|
| Side-effect-free application build | Tested | Historical quality run `31256037111` built NestJS and Next.js without applying migrations; current-tranche rerun is pending |
| Explicit schema validation and release migration commands | Implemented | `npm run db:validate` and `npm run release:migrate` are named root commands; the current tranche still requires clean-database execution evidence |
| Migration and restore rehearsal | Tested | Historical PostgreSQL 17 CI restore evidence exists for commit `b534bc2`; it does not verify the current working tree |
| Immutable release tag and artifact promotion | Not implemented | No signed/annotated release tag, artifact digest promotion or production deployment workflow is repository-evidenced |
| Application rollback/forward-fix decision process | Implemented | The policy and stop conditions below are documented; a current release rollback rehearsal is not yet evidenced |
| Production backup, IAM, KMS and PITR gate | Requires external/provider evidence | Provider recovery point, identities, keys, retention and replication must be attached to the release record |

## Production promotion checklist

- [ ] Freeze an immutable candidate commit SHA and record API/web artifact digests.
- [ ] Confirm `npm ci`, `npm run db:generate`, `npm run db:validate`, `npm run lint`,
  `npm run typecheck`, `npm run i18n:audit`, `npm test`, `npm run integrity`,
  `npm run build`, security gates and the required Playwright suites passed on that SHA.
- [ ] Attach exact suite/test counts, skips, durations, reconciliation figures and current visual evidence.
- [ ] Rehearse additive migrations and application compatibility on a production-shaped sanitized copy.
- [ ] Attach provider backup ID, restore-point timestamp, cross-region state, retention/immutability state,
  IAM identities and KMS key evidence. Repository statements are not substitutes for these records.
- [ ] Confirm the DB-backed attachment manifest passed in the logical restore drill. Separately attach
  provider object/scanner recovery evidence if such a provider is deployed; otherwise record that
  provider capability as not implemented rather than treating the database drill as a substitute.
- [ ] Identify release, database, security, finance-control and rollback/forward-fix owners.
- [ ] Promote the same immutable artifacts through staging and production; do not rebuild per environment.
- [ ] Run the post-deploy authorization-denial, company-isolation, health, posting and reconciliation smoke checks.
- [ ] Observe the stabilization window, record incidents/known limitations, then approve or stop the promotion.

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
4. Run `npm run db:validate`, then `npm run release:migrate` as an explicit database step using the migration identity.
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
