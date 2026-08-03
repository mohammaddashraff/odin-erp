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
| SEC-001 | Critical | Production authentication can use a built-in fallback signing secret | `AuthService` falls back to a known local string | Refuse production startup unless a strong secret/key provider is configured; rotate existing sessions |
| SEC-002 | Critical | Shared demo credentials are documented and applied by migration | README and `20260728220000_override_demo_password` | Disable demo accounts/reset in production; force reset; prevent credential-setting migrations from affecting non-demo tenants |
| SEC-003 | High | No MFA/step-up for privileged or destructive actions | no identity-provider/MFA model | Add IdP/WebAuthn/TOTP policy and step-up for access changes, reset, impersonation and sensitive export |
| SEC-004 | High | Login has no throttling or abuse controls | no rate limiter/lockout telemetry | Add per-IP/account throttling, progressive delays, alerting and safe generic errors |
| SEC-005 | High | Missing scope defaults to BRANCH | `ErpService.scope()` | Introduce `NONE`; migration must explicitly backfill intended scopes |
| SEC-006 | High | POS state lists tenant-wide shifts and sales | `posState()` has no branch/warehouse/register predicate | Scope by assigned register/branch/warehouse and add negative tests |
| SEC-007 | High | Approval queue applies branch/type but not configured resource predicates | `approvals()` bypasses `documentScope()` | Reuse central query policy per document resource |
| SEC-008 | High | Document PDF accepts any document print key | controller any-of print metadata then only target view check | Resolve target type and require its exact `*.print` key before rendering |
| SEC-009 | High | Evidence drill-down can expose journal/cost detail outside field policy | evidence response builds raw journal/stock strings | Apply central response projection and exact evidence permissions |
| SEC-010 | High | Banking statements/accounts are not resource-assigned | tenant-wide masters/statements can be returned to a banking viewer | Add company/branch/account assignments and consistent predicates |
| SEC-011 | High | Dynamic service denials are not consistently audited | only guard denials use access log writer | Centralize all decisions and append denial evidence without sensitive payloads |
| SEC-012 | High | Super Admin is a tenant business bypass and sole access administrator | `system.super_admin` grants all; Access controller class-gated | Separate platform/tenant/security/company duties and delegation envelopes |
| SEC-013 | Medium | User overrides can be created without mandatory reason | reason is nullable and empty is accepted | Require reason, ticket/approval reference and optionally expiry |
| SEC-014 | Medium | Access changes do not revoke/inspect refresh sessions | policy reload is immediate per request, but session inventory/revocation is absent | Add session list/revoke and privileged-change invalidation policy |
| SEC-015 | Medium | Security headers are not explicitly configured | no Helmet/CSP/HSTS configuration in repository | Add environment-aware CSP, HSTS, frame, MIME, referrer and permissions policies |
| SEC-016 | Medium | Generic `any` request bodies weaken validation | controllers predominantly accept `any`; global whitelist has no DTO metadata | Introduce validated DTOs and size limits per write endpoint |
| SEC-017 | Medium | Attachments are JSON values without private-object authorization | no object storage/signing/scan workflow | Add private attachment records, exact download keys, signed short-lived access and malware scan |
| SEC-018 | Medium | Admin Prisma bypass and tenant reset are powerful break-glass paths | owner connection and direct seed reset | Separate credentials, network policies, audit, approval, environment block and runbook |
| SEC-019 | Medium | No dependency/security scanning CI | only manual staging workflow | Add lockfile audit, secret scan, SAST and image/dependency update policy |
| SEC-020 | Low | Swagger allowlist uses path prefix when enabled | public docs may expose inventory of endpoints | Disable in production or require privileged authentication/network boundary |

## Data exposure rules

Hidden fields must be removed before serialization, aggregation, export, PDF, evidence, audit presentation, notifications and job payloads. Audit logging must use an allowlisted snapshot rather than arbitrary request/body data. Account numbers, salary, costs, tax identifiers, credentials and attachment URLs must never enter general logs.

## First hardening tranche status

- **Implemented:** SEC-001. Production startup and token operations now reject a missing, known fallback, or shorter-than-32-character signing secret.
- **Partially implemented:** SEC-002. Tenant demo reset is denied in production unless the deployment is explicitly labelled `ODIN_DEPLOYMENT_MODE=demo`; shared demo accounts and the historical credential migration still require production separation.
- **Implemented for identified paths:** SEC-006, SEC-007 and SEC-008. POS list/object access now applies assigned branch and warehouse, the approval queue reuses document record predicates, and document/report output requires the exact target permission.
- **Partially implemented:** SEC-009. Journal identifiers/lines in the inspected evidence responses now obey the journal-lines field policy and POS evidence is scoped through its shift. A central response-projection layer and wider regression suite remain required.
- **Outstanding production blockers:** SEC-003/004/005/010/011/015/019 and the unfinished portions of SEC-002/009. No production-safety claim is made.

## Production security gate

No production release until the outstanding or partial SEC-002/004/005/009/010 findings are remediated and negative tests pass. MFA may be satisfied by an approved external IdP, but privileged production access without MFA is not acceptable.
