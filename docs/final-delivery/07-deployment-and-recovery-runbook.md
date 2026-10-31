# Deployment and recovery runbook

Final hosting is the existing Hetzner server at `https://av8.odin-ltd.com`. Use [hetzner-deployment.md](hetzner-deployment.md) for the isolated Compose stack, secure initial owner, provider setup, nginx and update commands. Existing Vercel production was inspected read-only: both existing Vercel projects report READY for the original main commit `828ae27bd17682739d192115ed163781f2388bea`; this delivery is not that deployed version. Current local verification and exact commit evidence are maintained in [05](05-test-results-and-evidence.md) and [11](11-release-notes-and-readiness.md).

## Environments and reproducible checks

Use Node24, PostgreSQL17 and Poppler (`pdftotext`, `pdffonts`, `pdftoppm`, `pdfinfo`). Run `npm ci --ignore-scripts`. Local configuration/secrets live only in ignored `.av8/*.env`, mode0600. Never paste these files or database URLs into issue comments, logs or release artifacts.

For a **new** local installation, set `AV8_PG_BIN` to the absolute PostgreSQL17 binary directory and run `node scripts/av8/init-native.mjs --create`. This provisions separate dev/test clusters, role passwords and resource identity markers. It refuses existing files/data and occupied ports. On this delivery Mac the binary directory is `/opt/homebrew/opt/postgresql@17/bin`; no database on5432 was modified. Resume an existing cluster with `pg_ctl -D .av8/native-test -l .av8/postgres-test.log -w start` or its dev counterpart, using the correct PostgreSQL17 binary. Do not reinitialize it.

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

Then start the compiled services with `node scripts/av8/run.mjs test npm run start`, verify API8181 `/api/health` and frontend8180 `/login`, prepare the explicitly synthetic POS/supplier fixtures shown in CI, and run `node scripts/av8/run.mjs test env AV8_BROWSER_PRODUCTION=1 npm run test:delivery`. Do not run watcher rebuilds during final browser evidence. Stop only the recorded task-owned process before changing environments. The GitHub workflow performs the same gates on a new ephemeral database and uploads synthetic browser/PDF/recovery evidence. A green local run is not proof that hosted CI ran; record its actual URL and commit.

## Hosted release gates

The authoritative host is Hetzner. DNS A and hostname-valid HTTPS are verified; the final vhost deliberately returns503 until release gates pass. All previously enabled nginx site hashes were preserved. Staging uses its own Compose project, database/roles/secrets, attachment data and durable job/monitor state; its web service is available only on loopback18180 through an SSH tunnel. Production uses a separate configuration/project on18181. No additional staging DNS is required. Do not modify the host's other applications, databases, firewall or global nginx configuration.

The earlier Vercel projects remain preserved and are not this release's staging targets. New Vercel staging provisioning is prohibited by the user's deployment correction. Hosted target identity and actual runtime RLS checks fail closed; neither reference/demo seeding nor password-reset shortcuts are permitted on hosted environments.

Before promotion, the release owner must record the exact reviewed commit/tree, all current gate results, business approvals, an encrypted pre-change backup and tested restore, named rollback/support owners, and real opening reconciliation. Validate configuration **privately**: runtime role must be non-superuser/no-BYPASSRLS; admin migration access separate; cookies/HTTPS/origins correct; secrets present with no public prefix; storage/access and scanning policy approved; email sender/provider controlled; production scheduler/worker invocation durable and tested. Remove `AV8_SIMPLE_LOGIN=true` and all demo flags. `ODIN_REQUIRE_PRIVILEGED_MFA=true` and `ODIN_ALLOW_SHARED_DEMO_LOGINS=false` are required; enroll real privileged users and test recovery before deploying the stricter guard. The retired fixed-password reset script cannot be used.

Migrations run as a separate controlled deployment step, never on arbitrary application requests. Stop/freeze posting for the rehearsal's maintenance window. Apply forward migrations, verify identity/checksums and row-level security, deploy the **tested** build to the approved staging target, and repeat health, login/MFA, a synthetic permitted/forbidden request, report/PDF access, queue status and integrity checks. Promote production only after the owner-authorized release gates pass. Record actual staging and production status in the release evidence. Infrastructure preparation and a certificate are not application promotion. No real bank movement is authorized for acceptance; external email tests await the user’s private-key/domain-verification confirmation and remain restricted to the supplied synthetic test destinations.

Nonce script CSP follows [Next.js's documented dynamic-rendering pattern](https://nextjs.org/docs/app/guides/content-security-policy). Personalized HTML is not a public cache artifact. Preserve nonce headers in the hosting path; run rendered tests after any caching/proxy change. CSS inline styles remain allowed for the existing UI; production script `unsafe-inline` and `unsafe-eval` must remain absent.

## Recovery drill and production recovery

`node scripts/av8/run.mjs test node scripts/av8/recovery-drill.mjs` accepts only the isolated local test database. Freeze test writers first. It creates an authenticated AES-256-GCM encrypted snapshot, verifies its decrypted hash, restores into a uniquely named clean database, compares every public-table count/content digest and both private attachment stores' bytes/SHA256, checks posted journals, unscoped runtime RLS, scoped attachment reads and cross-tenant attachment denial, writes `output/recovery/evidence.json`, then drops only its own restored test database. It records elapsed time. The key is transient and destroyed; this drill archive is **not** an operational backup. The drill is same-server logical recovery, not independent-host failover, application restart or a contractual production RTO/RPO test.

Current delivery requires verified local encrypted backup/restore, protected key access and usable recovery instructions. Off-host retention and recovery are owner-deferred and non-blocking. Client-approved retention/RPO/RTO values have not been supplied; do not infer them from local timing. A production restore should first target an isolated replacement database/storage copy, verify migration state and both document stores, run per-company financial reconciliation and app/login/MFA/queue smoke checks, then switch traffic only with incident-owner authorization. Preserve the original database and later transaction evidence until reconciliation is approved.

Application rollback alone does not remove new enum values, change signed snapshots or safely reverse posted transactions. Prefer a forward correction compatible with existing data. For destructive failures, restore the tested pre-change backup only after assessing transactions written since it; replay approved evidence through idempotent supported paths, never directly delete immutable money/audit rows. Hold ambiguous external email outcomes for provider reconciliation; do not blindly resend restored successful dispatches.

CI installs PostgreSQL17 client tools from the signed [official PGDG Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/) and verifies its published key fingerprint. This avoids restoring a PostgreSQL17 dump with an older distribution client. Browser acceptance requires a compiled production build and `AV8_BROWSER_PRODUCTION=1` inside the isolated wrapper.

## Owner-approved deferral

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

This requirement is non-blocking for the current delivery. External provisioning/credential requests are pending until the owner asks to revisit them. Local backup and isolated restore verification remain required. No external disaster recovery or proposed RPO/RTO has been verified; earlier references to off-host recovery as a mandatory current-delivery gate are superseded by this decision.
