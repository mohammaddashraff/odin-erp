# Odin enterprise ERP transformation plan

Status: initial repository audit, 2026-08-03. This plan is evidence-based and does not claim that later phases are implemented.

## Executive decision

Odin is a compact, executable ERP demonstration with credible accounting, inventory, sales, purchasing, POS, tenant isolation, Arabic/RTL, and access-control foundations. It is not yet a production-grade multi-company enterprise platform. The safest path is incremental hardening: first make deployment and identity controls production-safe, then close access-control enforcement gaps, then extract the transaction kernel from the current monolithic service, and only then broaden modules.

The current stack remains appropriate: Next.js 16, React 19, NestJS 11, Prisma 7, PostgreSQL 17, BigInt minor currency units, and fixed integer quantities. No rewrite or stack replacement is approved.

## Baseline evidence

Commands run from the repository root on 2026-08-03:

| Command | Result |
|---|---|
| `git status --short --branch` | clean `main`, aligned with `origin/main` at `6840740` |
| `node --version` | `v23.10.0`; below the repository requirement of Node 24+ |
| `npm run lint` | PASS: API and web TypeScript checks |
| `npm run i18n:audit` | PASS: 0 missing, duplicate, hardcoded-English, or suspicious-Arabic findings |
| `npm test` | FAIL: 32 passed, 17 failed across 8 suites; 16 database tests were sandbox-blocked at `127.0.0.1:5433`, and one receivables test is date-dependent |
| `npm run build` | FAIL during `prisma migrate deploy` because PostgreSQL was inaccessible |
| API compile only (`npm exec -- nest build`) | PASS |
| `npm run build -w @odin/web` | PASS; Next.js reported duplicate lockfiles |
| `npm run test:e2e` | 21 failed at Chromium launch due macOS sandbox permission, 2 staging tests skipped |

The prior PASS record in `docs/VERIFICATION.md` is historical evidence from 2026-07-31, not a current run.

## First hardening tranche evidence

Implemented and re-verified on 2026-08-03:

| Command/control | Result |
|---|---|
| `npm run i18n:audit` | PASS: all six audit categories remain zero |
| `npm run lint` | PASS: API and web TypeScript checks |
| non-database Jest suites | PASS: 6 suites, 37 tests |
| `npm run build` | PASS: API and web; database migration is no longer a build side effect |
| `git diff --check` | PASS |
| full `npm test` | 6 suites/37 tests pass; 2 suites/16 tests cannot connect because the host PostgreSQL service at `127.0.0.1:5433` is not running |
| Playwright | Not rerun: the host cannot launch Chromium under its macOS sandbox, and application services require the unavailable database |

This tranche adds a Node 24/PostgreSQL 17 pull-request quality gate, production signing-secret validation, production demo-reset gating, deterministic receivables time input, exact report/document output permissions, POS branch/warehouse object checks, approval record scoping, and evidence-field redaction. It does not claim that Phase 0 or Phase 1 is complete.

## Architectural baseline

- 67 controller endpoints, 55 registered browser screens, 41 Prisma models, and 9 migrations.
- The API uses global authentication and authorization guards. Dynamic document actions are authorized in `ErpService`.
- Tenant row-level security is forced for runtime tables. Application work uses serializable tenant transactions with retry.
- Posted journals/documents and audit records have database mutation guards.
- A 364-key stable permission registry, multiple roles, user grant/deny overrides, seven data scopes, eleven protected fields, and four limits exist.
- Most business logic is concentrated in `apps/api/src/erp.service.ts`; this is the main maintainability and control-concentration risk.

## Phase gates

### Phase 0 — production safety

Exit criteria:

- Node 24 is used in development and CI.
- No fallback signing secret or shared demo credential can run in production.
- Demo reset is compile/deployment disabled outside disposable environments.
- MFA or an external identity provider protects privileged accounts.
- CI runs lint, unit/integration tests, migration validation, build, and security checks.
- Staging and production have separate credentials and databases.
- Releases map to immutable Git SHAs and signed/annotated tags; no release tags exist at this baseline.
- Security headers, login throttling, session administration, structured error monitoring, uptime/database monitoring, backup automation, and a successful restore drill are evidenced.
- `npm run build` no longer mutates a database implicitly; migration deployment is an explicit release step.

### Phase 1A — close existing access-control defects

Exit criteria:

- Default record scope is `NONE`, not implicit `BRANCH`.
- The registry is versioned, and every endpoint has an exact static key or a documented dynamic resolver.
- POS, approvals, banking, reports, evidence, PDF, CSV, bootstrap, and dashboards use the same record and field policies.
- Document PDF checks the target document's `*.print` permission.
- Evidence drill-down cannot reveal hidden journal/cost fields.
- Denied attempts from service-level dynamic checks are audited consistently.
- Scoped tests cover direct URL, API, export, print, evidence, POS, approvals, and banking.

### Phase 1B — enterprise Access Control Center

Exit criteria:

- Controlled platform, tenant, security, company, functional, read-only, integration, and service identities exist.
- Company-specific and resource-specific assignments are modelled relationally.
- Temporary grants, approval delegations, access reviews, permission templates, role versions, simulator explanations, delegated administration boundaries, session revocation, and SoD evaluation are complete.
- `/settings/access/policies`, `/templates`, `/limits`, `/access-reviews`, and `/simulator` are real workflows; unfinished pages remain out of navigation.

### Phase 2 — transaction kernel

Extract domain services for authorization, validation, state transition, approval, pricing/tax/currency, numbering, posting, stock, payments, reversal, audit, and outbox events. Every multi-record operation remains one database transaction. Add optimistic versions, idempotency consumption, locks, and immutable source references.

### Phase 3 — deepen current modules

Complete quote-to-cash, procure-to-pay, inventory, finance, treasury, POS, HR/payroll, authoritative reports, and role-sensitive dashboards against the definition of done. Prefer reconciled workflows to screen count.

### Phase 4 — new domains

Add CRM, installments, fixed assets, electronic invoicing, manufacturing, projects, maintenance, and portals only after Phases 0–3 pass. Each is feature-flagged and independently modelled.

## First implementation tranches

1. Production configuration fail-closed controls and deterministic tests.
2. Exact route/print/export/evidence authorization and default-deny scopes.
3. Relational company/organization assignments and resource scopes.
4. Temporary access, delegated authority, session revocation, access reviews, and SoD.
5. Service extraction beginning with authorization and document state transition.

Each tranche requires a migration plan, negative tests, a regression run, deployment steps, rollback/forward-fix steps, and updated matrices.

## Change governance

- Migrations are additive until a compatibility window is completed.
- Production seeds are forbidden. Existing tenant and transaction rows are preserved.
- Posted documents, journals, stock movements, and audit events remain immutable.
- Major capabilities use server-side feature flags and default off.
- A phase is complete only when exact commands, test counts, reconciliation results, known limitations, and operational evidence are recorded.

## Related audit records

See `CURRENT_CAPABILITY_MATRIX.md`, `MODULE_GAP_ANALYSIS.md`, `ACCESS_CONTROL_ARCHITECTURE.md`, `SECURITY_REVIEW.md`, `DATA_MODEL_REVIEW.md`, and the control/runbook documents in this directory.
