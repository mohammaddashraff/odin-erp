import type { IconName } from './ui-icons';

export type ScreenKind =
  | 'dashboard'
  | 'domain-overview'
  | 'documents'
  | 'master-data'
  | 'pos'
  | 'accounting'
  | 'payments'
  | 'banking'
  | 'approvals'
  | 'reports'
  | 'audit'
  | 'system-health';

export type ModuleId =
  | 'command'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'hr'
  | 'pos'
  | 'accounting'
  | 'banking'
  | 'approvals'
  | 'reports'
  | 'admin';

export interface RouteDefinition {
  id: string;
  label: string;
  route: `/${string}`;
  permission: string;
  namespace: string;
  screen: ScreenKind;
  documentType?: string;
  masterKind?: 'customer' | 'supplier' | 'item' | 'category' | 'unit' | 'warehouse' | 'bank' | 'account' | 'employee';
  reportCategory?: 'sales' | 'purchasing' | 'inventory' | 'accounting' | 'banking' | 'pos';
  initialReport?: string;
}

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  route: `/${string}`;
  icon: IconName;
  permission: string;
  category: 'management' | 'operations' | 'finance' | 'governance';
  children: readonly RouteDefinition[];
}

export const modules: readonly ModuleDefinition[] = [
  {
    id: 'command',
    label: 'Command Center',
    route: '/dashboard',
    icon: 'dashboard',
    permission: 'dashboard.read',
    category: 'management',
    children: [
      { id: 'dashboard', label: 'Executive Dashboard', route: '/dashboard', permission: 'dashboard.read', namespace: 'dashboard', screen: 'dashboard' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    route: '/sales/overview',
    icon: 'sales',
    permission: 'sales.write',
    category: 'operations',
    children: [
      { id: 'sales-overview', label: 'Sales Overview', route: '/sales/overview', permission: 'sales.write', namespace: 'sales', screen: 'domain-overview' },
      { id: 'customers', label: 'Customers', route: '/sales/customers', permission: 'sales.write', namespace: 'masters', screen: 'master-data', masterKind: 'customer' },
      { id: 'sales-quotations', label: 'Quotations', route: '/sales/quotations', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'QUOTATION' },
      { id: 'sales-orders', label: 'Sales Orders', route: '/sales/orders', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'SALES_ORDER' },
      { id: 'deliveries', label: 'Deliveries', route: '/sales/deliveries', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'DELIVERY_NOTE' },
      { id: 'sales-invoices', label: 'Invoices', route: '/sales/invoices', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'SALES_INVOICE' },
      { id: 'sales-returns', label: 'Returns', route: '/sales/returns', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'SALES_RETURN' },
      { id: 'credit-notes', label: 'Credit Notes', route: '/sales/credit-notes', permission: 'sales.write', namespace: 'documents', screen: 'documents', documentType: 'CREDIT_NOTE' },
      { id: 'customer-balances', label: 'Customer Balances', route: '/sales/customer-balances', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'sales', initialReport: 'customer-statement' },
    ],
  },
  {
    id: 'purchasing',
    label: 'Purchasing & Suppliers',
    route: '/purchasing/overview',
    icon: 'purchases',
    permission: 'purchases.write',
    category: 'operations',
    children: [
      { id: 'purchasing-overview', label: 'Purchasing Overview', route: '/purchasing/overview', permission: 'purchases.write', namespace: 'purchasing', screen: 'domain-overview' },
      { id: 'suppliers', label: 'Suppliers', route: '/purchasing/suppliers', permission: 'purchases.write', namespace: 'masters', screen: 'master-data', masterKind: 'supplier' },
      { id: 'purchase-requests', label: 'Purchase Requests', route: '/purchasing/requests', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'PURCHASE_REQUEST' },
      { id: 'purchase-rfqs', label: 'Requests for Quotation', route: '/purchasing/rfqs', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'PURCHASE_RFQ' },
      { id: 'purchase-orders', label: 'Purchase Orders', route: '/purchasing/orders', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'PURCHASE_ORDER' },
      { id: 'goods-receipts', label: 'Goods Receipts', route: '/purchasing/receipts', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'GOODS_RECEIPT' },
      { id: 'supplier-bills', label: 'Supplier Bills', route: '/purchasing/bills', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'PURCHASE_BILL' },
      { id: 'purchase-returns', label: 'Purchase Returns', route: '/purchasing/returns', permission: 'purchases.write', namespace: 'documents', screen: 'documents', documentType: 'PURCHASE_RETURN' },
      { id: 'supplier-balances', label: 'Supplier Balances', route: '/purchasing/supplier-balances', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'purchasing', initialReport: 'supplier-statement' },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory & Products',
    route: '/inventory/overview',
    icon: 'inventory',
    permission: 'inventory.write',
    category: 'operations',
    children: [
      { id: 'inventory-overview', label: 'Inventory Overview', route: '/inventory/overview', permission: 'inventory.write', namespace: 'inventory', screen: 'domain-overview' },
      { id: 'items', label: 'Items', route: '/inventory/items', permission: 'inventory.write', namespace: 'masters', screen: 'master-data', masterKind: 'item' },
      { id: 'categories', label: 'Categories', route: '/inventory/categories', permission: 'inventory.write', namespace: 'masters', screen: 'master-data', masterKind: 'category' },
      { id: 'units', label: 'Units of Measurement', route: '/inventory/units', permission: 'inventory.write', namespace: 'masters', screen: 'master-data', masterKind: 'unit' },
      { id: 'warehouses', label: 'Warehouses', route: '/inventory/warehouses', permission: 'inventory.write', namespace: 'masters', screen: 'master-data', masterKind: 'warehouse' },
      { id: 'transfers', label: 'Warehouse Transfers', route: '/inventory/transfers', permission: 'inventory.write', namespace: 'documents', screen: 'documents', documentType: 'WAREHOUSE_TRANSFER' },
      { id: 'adjustments', label: 'Stock Adjustments', route: '/inventory/adjustments', permission: 'inventory.write', namespace: 'documents', screen: 'documents', documentType: 'INVENTORY_ADJUSTMENT' },
      { id: 'counts', label: 'Stock Counts', route: '/inventory/counts', permission: 'inventory.write', namespace: 'documents', screen: 'documents', documentType: 'STOCK_COUNT' },
      { id: 'stock-card', label: 'Stock Card', route: '/inventory/stock-card', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'inventory', initialReport: 'stock-movements' },
      { id: 'valuation', label: 'Inventory Valuation', route: '/inventory/valuation', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'inventory', initialReport: 'inventory-valuation' },
    ],
  },
  {
    id: 'hr',
    label: 'Human Resources',
    route: '/hr/employees',
    icon: 'customer',
    permission: 'employees.sales.read',
    category: 'operations',
    children: [
      { id: 'employees', label: 'Employees', route: '/hr/employees', permission: 'employees.sales.read', namespace: 'hr', screen: 'master-data', masterKind: 'employee' },
    ],
  },
  {
    id: 'pos',
    label: 'Point of Sale',
    route: '/pos/workspace',
    icon: 'pos',
    permission: 'pos.use',
    category: 'operations',
    children: [
      { id: 'pos-workspace', label: 'POS Workspace', route: '/pos/workspace', permission: 'pos.use', namespace: 'pos', screen: 'pos' },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting & Finance',
    route: '/accounting/overview',
    icon: 'accounting',
    permission: 'accounting.read',
    category: 'finance',
    children: [
      { id: 'accounting-overview', label: 'Accounting Overview', route: '/accounting/overview', permission: 'accounting.read', namespace: 'accounting', screen: 'domain-overview' },
      { id: 'chart-of-accounts', label: 'Chart of Accounts', route: '/accounting/chart-of-accounts', permission: 'accounting.read', namespace: 'accounting', screen: 'master-data', masterKind: 'account' },
      { id: 'journals', label: 'Journal Entries', route: '/accounting/journals', permission: 'accounting.read', namespace: 'accounting', screen: 'accounting' },
      { id: 'periods', label: 'Fiscal Periods', route: '/accounting/periods', permission: 'accounting.read', namespace: 'accounting', screen: 'accounting' },
      { id: 'general-ledger', label: 'General Ledger', route: '/accounting/general-ledger', permission: 'accounting.read', namespace: 'accounting', screen: 'accounting' },
      { id: 'trial-balance', label: 'Trial Balance', route: '/accounting/trial-balance', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'accounting', initialReport: 'trial-balance' },
      { id: 'income-statement', label: 'Income Statement', route: '/accounting/income-statement', permission: 'reports.profitability', namespace: 'reports', screen: 'reports', reportCategory: 'accounting', initialReport: 'income-statement' },
      { id: 'balance-sheet', label: 'Balance Sheet', route: '/accounting/balance-sheet', permission: 'reports.profitability', namespace: 'reports', screen: 'reports', reportCategory: 'accounting', initialReport: 'balance-sheet' },
    ],
  },
  {
    id: 'banking',
    label: 'Cash & Banking',
    route: '/banking/overview',
    icon: 'banking',
    permission: 'banking.read',
    category: 'finance',
    children: [
      { id: 'banking-overview', label: 'Cash & Bank Overview', route: '/banking/overview', permission: 'banking.read', namespace: 'banking', screen: 'domain-overview' },
      { id: 'bank-accounts', label: 'Cash & Bank Accounts', route: '/banking/accounts', permission: 'banking.read', namespace: 'masters', screen: 'master-data', masterKind: 'bank' },
      { id: 'payment-allocations', label: 'Receipts & Payments', route: '/banking/allocations', permission: 'payments.read', namespace: 'payments', screen: 'payments' },
      { id: 'bank-transactions', label: 'Bank Transactions & Transfers', route: '/banking/transactions', permission: 'banking.read', namespace: 'banking', screen: 'banking' },
      { id: 'bank-statements', label: 'Bank Statements', route: '/banking/statements', permission: 'banking.read', namespace: 'banking', screen: 'banking' },
      { id: 'bank-reconciliation', label: 'Bank Reconciliation', route: '/banking/reconciliation', permission: 'banking.read', namespace: 'banking', screen: 'banking' },
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals & Workflow',
    route: '/approvals/inbox',
    icon: 'approvals',
    permission: 'approvals.read',
    category: 'governance',
    children: [
      { id: 'approval-inbox', label: 'Approval Inbox', route: '/approvals/inbox', permission: 'approvals.read', namespace: 'approvals', screen: 'approvals' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    route: '/reports/overview',
    icon: 'reports',
    permission: 'reports.read',
    category: 'governance',
    children: [
      { id: 'reports-overview', label: 'Report Library', route: '/reports/overview', permission: 'reports.read', namespace: 'reports', screen: 'reports' },
      { id: 'sales-reports', label: 'Sales Reports', route: '/reports/sales', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'sales' },
      { id: 'purchasing-reports', label: 'Purchasing Reports', route: '/reports/purchasing', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'purchasing' },
      { id: 'inventory-reports', label: 'Inventory Reports', route: '/reports/inventory', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'inventory' },
      { id: 'accounting-reports', label: 'Accounting Reports', route: '/reports/accounting', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'accounting' },
      { id: 'banking-reports', label: 'Cash & Bank Reports', route: '/reports/banking', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'banking' },
      { id: 'pos-reports', label: 'POS Reports', route: '/reports/pos', permission: 'reports.read', namespace: 'reports', screen: 'reports', reportCategory: 'pos' },
    ],
  },
  {
    id: 'admin',
    label: 'Administration & Control',
    route: '/admin/overview',
    icon: 'audit',
    permission: 'audit.read',
    category: 'governance',
    children: [
      { id: 'admin-overview', label: 'Administration Overview', route: '/admin/overview', permission: 'audit.read', namespace: 'admin', screen: 'domain-overview' },
      { id: 'audit-log', label: 'Audit Log', route: '/admin/audit', permission: 'audit.read', namespace: 'audit', screen: 'audit' },
      { id: 'system-health', label: 'System Health', route: '/admin/system-health', permission: 'system.reset', namespace: 'admin', screen: 'system-health' },
    ],
  },
] as const;

export const legacyRedirects: Readonly<Record<string, string>> = {
  '/sales': '/sales/overview',
  '/purchases': '/purchasing/overview',
  '/inventory': '/inventory/overview',
  '/pos': '/pos/workspace',
  '/payments': '/banking/allocations',
  '/accounting': '/accounting/general-ledger',
  '/banking': '/banking/overview',
  '/approvals': '/approvals/inbox',
  '/reports': '/reports/overview',
  '/audit': '/admin/audit',
};

export const allRoutes = modules.flatMap((module) => module.children.map((child) => ({ module, child })));

export function routeEntry(pathname: string) {
  return allRoutes.find(({ child }) => child.route === pathname) || allRoutes.find(({ child }) => child.route === '/dashboard')!;
}

export function routeForDocumentType(type: string) {
  return allRoutes.find(({ child }) => child.documentType === type)?.child.route || '/dashboard';
}

export function canAccess(permissions: readonly string[], permission: string) {
  return permissions.includes('*') || permissions.includes(permission);
}
