# Access control architecture

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
4. Add user GRANT overrides; collect user DENY overrides.
5. Deny a requested key if any deny matches; otherwise allow exact, wildcard, or Super Admin grant.
6. For dynamic documents, derive `module.resource.action` from `DocumentType`.
7. Apply a resource data-scope query, branch/warehouse assertions, protected-field serializer and applicable limit.
8. Execute within tenant RLS transaction.

## Remaining architecture bounds

- Multiple role scopes still combine to the broadest explicit scope; there is no separate resource-scope DENY or delegated administrative boundary.
- Field combination selects the broadest role access. User field overrides and a universal response-projection adapter remain absent.
- Four sales limits exist; purchasing, bank, journal, inventory and other authority limits require normalized policy models.
- Access administration remains class-gated by `system.super_admin`; bounded Security/Company Administrators are not implemented.
- Company, normalized team, temporary/delegated access, access review, SoD decisioning and explainable custom-policy boundaries are not first-class.
- Current report/document/POS/approval outputs use exact permission and scope adapters and literal controller keys are registry-tested; every future output channel must register equivalent enforcement.

## Access Control Center completion review

| Capability | Classification | Evidence / remaining boundary |
|---|---|---|
| User management | Complete for current tenant model | activate/deactivate, primary/additional roles, branch/warehouse, MFA requirement and overrides; critical changes revoke sessions |
| Role builder | Complete for current registries | permission, scope, field and four limit tabs with validated API writes |
| Permission registry | Complete | normalized unique registry plus controller-literal coverage test |
| Primary and additional roles | Complete | relational assignments included in effective actor |
| User-specific overrides | Complete for action permissions | GRANT/DENY with append-only audit; expiry/ticket governance is missing |
| Explicit DENY | Complete for action permissions | wins over role, wildcard, legacy and Super Admin; browser test proves financial export denial |
| Data scopes | Substantial but incomplete | NONE/OWN/ASSIGNED/TEAM/BRANCH/WAREHOUSE/DEPARTMENT/ALL and default deny; resource-scope DENY/custom policy absent |
| Field permissions | Partial | current sensitive serializers/reports are tested; no user field override or universal projector |
| Financial limits | Partial | four sales limits only |
| Approval limits | Partial | sales amount/discount and maker-checker controls; no general policy engine |
| Company assignments | Missing | Company is not a normalized model in the current repository |
| Branch assignments | Complete for current endpoints | user assignment, query predicates, object assertions and browser tampering denial |
| Warehouse assignments | Complete for current endpoints | user assignment, query predicates, POS/document assertions and negative tests |
| Department assignments | Partial | department data scope exists; user administrative assignment is not normalized |
| Team assignments | Partial | team actor/config scope exists; no normalized team membership UI/model |
| Financial-resource assignments | Complete for current bank-account/GL/supplier models | administrator-selected IDs protect transaction/report/export/print APIs; treasury/wallet/cheque/project/cost-centre models do not exist |
| Temporary access | Missing | no grant/expiry/approval model |
| Delegation | Missing | no delegation envelope or workflow |
| Segregation-of-duties warnings | Missing | maker-checker exists, assignment-time conflict engine does not |
| Access reviews | Missing | no campaign/attestation model |
| Effective Access Simulator | Missing | no explainable decision endpoint/UI |
| User-view preview | Missing | normal role-aware UI exists, but administrator impersonation/preview is intentionally absent |
| Append-only permission audit | Complete | PostgreSQL trigger and database mutation-negative test |
| Denied-request audit | Complete for HTTP 401/403 | centralized safe-context filter with classifier tests |
| Permission cache invalidation | Complete | effective policy reloads per request; role/user writes increment auth version |
| Active-session invalidation | Complete for critical changes | password, active state, role/user access, MFA reset and logout-all revoke persisted sessions |

Because temporary access, delegation, SoD warnings, reviews, simulator, preview and company administration are missing, the overall Phase 1 access program remains **partially complete** even when the critical verification gates pass.

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

Add company and normalized assignment tables without removing current JSON/legacy columns. Backfill, dual-read under a feature flag, compare decisions in audit-only mode, then switch enforcement tenant by tenant. Never widen a decision during compatibility fallback.
