# Production release — 27 October 2026 (Cairo)

The user authorized deployment after the local implementation handoff. Both production projects are now READY and were explicitly promoted after staging.

- Frontend: https://av8-erp.vercel.app — `dpl_HT5Jpm7Sag9P8G28P3wGhBBgap3P`.
- API: https://av8-erp-api.vercel.app — `dpl_DEAk5CzXEi2u1AnJ73bK2YUhKPmx`.
- Existing Vercel team/projects, protection rules, authentication mode, secrets and outbound-service settings were retained. No Git push or commit was made; the reviewed working tree was uploaded. The upload excluded private environment files, `.av8` contents, database dumps and test artifacts.

A full PostgreSQL custom-format backup was created before migration at `.av8/administration-release/before.dump` (0600, ignored by Git). A PostgreSQL 18 client matched the hosted server. The archive was checked with `pg_restore --list`; no restore was performed. This local backup is not off-site disaster recovery.

Only `20261026160000_account_profiles` was pending and applied. No reset, seed, credential reset, account creation, permission reassignment or business-data mutation was used for production verification. Before/after counts across 12 account/business tables and fingerprints of account identities/credentials and authorization relationships showed no differences. The exact confirmed fixture branch was excluded from future operational choices by the migration; existing assignments remained intact.

Verification:

- Both Vercel production builds completed successfully. Stable hostnames resolve to the deployment IDs above.
- Staged API and frontend-proxied health returned HTTP 200 with API/database OK.
- Existing role login succeeded; the new self-profile endpoint returned the added fields; anonymous access returned 401 and non-admin administration access returned 403.
- Live Chromium at the stable frontend passed My Profile, read-only effective access, English desktop and Arabic RTL at 390px, with no browser exceptions or 5xx responses. Business writes were blocked. Only normal login/logout/sign-in audit activity was generated.
- Existing financial/inventory integrity checks passed: balanced posted journals, no negative stock, and zero ledger/inventory/receivable/payable differences.
- Runtime log scan: no frontend errors. One API stderr entry was the existing `pg` concurrent-query deprecation warning on a successful profile request; no failed application request was found in these checks. No new log drain or monitoring service was configured.

Read-only browser evidence: `/tmp/av8-administration-live/result.json`, `my-profile-en.png`, `self-access-en.png`, `self-access-ar-mobile.png`. Private command logs and backup metadata remain under `.av8/administration-release` and `/tmp/administration-*`.

Previous deployment IDs retained for reference: frontend `dpl_EpNMPh8WgbBL76NDFRMLKb6iSLPc`, API `dpl_pLZ5gZqUv6Cdt3V3SeZkkSkGTBUZ`. A frontend rollback can promote the prior frontend. Do not blindly roll the API back past temporary-password enforcement if new temporary credentials have since been issued: preserve the new guard or suspend/recover outstanding temporary accounts first. Keep the additive columns; never reset production to roll back code.

[Implementation and migration semantics](IMPLEMENTATION.md) · [Deployment metadata](deployment.json)
