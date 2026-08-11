# Architecture decisions

## ADR-001: Evolve, do not rewrite

**Accepted.** Preserve Next.js/React, NestJS, Prisma/PostgreSQL, fixed-point money/quantity, tenant RLS, existing migrations and production data. The current stack has no proven blocker.

## ADR-002: PostgreSQL remains the authoritative integrity boundary

**Accepted.** Business services validate and authorize; PostgreSQL RLS, constraints, triggers and transactions enforce tenant and immutable-posting invariants. Admin connections are limited to migration, controlled bootstrap, restore and break-glass operations.

## ADR-003: Central explainable authorization

**Accepted target.** Replace scattered policy helpers with one decision service and channel-specific adapters. Exact denial reason/evidence is retained server-side; external responses remain safe.

## ADR-004: Default deny for action, record and field

**Accepted and implemented for the current registry.** Missing permission denies, missing record scope
becomes `NONE`, and registered sensitive fields default to hidden. Compatibility intent is preserved
only through explicit migrated policies; new resources must not inherit an implicit branch scope.

## ADR-005: Add Company as a first-class boundary

**Accepted target.** Tenant is the SaaS/customer boundary; Company is the legal/accounting boundary. Branch, warehouse, fiscal ledger, documents, roles and assignments belong to a company. Cross-company operations require explicit inter-company workflows.

## ADR-006: Extract a transaction kernel by characterization, not rewrite

**Accepted.** First add tests around existing behavior, then extract state, posting, stock, payment, numbering, audit and idempotency services one seam at a time. Transactions remain atomic throughout.

## ADR-007: Posted facts are immutable

**Accepted.** Posted journals, documents, stock movements and allocations are never edited or deleted. Corrections create linked reversals, returns, credit/debit notes or adjustments.

## ADR-008: Deployment does not migrate implicitly during application build

**Accepted target.** `prisma migrate deploy` is a separately approved release step with backup and validation. Builds compile artifacts without needing production database access.

## ADR-009: No unfinished module in production navigation

**Accepted.** Feature flags default off. Navigation is generated from enabled capabilities and effective permissions; API authorization remains independent.

## ADR-010: Asynchronous work uses outbox and idempotent jobs

**Accepted target.** Large reports, exports, imports, notifications and external integrations use a persisted outbox/job model with retries, dead-letter evidence and correlation IDs.

## ADR-011: Compatibility columns have a retirement plan

**Accepted.** Legacy role permission JSON and user branch/warehouse JSON may remain during dual-read migration only. New assignments are relational; parity is measured before deprecation.

## ADR-012: Arabic text is RTL; application numerals are always Latin

**Accepted.** Central web and API/output locale resolution uses `ar-EG-u-nu-latn`. Screens may not
select an Arabic numbering system or post-process glyphs. Identifiers and mixed-direction values use
bidirectional isolation, while all dates, times, currencies, counts, charts, inputs and generated
documents retain Western `0-9` digits.

## ADR-013: Loading, motion and color are shared semantic primitives

**Accepted.** Layout-shaped skeletons, action busy states, transitions, success feedback, status
colors, KPI accents and module identity consume one reusable light/dark design system. CSS and
lightweight primitives are preferred; `prefers-reduced-motion` is mandatory and large table datasets
are not animated. Page-specific random colors or generic full-page spinners are not accepted.

## ADR-014: Private attachment claims stop at evidenced boundaries

**Accepted.** Repository attachment controls authorize the owning record, validate safe metadata and
content, use short-lived user-bound delivery tickets and audit downloads. `NOT_CONFIGURED` is the
scanner state until a real scanner/provider is integrated. Provider object storage, IAM, KMS,
malware scanning and recovery are classified as external/provider evidence, never inferred from a
database status field or architecture hook.
