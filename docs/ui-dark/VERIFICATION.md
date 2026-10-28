# ODIN dark glass UI — implementation and verification

Branch: `feature/odin-erp-glass-redesign` · baseline: `637348d` · reviewed 2026-10-28.

## What changed

The entire frontend now uses midnight navy surfaces, blue lighting, translucent cards, clear light typography and shared semantic tokens. The horizontal permission-filtered navigation includes module menus, overflow navigation, breadcrumbs, page search and an accessible mobile drawer. Existing table, form, dialog, report, HR, POS, administration and AV8 layouts retain their behavior and consume the shared system.

The ERP dashboard uses the existing `/dashboard` and `/documents` APIs. Its four cards, currency/year-filtered net-sales chart, recent documents, inventory attention and financial overview follow the supplied composition. Exact minor-unit arithmetic and existing field/route checks remain in place. Users without financial dashboard permission retain the AV8 daily view; authorized users can reach it through **AV8 workspace → Daily workspace** or `/dashboard?view=daily`.

No backend code, schema, API contract, package dependencies, authentication implementation or financial/inventory rules changed. No production deployment, merge, migration or production data mutation was performed.

## Reference comparison

Reference: [supplied design](../design/odin-erp-dark-reference.png). Desktop review size: **1672 × 941**.

1. The 74px brand header, 58px horizontal navigation and 26px gutters reproduce the reference's overall structure. The official existing OSS geometric-eye asset is retained rather than redrawn.
2. Four 245px KPI cards use 19px gaps, fine blue borders, circular illuminated icons, translucent gradients and large white amounts.
3. The next row uses two equal panels, a smooth blue area chart, subtle gridlines and aligned transaction rows with emerald status pills. The lower row pairs inventory with financial information.
4. Navy backgrounds, upper blue lighting, 14–16px radii, light text, restrained glow and the installed Manrope/Noto Arabic/Lucide assets carry through module screens and dialogs.
5. Mobile uses 4/2/1 card columns, a focus-contained drawer, stacked transaction metadata and a scrollable chart. RTL mirrors navigation and content. Print uses a light paper palette.

Intentional differences preserve product behavior: navigation labels reflect existing modules; no nonfunctional theme/apps/notification controls were invented. Existing financial metrics replace screenshot-only values. No unsupported growth percentages, historical comparisons or top-selling product ranking were fabricated. Inventory attention uses existing data. The revenue chart explicitly covers the latest 200 accessible documents, keeps currencies separate and hides restricted totals; it is not a replacement for ledger reports.

## Browser evidence

**Every screenshot below uses synthetic, test-only API fixtures.** The app itself continues to request real data. No demo records or mock endpoints were added to production components.

| Screen | Screenshot |
| --- | --- |
| ERP dashboard | [Desktop](screenshots/dashboard-desktop.png), [320px mobile](screenshots/dashboard-mobile.png) |
| AV8 daily workspace | [Dashboard](screenshots/av8-dashboard.png) |
| Lead entry | [Dialog](screenshots/lead-dialog.png) |
| Student nested detail | [Travel preparation](screenshots/student-detail.png) |
| User administration | [Users](screenshots/users-desktop.png) |
| Accounting | [English](screenshots/accounting-desktop.png), [Arabic](screenshots/accounting-arabic.png), [Arabic mobile](screenshots/mobile-arabic.png) |
| Sales | [Invoices](screenshots/sales-invoices.png) |
| Inventory | [Items](screenshots/inventory-items.png) |
| HR | [Employees](screenshots/hr-employees.png) |
| Point of sale | [Workspace](screenshots/pos.png) |
| Banking | [Transactions](screenshots/banking.png) |
| Journals | [List](screenshots/journals.png) |
| Authentication | [Login](screenshots/login.png) |

The [route-by-route tracker](../ODIN_UI_REDESIGN_TRACKER.md) distinguishes implementation coverage, populated/empty-state browser checks and unverified integrations.

## Reproduce the isolated frontend review

Use Node 24 and installed project dependencies. No database is needed for this fixture-backed visual suite. The environment's Prisma download restriction required `npm ci --ignore-scripts`; full backend setup remains separate.

```sh
export AV8_ENV=dev AV8_OUTBOUND=disabled
export API_ORIGIN=http://127.0.0.1:8181 ODIN_UI_BUILD_DIR=.next-av8
npm run build -w @odin/web
npm run start -w @odin/web
# In another terminal:
npm run lint -w @odin/web
npx playwright test --config playwright.glass.config.ts
ODIN_UI_QA_URL=http://127.0.0.1:8180 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test tests/ui-v2/navigation-motion.spec.ts tests/ui-v2/localization-contracts.spec.ts -g 'horizontal menus|Arabic formatters|display permissions|numeric API'
node --import tsx tests/av8/dates.test.ts
npm exec --workspace @odin/api -- jest --runInBand --runTestsByPath src/money.spec.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to your installed Chromium executable if it is not `/usr/bin/chromium`. The suite intercepts `/api/**` only inside test browser contexts and never sends fixture writes to a backend.

## Checks and remaining limits

- Frontend production build and `tsc --noEmit`: pass.
- Redesign suite: **8 passed** on the production frontend build; includes 78 registered routes, five additional dynamic/query entries, root, ten redirects, bilingual 404, 13 student tabs, widths 1672/1280/768/390/320, search, login validation, lead save payload, dialogs, permissions, currency separation, returns, protected totals, RTL and print.
- Existing navigation/localization/permission tests: 5 passed.
- Existing date tests: 2 passed. Existing exact-money tests: 3 passed.
- Repository-wide `npm run typecheck` cannot pass before Prisma Client generation: missing Prisma exports and dependent types. Backend-dependent build, integration, security and full business workflow suites were not run in this environment.
- Translation audit remains failing on pre-existing findings. Baseline → final counts: missing keys 3 → 2; hardcoded English 5 → 4; Arabic outside the primary dictionary 513 → 513; suspicious Arabic values 4 → 4; missing values and duplicate keys remain zero. No new audit findings were introduced.
- Real login/MFA, persistent CRUD, attachments, financial posting, bank reconciliation, POS sales, exports, permission enforcement against real scoped records and complete accounting calculations require an isolated working backend. The fixture-backed tests establish UI behavior, not end-to-end business correctness.
- Review the live workflow suite and populated financial/administrative screens against that isolated backend before approving production release. The old sidebar assertions were migrated to the new navigation; transaction assertions were retained.
- GitHub API access is currently blocked by network policy. `api.github.com` was added to the saved environment configuration draft alongside the existing `binaries.prisma.sh` request. Saving that draft does not apply/publish it. Git delivery status is recorded separately in the final handoff.

This is a reviewable frontend redesign. Full live integration acceptance and production approval remain outstanding.
