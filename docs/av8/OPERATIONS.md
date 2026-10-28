# AV8 local operating notes

Production is deployed at [av8-erp.vercel.app](https://av8-erp.vercel.app). Use [VERCEL.md](VERCEL.md) for its separate database, private credentials, MFA and release instructions. The commands below apply to local dev/test resources.

The user explicitly requested adaptation **in the existing `odin-erp` directory**. Display/product name is AV8 ERP; internal npm workspace names `@odin/api` and `@odin/web` remain for compatibility. Existing user changes and the inherited remote were preserved; nothing was pushed.

## Isolation and startup

Working directory: `/mnt/HC_Volume_107060244/demo/odin-erp`.

- Node 24: `.av8/bin/node` (extracted from cached `node:24-bookworm-slim`). The initial adaptation preserved dependency versions; the Vercel release subsequently applied the security patches documented in `VERCEL.md`.
- Dev database: `av8-erp-dev-db`, `127.0.0.1:5548`, database `av8_dev`, volume `av8-erp-dev-pg`.
- Test database: `av8-erp-test-db`, `127.0.0.1:5549`, database `av8_test`, volume `av8-erp-test-pg`.
- Both use dedicated `av8_owner` / restricted `av8_runtime` roles and separate generated passwords. Legacy `odin_app` exists only as a NOLOGIN RLS policy group in these new clusters.
- Network `av8-erp-local`, app label `av8-erp`, no bind mounts, cached PostgreSQL 17 image. Databases limited to 192 MB and half a CPU each.
- No PM2/systemd/reverse-proxy/firewall/DNS changes. Live `odin-demo-app-1` has no bind mounts; live Odin database/volume was not accessed or modified.
- Private `.av8/dev.env` and `.av8/test.env` are ignored, mode 0600. The original root `.env` is preserved and **not loaded by AV8**. The launcher verifies exact URLs and a database resource marker before running commands.
- API output: `.av8/api`; frontend output: `apps/web/.next-av8`. Attachments are private database bytes with generated UUIDs, never public uploads or original filesystem paths.
- No outbound messaging, bank transfers, third-party synchronization or inherited workers are enabled. Reminders are database-backed staff queues. There is no provider integration represented as live.

Commands (from this directory):

```bash
export PATH="$PWD/.av8/bin:$PATH"
node scripts/av8/init-local.mjs                 # read-only identity verification
node scripts/av8/run.mjs dev npm run db:migrate -w @odin/api
node scripts/av8/run.mjs dev npm run db:seed -w @odin/api
npm run av8:build
npm run av8:start
```

Fresh installation: first verify free disk/memory and Docker image availability, then `node scripts/av8/init-local.mjs --create`. It generates private credentials and creates only AV8-labeled resources; it refuses unrelated name collisions. It does not pull images, prune resources or install dependencies. Use Node 24 for application commands. `npm ci --ignore-scripts` may be used after verifying local paths and the supplied lockfile; generate Prisma only through the AV8 launcher.

Preview: `http://127.0.0.1:8180`; API `http://127.0.0.1:8181`. For VS Code Remote SSH, forward port 8180. From another terminal:

```bash
ssh -L 8180:127.0.0.1:8180 USER@SERVER
```

Open `http://127.0.0.1:8180` on your computer. Do not expose these development accounts publicly. Credentials are local-only: login `admin@av8.local`, password stored as `AV8_BOOTSTRAP_PASSWORD` in `.av8/dev.env` (open it privately in VS Code). Additional role accounts: `management`, `telesales`, `sales`, `affairs`, `finance` at `av8.local`. Initial synthetic bootstrap uses the same private environment password for these review accounts; change passwords before operational use. No credential values are included in Git or reports. Existing authentication/MFA facilities remain available.

## Migration, backup and rollback

The four AV8 migrations are additive (`20261024180000`, `20261024210000`, `20261024213000`, `20261024220000`). They create student workflow/subledger tables, RLS, foreign keys/reference checks, immutable evidence and approved snapshots, and allocation controls. Shared ERP business tables are retained. Empty AV8 instances also receive existing baseline migrations; inherited demo seed is not used.

Before an AV8 migration, create an AV8-only backup (contains private student evidence):

```bash
mkdir -p .av8/backups
chmod 700 .av8/backups
docker exec av8-erp-dev-db pg_dump -U av8_owner -d av8_dev -Fc > .av8/backups/av8-dev-before-change.dump
chmod 600 .av8/backups/av8-dev-before-change.dump
```

For recovery, restore into a **new, separately named AV8 recovery database/container** and verify its identity and data before changing AV8 configuration. Do not run `pg_restore --clean`, Prisma reset, or any restore against Odin. The normal reset script is disabled. Prefer forward corrective migrations. Stop only the AV8 preview processes before code rollback; preserve private env/files and database backups. The original source baseline hash manifest is `docs/av8/source-manifest.json`; a source checkpoint from before AV8 edits was retained in `/tmp/av8-source-checkpoint-20261024` (not a durable backup).

## Role-based usage

- Telesales: capture or preview/import CSV; review duplicate warnings; assign, record contact, schedule/no-show/reschedule appointments, choose follow-ups as far ahead as needed. No age-based loss.
- Sales: receive assigned leads, record attended consultation and outcome, convert without replacing the contact; record medical results after cleared fee allocation; draft/upload/sign agreements. Multiple applications share the contact.
- Student affairs: review each document, mark conditional family record inapplicable with a reason, track English/visa/travel independently, upload evidence, maintain guardian sharing consent, review monthly reports and tasks. Appointment display is Africa/Cairo. Timestamp inputs explicitly include an offset; financial dates are calendar dates.
- Finance: approve accounting mapping first, record pending collections, confirm actual cleared cash, allocate partial/advance payments, record refund cases and academy remittances separately. Outgoing funds require a different approver and evidence. Global finance queue supports multi-student batch remittances within one academy/branch. USD allocations retain original currency, rates, rate date, payer, reference, bank and journal.
- Management/admin: approve versioned commercial policies and exceptions. Installment drafts require amount interpretation, first anchor/offset, and upfront milestone. The cash student price is usable independently; cash academy entitlement remains unapproved until explicitly decided. Plan amendments preserve original signed terms and allocations, apply credits to replaced unpaid charges, and keep a carry-forward audit. Reductions below already collected categories or changes to existing cash academy obligations require explicit reconciliation decisions.
- Staff print/export: download authorized printable HTML or PDF/CSV; browser-print HTML is suitable for Arabic/RTL. Student statements omit internal academy/commission information. CSV export is the current filtered page, clearly labeled.

## Operational limits and unresolved policies

Use **Business configuration → Manage academies / Manage users / Manage AV8 data scopes** for administration. A new user requires an active role, active linked branch and an initial password of at least 12 characters; creation requests password confirmation and records an access audit. Financial-resource assignments remain explicit in access governance. Student details can be corrected from the Admissions section with a recorded reason; the original contact identity and audit history are retained.

Bank-statement amounts are in the selected bank account's currency. Statement import is evidence, not a posted movement. Generic bank movements support the base currency; record foreign-currency student receipts/remittances through **Collections & academy** with historical rates and dates. Existing financial safeguards and draft commercial-policy gates still apply.

See `BUSINESS_DECISIONS.md`. New contract wording is a draft. No legal/embassy claims were independently verified. No malware scanning service is configured: files undergo size/type/signature checks, active PDF rejection, private authorized download, and integrity verification; the download response discloses scan status.

Automatic profit/revenue recognition, exceptional post-academy refunds, refund FX differences and cancellation percentages are deliberately not invented. Deferred-allocation corrections involving existing academy obligations and changes to established cash entitlement are blocked pending an authorized reconciliation decision; the exception log preserves them. Standalone general-ledger reversal of AV8 cash is blocked so it cannot silently leave student/academy statements inconsistent.

Monthly reporting creates an editable expected-period horizon after actual departure; use **Plan next report periods** to extend it. No background scheduler or external notifications run. No student/guardian portal is included.
