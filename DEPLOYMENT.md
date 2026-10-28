# Server deployment

URL: https://demo.odin-ltd.com
Base source commit: f7d740762be2c9235b5ea8557fdabd7ca90ed991
Previous audited image (base plus reviewable working-tree fixes): sha256:90884a53d63e5e5bdbe132a74eb80b9a966c64af0ade79fcbe651dc0104dfa4e
Directory: /srv/demo/odin-erp

Current ERP release (2 October 2026): `sha256:7414d8a639d8289add063fc72c78951f24faaac79219a7ebcd2f3b31a5797ea5`, frontend build `e7Eg21pAAPDoRMg0a97xH`, image tag `odin-demo:css-polish-20261002`. It improves shared typography, Arabic readability, filters, cards, tables, dialogs, employee profiles and mobile layouts. Runtime activity, employment and status labels use plain business language in both languages. The CSS image retains all 106 deployed API files unchanged from `odin-demo:hr-profiles-20261002`. Immediate frontend rollback image: `odin-demo:before-css-20261002`.

The HR release adds departments, editable employee profiles, working-day leave allowances and balances, leave submission/review/cancellation, attendance and monthly salary records. Independent approval and salary visibility follow user permissions. Annual leave reserves pending days and restores cancelled days; sick and unpaid leave do not consume the annual allowance. Salary records support preparation and approval; they do not issue payments or post accounting entries. The migrations `20261002130000_hr_workspace`, `20261002131000_hr_permissions` and `20261002132000_employee_profiles` are applied. HR validation passed 147 unit tests and four targeted database tests, including scope isolation, hidden salaries and concurrent leave reservations. A clearly identified demo profile is available at https://demo.odin-ltd.com/hr/employees?employee=7.

Database archive before the HR profile release: `/srv/demo/backups/odin-before-hr-profiles-20261002.dump`, with its password-free `.roles.sql` companion. Retained HR image: `odin-demo:hr-profiles-20261002`; pre-HR-profile image: `odin-demo:before-hr-profiles-20261002`. Rolling back HR code requires reviewing the applied schema and leave-record compatibility. A CSS rollback requires no schema change: tag `odin-demo:before-css-20261002` as `odin-demo:local`, then run the existing Compose `up -d --no-build --no-deps app` command.

Earlier accounting release (authorized 26 September 2026): `sha256:2a3eb612713e2f6ce84a94d7e3a55505892db8869c395cb4ca9f0feab23777e0`, frontend build `JOhrUV4sNUTLN4x4uNH4i`. It includes the new accounting UI and scoped accounting API extensions. Runtime environment, database schema and posted financial/inventory integrity are unchanged. [Accounting release and rollback](docs/accounting-v3/release.md) · [deployment evidence](docs/accounting-v3/deployment.json). Retained image: `odin-demo:before-accounting-v3-20260926`.

Earlier frontend release (authorized 26 September 2026): `sha256:0483f6229b68b1f4e5c272222c7acfecb14ae69780280f000d10ea125a545eb9`, build `qao1W32hnAMM0WawkX3RO`. All 164 deployed backend files and the dependency lock remain identical to the previous image. All 61 public routes passed read-only browser verification; post-release integrity differences remain zero. See [frontend release and rollback](docs/ui-v2-migration.md) and [machine-readable evidence](docs/ui-v2/deployment.json). Rollback image: `odin-demo:before-ui-v2-20260926`.

The `odin-demo` Compose project runs Node 24 (Next.js and NestJS) and PostgreSQL 17. Only the web service is published, on 127.0.0.1:8090; Nginx handles the public domain and TLS. Containers restart automatically. The existing IGCSE deployment uses separate containers and ports.

Runtime secrets are in `.env` (mode 0600, excluded from Git and image builds). Current account passwords are in `/srv/demo/private/credentials.json` (mode 0600). The admin email is `admin@odin.demo`. At the user’s explicit request, all 12 accounts use `password`, shared demo login is enabled, and MFA requirements and existing enrollment were cleared. Existing sessions were revoked. Demo reset remains disabled; sample business data remains available.

## Operations

```sh
cd /srv/demo/odin-erp
docker compose -f compose.deploy.yml ps
docker compose -f compose.deploy.yml logs --tail 100 app
docker compose -f compose.deploy.yml restart app
curl --fail https://demo.odin-ltd.com/api/health
```

Nginx: `/etc/nginx/sites-available/odin-demo` (source copy: `nginx.demo.conf`).
TLS: Let's Encrypt with `certbot.timer` and Nginx deploy reload hook.

Database backups run daily at 03:17 UTC via `/etc/cron.d/odin-demo-backup` and retain 14 days in `/srv/demo/backups`. These are local backups, not off-server disaster recovery. Run `scripts/backup-deployment.sh` before upgrades. Each dump has a mode-0600, password-free `.roles.sql` companion that must be applied before restoring RLS policies into a clean PostgreSQL cluster. Keep `.env` separately safe: it contains the MFA encryption key required alongside the database.

## Updates

Review repository changes before pulling. Back up the database, build with `docker compose -f compose.deploy.yml build`, apply `docker compose -f compose.deploy.yml run --rm app npm run release:migrate`, then run `docker compose -f compose.deploy.yml up -d --no-build app`. Do not rerun the seed or the initial password rotation script. Check health and `docker compose -f compose.deploy.yml exec -T app npm run integrity` after an update. Applied schema migrations need a compatibility review before rolling back an image.

## Verified on 2026-10-02

- Final image, API and database health pass on the public domain.
- The final image passed all 66 routes in Arabic desktop, English desktop and Arabic mobile: 198 page states, with business writes blocked.
- Public profile verification passed 50 screen states at widths 1440, 768, 390 and 320 pixels, including language switching, search/reset, help expansion, profile tabs, leave/employee dialogs, mobile navigation, Escape and reload. English employment and filter labels are readable; no page overflow, framework overlay or console errors were observed in Chromium 154 through Playwright. The Browser plugin was unavailable.
- Production build, frontend/API type checks and translation audit pass; all translation audit issue categories are zero.
- All 106 deployed API file hashes match the HR release. Financial integrity remains unchanged: five posted journals, debit and credit totals both `272830000` minor units, no negative stock and zero ledger, inventory, customer and supplier differences.
- Local verification evidence is in `/srv/demo/qa/hr-workspace/`; final screenshots use the `css-final-live-` prefix. This checks Chromium and the stated viewport sizes, not a separate Safari or Firefox run.

## Verified on 2026-09-26

- HTTPS valid, HTTP redirects to HTTPS, API and database health pass.
- Live browser login and populated executive dashboard pass using the auditor account.
- After the requested login change, all 12 accounts successfully authenticate with `password` without MFA; authenticated admin bootstrap returns 200.
- Ledger, inventory, AR and AP differences are zero; no negative stock.
- Initial database backup created; daily backup and certificate renewal configured.
- Nginx and Node accept up to 64 KiB authentication headers because the application's permission-bearing JWT exceeds Nginx's default single-header limit.
- Browser screenshot: `/srv/demo/qa/deployed-dashboard.png`.

This was a deployment smoke test, not the complete repository regression suite.

Audit release verification: the 2026-09-26 corrected image passed public health, 190/190 Jest tests in the isolated database, deployed browser login/dashboard, trial-balance net-column invariants, and zero ledger/inventory/AR/AP integrity differences. See `docs/qa/ODIN_ERP_AUDIT.md`.
