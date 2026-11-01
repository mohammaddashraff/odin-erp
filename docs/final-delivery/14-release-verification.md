# Exact release verification and handover

Application commit: **170b929bd4749e3ae53c7dcb0155e90d617210d9**. Delivery branch: `codex/av8-final-delivery-20261031`. [Pull request 10](https://github.com/mohammaddashraff/odin-erp/pull/10). Main and its existing deployments were preserved. A later documentation-only commit carries this handover without relabelling the tested application image.

[Final CI run 41235646385](https://github.com/mohammaddashraff/odin-erp/actions/runs/41235646385) is successful. Its [downloadable artifact](https://github.com/mohammaddashraff/odin-erp/actions/runs/41235646385/artifacts/13056031795) has ZIP SHA256 `99727f68aced314f0747876c34a95762c45bb966669576dda5a1211a1ab9bbaf`. Repository copies retain the useful synthetic evidence beyond the CI artifact's 14-day retention.

## Commands and results

| Command / actual check | Result |
|---|---|
| `npm ci --ignore-scripts` and isolated `db:generate`, `db:validate`, `db:migrate`, `db:seed` | PASS in CI; seed confined to synthetic CI/dev/test, never hosted production |
| `npm run lint`, isolated `npm run typecheck`, `npm run i18n:audit` | PASS; zero unresolved i18n audit entries |
| `node --test scripts/av8/web-isolation.test.mjs` and `node --test deploy/hetzner/*.test.mjs` | PASS; 50 total checks |
| `npm run security:history`, `npm run security:audit`, `npm run security:scan` | PASS; scope/residual tooling advisories are in the security inventory; no independent pentest or antivirus certification claimed |
| `node scripts/av8/run.mjs test npm test` | PASS 428/428, 54 suites in exact-commit CI |
| `node scripts/av8/run.mjs test npm run integrity` | PASS; final local dev/test reports also have zero exceptions across 1 development / 27 test company reports |
| `node scripts/av8/run.mjs test npm run build` | PASS; Linux Hetzner images built from the exact archived commit |
| Sequential guarded POS/supplier/finance/operations/opening fixtures, then `node scripts/av8/run.mjs test env AV8_BROWSER_PRODUCTION=1 npx playwright test -c playwright.delivery.config.ts` | PASS21/21 in 7.2 minutes;312route variants |
| `node scripts/av8/run.mjs test node scripts/av8/recovery-drill.mjs` | PASS in CI 1.991 seconds; local final 1.550 seconds. Ephemeral test archive is not an operational backup |
| `node deploy/hetzner/restore-drill.mjs ... --writers-quiesced` with explicit protected staging paths | PASS 15.535 seconds on exact hosted API image; retained operational archive/key, API/MFA/PDF and source preservation verified |
| Guarded `hosted-browser-smoke.mjs` and `production-browser-smoke.mjs` | PASS on exact deployed images; HTTPS certificate validation enabled, real bilingual interactions/CSP/API/no-store checks |
| Systemd unit validation, first backup/monitor invocations and periodic runs | PASS; separate staging/production instances, durable state, daily 03:15 UTC backup, no auto-deletion |
| Render actual Linux CI PDFs with Poppler and inspect all pages | PASS 19/19 PDFs/pages with exact hashes and source arithmetic |

## Immutable artifacts

| Image | Image ID |
|---|---|
| API | `sha256:f451d7fc74979cfe70efbca41fe1dee0509e39404bd63ff92942b5f2600f507d` |
| Web | `sha256:425ff680c0f7b9b3ebab6ac9d625ee1145c2c1f3384fa58eaa64416ce6d945a9` |
| Maintenance | `sha256:e4ca1a8f589ae894014f27f39f4e3d06bd20ca856258b7b234f0347415d67f15` |
| PostgreSQL | `postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |

All three application images carry the exact application commit label. Source archive SHA256 is `f188e03c17fcceafb975123f62bc431edf2f4e6b4f8a06f50b7142a7ee34663f`. [Release manifest](evidence/release-manifest.json) includes all 43 source migration checksums; [actual host inventory](evidence/hosted-release-inventory.json) includes applied checksums, image IDs, health, engine versions and backup/timer state for both environments.

## Environment verdict

Staging is ready for the stated controlled acceptance: isolated data/credentials/storage/jobs, actual dual-recipient email and alert delivery, durable restart/deduplication, final-image browser/restore proof. Production is deployed at [https://av8.odin-ltd.com](https://av8.odin-ltd.com) and verified for secure initial administration. DNS resolves to 2.28.75.201; trusted HTTPS/login/API and HTTP301 pass. Other host applications remain preserved.

Production email/academic sending and email alerts are disabled pending the distinct production provider key. Business policies remain DRAFT pending actual approvals, and no real-data cutover/client sign-off was performed. These are explicit activation dependencies, not silently completed acceptance. See [readiness and exact actions](11-release-notes-and-readiness.md).

“Off-host encrypted backups and recovery from an off-host destination: deferred by the project owner.”

External disaster recovery and proposed RPO/RTO targets have not been verified. No government submission, actual bank transfer, real student disciplinary action, independent penetration-test certification or legal/tax/e-signature compliance approval was performed or claimed.
