# Security review

Audit date: 2026-08-03. This is a static repository review plus baseline command evidence; penetration testing and production configuration review remain required.

## Positive controls

- Global authentication guard with active-user and tenant reset-version checks.
- Rotating, hashed, persisted refresh sessions and HttpOnly/SameSite cookies.
- Global permission guard and dynamic document permission resolution.
- Explicit DENY precedence, including over wildcard/Super Admin.
- Forced tenant RLS for runtime tables.
- Serializable transactions with bounded retry.
- Append-only business/access audit triggers.
- Posted journal/document immutability and balance triggers.
- CORS allowlist and request logging that intentionally excludes headers, cookies, bodies, passwords, tokens and database URLs.
- Backend price/tax/discount/tender calculations for principal sales/POS workflows.

## Findings

| ID | Severity | Finding | Evidence/impact | Required remediation |
|---|---|---|---|---|
| SEC-001 | Critical — Resolved | Production authentication previously had a built-in fallback signing secret | Production startup rejects a missing, known or short token secret | Rotate existing production sessions when deploying this control |
| SEC-002 | Critical — Resolved | Historical migrations/documentation contain disposable demo identities | Production seed/reset is blocked, browser hints require `NEXT_PUBLIC_ODIN_DEMO_MODE=true`, and the upgrade migration deactivates/revokes every legacy `@odin.demo` identity | Provision a unique MFA-enrolled administrator before release migration; never seed production |
| SEC-003 | High — Resolved for repository identity | Privileged accounts required MFA/step-up | Encrypted TOTP secrets, hashed one-time recovery codes, governed reset and five-minute step-up protect access/session/period/reset/password actions | Production recovery ownership and monitoring remain deployment controls |
| SEC-004 | High — Resolved | Login lacked throttling and abuse controls | Hashed email/IP counters, escalating lockout, generic errors and audit telemetry are implemented and database-tested | Alert thresholds remain environment configuration |
| SEC-005 | High — Resolved | Missing scope defaulted to BRANCH | `NONE` is the default; explicit backfill preserves only known intent | Continue route/resource registry coverage as endpoints are added |
| SEC-006 | High — Resolved | POS state previously listed tenant-wide shifts/sales | POS terminal plus assigned branch/warehouse predicates protect list/object/open/resume/return/close; browser tampering is denied | Normalize POS register entities when terminals become a master model |
| SEC-007 | High — Resolved | Approval queue previously missed resource predicates | Queue scope plus each document/journal query predicate is reused | Keep approval adapters in registry validation |
| SEC-008 | High — Resolved | Document PDF previously accepted any print key | Target type resolves exact permission and the independent print scope must be non-`NONE` | Keep output resolver tests for new document types |
| SEC-009 | High — Partial | Evidence/output paths could expose fields outside policy | Identified customer/item/bank/journal/document/report paths redact/deny protected data | Complete a universal response-projection layer before expanding endpoints |
| SEC-010 | High — Resolved for current bank/account model | Banking statements/accounts were tenant-wide | Assigned bank-account and GL-account predicates protect bootstrap, payments, banking, matching and financial report/output paths | Treasury/wallet/cheque models do not exist and must be scoped when introduced |
| SEC-011 | High — Resolved | Dynamic service denials were not consistently audited | One global denial filter records guard/service 401/403 decisions with safe context and append-only storage; audit failure never grants access | External SIEM/alert routing remains deployment work |
| SEC-012 | High | Super Admin is a tenant business bypass and sole access administrator | `system.super_admin` grants all; Access controller class-gated | Separate platform/tenant/security/company duties and delegation envelopes |
| SEC-013 | Medium | User overrides can be created without mandatory reason | reason is nullable and empty is accepted | Require reason, ticket/approval reference and optionally expiry |
| SEC-014 | Medium — Partially resolved | Access changes did not revoke refresh sessions | password, active-user and critical role/user access changes increment auth version and revoke sessions; logout-all exists | Per-device session inventory/revoke UI remains missing |
| SEC-015 | Medium — Resolved | Security headers were not explicitly configured | Web/API emit CSP, HSTS where applicable, frame, MIME, referrer and permissions policies; Playwright validates live responses | CSP should move from `unsafe-inline` to nonces when the frontend supports it |
| SEC-016 | Medium | Generic `any` request bodies weaken validation | controllers predominantly accept `any`; global whitelist has no DTO metadata | Introduce validated DTOs and size limits per write endpoint |
| SEC-017 | Medium | Attachments are JSON values without private-object authorization | no object storage/signing/scan workflow | Add private attachment records, exact download keys, signed short-lived access and malware scan |
| SEC-018 | Medium | Admin Prisma bypass and tenant reset are powerful break-glass paths | owner connection and direct seed reset | Separate credentials, network policies, audit, approval, environment block and runbook |
| SEC-019 | Medium — Resolved for repository CI | Security scanning was absent | CI runs the advisory decision gate, secret/demo/public-file scan, TypeScript/static route registry validation, environment tests, Prisma validation and live header checks | Container/provider scanning belongs to deployment CI |
| SEC-020 | Low | Swagger allowlist uses path prefix when enabled | public docs may expose inventory of endpoints | Disable in production or require privileged authentication/network boundary |

## Data exposure rules

Hidden fields must be removed before serialization, aggregation, export, PDF, evidence, audit presentation, notifications and job payloads. Audit logging must use an allowlisted snapshot rather than arbitrary request/body data. Account numbers, salary, costs, tax identifiers, credentials and attachment URLs must never enter general logs.

## Hardening tranche status

- **No unresolved Critical access-control finding remains in this repository review.** SEC-001 and SEC-002 are resolved by fail-closed production configuration, legacy demo-account deactivation/session revocation and demo-only build/seed gates.
- SEC-003/004/005/006/007/008/010/011/015/019 are implemented for the current product surface and have automated negative/live checks.
- SEC-009 remains partial: inspected customer/item/bank/journal/document serializers and current reports/outputs enforce field policy, but a universal response-projection layer is still required before adding endpoints.
- SEC-012/013/014/016/017/018/020 remain High/Medium/Low architecture or deployment work as described above. They are not silently classified as complete.
- The dependency gate currently records zero Critical, three time-bounded High accepted risks from current Next.js transitive PostCSS/optional Sharp pins, and zero Moderate/Low. The decisions expire 2026-09-03 and CI fails if the advisory set changes or the review expires.

## Production security gate

No production release until CI database, browser, security and restore jobs pass, production provider/IAM/KMS/PITR evidence exists, and the partial SEC-009 plus applicable SEC-012/016/017/018 deployment risks are accepted or remediated by accountable owners. Privileged production access without MFA is not acceptable.
