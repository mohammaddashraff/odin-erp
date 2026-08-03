# Architecture decisions

## ADR-001: Evolve, do not rewrite

**Accepted.** Preserve Next.js/React, NestJS, Prisma/PostgreSQL, fixed-point money/quantity, tenant RLS, existing migrations and production data. The current stack has no proven blocker.

## ADR-002: PostgreSQL remains the authoritative integrity boundary

**Accepted.** Business services validate and authorize; PostgreSQL RLS, constraints, triggers and transactions enforce tenant and immutable-posting invariants. Admin connections are limited to migration, controlled bootstrap, restore and break-glass operations.

## ADR-003: Central explainable authorization

**Accepted target.** Replace scattered policy helpers with one decision service and channel-specific adapters. Exact denial reason/evidence is retained server-side; external responses remain safe.

## ADR-004: Default deny for action, record and field

**Accepted target.** Missing permission denies, missing record scope becomes `NONE`, and unregistered sensitive fields are not exposed. The current BRANCH compatibility default must be removed through audited migration.

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
