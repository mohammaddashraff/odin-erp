# Permission registry and route map

Authoritative source: `apps/api/src/permissions.ts`. The current generated registry contains 364 unique stable keys across system, dashboard, sales, purchasing, inventory, accounting, payments, banking, POS, HR, reports, approvals, audit and settings.

## Naming contract

Keys use `module.resource.action`. UI labels and route names are not permission identifiers. `system.super_admin` is the only current two-segment exception. Wildcards are supported by the evaluator but are not emitted by the registry.

Document resources use the actions defined by the source registry. The `standard` set is:

`view`, `create`, `edit`, `delete`, `approve`, `reject`, `cancel`, `print`, `export`, `import`, `reopen`, `history`.

Additional actions are resource-specific: `convert`, `process`, `post`, `use`, `reconcile`, `manage`, and `reset`.

## Protected endpoint map

| Endpoint or family | Effective permission |
|---|---|
| `GET /api/health`, auth login/refresh/logout | public by explicit authentication allowlist |
| `GET /api/auth/me` | authenticated identity |
| `GET /api/bootstrap` | authenticated plus per-section checks inside service; no single static key |
| customer create/list/detail/update | `sales.customer.create/view/edit` |
| supplier/category/unit/item/warehouse/bank-account create | exact `purchasing.supplier.create`, `inventory.item.create`, `inventory.warehouse.create`, `banking.account.create` |
| dashboard and sales overview | `dashboard.overview.view`, `sales.overview.view` |
| sales document list/reference employees/exchange rate | controller any-of plus service resource checks |
| `GET/POST/PATCH /api/documents...` | dynamic `${module}.${resource}.${view|create|edit}` |
| document convert/workflow/post | dynamic source/target `convert/create`, resource `edit/approve/reject/post`, or `approvals.queue.edit/history` |
| payments | `payments.receipt|payment.view/create`, resolved by kind in service where applicable |
| journals | `accounting.journal.view/create/edit`; workflow dynamically checks `submit/edit`, `approve`, `reject`, `post`; reversal currently uses `create` |
| periods | `accounting.period.manage` |
| POS | exact `pos.register.view`, `pos.shift.create/edit`, `pos.sale.create/edit/view/print`, `pos.return.create` |
| banking | exact account/transaction/statement view/create/reconcile families |
| approvals/audit/evidence | `approvals.queue.view`, `audit.business.view`, or documented any-of history |
| report view | `reports.standard.view` or `reports.profitability.view`, then domain prerequisites in service |
| report CSV/PDF | broad controller metadata plus a dynamic resolver requiring the exact standard/profitability export or print key, followed by report view/domain checks |
| document PDF | dynamic resolver loads the target type, requires its exact `*.print` key, then applies target view and object scope |
| access overview and mutations | class-level `system.super_admin`; mutations also require `settings.users_access.manage` |
| tenant reset | `settings.system.reset` plus password confirmation |

## Registry gaps

- Registry version and deprecation metadata.
- Module/page/tab/card/API/integration/attachment/import permissions beyond current action families.
- Exact `submit`, `request_changes`, `reverse`, `allocate`, `close`, `download_attachment`, `upload_attachment`, `impersonate`, and `configure` keys where currently represented by `edit/create/manage`.
- Per-report stable keys such as finance trial balance versus a broad standard report key.
- Temporary grant, access review, simulator, SoD exception, session revoke, password reset and MFA administration keys.
- Company, team and selected-resource administration keys.

## Route coverage gate

Add a test that enumerates Nest route metadata and fails when an authenticated endpoint has neither static permission metadata nor a registered dynamic resolver. Add equivalent tests that every navigation entry references an active registry key and every print/export endpoint resolves the exact target key.
