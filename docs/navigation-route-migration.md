# Odin ERP navigation and route migration

This document records the canonical information architecture implemented by the
typed registry in `apps/web/src/app/navigation.ts`. The registry is the single
source of truth for sidebar modules, routes, breadcrumbs, permissions, screen
types, document types, report context, and legacy redirects.

## Final module hierarchy

| # | Module | Canonical landing route | Module permission | Category |
|---:|---|---|---|---|
| 1 | Command Center | `/dashboard` | `dashboard.overview.view` | Management |
| 2 | Sales | `/sales/overview` | `sales.overview.view` | Operations |
| 3 | Purchasing & Suppliers | `/purchasing/overview` | `purchasing.overview.view` | Operations |
| 4 | Inventory & Products | `/inventory/overview` | `inventory.overview.view` | Operations |
| 5 | Human Resources | `/hr/employees` | `hr.employee.view` | Operations |
| 6 | Point of Sale | `/pos/workspace` | `pos.register.view` | Operations |
| 7 | Accounting & Finance | `/accounting/overview` | `accounting.overview.view` | Finance |
| 8 | Cash & Banking | `/banking/overview` | `banking.account.view` | Finance |
| 9 | Approvals & Workflow | `/approvals/inbox` | `approvals.queue.view` | Governance |
| 10 | Reports & Analytics | `/reports/overview` | `reports.standard.view` | Governance |
| 11 | Administration & Control | `/admin/overview` | `audit.business.view` | Governance |

A module is visible only when the signed-in user has its module-level
permission. Children are then filtered by their own permissions. A generic
report permission therefore cannot reveal an unrelated operational module.

## Canonical route table

| Module | Screen | Route | Permission | Namespace / binding |
|---|---|---|---|---|
| Command Center | Executive Dashboard | `/dashboard` | `dashboard.overview.view` | `dashboard` |
| Sales | Sales Overview | `/sales/overview` | `sales.overview.view` | `sales` |
| Sales | Customers | `/sales/customers` | `sales.customer.view` | `masters:customer` |
| Sales | Quotations | `/sales/quotations` | `sales.quotation.view` | `documents:QUOTATION` |
| Sales | Sales Orders | `/sales/orders` | `sales.order.view` | `documents:SALES_ORDER` |
| Sales | Deliveries | `/sales/deliveries` | `sales.delivery.view` | `documents:DELIVERY_NOTE` |
| Sales | Invoices | `/sales/invoices` | `sales.invoice.view` | `documents:SALES_INVOICE` |
| Sales | Returns | `/sales/returns` | `sales.return.view` | `documents:SALES_RETURN` |
| Sales | Credit Notes | `/sales/credit-notes` | `sales.credit_note.view` | `documents:CREDIT_NOTE` |
| Sales | Customer Balances | `/sales/customer-balances` | `reports.standard.view` | `reports:customer-balances` |
| Purchasing & Suppliers | Purchasing Overview | `/purchasing/overview` | `purchasing.overview.view` | `purchasing` |
| Purchasing & Suppliers | Suppliers | `/purchasing/suppliers` | `purchasing.supplier.view` | `masters:supplier` |
| Purchasing & Suppliers | Purchase Requests | `/purchasing/requests` | `purchasing.request.view` | `documents:PURCHASE_REQUEST` |
| Purchasing & Suppliers | Requests for Quotation | `/purchasing/rfqs` | `purchasing.rfq.view` | `documents:PURCHASE_RFQ` |
| Purchasing & Suppliers | Purchase Orders | `/purchasing/orders` | `purchasing.order.view` | `documents:PURCHASE_ORDER` |
| Purchasing & Suppliers | Goods Receipts | `/purchasing/receipts` | `purchasing.receipt.view` | `documents:GOODS_RECEIPT` |
| Purchasing & Suppliers | Supplier Bills | `/purchasing/bills` | `purchasing.bill.view` | `documents:PURCHASE_BILL` |
| Purchasing & Suppliers | Purchase Returns | `/purchasing/returns` | `purchasing.return.view` | `documents:PURCHASE_RETURN` |
| Purchasing & Suppliers | Supplier Balances | `/purchasing/supplier-balances` | `reports.standard.view` | `reports:supplier-statement` |
| Inventory & Products | Inventory Overview | `/inventory/overview` | `inventory.overview.view` | `inventory` |
| Inventory & Products | Items | `/inventory/items` | `inventory.item.view` | `masters:item` |
| Inventory & Products | Categories | `/inventory/categories` | `inventory.item.view` | `masters:category` |
| Inventory & Products | Units of Measurement | `/inventory/units` | `inventory.item.view` | `masters:unit` |
| Inventory & Products | Warehouses | `/inventory/warehouses` | `inventory.warehouse.view` | `masters:warehouse` |
| Inventory & Products | Warehouse Transfers | `/inventory/transfers` | `inventory.transfer.view` | `documents:WAREHOUSE_TRANSFER` |
| Inventory & Products | Stock Adjustments | `/inventory/adjustments` | `inventory.adjustment.view` | `documents:INVENTORY_ADJUSTMENT` |
| Inventory & Products | Stock Counts | `/inventory/counts` | `inventory.stock_count.view` | `documents:STOCK_COUNT` |
| Inventory & Products | Stock Card | `/inventory/stock-card` | `reports.standard.view` | `reports:stock-movements` |
| Inventory & Products | Inventory Valuation | `/inventory/valuation` | `reports.standard.view` | `reports:inventory-valuation` |
| Human Resources | Employees | `/hr/employees` | `hr.employee.view` | `masters:employee` |
| Point of Sale | POS Workspace | `/pos/workspace` | `pos.register.view` | `pos` |
| Accounting & Finance | Accounting Overview | `/accounting/overview` | `accounting.overview.view` | `accounting` |
| Accounting & Finance | Chart of Accounts | `/accounting/chart-of-accounts` | `accounting.account.view` | `accounting:account` |
| Accounting & Finance | Journal Entries | `/accounting/journals` | `accounting.journal.view` | `accounting` |
| Accounting & Finance | Fiscal Periods | `/accounting/periods` | `accounting.period.view` | `accounting` |
| Accounting & Finance | General Ledger | `/accounting/general-ledger` | `accounting.journal.view` | `accounting` |
| Accounting & Finance | Trial Balance | `/accounting/trial-balance` | `reports.standard.view` | `reports:trial-balance` |
| Accounting & Finance | Income Statement | `/accounting/income-statement` | `reports.profitability.view` | `reports:income-statement` |
| Accounting & Finance | Balance Sheet | `/accounting/balance-sheet` | `reports.profitability.view` | `reports:balance-sheet` |
| Cash & Banking | Cash & Bank Overview | `/banking/overview` | `banking.account.view` | `banking` |
| Cash & Banking | Cash & Bank Accounts | `/banking/accounts` | `banking.account.view` | `masters:bank` |
| Cash & Banking | Receipts & Payments | `/banking/allocations` | `payments.receipt.view` | `payments` |
| Cash & Banking | Bank Transactions & Transfers | `/banking/transactions` | `banking.transaction.view` | `banking` |
| Cash & Banking | Bank Statements | `/banking/statements` | `banking.statement.view` | `banking` |
| Cash & Banking | Bank Reconciliation | `/banking/reconciliation` | `banking.statement.reconcile` | `banking` |
| Approvals & Workflow | Approval Inbox | `/approvals/inbox` | `approvals.queue.view` | `approvals` |
| Reports & Analytics | Report Library | `/reports/overview` | `reports.standard.view` | `reports` |
| Reports & Analytics | Sales Reports | `/reports/sales` | `reports.standard.view` | `reports:sales` |
| Reports & Analytics | Purchasing Reports | `/reports/purchasing` | `reports.standard.view` | `reports:purchasing` |
| Reports & Analytics | Inventory Reports | `/reports/inventory` | `reports.standard.view` | `reports:inventory` |
| Reports & Analytics | Accounting Reports | `/reports/accounting` | `reports.standard.view` | `reports:accounting` |
| Reports & Analytics | Cash & Bank Reports | `/reports/banking` | `reports.standard.view` | `reports:banking` |
| Reports & Analytics | POS Reports | `/reports/pos` | `reports.standard.view` | `reports:pos` |
| Administration & Control | Administration Overview | `/admin/overview` | `audit.business.view` | `admin` |
| Administration & Control | Audit Log | `/admin/audit` | `audit.business.view` | `audit` |
| Administration & Control | Users | `/settings/access/users` | `system.super_admin` | `permissions` |
| Administration & Control | Roles | `/settings/access/roles` | `system.super_admin` | `permissions` |
| Administration & Control | Permissions | `/settings/access/permissions` | `system.super_admin` | `permissions` |
| Administration & Control | Access Audit Log | `/settings/access/audit` | `system.super_admin` | `permissions` |
| Administration & Control | System Health | `/admin/system-health` | `settings.system.view` | `admin` |

Total: 11 modules and 60 directly addressable screens.

## Legacy bookmark migration

| Legacy route | Canonical route |
|---|---|
| `/` | `/dashboard` |
| `/sales` | `/sales/overview` |
| `/purchases` | `/purchasing/overview` |
| `/inventory` | `/inventory/overview` |
| `/pos` | `/pos/workspace` |
| `/payments` | `/banking/allocations` |
| `/accounting` | `/accounting/general-ledger` |
| `/banking` | `/banking/overview` |
| `/approvals` | `/approvals/inbox` |
| `/reports` | `/reports/overview` |
| `/audit` | `/admin/audit` |

## Purchasing terminology and workflow

Purchasing no longer reuses sales-quotation terminology:

1. Purchase Request (`PURCHASE_REQUEST`, طلب شراء)
2. Request for Quotation (`PURCHASE_RFQ`, طلب عرض سعر)
3. Purchase Order (`PURCHASE_ORDER`, أمر شراء)
4. Goods Receipt (`GOODS_RECEIPT`, إذن استلام)
5. Supplier Bill (`PURCHASE_BILL`, فاتورة مورد)
6. Purchase Return (`PURCHASE_RETURN`, مرتجع مشتريات)

Purchase Requests intentionally have no supplier field. A Request for Quotation
is supplier-facing and requires a supplier. The persisted conversion chain is
`PURCHASE_REQUEST -> PURCHASE_RFQ -> PURCHASE_ORDER`.

## Localization ownership

All visible route labels are resolved through the centralized catalog in
`apps/web/src/app/i18n.ts`. Purchasing uses the `documents` namespace for
document screens and forms, with supporting text from `navigation`, `masters`,
`common`, `enums`, and `references`. The selected locale is persisted in the
`odin_language` cookie and is therefore available during both server rendering
and client rendering.

## Verification coverage

`tests/e2e/odin-ui.spec.ts` checks:

- exactly ten module groups and one expanded module;
- all 55 direct routes, headings, and breadcrumbs;
- all legacy redirects;
- collapsed desktop and mobile navigation;
- business-role module visibility;
- distinct Purchase Request and supplier RFQ forms and persisted document types;
- English LTR and Arabic RTL screenshot evidence.

`tests/e2e/localization.spec.ts` checks:

- locale persistence across direct reloads;
- `html[lang]` and `html[dir]`;
- Arabic/English inverse assertions;
- Purchasing labels, tabs/routes, empty states, forms, validation, dropdowns,
  dialogs, and persisted documents;
- localized report/PDF export endpoints;
- zero console errors and zero HTTP 5xx responses.
