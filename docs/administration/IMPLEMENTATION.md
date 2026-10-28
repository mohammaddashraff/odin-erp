# Administration, accounts and access — implementation handoff

Implemented in the existing NestJS/Prisma/PostgreSQL API and Next.js/React ODIN interface. Existing uncommitted repository work was retained. The initial implementation phase performed no production deployment or migration. The user subsequently authorized deployment; see [the production release record](DEPLOYMENT.md). No reset, reseed or invitation delivery was performed.

## Using the application

Open **Settings & Administration → Users → Add user**. Choose the account's group and operational branch, enter the temporary password, and submit **Create user**. The resulting profile explains first sign-in. Share credentials securely using your existing process; the application does not claim to send an email. New temporary passwords expire after seven days; recovery passwords expire after 24 hours. The user must choose a different password before accessing business APIs.

Open a user's name for **Details**, **Access**, **Account & Security**, and **Activity**. Access editing includes additional groups and individual exceptions under **Customize access**. **Preview changes** evaluates the unsaved proposal on the server. Save revokes affected sessions. Existing identity re-verification and business policies remain in force; routine actions have no new mandatory reason/review/approval step.

Every authenticated user has **My Profile** in the header account menu. Name, contact details, language and password are self-service; access and branch assignments are read-only. Account identity remains separate from HR employees and students. Initials are used because the existing app has no account-avatar upload service.

## Routes and boundaries

| Route | Result |
| --- | --- |
| `/admin/overview` | Authorized active/inactive user counts, group count and actual account/access activity |
| `/settings/access/users` | Search, status/group/branch filters and stable profile links |
| `/settings/access/users/new` | Account creation and compact access explanation |
| `/settings/access/users/:id` | Administrator profile with four sections |
| `/my-profile` | Independent self-service API and screen; no administration permission needed |
| `/settings/access/roles` | Access groups; create, duplicate, edit and archive |
| `/admin/audit`, `/settings/access/audit` | Compatible Activity Log routes with authorized general/account views |
| `/settings/access/governance` | User selector leading to the authoritative profile access summary |
| `/admin/advanced` | Catalog, review, financial authority and diagnostic links |
| `/settings/access/permissions` | Searchable readable permission catalog; technical keys restricted to advanced details |
| `/settings/access/reviews` | Existing formal review operation, with its existing reason requirement |
| `/settings/access/limits` | Currency-specific company authority policies, readable existing caps and supported creation |
| `/admin/system-health` | Protected simple service status; no ordinary audit-page reset control |

Tenant-wide login-account and role mutations retain the existing `system.super_admin` requirement. Company administrators can read only authorized company/branch users and use existing governed operations. This refactor does not silently grant company administrators tenant-wide account-editing authority. Self-service writes have a separate field allowlist and reject identity/access/status/company changes.

## Authorization implementation notes

- The resolver in `access-governance.ts` and `AuthService.actorFor` remain authoritative. The browser displays server summaries and proposed results; it does not calculate access.
- Active primary and additional roles contribute grants, including normalized legacy aliases and relational permission assignments. Direct explicit denials override grants, including administrator grants. Removing one source leaves access granted by another source intact.
- Role scope selection preserves the existing most-permissive order: `NONE < OWN < ASSIGNED < TEAM < DEPARTMENT < WAREHOUSE < BRANCH < ALL`. Equal-ranked configurations use the existing resolver's first result; lists are not newly unioned. Field rules retain `HIDDEN < VIEW < EDIT` precedence.
- AV8 leads/applications use `ownerId` for both OWN and ASSIGNED. TEAM uses configured user IDs. Missing/NONE scope yields no records. BRANCH and ALL remain inside the user's permitted company/branch envelope. System administrators retain existing tenant-wide behavior.
- Generic document OWN means creator; ASSIGNED means the linked salesperson, falling back to creator when no employee is linked. Customer OWN/ASSIGNED means owner. Employee OWN/ASSIGNED means the linked employee account. Journal/payment OWN/ASSIGNED means creator. Team fallbacks and department/warehouse constraints remain those of each evaluator.
- Bank-account/account/supplier ASSIGNED uses explicit resources and applicable governed assignments; ALL stays in the company envelope. It does not mean cross-tenant access.
- The group editor offers verified modes for each mapped resource. Unmapped legacy resources retain their stored configuration, shown read-only with an explanation; the UI does not pretend an unsupported mode changes enforcement.
- Membership validity, company branch links, temporary grants, delegations and assignment expiry are respected by the existing actor evaluation. Their saved lifecycle is included in the summary. Existing governed endpoints were retained.
- AV8 sensitive projections are now evaluated in the specific record's company. Medical/document/bank/guardian restrictions also cover applicable detail, timeline, document download, print, export and queue responses; permission in a second company cannot expose these fields in the first.
- Active sessions are checked against current account status, `authVersion` and session revocation on requests. Password recovery/change, access changes and deactivation revoke applicable sessions. Temporary credentials cannot open business APIs, even through a crafted direct request.
- Last-administrator protection evaluates effective administrator access, including custom role keys and excluding expired temporary credentials. Checks and mutations occur in the existing serializable tenant transaction with retry; concurrent removal is tested.
- Preview is read-only. A revision hash includes role policies, memberships, overrides, grants and assignments. Save rejects a stale access revision. Profile writes use a separate profile version. Role writes use their current modification timestamp.

## Preservation and money

Role PATCH omission means unchanged. The editor submits only changed top-level sections, keeping invisible keys and configurations when editing a visible section. Explicit removals are deliberate. Unknown/custom permissions are identified as such; their business meaning is not invented. Renaming/describing a group does not modify policy or revoke sessions. Six default AV8 role labels are presentation metadata, with descriptions derived from their actual grants; IDs and grants were not replaced.

The existing legacy role-limit engine uses transaction-currency minor units and the accounting engine's fixed two-decimal unit, with no currency selector or implicit conversion. Role limits combine using the existing maximum-value rule. Zero blocks positive amounts where that limit is enforced; explicit JSON null is evaluated as zero; absence uses the operation's existing fallback. Existing custom structures are retained. New edits reject amounts beyond the old engine's safe integer range instead of silently rounding them.

Company authority policies are currency-specific and store exact PostgreSQL bigint minor amounts. The screen uses each configured currency's precision and string/BigInt conversion; KWD at three decimals is tested. Of matching active policies, the lowest cap applies regardless of priority; no matching policy adds no extra cap. A null amount on a percentage policy adds no amount cap; zero is a real zero cap. No exchange-rate conversion is introduced. The original company-policy operation still requires a reason. The existing backend supports creating caps, not an invented edit/delete action.

## Additive migration

`apps/api/prisma/migrations/20261026160000_account_profiles/migration.sql` adds account contact/home-branch/profile-version, temporary-credential and real sign-in tracking fields, plus `branches.operational`.

Existing accounts keep their credentials and are not forced through first-password change. Existing sign-in history is unknown until an actual successful authentication is recorded; newly tracked accounts can truthfully show never signed in. Only the exact seeded `TEST / Synthetic second branch` record in a tenant with an `AV8_ISOLATED_BOOTSTRAP` event whose `synthetic` flag is true is marked non-operational. No assignment, record or history is deleted or remapped.

During initial verification, applied successfully to the isolated test database:

```sh
.av8/bin/node scripts/av8/run.mjs test npm run db:migrate -w @odin/api
.av8/bin/node scripts/av8/run.mjs test npm run db:generate -w @odin/api
```

For a separately authorized release, back up the intended database, run Prisma `migrate deploy` with that environment, regenerate Prisma, then deploy the compatible API/web builds. Use the migration command, **not** `release:migrate`, whose existing script also runs the seed. Do not reset or reseed.

Rollback should leave these additive columns and historical data in place. Keep the temporary-password restriction in any rolled-back API; an older authentication build does not understand it. If rolling back past that guard, first suspend outstanding temporary-password accounts and revoke their sessions through a reviewed recovery procedure. Restore app behavior before considering any later schema cleanup; no destructive down migration was run or supplied as an automatic step.

## Verification and review artifacts

Commands executed with the bundled Node 24 runtime and verified isolated database:

```sh
.av8/bin/node scripts/av8/run.mjs test npm run lint
.av8/bin/node scripts/av8/run.mjs test npm run build
.av8/bin/node scripts/av8/run.mjs test npm exec --workspace @odin/api -- jest --runInBand --testPathPatterns='administration|access-governance|permissions|authorization-denial|mfa-security|deployment-config|av8-domain|av8-isolation|av8-print|av8-qa'
.av8/bin/node scripts/av8/run.mjs test npm exec -- playwright test -c playwright.administration.config.ts
.av8/bin/node scripts/check-translations.mjs
git diff --check
```

API suite: **85 tests across 11 suites passed**. Coverage includes atomic/duplicate creation, first-password gating, self-service privilege attacks, stale writes, company/branch record and sensitive boundaries, hidden policy preservation, precedence, preview/no-write behavior, session invalidation, expiring recovery, concurrent last-administrator removal, exact currency caps, self-activity isolation and protected diagnostics. No reset endpoint was invoked.

Repository lint is TypeScript checking; API/web checks and the production build passed. All **3 Playwright journeys passed** against the production build: navigation/access preview/Arabic RTL, currency-cap persistence/keyboard input, and create/profile/first-login/password/self-edit/deactivation. Chromium exercises desktop and 390px Arabic RTL sizes. Screenshots are from actual rendered pages. The installed browser is used directly through Playwright because a browser connector was not available. Its path is configured in `playwright.administration.config.ts`; another machine can substitute its Chromium installation.

Full-repository translation audit still reports the pre-existing branding allowlist (3 keys), unrelated AV8 visible English (5 occurrences), and the AV8 dictionary being treated as source (513 Arabic occurrences). It also flags four valid `UTF-8` technical terms in new Arabic password help. New administration visible literal keys have translations; there are no missing dictionary values or duplicate keys. These broad audit findings were not disguised as a passing whole-repository audit.

Local preview: <http://127.0.0.1:8180/admin/overview> (API on 8181, isolated database on 5549). Local synthetic test credentials are in `.av8/administration-preview.json`, generated with file mode 0600 and ignored by Git. No password is copied into this handoff or screenshots.

Screenshots are kept outside the repository:

- [Overview](/tmp/av8-administration-qa/overview-en.png), [Users](/tmp/av8-administration-qa/users-en.png), [Create user](/tmp/av8-administration-qa/create-user-en.png).
- [Administrator profile](/tmp/av8-administration-qa/profile-en.png), [Effective access](/tmp/av8-administration-qa/access-summary-en.png), [Unsaved preview](/tmp/av8-administration-qa/access-preview-en.png).
- [My Profile](/tmp/av8-administration-qa/my-profile-en.png), [Non-admin My Profile](/tmp/av8-administration-qa/my-profile-non-admin-en.png), [Activity](/tmp/av8-administration-qa/activity-en.png).
- [Arabic users](/tmp/av8-administration-qa/users-ar.png), [Arabic mobile users](/tmp/av8-administration-qa/users-ar-mobile.png), [Arabic mobile access](/tmp/av8-administration-qa/access-ar-mobile.png), [Currency caps](/tmp/av8-administration-qa/company-limits-en.png).

Logs: `/tmp/administration-security-tests.log`, `/tmp/administration-browser-tests.log`, `/tmp/administration-lint.log`, `/tmp/administration-build.log`, `/tmp/administration-api-build.log`, `/tmp/administration-translations.json`. Browser validation covers Chromium only; Safari, Firefox and assistive-technology sessions were not exercised.

The follow-up production deployment was explicitly authorized and completed. Its applied migration, deployment IDs, backup and live verification are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).
