# Hosted environment isolation

The user's final deployment target is **Hetzner at `https://av8.odin-ltd.com`**. Use the explicit `AV8_HOSTING=hetzner` profile below. The later Vercel section documents retained compatibility, not the selected final deployment. Configuration verification alone does not prove a deployment; the release owner records actual server, migration, login/MFA, worker, recipient and recovery evidence in the deployment/readiness documents.

## Hetzner production and isolated staging

Use `AV8_ENV=production|staging`, `NODE_ENV=production` and `AV8_HOSTING=hetzner`. `VERCEL` and `VERCEL_PROJECT_ID` must be absent. Required database identity fields are `AV8_HETZNER_DB_HOST`, `AV8_HETZNER_DB_NAME`, `AV8_HETZNER_DB_ADMIN_ROLE`, `AV8_HETZNER_DEPLOYMENT_ID` and `AV8_HETZNER_RESOURCE`. Deployment IDs contain 8–100 lowercase letters/digits/hyphens/underscores and begin with a letter/digit. The marker must equal `av8-erp-${AV8_ENV}:${AV8_HETZNER_DEPLOYMENT_ID}` exactly and differ from the previous hosted marker. Production database/owner names begin `av8_prod_`; staging names begin `av8_staging_`, followed by 1–50 lowercase letters/digits/underscores. Runtime username remains `av8_runtime` with a separate private credential.

`AV8_DB_TRANSPORT=TLS` requires an explicitly separate DNS database host and verified TLS URLs. `AV8_DB_TRANSPORT=PRIVATE_CONTAINER_NETWORK` is permitted only with the reviewed deployment-owned Compose network: database host exactly `av8-postgres`, PostgreSQL port 5432 internal only, **no database host-port publication**, no attachment to another application's network, and URLs explicitly `sslmode=disable`. This option does not authorize a public unencrypted database. Startup verifies both owner/runtime database identities and actual client/server addresses; private transport accepts valid RFC1918/loopback IPv4 or unique-local/loopback IPv6 addresses only. A public/missing address stops startup even when the configured hostname says internal. Both modes retain exact database markers, nonprivileged runtime flags and effective tenant-table RLS checks. The owner must also verify the actual host networking/Compose configuration; application checks alone cannot prove that no Docker port was published.

Production requires `ODIN_WEB_ORIGIN=ODIN_PUBLIC_ORIGIN=https://av8.odin-ltd.com`. Staging uses an explicitly separate HTTPS origin or an SSH-forwarded origin `http://127.0.0.1:<port>` with port 1024–65535 and `AV8_STAGING_PUBLIC_ORIGIN` set to that exact origin. Public HTTP, wildcard origins, inherited Vercel origins and staging reuse of the production domain fail validation. Every `ODIN_ALLOWED_ORIGINS` entry must equal the selected origin. Publish the staging web listener on host loopback only; use an authenticated SSH tunnel for acceptance.

Use unique token/MFA keys and mandatory privileged MFA; keep shared/demo/simple-login flags disabled. No synthetic seed or tenant reset is permitted on either hosted environment. Inherited outbound/jobs stay disabled; separately configured academic/scheduler jobs require their approved identities, provider configuration and controlled delivery evidence. The API listens on its container interface for the private web proxy; its port must remain unexposed to the public host. See the deployment package/runbook for provisioning, scoped first-administrator setup and no-collision handling alongside existing applications.

## Retained Vercel staging compatibility

Without the Hetzner profile, the application also supports an explicit Vercel `AV8_ENV=staging` deployment. This compatibility does not switch the selected final destination. Existing production-only scripts `init-hosted.mjs`, `run-hosted.mjs` and `configure-vercel.mjs` remain bound to their previous live targets and **must not be used for Hetzner or staging**. Local `run.mjs dev|test` also remains local-only.

Local verification: 32 tests passed across four staging/isolation/authentication/bootstrap suites, plus API TypeScript checking. Exact scope and limitations are recorded in [evidence/staging-tests.txt](evidence/staging-tests.txt).

Use a separate protected API deployment configuration with `NODE_ENV=production`, the committed build and unique credentials. Populate the following values; none has a production fallback:

| API variable | Required value |
|---|---|
| `AV8_STAGING_DB_HOST` | Exact dedicated database DNS hostname, distinct from the known live direct/pooler hosts. |
| `AV8_STAGING_DB_POOLER_HOST` | Optional exact separate runtime pooler hostname. Omit unless explicitly configured and verified. |
| `AV8_STAGING_DB_NAME` | Explicit `av8_staging_` name with lowercase letters, digits or underscores. |
| `AV8_STAGING_DB_ADMIN_ROLE` | Separate owner named `av8_staging_` followed by lowercase letters, digits or underscores. |
| `AV8_STAGING_RESOURCE` | Unique approved `av8-erp-staging:<identifier>` marker; identifier uses letters, digits, hyphens or underscores. |
| `AV8_STAGING_PROJECT_ID` | Dedicated API `prj_...` identifier, distinct from live API. Must equal the actual `VERCEL_PROJECT_ID`. |
| `DATABASE_URL` | Explicit runtime `av8_runtime` credential on the configured staging direct/pooler host and database, TLS required. |
| `DATABASE_ADMIN_URL` | Separate owner credential on the configured direct host and same database, TLS required. |
| `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING` | Optional; when present each must use that exact direct owner/database identity. |
| `ODIN_WEB_ORIGIN`, `ODIN_ALLOWED_ORIGINS` | Explicit HTTPS staging web origins; no wildcard, credentials, query, fragment or known live AV8/Odin origin. |
| `ODIN_TOKEN_SECRET`, `ODIN_MFA_ENCRYPTION_KEY` | Unique staging secrets, respectively at least 40 characters and exactly 32 decoded bytes. Must differ from each other; do not copy another environment's secrets. |

Database URLs permit only `sslmode=verify-full` (or `require`, normalized to verification by the adapter) and optional `channel_binding=require`. Duplicate parameters, arbitrary session options and unsupported ports fail validation. No inherited database alias may point to live data. If a pooler cannot expose a TLS session and effective RLS through the runtime connection, use the explicitly configured direct host; do not weaken the startup checks.

Set `ODIN_REQUIRE_PRIVILEGED_MFA=true`, `ODIN_ALLOW_SHARED_DEMO_LOGINS=false`, `AV8_SIMPLE_LOGIN=false`, `NEXT_PUBLIC_ODIN_DEMO_MODE=false`, `AV8_OUTBOUND=disabled` and `AV8_JOBS=disabled`. Staging cannot enable demo deployment/reset or synthetic AV8 seeding. Create reviewed reference configuration and named accounts through an approved provisioning procedure; enroll privileged MFA and test recovery. Named academic jobs remain separately opt-in and require explicit controlled test-recipient allowlists in staging; ordinary integration flags stay disabled.

The database owner must provision and independently verify `av8_guard.av8_environment_identity` with exactly one `resource` row matching the approved staging marker before startup, then grant `av8_runtime` read-only marker/schema access. Apply reviewed migrations in a separate controlled step to that verified staging database; run no demo seed. The runtime role must be `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`, have required application grants, and never own or bypass tenant tables. Do not copy the live marker. The application does not create identity markers or silently alter database roles.

Startup verifies the actual marker and database name over **both** owner and runtime connections, verifies the connected owner name, verifies runtime role flags, TLS and `row_security=on`, and checks effective RLS for every public tenant table plus the required tenant/application/fund/journal tables. Missing or failed checks stop startup. Unit tests simulate successful and rejected database responses; actual hosted connections and provider-specific behavior remain an external deployment acceptance gate.

The web project has its own separate staging project identity and explicit HTTPS API-origin configuration; its `AV8_STAGING_PROJECT_ID` is the **web** project ID, while the API value is the **API** project ID. Use the web staging configuration contract implemented alongside this API gate. Do not reuse live project IDs or the live API URL. After protected configuration, repeat health/login/MFA, permitted/forbidden requests, PDF/private-file access, per-company integrity and controlled worker/alert delivery checks and record their exact commit and target evidence.


## Web deployment contract

The delivery target is the Hetzner profile. The web and API share one browser origin; `/api/*` is forwarded by the web server to the isolated Docker API service. Browser authentication and refresh cookies remain on the public web origin. The private API and database ports must not be exposed publicly. Existing Vercel support is retained for compatibility; it is not the selected delivery target.

| Web variable | Hetzner requirement |
|---|---|
| `AV8_HOSTING` | `hetzner` |
| `AV8_ENV`, `NODE_ENV` | `staging` or `production`; always `NODE_ENV=production` |
| `AV8_HETZNER_DEPLOYMENT_ID` | Unique 8–100 lowercase letters, digits, underscores or hyphens; first character alphanumeric. |
| `AV8_HETZNER_RESOURCE` | Exactly `av8-erp-${AV8_ENV}:${AV8_HETZNER_DEPLOYMENT_ID}`; distinct staging and production identities. |
| `ODIN_PUBLIC_ORIGIN`, `ODIN_WEB_ORIGIN` | Exactly equal public origins, without credentials, path, query or fragment. Production is `https://av8.odin-ltd.com`. |
| `AV8_STAGING_PUBLIC_ORIGIN` | Staging only: exactly equal selected public origin. A separate explicit HTTPS origin or `http://127.0.0.1:<port>` with port 1024–65535 for a protected SSH tunnel; no production fallback. |
| `API_ORIGIN` | Exactly `http://api:8181` on the dedicated private Docker network. |
| `ODIN_UI_BUILD_DIR` | `.next`; Hetzner builds request Next standalone output. |
| `AV8_OUTBOUND` | `disabled` |
| `NEXT_PUBLIC_ODIN_DEMO_MODE`, `ODIN_ALLOW_SHARED_DEMO_LOGINS`, `AV8_SIMPLE_LOGIN` | `false` |
| `ODIN_REQUIRE_PRIVILEGED_MFA` | `true` |

The Hetzner API proxy never requests or forwards Vercel workload identity. Invalid runtime configuration stops forwarding with a 503 response. API destinations are selected from verified server environment, never from request parameters. The proxy forwards only the required authentication/content headers, does not follow upstream redirects, preserves HttpOnly refresh cookies, and returns no-store responses. Server configuration tests verify these boundaries and denial paths; actual Hetzner TLS, SSH access, proxy trust, privileged MFA and cookie behavior still require deployment acceptance.

Vercel compatibility uses its own `AV8_STAGING_PROJECT_ID` matching the actual web `VERCEL_PROJECT_ID`, an explicit `AV8_STAGING_API_ORIGIN` matching `API_ORIGIN`, a distinct HTTPS `ODIN_WEB_ORIGIN`, and the same authentication restrictions. Those project IDs differ between the web and API deployments. That profile requires server-issued Vercel workload identity before forwarding credentials and rejects browser-supplied identity. It must not be selected for the Hetzner delivery.

Local proxy/configuration evidence: `node --test scripts/av8/web-isolation.test.mjs` (26 passing tests at implementation; rerun as part of the exact-commit release checks). This is configuration/transport verification, not an external deployment claim.


Production client-IP boundary: the web listener is bound to host loopback and reached through the dedicated nginx vhost. That vhost overwrites `X-Real-IP` and `X-Forwarded-For` with nginx's actual `$remote_addr`. In the Hetzner **production** profile only, the web proxy validates the single `X-Real-IP` value with Node `net.isIP` and emits that value as API `X-Forwarded-For`; browser-supplied XFF and Vercel forwarding headers are ignored. The private API trusts exactly one proxy hop. This requires that the API network is reachable only by the owned web/monitor services and the web port is not exposed directly. SSH-loopback staging forwards none of those client-IP headers. Tests cover valid IPv4/IPv6, malformed/multiple addresses, forged XFF/Vercel headers and staging denial. Web configuration/proxy suite now contains 26 tests; actual nginx boundary remains a deployment check.
