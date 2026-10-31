# Deployment and recovery runbook

Delivery status: **technical production rollout verified; live-business activation conditional**. Application release `170b929bd4749e3ae53c7dcb0155e90d617210d9` is healthy at `https://av8.odin-ltd.com`; final CI 428/428 and 21 browser scenarios passed. Separate staging/production databases each have 43 matching migration checksums, scoped maintenance and daily encrypted local backups. Production email/alerts are disabled pending its distinct key. Use [Hetzner operations](hetzner-deployment.md), [exact verification](14-release-verification.md) and [readiness actions](11-release-notes-and-readiness.md). Earlier Vercel deployments remain preserved and are not the delivery target.

## Environments and reproducible checks

Use Node 24, PostgreSQL 17 and Poppler (`pdftotext`, `pdffonts`, `pdftoppm`, `pdfinfo`). Run `npm ci --ignore-scripts`. Local configuration/secrets live only in ignored `.av8/*.env`, mode 0600. Never paste these files or database URLs into issue comments, logs or release artifacts.

For a **new** local installation, set `AV8_PG_BIN` to the absolute PostgreSQL 17 binary directory and run `node scripts/av8/init-native.mjs --create`. This provisions separate dev/test clusters, role passwords and resource identity markers. It refuses existing files/data and occupied ports. On this delivery Mac the binary directory is `/opt/homebrew/opt/postgresql@17/bin`; no database on 5432 was modified. Resume an existing cluster with `pg_ctl -D .av8/native-test -l .av8/postgres-test.log -w start` or its dev counterpart, using the correct PostgreSQL 17 binary. Do not reinitialize it.

Run all environment-dependent commands through `node scripts/av8/run.mjs test COMMAND ...`; the wrapper rejects inherited database/outbound settings and wrong database names/ports/users/markers. Use `dev` only for the separate synthetic preview. The standard test order is:

```sh
node scripts/av8/run.mjs test npm run db:generate
node scripts/av8/run.mjs test npm run db:validate
node scripts/av8/run.mjs test npm run db:migrate
node scripts/av8/run.mjs test npm run db:seed
npm run lint
node scripts/av8/run.mjs test npm run typecheck
npm run i18n:audit
npm run security:audit
npm run security:scan
npm run security:history
node scripts/av8/run.mjs test npm test
node scripts/av8/run.mjs test npm run integrity
node scripts/av8/run.mjs test npm run build
```

Prepare the synthetic POS, supplier, finance, operations and opening fixtures in the same sequence shown in `.github/workflows/quality.yml`. Start the compiled services with `node scripts/av8/run.mjs test npm run start`, verify API 8181 `/api/health` and frontend 8180 `/login`, then run `node scripts/av8/run.mjs test env AV8_BROWSER_PRODUCTION=1 npm run test:delivery`. Do not run watcher rebuilds during final browser evidence. Stop only the recorded task-owned process before changing environments. The GitHub workflow performs the same gates on a new ephemeral database and uploads synthetic browser/PDF/recovery evidence. [Final run 41235646385](https://github.com/mohammaddashraff/odin-erp/actions/runs/41235646385) passed on application commit `170b929bd4749e3ae53c7dcb0155e90d617210d9`: 428 backend tests, 21 browser scenarios and all other gates. Earlier checkpoint success and the corrected integration-timeout failure remain in the ledger; they are not the final release evidence.

## Hosted release gates

The authoritative host is Hetzner. DNS A, trusted HTTPS, HTTP redirect and the public application are verified. All previously enabled nginx site hashes were preserved. Staging uses its own Compose project, database/roles/secrets, attachment data and durable job/monitor state; its web service is available only on loopback port 18180 through an SSH tunnel. Production uses its separate configuration/project on loopback port 18181 behind the dedicated HTTPS vhost. Its protected provider file awaits a distinct production key. No additional staging DNS is required. Preserve other applications, databases, firewall and global nginx configuration.

Actual final state: both environments run commit 170b929; production HTTPS/browser/API/MFA onboarding and 43 migration checksums passed. Staging delivered both authorized reports once and real DOWN/RECOVERED alerts; final API key loading and restart persistence are verified. Both maintenance/health and daily 03:15 UTC backup timers are active with successful first invocations. Production academic sends/email alerts remain disabled until the separate private provider key is confirmed; client business/privacy policies and real-data cutover remain explicit activation tasks. See the final evidence and readiness report. Earlier checkpoint/failure entries are preserved in the ledger.

The earlier Vercel projects remain preserved and are not this release's staging targets. New Vercel staging provisioning is prohibited by the user's deployment correction. Hosted target identity and actual runtime RLS checks fail closed; neither reference/demo seeding nor password-reset shortcuts are permitted on hosted environments.

Before promotion, the release owner must record the exact reviewed commit/tree, final local/CI/browser results, business approvals, an encrypted pre-change backup and tested restore, named rollback/support owners, and real opening reconciliation. Validate configuration **privately**: tenant business traffic uses the distinct non-superuser, no-BYPASSRLS, no-createdb/no-createrole runtime identity with effective RLS. The inherited authentication/bootstrap/migration admin pool is a separate non-superuser owner with explicit BYPASSRLS; the API process carries that credential, and runtime must never inherit its role. Cookies/HTTPS/origins, private secrets, approved storage/access/scanning policy, controlled sender and durable scheduler invocation must be verified for the final deployment. Hosted simple/demo login is prohibited; `ODIN_REQUIRE_PRIVILEGED_MFA=true` and `ODIN_ALLOW_SHARED_DEMO_LOGINS=false` remain required. Complete privileged users' real MFA enrollment and recovery setup through the secure flow. The retired fixed-password reset script cannot be used.

Migrations run as a separate controlled deployment step, never on arbitrary application requests. Stop/freeze posting for the rehearsal's maintenance window. Apply forward migrations, verify identity/checksums and row-level security, deploy the **tested** build to the approved staging target, and repeat health, login/MFA, a synthetic permitted/forbidden request, report/PDF access, queue status and integrity checks. Promote production only after the owner-authorized release gates pass. Record actual staging and production status in the release evidence. Infrastructure preparation and a certificate are not application promotion. No real bank movement is authorized for acceptance. The user's provider/domain confirmation has been received and controlled email acceptance has run; any further acceptance remains restricted to the already authorized test destinations. Successful restored dispatches must not be resent merely to repeat a test.

Nonce script CSP follows [Next.js's documented dynamic-rendering pattern](https://nextjs.org/docs/app/guides/content-security-policy). Personalized HTML is not a public cache artifact. Preserve nonce headers in the hosting path; run rendered tests after any caching/proxy change. CSS inline styles remain allowed for the existing UI; production script `unsafe-inline` and `unsafe-eval` must remain absent.

## Recovery drill and production recovery

`node scripts/av8/run.mjs test node scripts/av8/recovery-drill.mjs` accepts only the isolated local test database. Freeze test writers first. It creates an authenticated AES-256-GCM encrypted snapshot, verifies its decrypted hash, restores into a uniquely named clean database, compares every public-table count/content digest and both private attachment stores' bytes/SHA256, checks posted journals, unscoped runtime RLS, scoped attachment reads and cross-tenant attachment denial, writes `output/recovery/evidence.json`, then drops only its own restored test database. It records elapsed time. The key is transient and destroyed; this drill archive is **not** an operational backup. The drill is same-server logical recovery, not independent-host failover, application restart or a contractual production RTO/RPO test.

The separate [Hetzner local restore drill](hetzner-local-restore-drill.md) retains the actual staging operational archive and existing private backup key. It restores a uniquely named staging recovery database, compares table/sequence/document state and journals, then starts an isolated temporary API with no provider credentials, sends, jobs or published ports to verify actual password/MFA login and document access. Authentication changes affect only the restored copy. The first actual run preserved its backup/source but failed on the existing empty public schema; the narrow generated-target-only fix uses no CASCADE, and 10/10 guard/encryption tests pass. The actual rerun **passed on the final image in 15.535 seconds**: 43 migrations, 71 tables, 57 sequences, 588 rows and one 1,487-byte PDF matched; no unbalanced journals; API restart/health, password/MFA, scoped HTTP document download, unauthenticated and wrong-tenant denial passed. Source was unchanged, temporary database/container removed, and the retained encrypted archive plus original key retained. [Actual recovery evidence](evidence/hosted-local-recovery.json) identifies final API image `sha256:f451d7fc74979cfe70efbca41fe1dee0509e39404bd63ff92942b5f2600f507d` at commit 170b929bd4749e3ae53c7dcb0155e90d617210d9. The helper rejects production as a source and does not replace the separately reviewed production recovery procedure.

Current delivery requires verified local encrypted backup/restore, protected key access and usable recovery instructions. Off-host retention and recovery are owner-deferred and non-blocking. Client-approved retention/RPO/RTO values have not been supplied; do not infer them from local timing. A production restore should first target an isolated replacement database/storage copy, verify migration state and both document stores, run per-company financial reconciliation and app/login/MFA/queue smoke checks, then switch traffic only with incident-owner authorization. Preserve the original database and later transaction evidence until reconciliation is approved.

Application rollback alone does not remove new enum values, change signed snapshots or safely reverse posted transactions. Prefer a forward correction compatible with existing data. For destructive failures, restore the tested pre-change backup only after assessing transactions written since it; replay approved evidence through idempotent supported paths, never directly delete immutable money/audit rows. Hold ambiguous external email outcomes for provider reconciliation; do not blindly resend restored successful dispatches.

CI installs PostgreSQL 17 client tools from the signed [official PGDG Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/) and verifies its published key fingerprint. This avoids restoring a PostgreSQL 17 dump with an older distribution client. Browser acceptance requires a compiled production build and `AV8_BROWSER_PRODUCTION=1` inside the isolated wrapper.

## Owner-approved deferral

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

This requirement is non-blocking for the current delivery. External provisioning/credential requests are pending until the owner asks to revisit them. Local backup and isolated restore verification remain required. No external disaster recovery or proposed RPO/RTO has been verified; earlier references to off-host recovery as a mandatory current-delivery gate are superseded by this decision.
