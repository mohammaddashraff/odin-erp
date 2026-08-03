# Current capability matrix

Audit date: 2026-08-03. Classifications describe repository evidence, not marketing intent.

Legend: **Complete**, **Substantial but incomplete**, **Partial**, **Placeholder**, **Missing**, **Unsafe**, **Configuration dependent**, **Requires manual verification**.

| Capability | Classification | Repository evidence and gap |
|---|---|---|
| Authentication | Substantial but incomplete | bcrypt login, signed access tokens, rotating persisted refresh sessions, active-user recheck; no MFA/SSO, recovery, throttling, privileged step-up, or session administration UI |
| Tenant isolation | Substantial but incomplete | forced PostgreSQL RLS and tenant transaction context; admin Prisma connection bypasses RLS by design and requires strict operational control |
| Company isolation | Missing | no Company model or `companyId` on transactions, roles, users, reports, or journals |
| Branch/warehouse access | Partial | user JSON assignments and service assertions exist; POS list/detail/resume/return/close now apply branch/warehouse checks, while several report/banking paths still lack equivalent scopes |
| Permission registry | Substantial but incomplete | 364 stable `module.resource.action` keys; no registry version, lifecycle compatibility contract, or generated route coverage gate |
| Roles and user overrides | Substantial but incomplete | primary/additional roles and explicit grant/deny overrides; only Super Admin may administer, with no delegation boundary |
| Default deny | Unsafe | action permissions default deny, but absent data scope defaults to `BRANCH`; this violates the requested record default-deny rule |
| Data scopes | Partial | OWN, ASSIGNED, TEAM, BRANCH, WAREHOUSE, DEPARTMENT, ALL across selected resources; missing NONE, COMPANY, SELECTED_RESOURCES, CUSTOM_POLICY and consistent endpoint enforcement |
| Field security | Partial | eleven registered fields are redacted in common serializers; inspected evidence journal values now obey field policy, but audit payloads, some reports and nested structures are not centrally redacted |
| Financial/authority limits | Partial | four sales limits; purchasing, inventory, journal, payment, refund, bank, POS override, and approval limits are missing |
| Temporary access/delegation | Missing | no models, scheduler, expiry enforcement, approval, or UI |
| Access reviews | Missing | no campaign, reviewer, decision, evidence, or recertification model |
| Segregation of duties | Missing | maker-checker exists for document/journal approval, but no policy registry, assignment-time detection, exceptions, or reports |
| Access simulator | Missing | no effective-decision explanation endpoint or UI |
| Permission audit | Partial | append-only access logs record role/user/permission changes and guard denials; service denials, session/IP/device detail, expiry, reviews, and sensitive downloads are incomplete |
| Role-sensitive navigation | Substantial but incomplete | 55 screens are filtered by effective permissions; four Access pages exist, five required pages are absent |
| Sales workflow | Substantial but incomplete | quotation through invoice, receipts, returns/credits, scopes, exact totals, posting and reports; CRM, reservations, installments, versions, commissions, portal and broader policies missing |
| Purchasing workflow | Substantial but incomplete | request/RFQ/order/receipt/bill/return/payment; comparison, matching governance, landed cost/imports, supplier performance and robust approvals missing |
| Inventory | Substantial but incomplete | perpetual movement/balance ledger, transfers, adjustments, counts, weighted-average issue costing, negative-stock prevention; bins, variants, UOM conversion, reservations, batch/serial/expiry, FIFO/FEFO and concurrency locks missing |
| Accounting | Substantial but incomplete | balanced immutable journals, chart, control accounts, periods, reversal, core statements; multi-company, close workflow, recurring/accrual/prepaid/deferred, budgets, FX revaluation and consolidation missing |
| Treasury/payments | Partial | receipts/payments, allocations, bank transactions/statements and exact matching; currency-rich allocation state, over-allocation database constraints, cheque lifecycle, advances and payment reversals missing |
| POS | Partial | shifts, hold/resume, tender, stock/journal, return and close with branch/warehouse list and object checks; returns are all-or-nothing, refund uses first tender, and idempotency consumption/register assignment remain absent |
| HR/payroll | Placeholder | employee/departments and salary field security exist; attendance, contracts, leave, payroll and treasury/accounting lifecycle are absent |
| Fixed assets | Missing | no schema, service, routes, reports, or tests |
| Manufacturing/MRP | Missing | no schema, service, routes, reports, or tests |
| Projects/services/maintenance | Missing | no schema, service, routes, reports, or tests |
| Portals/integrations | Missing | no portal identity, scoped API clients, webhooks, outbox, retries, replay protection, or adapters |
| Approvals | Partial | one-step document/journal events, maker-checker and reasons; no configurable graph, delegation, escalation, SLA, parallel steps or attachments |
| Reporting | Substantial but incomplete | live financial/commercial/inventory/POS reports, CSV/PDF and reconciliations; report registry is hardcoded, field/scope parity has gaps, background export absent |
| Dashboard | Partial | permission/field-aware KPIs and drill areas; no card registry, freshness metadata, saved filters, or proven report/dashboard equality |
| Arabic/RTL/themes | Substantial but incomplete | central translation audit passes, Arabic/RTL and themes exist; manual accessibility and document-font verification remain required |
| Auditability | Substantial but incomplete | append-only business/access logs and posting references; audit payload redaction, retention governance, SIEM export and comprehensive event taxonomy missing |
| Database concurrency | Partial | serializable tenant transactions, sequence upserts and unique keys; stock read/then-upsert lacks explicit row lock/version, idempotency table is unused |
| Observability | Placeholder | JSON request logs and DB health endpoint; no metrics, traces, queues, alerts, error tracker, slow-query or connection monitoring |
| Backups/restore | Missing | no automation, evidence, RPO/RTO decision, encryption/retention policy or restore drill |
| CI/CD | Partial | pull-request/main quality workflow now runs Node 24, PostgreSQL 17, migrations, seed, lint, i18n, Jest and build; security scanning, E2E promotion and release deployment remain absent |
| Release management | Partial | build is side-effect free and `release:migrate` is explicit; immutable tags, environment promotion, deployment automation and proven rollback remain absent |
| Automated tests | Substantial but incomplete | 8 Jest suites/53 tests and 23 Playwright scenarios exist; 37 non-database tests pass, while this host lacks PostgreSQL/Chromium prerequisites and major negative/security/concurrency scenarios remain absent |

## Current navigation status

Sales, purchasing, inventory, POS, accounting, banking, approvals, reports, dashboard, audit, and four access pages are executable. HR is only an employee list. No unfinished future domain is present in navigation, which should remain the rule.
