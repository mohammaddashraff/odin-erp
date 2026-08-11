# Access control architecture

## Current additive tranche (2026-08-11)

The verified pre-tranche architecture below remains the compatibility base. The current tranche is
additive: it must not widen a decision when company, selected-resource, temporary or delegated
context is absent. Current implementation may be classified as **Implemented** or **Partially
implemented**, but no new capability is **Tested** until the clean migration, unit, database,
direct-API tampering and browser gates pass on the same immutable commit.

```text
Tenant
  -> Company assignment and bounded Company Administrator envelope
  -> branch / warehouse / department / team / selected financial resources
  -> primary + additional roles + direct overrides
  -> active temporary grants + bounded delegations
  -> permission, record, field, amount/approval and SoD decisions
  -> explainable effective-access result / safe administrator preview
  -> server query predicate + object assertion + response projection
  -> tenant/company database constraints and RLS-compatible transaction
  -> append-only allow/deny/grant/delegation/review/download evidence
```

Company is a legal/security boundary inside the tenant, not a replacement for tenant RLS. A Company
Administrator receives only the administrative envelope explicitly assigned for that company.
That bounded role does not imply access to business data outside its assigned companies. The legacy
tenant Super Admin remains an explicit all-company business-data bypass and is a documented
separation gap. For other actors, missing company context, expired temporary access, an
out-of-envelope delegation, unassigned financial object or hidden field denies server-side even when
a client submits a valid object ID.

The additive persistence model uses `Company`, active time-bounded `CompanyMembership` and
`CompanyBranch`. A default-company backfill plus compatibility triggers preserve existing tenant,
user and branch creation. The authenticated actor carries assigned company IDs, company-admin IDs
and company-scoped branch IDs. Query/object predicates apply that context even when a role's legacy
data scope is `ALL`. This closes branch-derived transactional paths; tenant-shared masters that do
not yet derive Company ownership remain explicitly partially implemented.

Selected financial objects use typed `FinancialResource` and `FinancialResourceAssignment` records.
Bank-account and GL-account resources map to current operational entities; treasury, wallet,
payment-card, cash-source, cheque-book, cost-centre and project types are governance records until
their corresponding business domains/adapters exist.
`TemporaryAccessGrant` and `Delegation` carry company, start/end, reason and revocation state; deny
wins and delegation validation prevents authority escalation. Initial SoD rules are seeded in `WARN`
mode. The persisted rule model also accepts `BLOCK`, and blocking conflicts are rejected on current
permission-set mutation paths: role create/update/duplicate, user primary/additional-role and override
changes, temporary grants and delegations. That is assignment-time coverage, not a configurable
same-record SoD engine or a governed-exception workflow. Effective-access simulation/preview returns
an explanation without session mutation, and access review decisions are retained as immutable
evidence.
Currency/company-aware authority policies extend the limit registry, but complete authority routing
and approval workflows are not claimed.

The effective-access simulator evaluates the selected actor and target context without replacing the
administrator's session. Safe user preview consumes simulator decisions; it is not impersonation and
does not bypass the normal API. Private attachment access uses the owning entity's company/record/
field policy, opaque storage identity, bounded download authorization and append-only audit. A local
download control is not evidence of provider object-storage IAM, KMS, malware scanning or recovery.

Private attachments are DB-backed in this tranche with metadata/content separation, safe filename,
content-type allowlist, size limit, hash, authenticated owner authorization, a short-lived signed
user/session-bound ticket, audited download and a sales-document upload/list/download UI.
`NOT_CONFIGURED` is the truthful scanner state until a real scanner/provider exists. The centralized
field projector covers the identified customer, supplier, document, journal, payment and audit
leaks; future endpoints/nested payloads still require registry coverage.

| Current-tranche capability | Classification | Evidence boundary |
|---|---|---|
| Company ownership, assignments and bounded administration | Partially implemented | Company/membership/branch mapping, customer/supplier ownership, mapped bank/GL ownership, compatibility triggers and actor/query bounds are implemented; tenant-shared reference/configuration masters and complete governance UI remain partial |
| Selected financial-resource assignments | Partially implemented | Typed resources and assignments are implemented; bank/GL have operational adapters while other requested classes await their business domains; current direct-ID/output-channel negative regressions pass |
| Temporary access and delegation | Tested | Company/start/end/reason/revocation plus deny/non-escalation rules are implemented; current expiry/envelope regressions pass |
| SoD warning and assignment evaluation | Partially implemented | Initial rules are seeded as `WARN`; configured `BLOCK` rules reject conflicts on current role, user, temporary-grant and delegation permission-set mutations and current persisted regressions pass. A generalized configurable same-record engine and governed exceptions remain incomplete |
| Access review and simulator/preview | Tested | Immutable review snapshots and non-mutating effective/proposed access explanations are implemented; current authorization coverage passes, while mature campaign/attestation depth remains incomplete |
| General field projection | Tested | Central projection covers the identified customer/supplier/document/journal/payment/audit leaks and current negative regressions pass; future endpoint coverage remains required |
| Private attachments | Tested | DB-backed authenticated size/type/hash/ticket/download-audit controls and sales-document UI are implemented and current HTTP/DB/browser regressions pass; scanner remains `NOT_CONFIGURED` |
| Generalized amount/approval limits | Partially implemented | Typed, currency-aware authority policies can be bounded by company, branch, role, department, document type and validity window. Enforcement adapters cover document approvals, receipts/payments, journal posting and treasury movement and current regressions pass; complete domain coverage, routing and escalation remain incomplete |
| Provider attachment storage/scanner and production IAM/KMS | Requires external/provider evidence | Do not classify provider operations as repository-tested without actual integration evidence |

## Current architecture

```text
User + active primary/additional roles + user permission overrides
  -> AuthService builds current effective actor on every authenticated request
  -> global AuthGuard validates session/user/reset version
  -> global AuthorizationGuard evaluates controller metadata
  -> ErpService resolves dynamic document key, default-NONE record scope, output scope, fields and current limits
  -> Prisma tenant transaction sets app.current_tenant_id
  -> PostgreSQL forced RLS enforces tenant boundary
  -> global AuthorizationDenialFilter records every resulting 401/403 without sensitive payloads
  -> UI consumes the same actor grants/denies for navigation and actions
```

Explicit permission DENY overrides exact, wildcard, legacy, and Super Admin grants. Active user and role state is reloaded during token verification, so role changes take effect on the next request without a permission cache.

## Current decision algorithm

1. Reject missing/invalid authentication except health/login/refresh/logout/optional docs.
2. Reject inactive user or tenant reset-version mismatch.
3. Combine normalized legacy and relational grants from active roles.
4. Add active company-scoped temporary/delegated permissions and resource assignments inside their
   company/time envelopes; add user GRANT overrides and collect user DENY overrides.
5. Deny a requested key if any deny matches; otherwise allow an exact or wildcard grant. Temporary
   and delegated grants remain inside their valid company envelope; the legacy Super Admin grant is
   tenant-wide and is retained as an explicit separation gap.
6. For dynamic documents, derive `module.resource.action` from `DocumentType`.
7. Intersect company, branch/warehouse, resource and record predicates; apply protected-field
   projection/write policy and the applicable authority limit.
8. Execute within a tenant RLS transaction and retain safe audit evidence.

## Remaining architecture bounds

- Multiple role scopes still combine to the broadest explicit scope; there is no separate resource-scope DENY or general custom-predicate language.
- Field combination selects the broadest role access. The centralized projector covers the identified current response trees, but user field overrides and automatic coverage of every future endpoint, nested payload, job and notification remain absent.
- The typed authority registry and company-aware policy model cover the current document-approval, receipt/payment, journal-posting and treasury-movement adapters. They do not provide complete approval routing, escalation or enforcement across every business domain.
- Company Administrator governance endpoints are bounded to assigned companies. Tenant-wide role/user administration remains protected by `system.super_admin`, and a distinct bounded Security/Functional Administrator model is not complete.
- Company membership, selected financial resources, temporary access, delegation, access-review
  evidence and non-mutating simulation are first-class. Normalized teams, mature review campaigns,
  configurable same-record SoD and governed SoD exceptions remain incomplete.
- Current report/document/POS/approval outputs use exact permission and scope adapters and literal controller keys are registry-tested; every future output channel must register equivalent enforcement.

## Compatibility-base Access Control Center review

| Capability | Classification | Evidence / remaining boundary |
|---|---|---|
| User management | Implemented | activate/deactivate, primary/additional roles, branch/warehouse, MFA requirement and overrides; critical changes revoke sessions |
| Role builder | Implemented | permission, scope, field and four limit tabs with validated API writes |
| Permission registry | Implemented | normalized unique registry plus controller-literal coverage test |
| Primary and additional roles | Implemented | relational assignments included in effective actor |
| User-specific overrides | Partially implemented | GRANT/DENY with append-only audit exists; expiry/ticket governance is incomplete |
| Explicit DENY | Implemented | wins over role, wildcard, legacy and Super Admin; historical browser evidence proves financial export denial |
| Data scopes | Partially implemented | NONE/OWN/ASSIGNED/TEAM/BRANCH/WAREHOUSE/DEPARTMENT/ALL and default deny exist; resource-scope DENY/custom policy remains absent |
| Field permissions | Partially implemented | centralized projection covers identified nested response trees and exposed protected writes such as document notes and journal lines require `EDIT`; automatic coverage of every future endpoint/job/output remains incomplete |
| Financial limits | Partially implemented | four compatibility sales role limits remain, and typed authority policies add current purchase, payment, treasury, journal, expense and credit-exposure keys; complete domain coverage remains incomplete |
| Approval limits | Partially implemented | sales amount/discount and maker-checker controls exist; company/currency-aware authority adapters cover current document approvals, payments, journal posting and treasury movement, while routing/escalation and full workflow coverage remain incomplete |
| Company assignments | Partially implemented | Company membership/mapping, customer/supplier ownership and bounded governance APIs are implemented; tenant-shared reference/configuration ownership and complete browser mutation UI remain incomplete |
| Branch assignments | Implemented | user assignment, query predicates, object assertions and historical browser tampering denial exist |
| Warehouse assignments | Implemented | user assignment, query predicates, POS/document assertions and historical negative tests exist |
| Department assignments | Partially implemented | department data scope exists; user administrative assignment is not fully normalized |
| Team assignments | Partially implemented | team actor/config scope exists; no complete normalized team membership UI/model |
| Financial-resource assignments | Partially implemented | typed requested resource classes and assignments exist; operational enforcement currently has bank/GL adapters, while other types await business domains |
| Temporary access | Tested | company/scope/start/expiry/reason/grantor/revocation and active-window evaluation exist; current expiry and mutation-path regressions pass |
| Delegation | Tested | bounded company/scope/validity/reason/revocation with deny/non-escalation exists; current envelope and mutation-path regressions pass |
| Segregation of duties | Partially implemented | document/journal/outgoing-payment maker-checker and seeded effective-access `WARN` rules exist; configured `BLOCK` rules reject current role, user, temporary-grant and delegation permission-set conflicts. Configurable same-record rules and governed exceptions remain incomplete |
| Access reviews | Implemented | review output and immutable evidence exist; mature campaign depth remains incomplete |
| Effective Access Simulator | Implemented | explainable effective-decision calculation exists without altering the target user's session |
| User-view preview | Implemented | safe simulation-based preview exists; real impersonation remains intentionally absent |
| Append-only permission audit | Implemented | PostgreSQL trigger and historical database mutation-negative test exist |
| Denied-request audit | Implemented | centralized safe-context HTTP 401/403 filter with classifier tests exists |
| Permission cache invalidation | Implemented | effective policy reloads per request; role/user writes increment auth version |
| Active-session invalidation | Implemented | password, active state, role/user access, MFA reset and logout-all revoke persisted sessions |

The overall Phase 1 access program remains **partially complete** because normalized teams,
resource-scope deny/custom predicates, automatic field/output coverage, configurable same-record SoD,
governed exceptions, complete governance browser forms, mature review campaigns and generalized
approval routing remain incomplete. Company governance APIs, temporary access, delegation, reviews,
simulator and safe preview are implemented capabilities, with current-tranche verification recorded
in `VERIFICATION.md`.

## Target policy model

The central `AuthorizationDecisionService` will accept:

```text
actor, tenant, company, branch, warehouse, resource, record, action,
field?, channel(API/UI/report/export/print/job/integration), amount?, context
```

It returns an explainable decision:

```text
ALLOW or DENY; matched grants/denies; administrative boundary;
record predicate; field access; effective limit; required approval;
temporary grant/delegation source; SoD warning; registry version; decision ID
```

Precedence:

1. Disabled/expired identity and tenant/company boundary deny.
2. Explicit deny overrides allow.
3. Platform privileges never imply tenant/company business access.
4. Missing permission or missing scope denies.
5. Record scope, field rule, limit and approval are independent gates.
6. Temporary grants must be approved, scoped, active and unexpired.
7. Delegated administrators cannot grant outside their delegation envelope.

## Target identity separation

- Platform Super Administrator: platform operations only; business tenant entry is separately granted and audited.
- Tenant Administrator: tenant configuration, not automatic financial/payroll visibility.
- Security Administrator: identities, roles, reviews and policy, bounded by company.
- Company/Functional Administrator: delegated subset only.
- Manager/Standard/Read-only/Portal: business roles with explicit scopes.
- Integration Identity/Service Account: non-interactive, token-scoped, rotated, rate-limited and excluded from human approval roles.

## Required enforcement adapters

- Controller metadata for static keys.
- Dynamic document/report/attachment resolvers.
- Prisma query predicate builder for records and aggregates.
- Response projection/redaction for fields and nested payloads.
- Export/print/job policy envelope persisted with the request.
- Navigation/action manifest derived from effective decisions.
- Append-only decision/audit writer with request and correlation IDs.

## Migration strategy

The additive migration introduces company and normalized governance tables without removing current
JSON/legacy columns. Compatibility backfills and provisioning triggers preserve existing tenants,
users and branches while current enforcement reads the new company/governance records. Any future
retirement of legacy columns requires decision comparison, tenant-by-tenant migration evidence and a
non-widening fallback; that retirement is not claimed in this tranche.
