# AV8 Vercel deployment

## Automatic deployments from GitHub

Since 28 October 2026, both existing Vercel projects are connected to the private [mohammaddashraff/odin-erp](https://github.com/mohammaddashraff/odin-erp) repository. Their production branch is `main`.

| Project | Repository root | Production URL |
| --- | --- | --- |
| `av8-erp` | `apps/web` | https://av8-erp.vercel.app |
| `av8-erp-api` | `apps/api` | https://av8-erp-api.vercel.app |

Every commit pushed to `main`, including changes saved through GitHub's browser editor or merged pull requests, triggers production builds for both projects. Each successful deployment updates its existing production domain. Build failures keep that project's previous successful deployment live. Changes on other branches do not update production until merged into `main`.

Both projects use Node.js 24, install with `npm ci --ignore-scripts`, and can access monorepo files outside their root. The frontend builds with `npm run build`; the API builds with `npm run build:vercel`. Skipping unaffected projects is disabled so shared-file changes also build both projects.

Private runtime configuration stays in Vercel. Database migrations remain the explicit release step documented below; Git pushes deploy code and do not automatically apply migrations or seed data. Apply compatible migrations before publishing code that requires them. The frontend and API build independently, so changes to their shared contract should support the previous deployed version during rollout.

The initial 24 October 2026 deployment used the local working tree and owner-approved private Vercel configuration. GitHub is now the source for automatic code deployments.

## Dedicated resources

| Resource | Identity |
| --- | --- |
| Vercel team | `muhammadashraf-s-projects` / `team_t1wPpgikmXwjT1r1HzMSyYfo` |
| Frontend | `av8-erp` / `prj_uhdt4Zm1BiauDHJeHoMa1ccO2GvG` |
| API | `av8-erp-api` / `prj_iHlpBv6jtRpJLOOHwNOyitAeovck` |
| Frontend domain | `https://av8-erp.vercel.app` |
| API domain | `https://av8-erp-api.vercel.app` |
| Neon project | `cool-meadow-67774901` |
| Vercel Neon store | `store_mWVMdQd0jyQsrzVT` |
| Database | `neondb`, Frankfurt; free plan selected during provisioning |
| Database resource marker | `av8-erp-production:cool-meadow-67774901` |

Existing Odin resources and the AV8 marketing site were not modified. Production uses a newly provisioned empty Neon database, separate credentials, and a restricted `av8_runtime` role. Baseline and all four AV8 migrations were applied, followed by the empty-only AV8 configuration seed. No original customer records were copied. Plan interpretation and academy terms remain unapproved drafts.

## Authentication and private configuration

Vercel's standard deployment protection remains enabled for generated deployment URLs. The stable production domains are publicly reachable under that policy; ERP data still requires the application's own session and permission checks. The Next.js server also supplies Vercel's short-lived OIDC identity, and the API's Trusted Sources rule allows the new frontend project's production environment to reach protected production deployments. No protection settings were disabled.

Login: `admin@av8.local`. After the initial deployment, the owner requested an administrator password/MFA reset and simple login. The administrator now uses the subsequently assigned password; `AV8_BOOTSTRAP_PASSWORD` in the ignored, mode-0600 `.av8/production.env` is the original seed credential and is no longer the administrator's current password. It differs from development and was not uploaded as a runtime variable. Other seeded role accounts retain their original credentials until individually changed.

The current owner-requested configuration is `AV8_SIMPLE_LOGIN=true`, `ODIN_REQUIRE_PRIVILEGED_MFA=false`, and `ODIN_ALLOW_SHARED_DEMO_LOGINS=false`. The reset revoked the administrator's old sessions/recovery codes and cleared its MFA enrollment. Accounts with their own enabled MFA still receive their normal challenge. The QA release preserved these settings and did not reset credentials again.

The API stores its database URLs, signing secret, and MFA encryption key as Vercel production secrets. The frontend receives no database passwords or ERP signing keys. `.vercelignore` excludes environment files, `.av8`, local build outputs, tests and documentation; the CLI upload manifest was inspected before deployment. Outbound messaging, bank providers and background jobs remain disabled.

## Runtime and future releases

Both projects use Node 24. Root directories are `apps/api` and `apps/web`, with access to monorepo files outside those roots. Install command: `npm ci --ignore-scripts`. API build command: `npm run build:vercel` (Prisma generation, then Vercel's native NestJS build); frontend: `npm run build`.

The API validates the exact new database endpoint, restricted role, Vercel project ID and database marker. `scripts/av8/run-hosted.mjs` loads only the private production environment and checks the marker before hosted maintenance commands. `scripts/av8/configure-vercel.mjs` passes approved secrets to the exact two project IDs through CLI stdin, never process arguments. Do not run inherited seed, reset or deployment commands.

For an already provisioned environment, migrations are explicit release steps:

```bash
export PATH="$PWD/.av8/bin:$PATH"
node scripts/av8/run-hosted.mjs npm run db:migrate -w @odin/api
```

Verify the team and project before each `vercel deploy --prod --project av8-erp-api --scope muhammadashraf-s-projects` or frontend equivalent. Inspect with `vercel deploy --dry --json` first. For later releases, stage with `--skip-domain`, test the staged production deployment and promote it. Preserve the database and secret files when rolling back application code; use forward database corrections rather than resetting the database. Do not re-run marketplace provisioning for an existing AV8 database.

Attachments are limited to 4 MiB, stored privately in PostgreSQL, and checked in both the browser and API. The frontend API proxy has a 60-second function limit and a 55-second upstream timeout. A small database pool limits connections per function instance. Production startup checks the Arabic and Latin PDF font assets. Resource usage, paid-plan upgrades, backups and restoration must be managed separately as usage grows; no automatic paid upgrade was selected.

## Dependency maintenance

Before deployment, Next.js was patched to 16.4.3 and compatible transitive security fixes were pinned in the lockfile. The repository's remaining build-tool advisories were also patched. npm reported zero vulnerabilities after these changes. Release context: [Next.js 16.4.3](https://github.com/vercel/next.js/releases/tag/v16.4.3), [Next.js security advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

Local verification after these updates: API and frontend production builds passed; 120 tests passed across 13 AV8, database, financial, file-validation and authentication suites. The repository dependency-security gate passed with zero advisories.

## Current live release — hover stability and ODIN identity, 25 October 2026

- Frontend: [`dpl_N6JgBL2zyVCozR4r1yUtFKFa66Tj`](https://vercel.com/muhammadashraf-s-projects/av8-erp/N6JgBL2zyVCozR4r1yUtFKFa66Tj), production `READY`, serving `https://av8-erp.vercel.app`. Staged, checked and promoted; the stable hostname resolves to this deployment.
- Reproduced the hover defect on the preceding production frontend: submenu labels wrapped during width animation, causing the Home row to overshoot its final position before returning. Submenu content now keeps its expanded text width inside an animated grid. The logo remains inside the visible rail throughout opening/closing in both directions. Pointer hover and keyboard focus have separate state; a cancelable 140ms close delay handles rapid pointer re-entry.
- Brand reference was inspected on the live [ODIN corporate site](https://odin-ltd.com): blue `#245DE8`, navy `#102747`, white, panel `#F4F7FC`, muted `#53647B`, borders `#DCE4EF`, Manrope and Noto Sans Arabic. Reused the existing original `oss-geometric-eye.png` asset with `OSS. / ERP` and localized “Built for AV8.” Applied the palette to the sidebar, AV8 workspace accents and tabs; updated login attribution, metadata, favicon redirects and the manifest. Semantic status colors retain their meaning.
- The upload differs in nine frontend source files from the preceding release; all other uploaded source matches. No private files were uploaded. The backend, database, account settings and corporate site were not changed.
- Validation: frontend TypeScript and Vercel production build passed; both new `tests/ui-v2/navigation-motion.spec.ts` cases passed. Local browser checks cover hover, rapid re-entry, focus, pin persistence, long submenus, route changes, RTL, mobile and reduced motion. Live authenticated Chromium verification passed at 20:14 Cairo time: actual EN/AR hover sampled over 34 frames per opening/closing transition, original logo, palette, pin persistence, 390px mobile drawer and 320px overflow. No browser errors, failed responses or business writes; normal login/logout session activity only. Staged and live frontend → API → database health passed.
- Temporary evidence: `/tmp/av8-hover-brand-qa/result.json`, `/tmp/av8-hover-live/result.json`, live `sidebar-en.png`, `sidebar-ar.png`, `mobile-ar.png`, `login.png`, and `/tmp/av8-hover-release.json`. Playwright Chromium was used because the Browser plugin was unavailable.
- Frontend rollback candidate: `dpl_BR9FCtsN847SBpqmEz1RGHnu2EGN`. API remains `dpl_GdLsrBDo1iQBNXnWiWz9U4jo8NCu`. This is a working-tree release, not a new Git commit.

## Previous live release — sidebar polish, 25 October 2026

- Frontend: [`dpl_BR9FCtsN847SBpqmEz1RGHnu2EGN`](https://vercel.com/muhammadashraf-s-projects/av8-erp/BR9FCtsN847SBpqmEz1RGHnu2EGN), production `READY`, serving `https://av8-erp.vercel.app`. Staged with `--skip-domain`, checked, then promoted; the stable hostname resolves to this deployment.
- Exactly six frontend source files differ from the preceding production source: the shared brand and workspace components, sidebar/base styling, AV8 styling, interface polish and navigation translations. All other uploaded files match the preceding release. The generated `next-env.d.ts` development paths were restored before upload. No private files were uploaded.
- Sidebar uses the existing SVG brand asset, a unified navy/teal palette, clearer typography, a compact pin control and mobile close button. Compact desktop navigation retains the logo, tablet widths collapse correctly, and Arabic layouts use logical spacing.
- Vercel's production build and TypeScript checks passed. Staged HTML, stylesheet and frontend → API → database health checks returned HTTP 200. Read-only live Chromium verification passed at 20:00 Cairo time: administrator login, the new sidebar assets/styles, pin persistence across reload, collapse/keyboard expansion, route navigation, Arabic mobile drawer and focus restoration, 320px overflow checks and logout. Browser errors and failed responses were empty. No business writes occurred; only normal authentication/session activity was added.
- API remains `dpl_GdLsrBDo1iQBNXnWiWz9U4jo8NCu`. No migrations, data resets, credential changes or infrastructure changes were made. Frontend rollback candidate: `dpl_2kua9VqBqXJU8UqehMCKzriHqrLx`.
- Temporary evidence: `/tmp/av8-nav-live/result.json`, `desktop-en.png`, `mobile-ar.png` and `/tmp/av8-nav-release-check.json`. Browser plugin was unavailable, so verification used installed Playwright Chromium at 1440×1000, 390×844 and 320×740. This remains a working-tree release, not a new Git commit.

## Previous live release — QA corrections, 25 October 2026

- Frontend: [`dpl_2kua9VqBqXJU8UqehMCKzriHqrLx`](https://vercel.com/muhammadashraf-s-projects/av8-erp/2kua9VqBqXJU8UqehMCKzriHqrLx), production `READY`, serving `https://av8-erp.vercel.app`.
- API: [`dpl_GdLsrBDo1iQBNXnWiWz9U4jo8NCu`](https://vercel.com/muhammadashraf-s-projects/av8-erp-api/GdLsrBDo1iQBNXnWiWz9U4jo8NCu), production `READY`, serving `https://av8-erp-api.vercel.app`.
- Both builds were staged with `--skip-domain`, checked, then promoted. Resolving each stable hostname returned the corresponding new deployment ID. Staged API health and frontend HTML returned HTTP 200; stable frontend → API → database health also passed.
- Upload manifest: 188 files, 6,926,981 bytes, zero private files. No migrations, database resets, secret changes or new infrastructure were needed. This is a working-tree release, not a new Git commit.
- Local verification passed: API/frontend production builds, 130 Jest tests in 14 suites, and 2 native date/control tests. Four staff roles and protected user creation/login were tested in the isolated local environment. [IMPLEMENTATION.md](IMPLEMENTATION.md#qa-report-corrections--25-october-2026) records the fixes and acceptance scope.
- Read-only live Chromium checks completed at 00:23 UTC: current administrator login, anonymous access denial, dashboard queue filtering, saved appointment values in Cairo time, saved document status/permitted transitions, Arabic CSV currency units, student PDF download and tab persistence, FX preview, Arabic desktop/mobile layout, explicit USD statement currency, empty bank input defaults, create-user form availability and logout. Browser console and failed-response lists were empty.
- Live browser QA used the existing clearly identified `AV8 QA` records. It created no business records and approved no policies or financial transactions; only normal authentication/session audit activity was added. The synthetic records left by the original review remain.
- Evidence: `/tmp/av8-qa-report-20261025/live.json`, `live-ar-desktop.png`, `live-ar-mobile.png`, `live-balances.csv`, `live-student.pdf`; script `/tmp/av8-report-live-qa.cjs`. Playwright with the installed Chromium was used because the Browser plugin was unavailable. Private deployment/test logs and upload manifest are in `.av8/`. Temporary evidence is not a durable backup.

Accounting mapping, installment interpretation, academy settlement/commission and the real academy identity still require owner approval before operational acceptance. The complete financial/travel journey passed with synthetic approved policies in the isolated test database; this does not approve production business terms. Load testing and a backup/restore drill remain outside this release verification.

## Initial verified release — 24 October 2026

- Frontend: [`dpl_6kvjc751VMRSFJPBGDxyciMFRHFB`](https://vercel.com/muhammadashraf-s-projects/av8-erp/6kvjc751VMRSFJPBGDxyciMFRHFB), production `READY`, serving `https://av8-erp.vercel.app`.
- API: [`dpl_GBnhUMSEXnAJNnw51mykACBeU9YW`](https://vercel.com/muhammadashraf-s-projects/av8-erp-api/GBnhUMSEXnAJNnw51mykACBeU9YW), production `READY`. Staged, checked, then promoted; resolving `av8-erp-api.vercel.app` returned this deployment ID.
- Final stable frontend `/api/health` returned HTTP 200 with both API and database `ok` at 20:21 UTC on 24 October 2026. Startup also verified the database marker, runtime role and all four PDF fonts.
- Live Chromium checks passed: anonymous data access rejected; administrator MFA enrollment required; telesales login and authorized reference/lead reads; finance access rejected for telesales; secure HttpOnly refresh cookie and actual browser session restoration; English desktop and Arabic mobile screens; logout. No browser console errors or failed browser requests remained.
- Production contains configuration and private role accounts, with zero leads/applications created by these checks. Only authentication/session audit activity was added.
- Evidence: `/tmp/av8-erp-vercel-qa-20261024/result.json`, `dashboard-en.png`, `leads-ar-mobile.png`. Test script: `/tmp/av8-live-browser-qa.cjs`. Private logs are in `.av8/`. Temporary evidence is not a durable backup.

The first API attempts were rejected before compilation because function patterns are not accepted by this native NestJS preset. The final `apps/api/vercel.json` uses only the documented framework setting; native tracing included the required fonts, confirmed by staged runtime startup. No failed deployment was promoted.
