# Security review

Audit date: 2026-08-08. This is a static repository review plus baseline command evidence; penetration testing and production configuration review remain required.

## Current-tranche classification (2026-08-11)

The findings and historical PASS statements below are preserved for commit `b534bc2`. The current
application commit `7d747fb26cacc7874bc8753e416156a0347a3aa9` subsequently passed the database,
direct-API, authorization, browser, security and restore gates recorded in `VERIFICATION.md`.
That evidence is bounded to the tested repository paths; penetration testing and production
configuration/provider review remain required.

| Security capability | Classification | Current evidence boundary |
|---|---|---|
| Pre-tranche authentication, session, MFA, default-deny and denial-audit controls | Tested | Current unit/security and concurrent-MFA regressions pass, alongside browser/direct-API authorization coverage |
| Company isolation and bounded Company Administrator | Partially implemented | Company membership/branch mapping, customer/supplier ownership, mapped bank/GL ownership and actor/query bounds are implemented and current DB/direct-API regressions pass. Some tenant-level masters/configuration remain shared, and the governance UI does not expose every bounded mutation |
| Financial-object assignments, temporary access and delegation | Partially implemented | typed assignments, validity/revocation, deny-wins and non-escalation are implemented. Bank/GL adapters enforce operational IDs; other typed classes are assignment metadata until their business domains exist |
| SoD warnings, hard assignment blocks, access review and effective-access simulator/preview | Partially implemented | persisted `WARN`/`BLOCK` rules cover role saves, user role/override changes, temporary grants and delegations; review/simulation evidence exists. Generalized same-record rules and governed exceptions remain absent |
| Generalized field response projection | Implemented | centralized projection covers the identified journal/payment/supplier/customer/document/audit leaks; future nested/job/output adapters still require coverage |
| Private attachment authorization and download audit | Tested | DB-backed safe type/size/name/hash controls, owning-record authorization, sales-document upload/list/download UI, user/session-bound expiring ticket and audit are implemented; current HTTP/DB/browser regressions pass |
| Malware scanner operation | Requires external/provider evidence | no scanner is integrated and persisted state is truthfully `NOT_CONFIGURED`; a real provider and test evidence are required before claiming scanning |
| DB-backed attachment logical recovery | Tested | the current restore drill compares a non-empty source/restored attachment count, bytes and content manifest and passed; provider recovery remains external |
| Provider object recovery, IAM, KMS, PITR and cross-region retention | Requires external/provider evidence | These controls cannot be established by repository code or the deterministic logical restore drill |
| Current-tranche security regression sources | Tested | application commit `7d747fb26cacc7874bc8753e416156a0347a3aa9` passed the 13-suite/159-test security selector, 6 DB suites/66 tests, 18 Jest suites/189 tests and 31 local Playwright scenarios; two staging-only scenarios are skipped without `STAGING_BASE_URL` |

## Positive controls

- Global authentication guard with active-user and tenant reset-version checks.
- Rotating, hashed, persisted refresh sessions and HttpOnly/SameSite cookies.
- Global permission guard and dynamic document permission resolution.
- Explicit DENY precedence, including over wildcard/Super Admin.
- Forced tenant RLS for runtime tables.
- Serializable transactions with bounded retry.
- Append-only business/access audit triggers.
- Posted journal/document immutability and balance triggers.
- Company-binding triggers for branch-derived documents, customer/supplier parties, mapped finance
  objects and private attachments.
- Outgoing supplier payments enter a submitted state and require a different authorized checker to
  approve or reject before journal/allocation effects; receipts retain their immediate-post path.
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
| SEC-009 | High — Tested for identified paths | Evidence/output paths could expose fields outside policy | Central projection covers the identified customer, supplier, document, journal, payment and audit leaks; current direct negative tests pass | Register every future nested/output/job adapter and rerun direct negative tests; universal future coverage remains an engineering rule |
| SEC-010 | High — Resolved for current bank/account model | Banking statements/accounts were tenant-wide | Assigned company-owned bank-account and GL-account predicates protect bootstrap, payments, banking, matching and financial report/output paths | Other typed financial-resource classes are governance records only; add equivalent adapters when their operational domains are introduced |
| SEC-011 | High — Resolved | Dynamic service denials were not consistently audited | One global denial filter records guard/service 401/403 decisions with safe context and append-only storage; audit failure never grants access | External SIEM/alert routing remains deployment work |
| SEC-012 | High — Partially resolved | Super Admin remains a tenant business bypass and the only tenant-wide role/user administrator | Bounded Company Administrators can manage company governance through company-scoped envelopes, but `system.super_admin` still grants all business and tenant access | Separate platform, tenant and security administration; finish bounded Functional/Security Administrator roles and UI |
| SEC-013 | Medium | User overrides can be created without mandatory reason | reason is nullable and empty is accepted | Require reason, ticket/approval reference and optionally expiry |
| SEC-014 | Medium — Partially resolved | Access changes did not revoke refresh sessions | password, active-user and critical role/user access changes increment auth version and revoke sessions; logout-all exists | Per-device session inventory/revoke UI remains missing |
| SEC-015 | Medium — Resolved | Security headers were not explicitly configured | Web/API emit CSP, HSTS where applicable, frame, MIME, referrer and permissions policies; Playwright validates live responses | CSP should move from `unsafe-inline` to nonces when the frontend supports it |
| SEC-016 | Medium | Generic `any` request bodies weaken validation | controllers predominantly accept `any`; global whitelist has no DTO metadata | Introduce validated DTOs and size limits per write endpoint |
| SEC-017 | Medium — Repository control tested | Attachments required private owner authorization and safe delivery | DB-backed bytes and safe metadata, allowlisted type/size, hash, safe filename, owning-record authorization, browser upload/list/download, user/session-bound short-lived ticket and download audit are implemented and current HTTP/DB/browser paths pass; scanner status is `NOT_CONFIGURED` | Integrate and test a real malware scanner/provider and provider object-storage/recovery controls before claiming those capabilities |
| SEC-018 | Medium | Admin Prisma bypass and tenant reset are powerful break-glass paths | owner connection and direct seed reset | Separate credentials, network policies, audit, approval, environment block and runbook |
| SEC-019 | Medium — Resolved for repository CI | Security scanning was absent | CI runs the advisory decision gate, secret/demo/public-file scan, TypeScript/static route registry validation, environment tests, Prisma validation and live header checks | Container/provider scanning belongs to deployment CI |
| SEC-020 | Low | Swagger allowlist uses path prefix when enabled | public docs may expose inventory of endpoints | Disable in production or require privileged authentication/network boundary |

## Data exposure rules

Hidden fields must be removed before serialization, aggregation, export, PDF, evidence, audit presentation, notifications and job payloads. Audit logging must use an allowlisted snapshot rather than arbitrary request/body data. Account numbers, salary, costs, tax identifiers, credentials and attachment URLs must never enter general logs.

## Hardening tranche status

- **No unresolved Critical access-control finding remains in this repository review.** SEC-001 and SEC-002 are resolved by fail-closed production configuration, legacy demo-account deactivation/session revocation and demo-only build/seed gates.
- SEC-003/004/005/006/007/008/010/011/015/019 are implemented for the current product surface and have automated negative/live checks.
- SEC-009 has a centralized projector for the identified customer, supplier, document, journal,
  payment and audit paths, with current negative regressions passing. Every future nested/output/job
  path still requires explicit registration; this is not a claim of automatic universal future coverage.
- Persisted `BLOCK` SoD rules are enforced on current permission-set mutation paths: role create,
  update and duplicate; user primary/additional-role and override changes; temporary grants; and
  delegations. This is not a generalized same-record policy engine or an exception workflow.
- SEC-017 repository controls and DB-backed logical recovery mechanics are implemented with a
  truthful `NOT_CONFIGURED` scanner state. A real scanner/provider and provider object recovery remain
  absent/external.
- SEC-012/013/014/016/018/020 and the provider portion of SEC-017 remain architecture or deployment
  work as described above. They are not silently classified as complete.
- The dependency gate currently records zero Critical, two time-bounded High accepted risks from latest stable NestJS Swagger pinning JS-YAML 5.2.1, and zero Moderate/Low after upgrading Next.js, PostCSS, Sharp, Nano ID, NestJS Swagger and the compatible JS-YAML 3/4 lines. Swagger is disabled by default and Odin does not parse user-controlled YAML. The decisions expire 2026-09-08; CI fails on any Critical, unreviewed High, changed advisory set or expired decision.

## Production security gate

No production release until current CI database, browser, security and restore jobs pass, production
provider/IAM/KMS/PITR evidence exists, field-projection and private-attachment negative tests pass,
and applicable SEC-012/016/017/018 deployment risks are accepted or remediated by accountable
owners. Privileged production access without MFA is not acceptable.
