# AV8 implementation and verification — 24 October 2026

## Workspace and isolation
- User clarified: adapt existing `/mnt/HC_Volume_107060244/demo/odin-erp` in place; rename application AV8. Preserve existing uncommitted work. No remote push.
- No applicable AGENTS.md found. npm workspaces; NestJS / Prisma 7 / PostgreSQL; Next.js 16 / React. Node 24 required.
- Live Odin app has no bind mounts; existing database uses `odin-demo_odin_data`. Neither will be changed.
- Source baseline hashes: `source-manifest.json`; preexisting Git status in ignored `.av8/`.
- AV8 uses independent dev/test PostgreSQL instances, volumes, credentials and localhost ports. Runtime verifies resource marker and exact endpoints. Outbound and inherited jobs disabled.

## Reuse audit
- Reuse: AuthService/session/MFA, permission registry/company membership/branch scopes, Customer/Supplier identities, ApprovalEvent/AuditEvent, private attachment validators, journal posting/period locks, document numbering, bank resources, print/CSV, existing Next components/localization.
- Gaps: no recruitment CRM, student application, academic document checklist, visa/travel, installment contracts or academy pass-through subledger. These require additive domain tables and authorized services.
- No framework/dependency upgrades or destructive shared-table changes planned.

## Milestones
- [x] Source and resource audit; workspace clarified.
- [x] Isolated dev/test provisioning and configuration proof.
- [x] CRM/admissions and immutable contracts.
- [x] Documents/English/visa/travel/progress and permissions.
- [x] Collections/refunds/academy remittances using existing journals.
- [x] Connected bilingual staff screens, queues, statements/reports.
- [x] Behavioral/database/security tests; type/build/browser checks.
- [x] Operating notes and final evidence.

## Delivered behavior and main files

- CRM capture, duplicate-aware CSV preview/import, assignment, first-contact and long nurture dates, appointment/no-show/reschedule history, consultations and multiple applications linked to the same customer.
- Independent student tracks; cleared USD 2,000 fee guard before medical; failure refund request; pass/visa academy milestones; immutable signed terms and approved plan amendments; document versions and sensitive access; visa/travel readiness and factual departure exceptions; monthly reporting periods, guardian consent and tasks.
- Exact integer money, original currency and explicit historical rates; receipt allocation, unapplied cash, refund approval/payment/credit, partial and multi-student remittances, deferred forwarding in full, idempotency and concurrent posting controls. Uses existing bank transactions, numbering, balanced journals, financial authority and locked periods.
- Arabic/English staff UI, mobile layout, searchable/paginated lists, actionable queues, source/owner conversion reports, applications/medical/collections/academy/commission reports, authorized CSV and printable HTML/PDF. Student statements exclude academy commission details.
- Backend: `apps/api/src/av8-{domain,access,finance.service,service,controller,print,isolation}.ts`, existing `erp.service.ts` integration, additive permission registrations. Seed: `apps/api/prisma/av8-seed.ts`.
- Frontend: `apps/web/src/screens/av8*.tsx`, `core/av8-copy.ts`, `app/av8.css`, existing navigation/session/localization components, and AV8 branding.
- Runtime: `scripts/av8/run.mjs`, `scripts/av8/init-local.mjs`, `.env.av8.example`. Node 24 and all generated secrets/build outputs are isolated in ignored locations.

## Data impact

Four new forward migrations (`20261024180000`, `20261024210000`, `20261024213000`, `20261024220000`) add AV8 tables, scoped references, RLS, immutable evidence/snapshots and financial constraints. Existing baseline migrations were applied only to the two empty AV8 instances. No shared business table was dropped or renamed.

Dev contains private review accounts, draft business settings, a clearly synthetic academy, and synthetic browser-review leads/applications. Test contains synthetic scenario records and explicitly approved **test-only** commercial fixtures. No original customer data was copied. No files from the 357-file source checkpoint were removed; existing work was retained. No Git push occurred. After the initial local implementation, the user requested Vercel deployment; that separate release is documented below.

## Observed verification

| Check | Result |
| --- | --- |
| Dedicated dev/test container labels, localhost ports, volume identity and database markers | Passed, both resources |
| API TypeScript; frontend TypeScript in production build | Passed |
| Full root production build (Nest + Next) | Passed |
| AV8 domain and real PostgreSQL workflow tests | 20 passed across 2 suites |
| Arabic student PDF regression, using Poppler extraction and font inspection | 1 passed |
| Existing money, permissions, access governance, attachments, accounting CSV/PDF/workspace, deployment and MFA tests | 97 passed across 9 suites |
| Browser page identity, meaningful content, no framework overlay | Passed |
| Browser console | No errors |
| Desktop 1440×1000 and Arabic mobile 390×844 | Passed; no page overflow |
| Git whitespace check | Passed |

Browser plugin was unavailable. Used the installed Playwright package with already-installed Chromium 1248; no browser or package downloads. Browser flow: real login → capture synthetic lead → first contact → schedule appointment → attendance → convert → inspect USD 2,000 fee schedule → Arabic documents → mobile view → draft plan previews → source-performance report → appointments/affairs/finance screens. API PDF download and rendered Arabic PDF were also checked.

Evidence is outside the repository at `/tmp/av8-erp-qa-20261024/`: `result.json`, `dashboard-en.png`, `student-ar-desktop.png`, `student-ar-mobile.png`, `policies-ar.png`, `statement-ar.pdf`, `statement-ar.png`. Browser script: `/tmp/av8-browser-qa.cjs`. Logs are ignored under `.av8/`: `build.log`, `behavioral-test.log`, `regression-test.log`, `print-test.log`, `browser-test.log`. Temporary evidence may not survive host cleanup.

Commands used (through the AV8 launcher): `npm run build`; Jest with `scripts/av8/jest.config.cjs` for AV8 tests and an explicit existing-unit-test regex for regressions; Node `/tmp/av8-browser-qa.cjs`. Browser uses Chromium `launch`, `goto`, accessible labels, real form submission, screenshots and console listeners.

## Review and operational boundaries

Preview remains running at `http://127.0.0.1:8180`; forward port 8180 over SSH. Follow [OPERATIONS.md](OPERATIONS.md) for private login access, startup, AV8-only backups and recovery.

Commercial draft terms still need authorized approval; see [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md). No outward messaging, bank-provider transfer, academy synchronization, malware scanning or student/guardian portal is configured or claimed as tested. Legal contract wording and embassy requirements are operational drafts/client guidance. Exceptional refunds/FX adjustments and corrections involving established academy obligations need approved reconciliation decisions, not invented automatic rules.

Financial scenarios were exercised through real Nest/Prisma/PostgreSQL services and direct API authorization checks. The browser pass covered the recruitment-to-application path and staff screens; it did not click every financial approval/amendment combination, every role, or browsers other than Chromium. Reports currently compute scoped aggregates in application memory before pagination; large-dataset performance and a backup/restore drill were not tested. PostgreSQL driver emits a deprecation warning for concurrent queries on one transaction client; tests pass, but future pg upgrades should replace those query batches with sequential awaits.

## Vercel release — 24 October 2026

Deployed the working tree to the new `av8-erp` frontend and `av8-erp-api` projects in the user's Vercel team. Production has its own newly provisioned Neon database, identity marker and restricted runtime role; migrations and empty-only configuration seed completed. No existing Odin or AV8 marketing resources were changed. The user explicitly approved production secret storage. See [VERCEL.md](VERCEL.md) for identifiers, access and maintenance.

Hosting changes: production database/project guards; bounded PostgreSQL pools; OIDC-capable same-origin API proxy preserving sessions and authorization; Node 24 native NestJS deployment; private 4 MiB uploads; PDF-font startup checks. Next.js and compatible dependencies received security patches before deployment. Local production builds passed, and the expanded regression run passed **120 tests across 13 suites**. One concurrent local API build ran out of host memory; rerunning it alone passed.

Live checks verified frontend → API → PostgreSQL health, anonymous access denial, administrator MFA enrollment requirement, real telesales login, reference/lead reads, finance permission denial, secure HttpOnly session-cookie refresh, Arabic mobile layout and logout. No business records were created by production smoke tests. Separate local tests cover the full workflow and finance scenarios.

## QA report corrections — 25 October 2026

The user approved implementing and testing the supplied QA report inside `odin-erp`. The report's suggested separate directory did not override the user's existing workspace choice. Existing source changes were preserved. All new business scenarios ran against the dedicated AV8 dev/test databases; commercial approvals used by automated tests are synthetic fixtures.

- D01: financial calendar dates keep their day across browser timezones; operational timestamps and default dates use Africa/Cairo. Tests cover browsers west/east of UTC, midnight and Egyptian daylight saving.
- D02: CSV money uses exact major units, readable Arabic headings, explicit original/USD currencies and spreadsheet-injection escaping. The collections screen distinguishes original currency from USD equivalents.
- D03–D04: appointment selection loads saved status/time/location; document editing starts at its current state and exposes permitted transitions. Note-only changes preserve other data. Bank-statement relationship fields appear only for the bank document.
- D05: an omitted exception status creates a decision request. Student affairs may request; management approval/rejection remains separately authorized. Requests do not post money.
- D06–D07: statement totals/lines show account currency. Bank forms start with empty monetary/reference values and explicit dates. Generic bank posting cannot silently post a foreign-currency amount as base currency; foreign-currency student money uses the existing AV8 historical-rate workflow.
- D08–D12: Cairo date/time controls replace ISO text; unusable/unassigned branch options are filtered; audit search includes displayed/localized actions and recorded references; dashboard cards retain their filter; approval links open the selected journal.
- Student navigation uses five workflow groups, a next-action/owner/follow-up summary, and links from readiness blockers. Current tabs survive downloads/reloads. Task cards show owner/due date; progress explains predeparture eligibility and supports report grades and completion percentages after departure. Field/status labels, upload guidance and finance-rate previews are clearer.
- Supported administration now includes protected staff creation with step-up verification, active role/branch validation, company membership and credential-free audit records. Settings link to users, academy partner editing and AV8 role scopes. Student identity corrections preserve the shared contact and immutable before/after audit evidence. The sidebar can stay pinned. Accounting PDF product branding is AV8.

Verification: production builds passed; **130 Jest checks in 14 suites**, plus **2 native date-format/control tests**, passed. The database scenarios include approved test-only installment policies, collections/FX/partial payments, medical refunds, remittances, a fully eligible journey through arrival, monthly academic reporting, guardian-consent denial, RLS and bank reconciliation. Browser checks reproduced the original appointment/document/CSV defects before replacement, then passed on the corrected build. English desktop (1440×1000), Arabic mobile (390×844), four separate staff roles and actual protected user creation were exercised. Browser plugin was unavailable; installed Playwright/Chromium was used without new dependencies.

Evidence is outside the repository at `/tmp/av8-qa-report-20261025/`, with baseline/corrected screenshots, CSV, PDF, `before.json`, `after.json` and `roles.json`. Private build/test logs are in `.av8/`. No schema migration is required. Client approval of accounting mappings, installment interpretation, academy settlement/commission and the real academy identity remains necessary before operational acceptance. Backup restoration and load testing remain outside this verification.

The corrected API/frontend were also staged and promoted on the same two existing AV8 Vercel projects. Read-only live browser QA passed on `https://av8-erp.vercel.app`, including the original QA student's appointment/document editors, CSV amounts/currency, PDF/tab persistence, FX preview, bank defaults, Arabic desktop/mobile and user-management form. No production business data or commercial approvals were changed by these checks. Live evidence is `live.json`, `live-ar-desktop.png` and `live-ar-mobile.png` in the same evidence directory. See [VERCEL.md](VERCEL.md#current-live-release--qa-corrections-25-october-2026) for deployment IDs, current authentication settings and release details.
