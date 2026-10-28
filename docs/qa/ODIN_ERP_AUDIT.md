# ODIN ERP implementation audit

Audit run: `2026-09-26-odin-audit`  
Final status: **VERIFIED_PASS with bounded gaps**

## Executive result

The authorized ODIN demo was audited from repository, API, PostgreSQL, isolated browser, reverse
proxy, backup/restore and deployed runtime evidence. Three material defects were confirmed and fixed:
the trial balance presented turnover instead of net ending balances; clean restore lacked its required
RLS database role; and the dependency tree contained one Critical and eleven High advisories. The
corrected image is deployed at `https://demo.odin-ltd.com` and passed health, accounting integrity,
authenticated browser and deployed trial-balance checks.

This status applies to the scope below. It is not a claim that the system is production ready or
fully secure. The Vercel URL has different frontend assets and an independently healthy API/database,
but its ownership and database relationship were not established; it remained read-only. Large
optional modules and policy-dependent workflows are recorded in the backlog.

## Environment and URL mapping

- Host/user/repository: `docker-ce-ubuntu-4gb-nbg1-1`, root, `/srv/demo/odin-erp`.
- Base Git revision: `f7d740762be2c9235b5ea8557fdabd7ca90ed991`; fixes are an uncommitted,
  reviewable working tree on that base.
- Deployed test runtime: Docker Compose project `odin-demo`, Node 24, Next.js 16.3.6, NestJS 11,
  Prisma 7.10.0 and PostgreSQL 17.
- Deployed image after audit: `sha256:90884a53d63e5e5bdbe132a74eb80b9a966c64af0ade79fcbe651dc0104dfa4e`.
- `demo.odin-ltd.com` resolves to `2.28.75.201`; Nginx TLS proxies only to
  `127.0.0.1:8090`, the healthy `odin-demo-app-1`. PostgreSQL is not published.
- `odin-erp-web.vercel.app` resolves to Vercel and uses different immutable Next.js asset names. Its
  `/api/health` returned API/database `ok`, but no non-secret revision or database identity is exposed.
  Mutations there are **BLOCKED** pending environment ownership evidence.
- No live payment, email, SMS, WhatsApp, webhook, tax-authority or bank-feed adapter was found.
- Pre-build headroom was 1.8 GiB available RAM plus 1.0 GiB free swap and 55 GiB disk. Builds used
  one worker where supported and did not touch unrelated services.

The earlier `ERR_BLOCKED_BY_ADMINISTRATOR` was specific to another managed cloud browser. This run's
isolated Chromium reached the public site successfully; no firewall or ERP permission was weakened.

## Verification totals

The authoritative non-browser regression gate after all code changes is **19 suites / 190 tests
passed, 0 failed, 0 skipped**. The 13-suite security selector also passed **159/159**, but those tests
are a subset of the 190 and are not double-counted. TypeScript/lint, i18n audit, Prisma validation,
production build, tracked-file security scan and dependency audit all passed. Dependency audit final
counts: **0 Critical, 0 High, 0 Moderate, 0 Low**.

Browser verification used `agent-browser` with isolated contexts:

- **12/12 role login/dashboard/navigation smokes passed**, with `/api/bootstrap` 200 and no horizontal
  overflow; screenshots were captured per role.
- Public post-deploy admin flow passed: login 201, bootstrap 200, dashboard 200, no failed
  application requests, no console errors and no page errors.
- Arabic mobile login at 390×844 rendered RTL with no horizontal overflow.
- Targeted API authorization probes returned validation 400 for permitted identities and 403 for
  unauthorized identities; the 159 security tests provide the deeper record/scope enforcement.

Exactly **33 repository Playwright scenarios were inventoried but not run in this audit pass** because
they assume a dedicated application on hard-coded `127.0.0.1:8080`, and two additionally require an
explicit staging target. They remain **NOT_TESTED** here rather than being counted as skipped or
passed. Custom browser checks above exercised the deployed and isolated environments instead.
One environment-level item is **BLOCKED**: mutation testing on the unowned Vercel deployment.

## Critical findings and fixes

| ID | Severity | Result | Business impact and disposition |
|---|---|---|---|
| ODIN-FIN-001 | P1 | VERIFIED_PASS | Trial balance showed 13,700 turnover instead of 11,200 ending debit/credit balances in the deterministic scenario. Report logic and regression test fixed it; deployed endpoint preserves the net-column invariant and balances. |
| ODIN-OPS-001 | P1 | VERIFIED_PASS | A clean restore failed on 58 RLS policies because `odin_app` was absent. Backup now emits a password-free role bootstrap companion; clean PostgreSQL 17 restore passed. |
| ODIN-SEC-001 | P1 | VERIFIED_PASS | Initial audit found 1 Critical, 11 High and 2 Moderate advisories. Compatible patched dependency versions reduced all severities to zero; build and 190 tests pass. |
| ODIN-DEP-001 | P3 | VERIFIED_FAIL | Prisma's PostgreSQL adapter still emits a nested-query deprecation warning. It has no current functional failure but must be resolved before a future `pg` 9 upgrade. |

Every finding's preconditions, steps, expected/actual behavior, source, root cause, fix, verification
and limitations are in `FIX_LOG.md`.

## Accounting reconciliation

The deterministic single-currency, zero-tax fixture used real workflows and produced the requested
ending results: bank 9,900; inventory 6 units/value 600; AR 300; AP 600; revenue 600; COGS 400;
profit 200; trial-balance debit and credit 11,200. Every difference is **0**. Raw ledger turnover is
13,700 per side due to the legitimate GRNI receipt/bill clearing entries, which is why the original
trial-balance presentation was wrong.

The deployed demo integrity check after release reports 5 balanced posted journals, no negative stock,
and differences of **0 minor units** for ledger, inventory, AR and AP. The deployed trial-balance API
returns 10 nonzero accounts, one net debit/credit column per account, and equal totals of 259,830,000
minor units. Full posting matrix and limits are in `ACCOUNTING_RECONCILIATION.md`.

## Module and permission gaps

The detailed 21-row coverage map is `MODULE_GAP_MATRIX.csv`. Seventeen current product areas have
bounded runtime verification; four absent optional domains are marked `NOT_APPLICABLE`, not defects.
Material partial areas are inventory depth/concurrency, period-close governance, advanced purchasing,
multi-step approvals, HR/payroll, provider-backed attachments, advanced accounting and route-wide UI
accessibility. Fixed assets, manufacturing, operational project/service costing, and external portals
need product/accounting policy before implementation.

`ROLE_PERMISSION_MATRIX.csv` contains 77 configured role/module rows across the 12 supplied accounts.
It records actual configured roles, action grants and scopes such as OWN, TEAM, BRANCH, WAREHOUSE,
DEPARTMENT and ALL. Each identity passed isolated login/dashboard/navigation; the matrix does not
claim that each of its 77 action cells was clicked in a browser. Backend enforcement is supported by
the security suites and targeted negative probes. Both `cfo@...` and `finance@...` are configured as
**Finance Manager**; the README label now states that the first is the CFO demo profile.

## Backup and deployment evidence

The original custom dump proved restorable only after manually creating `odin_app`. The fixed backup
created a mode-0600 dump and mode-0600, password-free role companion. A clean PostgreSQL 17 restore
then produced 1 tenant, 12 users, 5 journals, 17 applied migrations and 58 RLS policies. The backup is
still local-only and does not establish off-site disaster recovery.

Release steps ran `prisma migrate deploy` (17 migrations found, none pending), skipped seed because the
database already contained its tenant, recreated only `odin-demo-app-1`, and reached healthy state.
No migration was added. Public `/api/health` and post-release integrity passed. Authentication state
and credentials were deleted from the browser container and are absent from audit artifacts.

## Reproducible commands

Run with the test database environment supplied privately; do not place database credentials in the
shell history or reports.

```bash
npm run db:generate
npm run db:validate
npm run lint
npm run i18n:audit
npm run security:scan
npm run security:audit
npm test
npm run integrity

docker compose -f compose.deploy.yml build app
docker compose -f compose.deploy.yml run --rm app npm run release:migrate
docker compose -f compose.deploy.yml up -d --no-build app
curl --fail https://demo.odin-ltd.com/api/health
```

## Evidence and deliverables

Sanitized logs and screenshots are gitignored under
`/srv/demo/odin-erp/artifacts/audit/2026-09-26`. Key files are
`logs/final-full-test.log`, `logs/deployed-health-integrity.log`,
`logs/deployed-browser-clean-smoke.log`, `logs/deployed-trial-balance-check.log`,
`logs/security-audit-after-fix.log`, `logs/url-mapping.log`, `deployed-final-dashboard.png`, the
12 role screenshots and `mobile-ar-login.png`.

Required deliverables:

- `docs/qa/ODIN_ERP_AUDIT.md`
- `docs/qa/MODULE_GAP_MATRIX.csv`
- `docs/qa/ROLE_PERMISSION_MATRIX.csv`
- `docs/qa/ACCOUNTING_RECONCILIATION.md`
- `docs/qa/FIX_LOG.md`
- `docs/qa/REMAINING_BACKLOG.md`
- `docs/qa/RESUME.md`
