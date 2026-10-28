# Accounting release and recovery

The accounting replacement is active at https://demo.odin-ltd.com following the user's explicit authorization for the ongoing replacement.

- Runtime image: `sha256:2a3eb612713e2f6ce84a94d7e3a55505892db8869c395cb4ca9f0feab23777e0`.
- Frontend build: `JOhrUV4sNUTLN4x4uNH4i`.
- Source implementation checkpoint: `ab2beebc2c9ab23fdbbfc5a994aca8c047a0c514`, branch `checkpoint/accounting-v3-ready-2026-09-26`.
- Prior accounting UI checkpoint: `checkpoint/accounting-before-rebuild-2026-09-26` (`af9d5b0367e56bcf059971e555d419a58a5ae348`).
- Retained runtime: `odin-demo:before-accounting-v3-20260926` (`sha256:0483f6229b68b1f4e5c272222c7acfecb14ae69780280f000d10ea125a545eb9`).

The release rebuilds the frontend and adds scoped accounting API functions. Existing authentication, accounting posting rules, inventory rules, data schema and database records are preserved. Runtime environment values, published ports, DNS, TLS, nginx and unrelated applications are unchanged. No migration or seed operation ran. The default local build directories also contain the exact tested image artifacts.

The private pre-release database archive was verified with `pg_restore --list`. Its path and the role backup are recorded in `deployment.json`; neither file is committed. Financial integrity after release exactly matches the pre-release baseline: all posted journals balance, ledger/inventory/AR/AP differences are zero, and no negative stock exists.

To restore the retained runtime from `/srv/demo/odin-erp`:

```sh
docker tag odin-demo:before-accounting-v3-20260926 odin-demo:local
docker compose -f compose.deploy.yml up -d --no-deps --no-build app
```

A database restore is not needed to roll back this release. Do not restore the backup over subsequent legitimate transactions. The active deployment was verified without business-data writes; all create/edit/approve/post/reverse testing ran on the isolated QA database.

See [implementation](implementation.md), [verification](verification.json), [exact candidate browser evidence](candidate-verification.json), [report evidence](report-verification.json) and [PDF verification](pdf-verification.md).


Final public checks passed all 61 English routes, five additional Arabic routes, and the accounting module in both languages at desktop/mobile widths (32 accounting checks). CSV/PDF downloads and login/logout passed; the browser guards observed zero business mutation requests. Final source/documentation recovery is retained in `checkpoint/accounting-v3-deployed-2026-09-26` and `/srv/demo/backups/odin-accounting-v3-deployed.bundle`.

The isolated preview container can be restarted with `docker start odin-accounting-v3-preview`; it serves the exact release at loopback port 8185 using the QA database. Run browser workflows only against that isolated service, for example `ODIN_UI_QA_URL=http://127.0.0.1:8185 npm run test:e2e`.
