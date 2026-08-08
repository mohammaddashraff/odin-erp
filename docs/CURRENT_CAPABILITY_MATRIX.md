# Current capability matrix

Audit date: 2026-08-08. Classifications describe repository evidence, not marketing intent.

Legend: **Complete**, **Substantial but incomplete**, **Partial**, **Placeholder**, **Missing**, **Unsafe**, **Configuration dependent**, **Requires manual verification**.

| Capability | Classification | Repository evidence and gap |
|---|---|---|
| Authentication | Substantial but incomplete | bcrypt login, encrypted TOTP, hashed one-time recovery codes, governed reset, email/IP throttling, five-minute privileged step-up, rotating persisted refresh sessions, idle/absolute expiry and logout-all; SSO and per-device session administration UI remain missing |
| Tenant isolation | Substantial but incomplete | forced PostgreSQL RLS and tenant transaction context; admin Prisma connection bypasses RLS by design and requires strict operational control |
| Company isolation | Missing | no Company model or `companyId` on transactions, roles, users, reports, or journals |
| Branch/warehouse access | Substantial but incomplete | user assignments and query-level predicates protect documents, POS, bootstrap, approvals and current banking/report paths; Company is not normalized and new endpoints still require registry coverage |
| Permission registry | Substantial but incomplete | 364 stable `module.resource.action` keys plus a controller-decorator coverage test; no registry version or lifecycle compatibility contract |
| Roles and user overrides | Substantial but incomplete | primary/additional roles and explicit grant/deny overrides; only Super Admin may administer, with no delegation boundary |
| Default deny | Complete for current repository surface | action permissions and absent resource scopes both default deny through `NONE`; clean-database and live browser negative tests enforce the behavior |
| Data scopes | Substantial but incomplete | `NONE`, `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and `ALL` have query-level unit and persisted database matrices; current financial resources support assigned IDs, while Company, resource-specific DENY and custom-policy modeling remain missing |
| Field security | Partial | eleven registered fields are redacted in common serializers; inspected evidence journal values now obey field policy, but audit payloads, some reports and nested structures are not centrally redacted |
| Financial/authority limits | Partial | four sales limits; purchasing, inventory, journal, payment, refund, bank, POS override, and approval limits are missing |
| Temporary access/delegation | Missing | no models, scheduler, expiry enforcement, approval, or UI |
| Access reviews | Missing | no campaign, reviewer, decision, evidence, or recertification model |
| Segregation of duties | Missing | maker-checker exists for document/journal approval, but no policy registry, assignment-time detection, exceptions, or reports |
| Access simulator | Missing | no effective-decision explanation endpoint or UI |
| Permission audit | Substantial but incomplete | append-only access logs record role/user/permission changes and a global filter captures guard/service 401/403 decisions with safe context; external SIEM, device detail, expiry/reviews and sensitive-download taxonomy remain incomplete |
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
| Backups/restore | Substantial but incomplete | CI run 31256037111 passed an encrypted, checksum-verified clean PostgreSQL 17 restore with migration, RLS, reconciliation and restored-API checks; provider PITR, cross-region retention, object attachments and production IAM/KMS evidence remain deployment work |
| CI/CD | Substantial but incomplete | pull-request/main quality workflow runs Node 24, PostgreSQL 17, 14 clean migrations, seed, lint, i18n, 84 Jest tests, integrity, builds, security gates, 25 Playwright tests and an encrypted restore drill; production promotion/deployment and provider evidence remain absent |
| Release management | Partial | build is side-effect free and `release:migrate` is explicit; immutable tags, environment promotion, deployment automation and proven rollback remain absent |
| Automated tests | Substantial but incomplete | CI run 31256037111 passed 10 Jest suites/84 tests and 25/25 Chromium scenarios, including all eight data scopes and live direct-API denials; broader concurrency, attachment, Company and production-provider scenarios remain absent |

## Current navigation status

Sales, purchasing, inventory, POS, accounting, banking, approvals, reports, dashboard, audit, and four access pages are executable. HR is only an employee list. No unfinished future domain is present in navigation, which should remain the rule.
