# Hetzner deployment and operations

The exact application release `170b929bd4749e3ae53c7dcb0155e90d617210d9` is deployed to isolated staging and production at `https://av8.odin-ltd.com`. DNS, trusted TLS, both 43-migration sets, exact image IDs, real scheduling/backups and browser checks passed. [Release verification](14-release-verification.md) records actual evidence; [readiness](11-release-notes-and-readiness.md) records outstanding live-business activation actions. The commands below are operating procedures, not a request to recreate existing environments. Existing host applications, the existing test database container, `/srv/av8-academy`, shared nginx, firewall and other volumes must remain intact.

## Layout and isolation

Use a reviewed checkout under `/srv/av8-erp-final/releases/<commit>`, separate private configurations under `/srv/av8-erp-final/staging/private` and `/srv/av8-erp-final/production/private`, and separate backups outside those private directories. Compose projects are `av8-delivery-staging` and `av8-delivery-prod`. Each has its own database and monitor volumes, database name/owner, runtime password, signing/MFA/scheduler secrets, environment marker and application network. No database or API host port is published. Web ports bind only to loopback: staging 18180 and production 18181, subject to the actual host port check.

The source uses Node 24, PostgreSQL 17 Alpine, and a standalone Next server. Build, API runtime, web runtime and maintenance are separate targets. App processes run as UID 1000 with dropped capabilities, no-new-privileges, resource limits and bounded logs. The pinned PostgreSQL Alpine image uses UID 70; generated database secret files are owned by that UID. App config files belong to UID 1000, remain mode 0600 and sit inside a root-only directory. Verify the cached image's UID/digest before use and retain the actual image digests with release evidence. Root/host administrators can access Docker secrets; this is not a defense against a compromised host administrator.

The separate admin/migration owner is NOSUPERUSER/NOCREATEDB with BYPASSRLS because the inherited authentication/bootstrap pool must find users before tenant context is known. This credential is a privileged application trust boundary, not a least-privilege authentication claim. Tenant business transactions use the distinct av8_runtime role, which has no BYPASSRLS/superuser/role-creation/database-creation rights and no membership in the owner role; startup checks effective RLS. Financial immutability triggers still apply to the owner. The database network is private and internal. `AV8_DB_TRANSPORT=PRIVATE_CONTAINER_NETWORK` is limited to `av8-postgres`; startup verifies both actual connection addresses, marker, database/roles and runtime RLS. External database use requires the separate TLS contract. The host has limited disk space: build sequentially and monitor it. Do not prune unrelated images, volumes or builder caches.

## Prepare and validate

From the reviewed checkout, generate new private state once. Existing directories are refused, so a retry cannot replace credentials.

```sh
node deploy/hetzner/generate-config.mjs --mode staging --directory /srv/av8-erp-final/staging/private --image-tag REVIEWED_COMMIT
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml config --quiet
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml build maintenance api web
```

The build creates no database and includes no runtime secret. Its hosted web configuration has no localhost API rewrite; every API proxy request selects the private runtime API origin. Staging and production can use the same reviewed image with their distinct runtime configurations. Set the actual cached PostgreSQL digest in private `compose.env` as `AV8_POSTGRES_IMAGE` before rollout. Capture image IDs and commit after build. The legacy repository Dockerfile/demo compose and Vercel scripts are not this target's deployment commands.

```sh
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml up -d av8-postgres
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml run --rm maintenance migrate
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml up -d api web
```

Wait for actual health and inspect redacted logs. Never run inherited demo bootstrap/seed. The database init script runs only in the new project volume, creates independent roles and the immutable identity marker, and does not contact a host database. A conflicting pre-existing volume/marker fails startup instead of being erased.

## Initial named owner

The empty-installation bootstrap requires these explicit fields in private `api.json`: `AV8_INITIAL_SETUP=EMPTY_DATABASE_ONLY`, `AV8_INITIAL_ADMIN_EMAIL`, `AV8_INITIAL_ADMIN_NAME`, `AV8_INITIAL_COMPANY_NAME`, `AV8_INITIAL_BRANCH_NAME`, and `AV8_INITIAL_BRANCH_CODE`. Select the real owner; an authorized test email is not automatically an administrator. It refuses any existing tenant/user. It creates one named administrator, mandatory MFA and password change, a company/branch, EGP/USD currency references, and draft policies. It creates no clients, academy partners, financial accounts, calendar assumptions, balances or transactions. The maker-checker threshold starts at zero until configured through administration.

```sh
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml run --rm maintenance bootstrap
```

The generated high-entropy password is written only to `private/bootstrap/initial-owner.json`, never stdout. It expires after24 hours. Deliver it through the approved private channel. Complete MFA enrollment, save recovery codes privately, change the password, and configure named staff/resource access, fiscal periods, actual financial resources and reviewed policy activations. Remove bootstrap configuration fields after setup. A later access problem uses authenticated recovery; rerunning bootstrap cannot reset an owner.

## Reverse proxy and certificate

The server's shared nginx already owns80/443. `deploy/hetzner/nginx.conf.example` is a separate vhost template, not a replacement for the main configuration. First install only the new HTTP ACME webroot location; obtain the domain's actual certificate using the existing certbot installation and reviewed webroot. Then install the HTTPS block pointing to127.0.0.1:18181. Run `nginx -t` before a graceful reload. Do not enable a certificate path that does not exist or restart other applications. Verify hostname/certificate chain, HTTPS redirect, security headers, login/MFA, private files and both languages at the actual final domain. Staging loopback is operator-only; use an SSH tunnel or a separately approved protected staging hostname.

## Academic jobs and alert delivery

Private provider configuration must supply the verified sender and API key; approved recipient addresses belong only in private configuration. Configure the exact stage test allowlist. Academic delivery and operational alerts are independently disabled by default. Enable only the intended named worker identities, provider settings and scheduler after the existing operations runbook prerequisites pass.

Staging defaults to the prepared provider file `/srv/av8-erp-final/private/resend.env`, selected by `AV8_PROVIDER_CONFIG_FILE` in private `compose.env`. Production defaults to its own empty `private/provider.env`; the generator rejects reuse of the staging file and never copies its credential. It is mounted read-only only into API, maintenance and monitor, never web or PostgreSQL. The loader accepts only `AV8_ACADEMIC_EMAIL_API_KEY`, `AV8_ACADEMIC_EMAIL_FROM` and optional `AV8_ACADEMIC_EMAIL_REPLY_TO`; it rejects duplicate/unknown fields, interpolation and malformed content without printing values. Empty fields do not overwrite existing values or enable delivery. If the shared file is absent during new configuration generation, an empty private fallback is created. For an existing configuration, update this one path without regenerating passwords or other credentials. Recreate the affected services after a provider-file change; secret configuration alone does not change the explicit email/worker/alert enablement switches. The sender may be a single plain address or a safe display-name mailbox such as `Example Flight Academy <sender@example.invalid>`. Reply-To must be one plain address. Control characters, newlines and multiple recipients are rejected before sending. Populate the production provider file separately through the approved private channel; recipients, job flags, database and monitor state remain independent.

The user has explicitly required waiting until they confirm both that the private key is configured and that the sender domain is verified before any actual email test. File existence, metadata/readability checks, sender details or an earlier recipient authorization do not satisfy that confirmation. All source tests use mocked transport, and email/alert switches remain disabled during this hold.

`AV8_ALERT_EMAIL_ENABLED=true` and `AV8_ALERT_EMAIL_TO` select the authorized operational alert recipient. Alerts reuse the configured Resend sender/key and enforce the staging allowlist. Their fixed text contains no student or financial payload. A durable monitor volume records one send intent per outage and recovery. Ambiguous sends remain unknown; they are never automatically replayed. At most one controlled test is sent for a retained stable test ID. Provider acceptance is not proof of delivered/read status; retain redacted provider delivery evidence.

```sh
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml run --rm monitor monitor --test-id CONTROLLED_TEST_ID
docker compose --env-file /srv/av8-erp-final/staging/private/compose.env -f deploy/hetzner/compose.yaml run --rm monitor
```

The ordinary monitor invocation checks private API health and, when enabled, calls the authenticated bounded scheduler. Run it from an environment-specific host cron/systemd timer after the controlled test. Use the absolute reviewed checkout and private `compose.env` path; do not place secrets in cron arguments. Separate project/volume paths keep staging job state from production. Subscribe stderr/failing exit status to the host's existing operator route as well; a service unable to reach its email provider cannot certify that an email alert arrived. Do not use a blind resend for a `SENDING`/unknown alert; reconcile its provider dedup identity or create an explicitly reviewed new test identity.

## Dedicated host scheduler

After the matching private configuration and scoped worker checks pass, point `/srv/av8-erp-final/current-staging` at the reviewed release and install only `deploy/hetzner/systemd/av8-scheduler@.{service,timer}` into `/etc/systemd/system`. Verify with `systemd-analyze verify`, then `systemctl daemon-reload` and `systemctl enable --now av8-scheduler@staging.timer`. Production uses its own `current-production` link/private directory and is enabled separately only when its worker/alert setup is ready. No existing timer/cron is replaced. These are health/job polling intervals, not a business grace period or backup RPO.

The unit invokes the existing monitor container as UID 1000 with a private secret mount, durable per-project monitor volume and an independently authenticated bounded scheduler call. The host unit needs Docker access; its command contains no credential values. Overlapping systemd runs do not start another copy; persistent scheduler claims and monitor intent records also protect restart/retry. Check `systemctl status av8-scheduler@staging.timer` and `journalctl -u av8-scheduler@staging.service`; verify successful invocation after API restart and that delivered recipients remain at one send attempt. Pause only this timer when quiescing staging for an exact backup manifest/restore drill, then resume it. Use the stable current-environment path for subsequent Compose commands so release paths do not unnecessarily change the PostgreSQL init-script bind.

## Backup, recovery and update

Attachments live in PostgreSQL and are included in the application-schema dump. The backup helper streams directly into AES-256-GCM encryption and writes a plaintext-hash manifest; the key stays in private configuration. Copy encrypted archives off-host and store the key separately through the approved secret channel. The monitor volume and private configuration require their own protected backup. No off-host destination or production RPO/RTO is certified until exercised.

```sh
node deploy/hetzner/backup.mjs /srv/av8-erp-final/staging/private /srv/av8-erp-final/backups/staging
node deploy/hetzner/decrypt-backup.mjs ARCHIVE.dump.enc /PRIVATE/backup-key /PRIVATE/new-restore.dump
```

Decryption authenticates the archive and hash but does not restore a database. Rehearse restoration into a separate empty isolated recovery project/database, preserving the target identity marker outside the dump's public schema. Prepare the original policy group/runtime roles and explicitly map the original owner/default privileges to the recovery owner when names differ. Restore with `pg_restore --exit-on-error`; verify migration state, exact row/document hashes, balanced posted journals, source integrity, runtime RLS, scoped document access, application restart and a real login. Never restore over the live source or run `down -v` as a release step. Archive retention, actual restore timings and responsible owner require recorded operational approval.

The prepared staging-only helper and exact acceptance/cleanup procedure are in [the local restore drill](hetzner-local-restore-drill.md). It retains the operational encrypted backup/key, restores to a unique database in the dedicated staging PostgreSQL container, starts an isolated API with sends/jobs disabled, and verifies actual password/MFA login plus document access. Guard/SQL preparation tests are not a substitute for the release owner's recorded server execution.

For an update, back up and verify source identity first, build/tag the tested commit, run forward migrations using maintenance, and recreate only this project's API/web services. Migration rollback is not a guessed down migration: use the tested prior application image only if schema-compatible, or restore the reviewed pre-change backup into an isolated target and reconcile any later entry. Preserve original evidence and report deployment/migration state honestly.

Docker's documented [project network isolation](https://docs.docker.com/compose/how-tos/networking/), [per-service secret mounts](https://docs.docker.com/compose/how-tos/use-secrets/) and [service limits/health checks](https://docs.docker.com/reference/compose-file/services/) inform this package. Container build/start and the actual host proxy remain separate acceptance evidence from source/configuration tests.

## Owner-approved deferral

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

This requirement is non-blocking for the current delivery. External provisioning/credential requests are pending until the owner asks to revisit them. Local backup and isolated restore verification remain required. No external disaster recovery or proposed RPO/RTO has been verified; earlier references to off-host recovery as a mandatory current-delivery gate are superseded by this decision.

## Empty-installation database verification

`av8-first-owner.database.spec.ts` exercises actual PostgreSQL FORCE RLS and triggers on a disposable schema-only clone. It reproduces the NOBYPASS owner failure, verifies the privileged admin-pool fix without granting runtime bypass, checks required password change/MFA/company membership/DRAFT reference policies/no financial sample data, and refuses a second bootstrap. The focused run passed 3/3; see `evidence/first-owner-database-tests.txt`. This local regression complements the separately recorded hosted startup and first-owner evidence.

## Final-domain read-only smoke

After the production route is promoted, the release operator runs `AV8_PRODUCTION_SMOKE_ORIGIN=https://av8.odin-ltd.com AV8_PRODUCTION_ROUTE_PROMOTED=true node scripts/av8/production-browser-smoke.mjs`. The script keeps browser certificate validation enabled, permits same-origin GET/HEAD plus an empty automatic anonymous `/api/auth/refresh` POST (no credentials forwarded; actual401/no-store required), submits no form or credential, and checks English/Arabic desktop/mobile login interactions, overflow/page errors, API health, anonymous and forged-header authentication denial, no-store responses and actual per-document CSP nonce enforcement. Artifacts are written to `output/playwright/production-smoke/`. Spoofed-header denial does not claim server-side client-IP or rate-limit attribution verification. The script was syntax/lint checked before promotion; runtime evidence is recorded separately by the release operator.

## Independent local backup schedule

`deploy/hetzner/systemd/av8-backup@.service` and `.timer` provide separate staging and production schedules. The routine technical default is **daily at03:15UTC**, with one catch-up execution after downtime (`Persistent=true`). This is a scheduling default, not a promised recovery point or business retention rule. The root oneshot service uses `/usr/bin/node`, the reviewed `current-%i` release, the environment’s `%i/private` configuration/key and `/srv/av8-erp-final/backups/%i`; no credentials appear in the unit. Database attachments are included in the encrypted dump. Staging and production archives and keys remain separate.

The release operator verifies `/usr/bin/node` and Docker access, installs only these two units, runs `systemd-analyze verify /etc/systemd/system/av8-backup@.service /etc/systemd/system/av8-backup@.timer` and `systemd-analyze calendar "*-*-* 03:15:00 UTC"`, then runs `systemctl daemon-reload`. Start `av8-backup@staging.service` once and check its exit status, encrypted archive and metadata before enabling `av8-backup@staging.timer`; repeat separately for production after promotion. Inspect `systemctl list-timers av8-backup@staging.timer av8-backup@production.timer` and `journalctl -u av8-backup@staging.service`. Forward failed-unit events through the existing operator monitoring route. The schedule creates new encrypted archives and never deletes old ones. Retention remains an owner decision; monitor available disk space and obtain an explicit retention decision before deleting archives. No off-host destination is configured or claimed.

Source checks passed for unit sections/directives, exact isolated paths, UTC schedule, catch-up, private umask and absence of credentials/deletion commands. Native `systemd-analyze` is unavailable on the local macOS workspace; the release operator must record host verification and the first actual scheduled-service result. The author did not install or start either unit.
