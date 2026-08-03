# Access control architecture

## Current architecture

```text
User + active primary/additional roles + user permission overrides
  -> AuthService builds current effective actor on every authenticated request
  -> global AuthGuard validates session/user/reset version
  -> global AuthorizationGuard evaluates controller metadata
  -> ErpService resolves dynamic document key, record scope, fields and four sales limits
  -> Prisma tenant transaction sets app.current_tenant_id
  -> PostgreSQL forced RLS enforces tenant boundary
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

## Findings that must change

- Data-scope absence currently becomes `BRANCH`; enterprise default deny requires `NONE`.
- Scope combination selects the broadest role scope. There is no explicit scope deny or administrative boundary.
- Field combination selects the broadest access. User field overrides and explicit field restrictions are absent.
- Only four sales limits exist; multiple-role resolution always selects the highest value.
- Access administration is class-gated by `system.super_admin`, preventing controlled Security/Company Administrators.
- Service-level dynamic denials are not written through one denial-audit path.
- Report routes retain broad controller metadata, but report and document outputs now use an exact target resolver; route-coverage automation and equivalent treatment for every future output channel are still missing.
- Company, team, selected-resource and custom-policy boundaries are not first-class.

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
