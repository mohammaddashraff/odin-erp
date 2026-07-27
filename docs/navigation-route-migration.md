# Odin ERP navigation and route migration

This document records the canonical information architecture implemented by the
typed registry in `apps/web/src/app/navigation.ts`. The registry is the single
source of truth for sidebar modules, routes, breadcrumbs, permissions, screen
types, document types, report context, and legacy redirects.

## Final module hierarchy

| # | Module | Canonical landing route | Module permission | Category |
|---:|---|---|---|---|
| 1 | Command Center | `/dashboard` | `dashboard.read` | Management |
| 2 | Sales & Customers | `/sales/overview` | `sales.write` | Operations |
| 3 | Purchasing & Suppliers | `/purchasing/overview` | `purchases.write` | Operations |
| 4 | Inventory & Products | `/inventory/overview` | `inventory.write` | Operations |
| 5 | Point of Sale | `/pos/workspace` | `pos.use` | Operations |
| 6 | Accounting & Finance | `/accounting/overview` | `accounting.read` | Finance |
| 7 | Cash & Banking | `/banking/overview` | `banking.read` | Finance |
| 8 | Approvals & Workflow | `/approvals/inbox` | `approvals.read` | Governance |
| 9 | Reports & Analytics | `/reports/overview` | `reports.read` | Governance |
| 10 | Administration & Control | `/admin/overview` | `audit.read` | Governance |

A module is visible only when the signed-in user has its module-level
permission. Children are then filtered by their own permissions. A generic
report permission therefore cannot reveal an unrelated operational module.

## Canonical route table

| Module | Screen | Route | Permission | Namespace / binding |
|---|---|---|---|---|
| Command Center | Executive Dashboard | `/dashboard` | `dashboard.read` | `dashboard` |
| Sales & Customers | Sales Overview | `/sales/overview` | `sales.write` | `sales` |
| Sales & Customers | Customers | `/sales/customers` | `sales.write` | `masters:customer` |
| Sales & Customers | Sales Quotations | `/sales/quotations` | `sales.write` | `documents:QUOTATION` |
| Sales & Customers | Sales Orders | `/sales/orders` | `sales.write` | `documents:SALES_ORDER` |
| Sales & Customers | Deliveries | `/sales/deliveries` | `sales.write` | `documents:DELIVERY_NOTE` |
| Sales & Customers | Sales Invoices | `/sales/invoices` | `sales.write` | `documents:SALES_INVOICE` |
| Sales & Customers | Customer Returns | `/sales/returns` | `sales.write` | `documents:SALES_RETURN` |
| Sales & Customers | Credit Notes | `/sales/credit-notes` | `sales.write` | `documents:CREDIT_NOTE` |
| Sales & Customers | Customer Balances | `/sales/customer-balances` | `reports.read` | `reports:customer-statement` |
| Purchasing & Suppliers | Purchasing Overview | `/purchasing/overview` | `purchases.write` | `purchasing` |
| Purchasing & Suppliers | Suppliers | `/purchasing/suppliers` | `purchases.write` | `masters:supplier` |
| Purchasing & Suppliers | Purchase Requests | `/purchasing/requests` | `purchases.write` | `documents:PURCHASE_REQUEST` |
| Purchasing & Suppliers | Requests for Quotation | `/purchasing/rfqs` | `purchases.write` | `documents:PURCHASE_RFQ` |
| Purchasing & Suppliers | Purchase Orders | `/purchasing/orders` | `purchases.write` | `documents:PURCHASE_ORDER` |
| Purchasing & Suppliers | Goods Receipts | `/purchasing/receipts` | `purchases.write` | `documents:GOODS_RECEIPT` |
| Purchasing & Suppliers | Supplier Bills | `/purchasing/bills` | `purchases.write` | `documents:PURCHASE_BILL` |
| Purchasing & Suppliers | Purchase Returns | `/purchasing/returns` | `purchases.write` | `documents:PURCHASE_RETURN` |
| Purchasing & Suppliers | Supplier Balances | `/purchasing/supplier-balances` | `reports.read` | `reports:supplier-statement` |
| Inventory & Products | Inventory Overview | `/inventory/overview` | `inventory.write` | `inventory` |
| Inventory & Products | Items | `/inventory/items` | `inventory.write` | `masters:item` |
| Inventory & Products | Categories | `/inventory/categories` | `inventory.write` | `masters:category` |
| Inventory & Products | Units of Measurement | `/inventory/units` | `inventory.write` | `masters:unit` |
| Inventory & Products | Warehouses | `/inventory/warehouses` | `inventory.write` | `masters:warehouse` |
| Inventory & Products | Warehouse Transfers | `/inventory/transfers` | `inventory.write` | `documents:WAREHOUSE_TRANSFER` |
| Inventory & Products | Stock Adjustments | `/inventory/adjustments` | `inventory.write` | `documents:INVENTORY_ADJUSTMENT` |
| Inventory & Products | Stock Counts | `/inventory/counts` | `inventory.write` | `documents:STOCK_COUNT` |
| Inventory & Products | Stock Card | `/inventory/stock-card` | `reports.read` | `reports:stock-movements` |
| Inventory & Products | Inventory Valuation | `/inventory/valuation` | `reports.read` | `reports:inventory-valuation` |
| Point of Sale | POS Workspace | `/pos/workspace` | `pos.use` | `pos` |
| Accounting & Finance | Accounting Overview | `/accounting/overview` | `accounting.read` | `accounting` |
| Accounting & Finance | Chart of Accounts | `/accounting/chart-of-accounts` | `accounting.read` | `accounting:account` |
| Accounting & Finance | Journal Entries | `/accounting/journals` | `accounting.read` | `accounting` |
| Accounting & Finance | Fiscal Periods | `/accounting/periods` | `accounting.read` | `accounting` |
| Accounting & Finance | General Ledger | `/accounting/general-ledger` | `accounting.read` | `accounting` |
| Accounting & Finance | Trial Balance | `/accounting/trial-balance` | `reports.read` | `reports:trial-balance` |
| Accounting & Finance | Income Statement | `/accounting/income-statement` | `reports.profitability` | `reports:income-statement` |
| Accounting & Finance | Balance Sheet | `/accounting/balance-sheet` | `reports.profitability` | `reports:balance-sheet` |
| Cash & Banking | Cash & Bank Overview | `/banking/overview` | `banking.read` | `banking` |
| Cash & Banking | Cash & Bank Accounts | `/banking/accounts` | `banking.read` | `masters:bank` |
| Cash & Banking | Receipts & Payments | `/banking/allocations` | `payments.read` | `payments` |
| Cash & Banking | Bank Transactions & Transfers | `/banking/transactions` | `banking.read` | `banking` |
| Cash & Banking | Bank Statements | `/banking/statements` | `banking.read` | `banking` |
| Cash & Banking | Bank Reconciliation | `/banking/reconciliation` | `banking.read` | `banking` |
| Approvals & Workflow | Approval Inbox | `/approvals/inbox` | `approvals.read` | `approvals` |
| Reports & Analytics | Report Library | `/reports/overview` | `reports.read` | `reports` |
| Reports & Analytics | Sales Reports | `/reports/sales` | `reports.read` | `reports:sales` |
| Reports & Analytics | Purchasing Reports | `/reports/purchasing` | `reports.read` | `reports:purchasing` |
| Reports & Analytics | Inventory Reports | `/reports/inventory` | `reports.read` | `reports:inventory` |
| Reports & Analytics | Accounting Reports | `/reports/accounting` | `reports.read` | `reports:accounting` |
| Reports & Analytics | Cash & Bank Reports | `/reports/banking` | `reports.read` | `reports:banking` |
| Reports & Analytics | POS Reports | `/reports/pos` | `reports.read` | `reports:pos` |
| Administration & Control | Administration Overview | `/admin/overview` | `audit.read` | `admin` |
| Administration & Control | Audit Log | `/admin/audit` | `audit.read` | `audit` |
| Administration & Control | System Health | `/admin/system-health` | `system.reset` | `admin` |

Total: 10 modules and 55 directly addressable screens.

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
