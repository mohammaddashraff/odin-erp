export type PermissionDefinition = {
  key: string;
  module: string;
  resource: string;
  action: string;
  description: string;
};

const actionLabels: Record<string, string> = {
  view: 'View records', create: 'Create records', edit: 'Edit records', delete: 'Delete records', approve: 'Approve records',
  reject: 'Reject records', cancel: 'Cancel records', print: 'Print records', export: 'Export records', import: 'Import records',
  post: 'Post to accounting', reopen: 'Reopen records', history: 'View record history', convert: 'Convert records',
  process: 'Process records', reconcile: 'Reconcile records', manage: 'Manage configuration', reset: 'Reset demo data', use: 'Use module',
};

function resourcePermissions(module: string, resource: string, actions: string[]): PermissionDefinition[] {
  return actions.map((action) => ({
    key: `${module}.${resource}.${action}`,
    module,
    resource,
    action,
    description: `${actionLabels[action] || action} in ${resource.replaceAll('_', ' ')}`,
  }));
}

const standard = ['view', 'create', 'edit', 'delete', 'approve', 'reject', 'cancel', 'print', 'export', 'import', 'reopen', 'history'];
const document = (module: string, resource: string, extra: string[] = []) => resourcePermissions(module, resource, [...standard, ...extra]);

export const PERMISSION_REGISTRY: readonly PermissionDefinition[] = [
  { key: 'system.super_admin', module: 'system', resource: 'access', action: 'manage', description: 'Unrestricted tenant administration' },
  ...resourcePermissions('dashboard', 'overview', ['view']),
  ...resourcePermissions('sales', 'overview', ['view']),
  ...document('sales', 'customer'),
  ...document('sales', 'quotation', ['convert']),
  ...document('sales', 'order', ['convert']),
  ...document('sales', 'delivery', ['process', 'post', 'convert']),
  ...document('sales', 'invoice', ['post', 'convert']),
  ...document('sales', 'return', ['post']),
  ...document('sales', 'credit_note', ['post']),
  ...resourcePermissions('sales', 'price', ['edit']),
  ...resourcePermissions('sales', 'exchange_rate', ['edit']),
  ...resourcePermissions('purchasing', 'overview', ['view']),
  ...document('purchasing', 'supplier'),
  ...document('purchasing', 'request', ['convert']),
  ...document('purchasing', 'rfq', ['convert']),
  ...document('purchasing', 'order', ['convert']),
  ...document('purchasing', 'receipt', ['process', 'post', 'convert']),
  ...document('purchasing', 'bill', ['post', 'convert']),
  ...document('purchasing', 'return', ['post']),
  ...resourcePermissions('inventory', 'overview', ['view']),
  ...document('inventory', 'item'),
  ...document('inventory', 'warehouse'),
  ...document('inventory', 'transfer', ['process', 'post']),
  ...document('inventory', 'adjustment', ['process', 'post']),
  ...document('inventory', 'stock_count', ['process', 'post']),
  ...resourcePermissions('accounting', 'overview', ['view']),
  ...document('accounting', 'journal', ['post']),
  ...document('accounting', 'account'),
  ...resourcePermissions('accounting', 'period', ['view', 'manage']),
  ...resourcePermissions('payments', 'receipt', ['view', 'create', 'edit', 'delete', 'print', 'export', 'history']),
  ...resourcePermissions('payments', 'payment', ['view', 'create', 'edit', 'delete', 'print', 'export', 'history']),
  ...resourcePermissions('banking', 'account', ['view', 'create', 'edit', 'delete', 'history']),
  ...resourcePermissions('banking', 'transaction', ['view', 'create', 'edit', 'delete', 'print', 'export', 'history']),
  ...resourcePermissions('banking', 'statement', ['view', 'create', 'reconcile', 'export', 'history']),
  ...resourcePermissions('pos', 'register', ['view', 'use']),
  ...resourcePermissions('pos', 'shift', ['view', 'create', 'edit']),
  ...resourcePermissions('pos', 'sale', ['view', 'create', 'edit', 'cancel', 'print', 'history']),
  ...resourcePermissions('pos', 'return', ['view', 'create', 'approve']),
  ...document('hr', 'employee'),
  ...resourcePermissions('reports', 'standard', ['view', 'export', 'print']),
  ...resourcePermissions('reports', 'profitability', ['view', 'export', 'print']),
  ...resourcePermissions('approvals', 'queue', ['view', 'approve', 'reject', 'edit', 'history']),
  ...resourcePermissions('audit', 'business', ['view', 'export']),
  ...resourcePermissions('audit', 'access', ['view', 'export']),
  ...resourcePermissions('settings', 'users_access', ['view', 'manage']),
  ...resourcePermissions('settings', 'system', ['view', 'manage', 'reset']),
];

const registryKeys = new Set(PERMISSION_REGISTRY.map(({ key }) => key));

export const LEGACY_PERMISSION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'dashboard.read': ['dashboard.overview.view'],
  'sales.write': PERMISSION_REGISTRY.filter(({ module }) => module === 'sales').map(({ key }) => key),
  'customers.view': ['sales.customer.view'],
  'customers.create': ['sales.customer.create'],
  'customers.edit': ['sales.customer.edit'],
  'customers.view-credit': ['sales.customer.view'],
  'customers.edit-credit': ['sales.customer.edit'],
  'quotations.view': ['sales.quotation.view'],
  'quotations.create': ['sales.quotation.create'],
  'quotations.edit': ['sales.quotation.edit'],
  'quotations.submit': ['sales.quotation.edit'],
  'quotations.convert': ['sales.quotation.convert'],
  'prices.override': ['sales.price.edit'],
  'exchange-rates.override': ['sales.exchange_rate.edit'],
  'invoices.view': ['sales.invoice.view'],
  'invoices.view-accounting': ['accounting.journal.view'],
  'purchases.write': PERMISSION_REGISTRY.filter(({ module }) => module === 'purchasing').map(({ key }) => key),
  'inventory.write': PERMISSION_REGISTRY.filter(({ module }) => module === 'inventory').map(({ key }) => key),
  'accounting.read': ['accounting.overview.view', 'accounting.journal.view', 'accounting.account.view', 'accounting.period.view'],
  'journals.write': ['accounting.journal.view', 'accounting.journal.create', 'accounting.journal.edit'],
  'posting.execute': ['accounting.journal.post', 'sales.invoice.post', 'purchasing.bill.post'],
  'periods.manage': ['accounting.period.manage'],
  'payments.read': ['payments.receipt.view', 'payments.payment.view'],
  'payments.write': ['payments.receipt.create', 'payments.payment.create'],
  'banking.read': ['banking.account.view', 'banking.transaction.view', 'banking.statement.view'],
  'banking.write': ['banking.account.create', 'banking.transaction.create', 'banking.statement.create'],
  'banking.reconcile': ['banking.statement.reconcile'],
  'pos.use': ['pos.register.view', 'pos.register.use', 'pos.shift.view', 'pos.shift.create', 'pos.sale.view', 'pos.sale.create', 'pos.sale.edit', 'pos.sale.print'],
  'pos.returns': ['pos.return.view', 'pos.return.create'],
  'pos.close': ['pos.shift.edit'],
  'approvals.read': ['approvals.queue.view', 'approvals.queue.history'],
  'approvals.act': ['approvals.queue.approve', 'approvals.queue.reject'],
  'approvals.request-changes': ['approvals.queue.edit'],
  'reports.read': ['reports.standard.view'],
  'reports.profitability': ['reports.profitability.view'],
  'audit.read': ['audit.business.view'],
  'system.reset': ['settings.system.reset'],
  'employees.sales.read': ['sales.quotation.view'],
  'hr.read': ['hr.employee.view'],
};

export function normalizePermissions(values: readonly string[]) {
  const normalized = new Set<string>();
  for (const value of values) {
    if (value === '*') normalized.add('system.super_admin');
    if (registryKeys.has(value)) normalized.add(value);
    for (const mapped of LEGACY_PERMISSION_ALIASES[value] || []) normalized.add(mapped);
  }
  return [...normalized].sort();
}

export function permissionMatches(granted: string, requested: string) {
  if (granted === 'system.super_admin' || granted === requested) return true;
  if (!granted.endsWith('.*')) return false;
  return requested.startsWith(granted.slice(0, -1));
}

export function hasPermission(grants: readonly string[], denies: readonly string[], requested: string) {
  if (denies.some((permission) => permissionMatches(permission, requested))) return false;
  return grants.some((permission) => permissionMatches(permission, requested));
}

export const FIELD_REGISTRY = [
  ['item', 'purchasePriceMinor', 'Purchase price'], ['item', 'costPriceMinor', 'Cost price'], ['document', 'costMinor', 'Cost of goods'],
  ['document', 'profitMargin', 'Profit margin'], ['customer', 'creditLimitMinor', 'Credit limit'], ['customer', 'paymentTermsDays', 'Payment terms'],
  ['customer', 'balanceMinor', 'Customer balance'], ['bankAccount', 'accountNumber', 'Bank account details'], ['employee', 'salaryMinor', 'Employee salary'],
  ['journal', 'lines', 'Journal entry details'], ['party', 'taxNumber', 'Tax information'],
] as const;

export const DATA_SCOPE_RESOURCES = [
  'company', 'branch', 'warehouse', 'department', 'team',
  'customer', 'supplier', 'employee', 'salesperson',
  'quotation', 'order', 'delivery', 'invoice', 'return', 'credit_note',
  'purchase_request', 'rfq', 'purchase_order', 'receipt', 'bill', 'purchase_return',
  'transfer', 'adjustment', 'stock_count',
  'pos_terminal', 'bank_account', 'account', 'cost_center', 'project',
  'journal', 'approval_queue', 'report', 'export', 'print', 'attachment',
] as const;

export const LIMIT_REGISTRY = [
  { key: 'sales.discount_percent', description: 'Maximum sales discount percentage', unit: 'percent' },
  { key: 'sales.quotation_amount_minor', description: 'Maximum quotation amount', unit: 'minor_currency' },
  { key: 'sales.credit_amount_minor', description: 'Credit sale approval threshold', unit: 'minor_currency' },
  { key: 'sales.return_amount_minor', description: 'Return approval threshold', unit: 'minor_currency' },
] as const;
