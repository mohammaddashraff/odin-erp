# ODIN frontend replacement and rollback

## Boundaries

This replacement is a frontend change in the existing Next.js application. API source, Prisma schema/migrations, authentication endpoints and storage keys, permission identifiers, accounting/inventory rules, and deployed backend configuration are preserved. User changes already present in the API, packages, deployment files and QA documents remain intact.

The user explicitly replied **“create”** to the isolated-QA request. The QA PostgreSQL container `odin-ui-v2-qa-db` uses loopback 5547, the unchanged API uses 8183, and the built frontend preview uses 8184. Existing migrations and demo seed initialize only that isolated database. Runtime secrets remain in `/tmp/odin-ui-v2/qa.env` outside Git; no credential file is copied into the frontend or documentation.

The initial replacement gate left production unchanged. The user subsequently replied **“i authorize”** after deployment authorization was requested, authorizing the frontend-only release to the existing ERP service. Nginx, DNS and the corporate website remain outside the change. Final release evidence is recorded below.

## Replacement gate

The new application was implemented and tested in `apps/web-v2` before active application retirement. Gate evidence covers all 61 routes in English and Arabic, ten compatibility redirects, real create/edit/checker approval/post/reversal chains, private attachments, all 18 report exports, POS, banking, master data, user/role governance, sessions/MFA and denied API requests. [The parity ledger](ui-v2-parity.md) records test files and outcomes. [Brand and visual evidence](ui-v2-brand.md) records the original mark, fonts, source hashes and inspected screenshots.

The gate closed and the active local application switched to `apps/web`. The root production build, API/frontend typechecks, translation audit and production asset/security scan passed. The first active-path acceptance run passed all 29 tests. The expanded 30-test suite then passed, including cross-account notification isolation. A final restricted-price display correction was verified with the new regression and the affected editor workflows; the exact per-run results are recorded in [verification.json](ui-v2/verification.json). The subsequently authorized frontend-only public release is recorded below.

## Local run and verification

The existing workspace name `@odin/web` and package scripts remain unchanged. For normal development use the repository's documented API environment. For isolated acceptance use a separate local API/database and build-time `API_ORIGIN`:

```sh
API_ORIGIN=http://127.0.0.1:8183 npm run build -w @odin/web
npm exec -w @odin/web -- next start --hostname 127.0.0.1 --port 8184
ODIN_UI_QA_URL=http://127.0.0.1:8184 npm run test:e2e
npm run lint
npm run i18n:audit
npm run security:scan
```

`API_ORIGIN` is captured in Next.js rewrites at build time. It must match the intended API before building. The API's existing allowed-origin setting must include the local QA preview. Do not use the deployed demo or production database for this mutating acceptance suite. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium; otherwise Playwright's managed browser is used outside this QA host.

On this host Node 24 is temporarily available through `PATH=/tmp/odin-runtime/bin:$PATH`. The side-by-side preview used `ODIN_UI_BUILD_DIR=.next-production` to keep build output separate from development output. The final active preview runs the normal `apps/web/.next` build. That directory is ignored and is not application source. The normal build remains `.next`.

## Recoverable original checkpoint

Original Git HEAD: `f7d7407`. The checkpoint that also contains the pre-existing user changes is:

- Commit: `54e6ac7c2d20a9b624126b8a2515dee60e36f89e`.
- Branch: `checkpoint/ui-original-with-user-work-2026-09-26`.
- Bundle: `/srv/demo/backups/odin-before-ui-v2.bundle`.

The checkpoint was created with a temporary index, preserving the user's working tree and index. Secrets, runtime environments and build output were excluded.

To review or recover the original safely in a separate checkout:

```sh
git bundle verify /srv/demo/backups/odin-before-ui-v2.bundle
git worktree add ../odin-erp-original-ui checkpoint/ui-original-with-user-work-2026-09-26
```

To roll back an approved local change, first checkpoint any subsequent work. Restore the original `apps/web` plus its original browser tests/configuration and translation/security-check entry paths from that checkpoint, then run its build/checks. Backend/database rollback is not required for this frontend change. Deployment or switching a running public service still requires explicit authorization.

## Verification limits and preserved behavior

- Actual Chromium UI and API workflows ran against the isolated QA database. Physical barcode devices and external printers remain unverified. The authorized public rollout passed read-only browser and integrity checks; business mutations remain tested only in isolated QA.
- The backend caps general document responses at the latest 200 records. Sales/customer searches retain their existing server pagination; other lists search the complete returned collection before local pagination. Dashboard document sums are separately grouped by currency and explicitly describe that 200-document window; no invented series are shown.
- The existing manual-journal default cost center is `HEAD-OFFICE`. The seed does not assign that cost center, so the unchanged backend rejects it. Journal acceptance clears the optional cost-center field; it does not bypass assignment enforcement.
- The seeded CFO lacks a configured sales credit-approval limit. Sales acceptance uses the configured branch checker; the real server denial for an unsuitable checker remains intact.
- The backend test run emits an existing PostgreSQL adapter deprecation warning. It does not fail the tests.
- Destructive demo reset was preserved by contract review and server tests, rather than resetting the populated UI acceptance tenant at the end of the run.
- Dark-theme-specific legacy assertions are superseded by the requested single light workspace. Original behavioral assertions are mapped to the replacement suite; old presentation selectors are retired with the old markup.


## Verified replacement checkpoint

The completed replacement is retained on `checkpoint/ui-v2-verified-2026-09-26`, with a second complete-history bundle at `/srv/demo/backups/odin-ui-v2-verified.bundle`. The user's current index is preserved. Compare the two checkpoint branches to review only this replacement, independently of the pre-existing user work:

```sh
git diff --stat checkpoint/ui-original-with-user-work-2026-09-26 checkpoint/ui-v2-verified-2026-09-26
git worktree add ../odin-erp-ui-v2 checkpoint/ui-v2-verified-2026-09-26
```

## Authorized frontend-only release preparation

The release candidate derives from the exact deployed image `sha256:90884a53d63e5e5bdbe132a74eb80b9a966c64af0ade79fcbe651dc0104dfa4e`, retained as `odin-demo:before-ui-v2-20260926`. Only `apps/web` source, approved assets, frontend configuration and compiled output are replaced. The candidate's 164 backend files and dependency lock match the deployed image; runtime UID remains 1000. The frontend is rebuilt with the existing internal API origin `http://127.0.0.1:8081`.

A private database dump and password-free role companion were captured before rollout and the archive listing verified. Existing ledger, inventory, AR and AP differences were all zero, with no negative stock. No migration, seed, password reset or business-record mutation is part of this release.

The final local gate covers 34 unique acceptance tests. The long main runner ended after 32 completed passes; the unfinished attachment/MFA checks plus three completion checks passed in a separate five-test run. See the exact outcomes in `verification.json`.

## Completed public release and rollback

The authorized replacement is live at **https://demo.odin-ltd.com**. Active image: `sha256:0483f6229b68b1f4e5c272222c7acfecb14ae69780280f000d10ea125a545eb9`; release build ID: `qao1W32hnAMM0WawkX3RO`. Release-ready source checkpoint: `79997e50ebf4904272ba01b66a03e2469faf96ef`, branch `checkpoint/ui-v2-release-ready-2026-09-26`, complete-history bundle `/srv/demo/backups/odin-ui-v2-release.bundle`.

All 61 deployed routes passed read-only English browser checks; five representative Arabic routes, mobile navigation and login/logout also passed. No runtime errors or business-write requests occurred. Post-release ledger, inventory, AR and AP checks match the pre-release baseline; all differences are zero, with no negative stock. Runtime environment values and published ports remain unchanged. Nginx, DNS, corporate website, database schema and business records were not changed by the rollout. Authentication naturally creates/revokes session and audit records.

The initial release guard compared environment lists by order and rolled back even though their values matched. The successful retry compares variable names and values; a real difference still triggers rollback. The retained image was successfully used during that rollback.

To restore the previous UI image without a database change:

```sh
docker tag odin-demo:before-ui-v2-20260926 odin-demo:local
docker compose -f compose.deploy.yml up -d --no-deps --no-build app
```

No migration or seed ran, so image rollback requires no database restore. The verified pre-release dump and role companion remain private under `/srv/demo/backups`; their exact paths are in [deployment.json](ui-v2/deployment.json). Review current work before any future rollback.

Final source and deployment evidence are retained on `checkpoint/ui-v2-deployed-2026-09-26` and in `/srv/demo/backups/odin-ui-v2-deployed.bundle`. The current user index and unrelated uncommitted work are preserved.


## Subsequent accounting replacement

The accounting module was subsequently rebuilt with a real account hierarchy, journal register/editor, fiscal calendar, running ledgers and structured financial reports. The current release, additional API endpoints, tests and retained runtime are documented in [accounting release/recovery](accounting-v3/release.md). The frontend-only deployment evidence above describes the preceding release.
