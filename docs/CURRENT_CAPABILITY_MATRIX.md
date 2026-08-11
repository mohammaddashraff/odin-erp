# Current capability matrix

Audit date: 2026-08-11. Classifications describe repository evidence, not marketing intent. The
successful 8 August quality run remains historical evidence for commit `b534bc2`; it does not make
the current uncommitted tranche **Tested**. Current implementations remain **Implemented** or
**Partially implemented** until a new immutable commit passes the applicable gates.

Legend: **Implemented**, **Partially implemented**, **Tested**, **Requires external/provider
evidence**, **Not implemented**.

| Capability | Classification | Repository evidence and gap |
|---|---|---|
| Authentication | Implemented | bcrypt login, encrypted TOTP, hashed one-time recovery codes, governed reset, throttling, five-minute privileged step-up, rotating persisted refresh sessions, idle/absolute expiry and logout-all exist; SSO and per-device session administration UI remain absent; current rerun pending |
| Tenant isolation | Implemented | forced PostgreSQL RLS and tenant transaction context exist; the admin Prisma connection bypasses RLS by design and requires strict operational control; historical negative evidence exists, current rerun pending |
| Company isolation | Partially implemented | Company, time-bounded membership, CompanyBranch mapping, customer/supplier ownership, mapped bank/GL ownership, default-company compatibility and branch-derived actor/query/trigger bounds are implemented. Items and several reference/configuration masters remain tenant-level; current full regression evidence is pending |
| Branch/warehouse access | Implemented | user assignments and query-level predicates protect current documents, POS, bootstrap, approvals, banking and reports; new endpoints still require registry and negative-test coverage |
| Permission registry | Implemented | normalized `module.resource.action` keys and controller-literal coverage exist; governance and attachment routes deliberately reuse bounded settings/document policy plus dynamic resolvers. Registry versioning and lifecycle compatibility remain absent |
| Roles and user overrides | Implemented | primary/additional roles and explicit grant/deny overrides exist; Company Administrator governance is bounded to assigned companies, while tenant-wide role/user administration remains Super-Admin-gated and a distinct bounded Functional/Security Administrator is incomplete |
| Default deny | Implemented | missing action permissions and record scopes deny through `NONE`; historical clean-database/live-browser evidence exists, current rerun pending |
| Data scopes | Partially implemented | `NONE`, `OWN`, `ASSIGNED`, `TEAM`, `BRANCH`, `WAREHOUSE`, `DEPARTMENT`, and `ALL` exist; company membership/branch envelopes and typed selected-resource assignments are implemented, while resource-specific DENY/custom predicates and normalized team membership remain incomplete |
| Field security | Implemented | a centralized projector covers the identified journal/payment/supplier/customer/document/audit leaks; universal future-endpoint/nested/job coverage still requires registry discipline and current negative evidence is pending |
| Financial-resource assignments | Partially implemented | typed FinancialResource and time-bounded assignment records cover treasury, wallet, payment-card, cash-source, cheque-book, cost-centre, project, bank-account and GL-account classes. Bank/GL IDs have operational adapters; the other classes are governance records until corresponding business domains exist |
| Financial/authority limits | Partially implemented | the registry contains four compatibility sales limits plus typed authority keys for purchase approvals, receipts/payments, treasury movement, journal posting, expenses and customer credit exposure. Company/branch/role/department/document/currency/time-bounded policies are enforced by current document, payment, journal and treasury adapters; full domain coverage, approval routing/escalation and current rerun evidence remain incomplete |
| Temporary access | Implemented | company/start/end/reason/grantor/revocation plus automatic active-window evaluation are implemented; current expiry and adapter evidence is pending |
| Delegation | Implemented | company/scope/start/end/reason/revocation with deny-wins and non-escalation validation is implemented; current envelope-tampering evidence is pending |
| Access reviews | Implemented | effective assignment review and immutable review evidence are implemented; mature campaign/attestation workflow and browser depth remain incomplete |
| Segregation of duties | Partially implemented | maker-checker plus seeded configurable `WARN` rules are implemented. Configured `BLOCK` rules reject conflicts on role create/update/duplicate, user primary/additional-role and override changes, temporary grants and delegations. Generalized configurable same-record rules and governed exceptions remain incomplete; current rerun pending |
| Effective Access Simulator and safe preview | Implemented | explainable non-mutating calculation/preview is implemented and does not replace the selected user's session; current authorization evidence is pending |
| Permission audit | Implemented | append-only access logs and centralized safe 401/403 denial logging exist; external SIEM, device detail, expiry/reviews and complete sensitive-download taxonomy remain incomplete |
| Role-sensitive navigation | Partially implemented | the permission-gated Access Governance route exposes assigned companies, effective access, safe simulation and review evidence/actions. Tenant-wide access pages remain Super-Admin-only, and membership/resource/temporary/delegation/authority mutation forms are not all present; current direct-route/browser verification is pending |
| Private attachments | Implemented | DB-backed bytes and safe metadata, allowlisted type/size, hash, safe filename, owning-record authorization, sales-document upload/list/download UI, user/session-bound short-lived ticket and download audit are implemented; scanner state is truthfully `NOT_CONFIGURED`. DB logical recovery is implemented in the drill; provider object storage/scanner/recovery requires external evidence |
| Attachment malware scanning and provider object delivery/recovery | Requires external/provider evidence | no scanner or provider object store is integrated; `NOT_CONFIGURED` is not a scan result, and the PostgreSQL logical restore drill cannot establish provider IAM/KMS/versioning/replication/recovery |
| Sales workflow | Implemented | quotation through invoice, receipts, returns/credits, exact totals, posting and reports exist; CRM, reservations, installments, versions, commissions, portal and broader policies remain absent |
| Purchasing workflow | Partially implemented | request/RFQ/order/receipt/bill/return exist; outgoing supplier payments now submit for a separate checker before posting/allocation. Comparison, matching governance, landed cost/imports, supplier performance, payment reversal and broader limits remain incomplete |
| Inventory | Partially implemented | perpetual movement/balance ledger, transfers, adjustments, counts, weighted-average issue costing and negative-stock prevention exist; bins, variants, UOM conversion, reservations, batch/serial/expiry, FIFO/FEFO and stronger concurrency remain incomplete |
| Accounting | Partially implemented | balanced immutable journals, chart, control accounts, periods, reversal and core statements exist; multi-company policy propagation, close workflow, recurring/accrual/deferred, budgets, FX revaluation and consolidation remain incomplete |
| Treasury/payments | Partially implemented | customer receipts post immediately; outgoing supplier payments persist a submitted instruction with no journal/allocation effect until a different authorized checker approves, while reject evidence is retained. Payment data scope is enforced across lists, create, decisions, customer detail, reports and audit evidence, and raw allocation-plan JSON is not projected. Bank transactions/statements and exact matching exist; currency-rich allocation facts, cheque controls, advances and governed reversals remain incomplete |
| POS | Partially implemented | shifts, hold/resume, tender, stock/journal, return and close plus branch/warehouse checks exist; partial returns, original-tender refund, terminal model and idempotency remain incomplete |
| HR/payroll | Partially implemented | employee/department master and salary field security exist; attendance, contracts, leave, payroll and accounting/treasury lifecycle are not implemented |
| Fixed assets | Not implemented | no schema, service, routes, reports or tests |
| Manufacturing/MRP | Not implemented | no schema, service, routes, reports or tests |
| Projects/services/maintenance business workflow | Not implemented | Project may exist as an access-assignment resource in the tranche, but no operational project/service/maintenance domain exists |
| Portals/integrations | Not implemented | no portal identity, scoped API clients, webhooks, outbox, retries, replay protection or adapters |
| Approvals | Partially implemented | one-step document/journal decisions and outgoing-payment approve/reject now retain actor/comment evidence and maker/checker separation; configurable graphs, escalation/SLA, parallel steps, governed exceptions and approval attachment workflow remain incomplete |
| Reporting | Partially implemented | live financial/commercial/inventory/POS reports, CSV/PDF and reconciliations exist; central report registry, full projection parity and background export remain incomplete |
| Dashboard | Partially implemented | permission/field-aware KPIs and the semantic hierarchy/loading treatment are implemented; current browser verification, freshness metadata, saved filters and proven report equality remain pending or absent as applicable |
| Western-digit Arabic localization | Implemented | central web and API/export locales use `ar-EG-u-nu-latn`; final full-route/input/export assertions and current suite evidence remain pending |
| Loading, skeleton and motion system | Partially implemented | reusable page/card/table/form/report/chart/action patterns and reduced-motion behavior are implemented; current route-wide browser evidence is pending |
| Semantic colors and module identity | Partially implemented | shared functional color families, dashboard accents and restrained module identities are implemented; current light/dark contrast and visual verification are pending |
| RTL/themes/responsive UX | Partially implemented | centralized translations, logical CSS, light/dark themes and responsive layouts exist; new component directionality, accessibility and document-font checks require current verification |
| Auditability | Partially implemented | append-only business/access logs and posting references exist; universal payload redaction, retention governance, SIEM export and comprehensive event taxonomy remain incomplete |
| Database concurrency | Partially implemented | serializable tenant transactions, sequence upserts and unique keys exist; stock row locking/versioning and idempotency consumption remain incomplete |
| Observability | Partially implemented | safe JSON request logs and database health exist; production metrics, traces, queues, alerts, error tracking and slow-query monitoring are not implemented in the repository |
| Repository backup/restore | Implemented | historical CI passed an encrypted logical restore with migration/RLS/reconciliation/API checks; the current drill also requires a non-empty DB-backed attachment and source/restored count, byte and content-manifest equality. Portable checksum/file-mode mechanics are implemented, but the current-tranche drill rerun is pending |
| Provider PITR/cross-region/IAM/KMS/retention | Requires external/provider evidence | production recovery points, cross-region state, immutable/legal retention, IAM, KMS rotation, monitoring delivery and achieved RPO/RTO cannot be inferred from repository code |
| CI/CD | Implemented | quality workflow covers Node 24, PostgreSQL 17, schema validation, migrations, seed, TypeScript, i18n, Jest, integrity, builds, security, browser and restore; current-tranche run is pending and production promotion remains absent |
| Release management | Partially implemented | build is side-effect-free, validation/release-migration commands and promotion checklist exist; immutable tags, artifact promotion, deployment automation and proven rollback are not implemented |
| Automated tests | Partially implemented | historical CI totals remain tied to the historical SHA. Current source adds company/governance, field/direct-ID, private-attachment, payment-approval, localization and loading regressions, but exact final suite/test totals and an immutable current run are still required before `Tested` |

## Current navigation status

The navigation registry includes an executable, permission-gated Access Governance route in addition
to the tenant-wide Super-Admin Users & Access pages. That workspace exposes company selection,
effective-access evidence, safe simulation and access-review history/actions through authorized API
routes. It is not a complete browser editor for membership, financial resources, temporary grants,
delegation or authority policies. Current direct-route/browser verification remains pending, and
future governance screens must not enter navigation before they are executable, server-authorized and
covered by direct-route tests.
