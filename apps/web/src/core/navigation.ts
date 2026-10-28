type IconName = string;

export type ScreenKind =
  | "av8"
  | "hr"
  | "dashboard"
  | "domain-overview"
  | "documents"
  | "master-data"
  | "pos"
  | "accounting"
  | "payments"
  | "banking"
  | "approvals"
  | "reports"
  | "audit"
  | "access"
  | "system-health"
  | "administration";

export type ModuleId =
  | "av8"
  | "command"
  | "sales"
  | "purchasing"
  | "inventory"
  | "hr"
  | "pos"
  | "accounting"
  | "banking"
  | "approvals"
  | "reports"
  | "admin";

export type ModuleTone =
  | "brand"
  | "info"
  | "success"
  | "warning"
  | "analytics"
  | "neutral";

export interface RouteDefinition {
  id: string;
  label: string;
  route: `/${string}`;
  permission: string | readonly string[];
  namespace: string;
  screen: ScreenKind;
  documentType?: string;
  masterKind?:
    | "customer"
    | "supplier"
    | "item"
    | "category"
    | "unit"
    | "warehouse"
    | "bank"
    | "account"
    | "employee";
  reportCategory?:
    | "sales"
    | "purchasing"
    | "inventory"
    | "accounting"
    | "banking"
    | "pos";
  initialReport?: string;
}

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  route: `/${string}`;
  icon: IconName;
  tone: ModuleTone;
  permission: string;
  category: "management" | "operations" | "finance" | "governance";
  children: readonly RouteDefinition[];
}

export const modules: readonly ModuleDefinition[] = [
  { id: "av8", label: "AV8 workspace", route: "/av8/leads", icon: "sales", tone: "brand", permission: "av8.workspace.view", category: "operations", children: [
{id:"av8-appointments",label:"Appointment calendar",route:"/av8/appointments",permission:"av8.leads.view",namespace:"av8",screen:"av8"},
{id:"av8-leads",label:"Leads & follow-ups",route:"/av8/leads",permission:"av8.leads.view",namespace:"av8",screen:"av8"},
{id:"av8-students",label:"Applications & students",route:"/av8/students",permission:"av8.applications.view",namespace:"av8",screen:"av8"},
{id:"av8-affairs",label:"Student affairs",route:"/av8/affairs",permission:"av8.affairs.view",namespace:"av8",screen:"av8"},
{id:"av8-finance",label:"Collections & academy",route:"/av8/finance",permission:"av8.finance.view",namespace:"av8",screen:"av8"},
{id:"av8-reports",label:"AV8 reports",route:"/av8/reports",permission:"av8.reports.view",namespace:"av8",screen:"av8"},
{id:"av8-settings",label:"Business configuration",route:"/av8/settings",permission:"av8.policies.view",namespace:"av8",screen:"av8"},
]},
  {
    id: "command",
    label: "Command Center",
    route: "/dashboard",
    icon: "dashboard",
    tone: "brand",
    permission: "av8.workspace.view",
    category: "management",
    children: [
      {
        id: "dashboard",
        label: "Daily workspace",
        route: "/dashboard",
        permission: "av8.workspace.view",
        namespace: "dashboard",
        screen: "av8",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    route: "/sales/overview",
    icon: "sales",
    tone: "success",
    permission: "sales.overview.view",
    category: "operations",
    children: [
      {
        id: "sales-overview",
        label: "Sales Overview",
        route: "/sales/overview",
        permission: "sales.overview.view",
        namespace: "sales",
        screen: "domain-overview",
      },
      {
        id: "customers",
        label: "Customers",
        route: "/sales/customers",
        permission: "sales.customer.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "customer",
      },
      {
        id: "sales-quotations",
        label: "Quotations",
        route: "/sales/quotations",
        permission: "sales.quotation.view",
        namespace: "documents",
        screen: "documents",
        documentType: "QUOTATION",
      },
      {
        id: "sales-orders",
        label: "Sales Orders",
        route: "/sales/orders",
        permission: "sales.order.view",
        namespace: "documents",
        screen: "documents",
        documentType: "SALES_ORDER",
      },
      {
        id: "deliveries",
        label: "Deliveries",
        route: "/sales/deliveries",
        permission: "sales.delivery.view",
        namespace: "documents",
        screen: "documents",
        documentType: "DELIVERY_NOTE",
      },
      {
        id: "sales-invoices",
        label: "Invoices",
        route: "/sales/invoices",
        permission: "sales.invoice.view",
        namespace: "documents",
        screen: "documents",
        documentType: "SALES_INVOICE",
      },
      {
        id: "sales-returns",
        label: "Returns",
        route: "/sales/returns",
        permission: "sales.return.view",
        namespace: "documents",
        screen: "documents",
        documentType: "SALES_RETURN",
      },
      {
        id: "credit-notes",
        label: "Credit Notes",
        route: "/sales/credit-notes",
        permission: "sales.credit_note.view",
        namespace: "documents",
        screen: "documents",
        documentType: "CREDIT_NOTE",
      },
      {
        id: "customer-balances",
        label: "Customer Balances",
        route: "/sales/customer-balances",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "sales",
        initialReport: "customer-balances",
      },
    ],
  },
  {
    id: "purchasing",
    label: "Purchasing & Suppliers",
    route: "/purchasing/overview",
    icon: "purchases",
    tone: "warning",
    permission: "purchasing.overview.view",
    category: "operations",
    children: [
      {
        id: "purchasing-overview",
        label: "Purchasing Overview",
        route: "/purchasing/overview",
        permission: "purchasing.overview.view",
        namespace: "purchasing",
        screen: "domain-overview",
      },
      {
        id: "suppliers",
        label: "Suppliers",
        route: "/purchasing/suppliers",
        permission: "purchasing.supplier.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "supplier",
      },
      {
        id: "purchase-requests",
        label: "Purchase Requests",
        route: "/purchasing/requests",
        permission: "purchasing.request.view",
        namespace: "documents",
        screen: "documents",
        documentType: "PURCHASE_REQUEST",
      },
      {
        id: "purchase-rfqs",
        label: "Requests for Quotation",
        route: "/purchasing/rfqs",
        permission: "purchasing.rfq.view",
        namespace: "documents",
        screen: "documents",
        documentType: "PURCHASE_RFQ",
      },
      {
        id: "purchase-orders",
        label: "Purchase Orders",
        route: "/purchasing/orders",
        permission: "purchasing.order.view",
        namespace: "documents",
        screen: "documents",
        documentType: "PURCHASE_ORDER",
      },
      {
        id: "goods-receipts",
        label: "Goods Receipts",
        route: "/purchasing/receipts",
        permission: "purchasing.receipt.view",
        namespace: "documents",
        screen: "documents",
        documentType: "GOODS_RECEIPT",
      },
      {
        id: "supplier-bills",
        label: "Supplier Bills",
        route: "/purchasing/bills",
        permission: "purchasing.bill.view",
        namespace: "documents",
        screen: "documents",
        documentType: "PURCHASE_BILL",
      },
      {
        id: "purchase-returns",
        label: "Purchase Returns",
        route: "/purchasing/returns",
        permission: "purchasing.return.view",
        namespace: "documents",
        screen: "documents",
        documentType: "PURCHASE_RETURN",
      },
      {
        id: "supplier-balances",
        label: "Supplier Balances",
        route: "/purchasing/supplier-balances",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "purchasing",
        initialReport: "supplier-statement",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory & Products",
    route: "/inventory/overview",
    icon: "inventory",
    tone: "analytics",
    permission: "inventory.overview.view",
    category: "operations",
    children: [
      {
        id: "inventory-overview",
        label: "Inventory Overview",
        route: "/inventory/overview",
        permission: "inventory.overview.view",
        namespace: "inventory",
        screen: "domain-overview",
      },
      {
        id: "items",
        label: "Items",
        route: "/inventory/items",
        permission: "inventory.item.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "item",
      },
      {
        id: "categories",
        label: "Categories",
        route: "/inventory/categories",
        permission: "inventory.item.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "category",
      },
      {
        id: "units",
        label: "Units of Measurement",
        route: "/inventory/units",
        permission: "inventory.item.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "unit",
      },
      {
        id: "warehouses",
        label: "Warehouses",
        route: "/inventory/warehouses",
        permission: "inventory.warehouse.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "warehouse",
      },
      {
        id: "transfers",
        label: "Warehouse Transfers",
        route: "/inventory/transfers",
        permission: "inventory.transfer.view",
        namespace: "documents",
        screen: "documents",
        documentType: "WAREHOUSE_TRANSFER",
      },
      {
        id: "adjustments",
        label: "Stock Adjustments",
        route: "/inventory/adjustments",
        permission: "inventory.adjustment.view",
        namespace: "documents",
        screen: "documents",
        documentType: "INVENTORY_ADJUSTMENT",
      },
      {
        id: "counts",
        label: "Stock Counts",
        route: "/inventory/counts",
        permission: "inventory.stock_count.view",
        namespace: "documents",
        screen: "documents",
        documentType: "STOCK_COUNT",
      },
      {
        id: "stock-card",
        label: "Stock Card",
        route: "/inventory/stock-card",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "inventory",
        initialReport: "stock-movements",
      },
      {
        id: "valuation",
        label: "Inventory Valuation",
        route: "/inventory/valuation",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "inventory",
        initialReport: "inventory-valuation",
      },
    ],
  },
  {
    id: "hr",
    label: "Human Resources",
    route: "/hr/overview",
    icon: "customer",
    tone: "info",
    permission: "hr.employee.view",
    category: "operations",
    children: [
      { id: "hr-overview", label: "HR Overview", route: "/hr/overview", permission: "hr.employee.view", namespace: "hr", screen: "hr" },
      { id: "employees", label: "Employees", route: "/hr/employees", permission: "hr.employee.view", namespace: "hr", screen: "hr" },
      { id: "departments", label: "Departments", route: "/hr/departments", permission: "hr.department.view", namespace: "hr", screen: "hr" },
      { id: "attendance", label: "Attendance", route: "/hr/attendance", permission: "hr.attendance.view", namespace: "hr", screen: "hr" },
      { id: "leave", label: "Leave Requests", route: "/hr/leave", permission: "hr.leave.view", namespace: "hr", screen: "hr" },
      { id: "payroll", label: "Monthly Payroll", route: "/hr/payroll", permission: "hr.payroll.view", namespace: "hr", screen: "hr" },
    ],
  },
  {
    id: "pos",
    label: "Point of Sale",
    route: "/pos/workspace",
    icon: "pos",
    tone: "info",
    permission: "pos.register.view",
    category: "operations",
    children: [
      {
        id: "pos-workspace",
        label: "POS Workspace",
        route: "/pos/workspace",
        permission: "pos.register.view",
        namespace: "pos",
        screen: "pos",
      },
    ],
  },
  {
    id: "accounting",
    label: "Accounting & Finance",
    route: "/accounting/overview",
    icon: "accounting",
    tone: "brand",
    permission: "accounting.overview.view",
    category: "finance",
    children: [
      {
        id: "accounting-overview",
        label: "Accounting Overview",
        route: "/accounting/overview",
        permission: "accounting.overview.view",
        namespace: "accounting",
        screen: "domain-overview",
      },
      {
        id: "chart-of-accounts",
        label: "Chart of Accounts",
        route: "/accounting/chart-of-accounts",
        permission: "accounting.account.view",
        namespace: "accounting",
        screen: "master-data",
        masterKind: "account",
      },
      {
        id: "journals",
        label: "Journal Entries",
        route: "/accounting/journals",
        permission: "accounting.journal.view",
        namespace: "accounting",
        screen: "accounting",
      },
      {
        id: "periods",
        label: "Fiscal Periods",
        route: "/accounting/periods",
        permission: "accounting.period.view",
        namespace: "accounting",
        screen: "accounting",
      },
      {
        id: "general-ledger",
        label: "General Ledger",
        route: "/accounting/general-ledger",
        permission: "accounting.journal.view",
        namespace: "accounting",
        screen: "accounting",
      },
      {
        id: "trial-balance",
        label: "Trial Balance",
        route: "/accounting/trial-balance",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "accounting",
        initialReport: "trial-balance",
      },
      {
        id: "income-statement",
        label: "Income Statement",
        route: "/accounting/income-statement",
        permission: "reports.profitability.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "accounting",
        initialReport: "income-statement",
      },
      {
        id: "balance-sheet",
        label: "Balance Sheet",
        route: "/accounting/balance-sheet",
        permission: "reports.profitability.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "accounting",
        initialReport: "balance-sheet",
      },
    ],
  },
  {
    id: "banking",
    label: "Cash & Banking",
    route: "/banking/overview",
    icon: "banking",
    tone: "success",
    permission: "banking.account.view",
    category: "finance",
    children: [
      {
        id: "banking-overview",
        label: "Cash & Bank Overview",
        route: "/banking/overview",
        permission: "banking.account.view",
        namespace: "banking",
        screen: "domain-overview",
      },
      {
        id: "bank-accounts",
        label: "Cash & Bank Accounts",
        route: "/banking/accounts",
        permission: "banking.account.view",
        namespace: "masters",
        screen: "master-data",
        masterKind: "bank",
      },
      {
        id: "payment-allocations",
        label: "Receipts & Payments",
        route: "/banking/allocations",
        permission: ["payments.receipt.view", "payments.payment.view"],
        namespace: "payments",
        screen: "payments",
      },
      {
        id: "bank-transactions",
        label: "Bank Transactions & Transfers",
        route: "/banking/transactions",
        permission: "banking.transaction.view",
        namespace: "banking",
        screen: "banking",
      },
      {
        id: "bank-statements",
        label: "Bank Statements",
        route: "/banking/statements",
        permission: "banking.statement.view",
        namespace: "banking",
        screen: "banking",
      },
      {
        id: "bank-reconciliation",
        label: "Bank Reconciliation",
        route: "/banking/reconciliation",
        permission: "banking.statement.reconcile",
        namespace: "banking",
        screen: "banking",
      },
    ],
  },
  {
    id: "approvals",
    label: "Approvals & Workflow",
    route: "/approvals/inbox",
    icon: "approvals",
    tone: "warning",
    permission: "approvals.queue.view",
    category: "governance",
    children: [
      {
        id: "approval-inbox",
        label: "Approval Inbox",
        route: "/approvals/inbox",
        permission: "approvals.queue.view",
        namespace: "approvals",
        screen: "approvals",
      },
    ],
  },
  {
    id: "reports",
    label: "Reports & Analytics",
    route: "/reports/overview",
    icon: "reports",
    tone: "analytics",
    permission: "reports.standard.view",
    category: "governance",
    children: [
      {
        id: "reports-overview",
        label: "Report Library",
        route: "/reports/overview",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
      },
      {
        id: "sales-reports",
        label: "Sales Reports",
        route: "/reports/sales",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "sales",
      },
      {
        id: "purchasing-reports",
        label: "Purchasing Reports",
        route: "/reports/purchasing",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "purchasing",
      },
      {
        id: "inventory-reports",
        label: "Inventory Reports",
        route: "/reports/inventory",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "inventory",
      },
      {
        id: "accounting-reports",
        label: "Accounting Reports",
        route: "/reports/accounting",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "accounting",
      },
      {
        id: "banking-reports",
        label: "Cash & Bank Reports",
        route: "/reports/banking",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "banking",
      },
      {
        id: "pos-reports",
        label: "POS Reports",
        route: "/reports/pos",
        permission: "reports.standard.view",
        namespace: "reports",
        screen: "reports",
        reportCategory: "pos",
      },
    ],
  },
  {
    id: "admin", label: "Settings & Administration", route: "/admin/overview", icon: "audit", tone: "neutral", permission: "settings.users_access.view", category: "governance",
    children: [
      {id:"admin-overview",label:"Overview",route:"/admin/overview",permission:"settings.users_access.view",namespace:"admin",screen:"administration"},
      {id:"access-users",label:"Users",route:"/settings/access/users",permission:"settings.users_access.view",namespace:"admin",screen:"administration"},
      {id:"access-roles",label:"Access Groups",route:"/settings/access/roles",permission:"system.super_admin",namespace:"admin",screen:"administration"},
      {id:"audit-log",label:"Activity Log",route:"/admin/audit",permission:["audit.business.view","settings.users_access.view"],namespace:"admin",screen:"administration"},
      {id:"advanced",label:"Advanced Settings",route:"/admin/advanced",permission:["settings.users_access.view","settings.system.view"],namespace:"admin",screen:"administration"},
    ],
  },
] as const;

export const legacyRedirects: Readonly<Record<string, string>> = {
  "/sales": "/sales/overview",
  "/purchases": "/purchasing/overview",
  "/inventory": "/inventory/overview",
  "/pos": "/pos/workspace",
  "/payments": "/banking/allocations",
  "/accounting": "/accounting/general-ledger",
  "/banking": "/banking/overview",
  "/approvals": "/approvals/inbox",
  "/reports": "/reports/overview",
  "/audit": "/admin/audit",
};

const adminModule=modules.find(m=>m.id==='admin')!;
const auxiliaryRoutes:RouteDefinition[]=[
 {id:'authority-limits',label:'Company financial authority',route:'/settings/access/limits',permission:'system.super_admin',namespace:'admin',screen:'administration'},
 {id:'profile',label:'My Profile',route:'/my-profile',permission:'authenticated',namespace:'admin',screen:'administration'},
 {id:'access-new-user',label:'Create user',route:'/settings/access/users/new',permission:'system.super_admin',namespace:'admin',screen:'administration'},
 {id:'access-governance',label:'User access summary',route:'/settings/access/governance',permission:'settings.users_access.view',namespace:'admin',screen:'administration'},
 {id:'access-permissions',label:'Permission catalog',route:'/settings/access/permissions',permission:'system.super_admin',namespace:'admin',screen:'administration'},
 {id:'access-audit',label:'Activity Log',route:'/settings/access/audit',permission:'settings.users_access.view',namespace:'admin',screen:'administration'},
 {id:'access-reviews',label:'Access reviews',route:'/settings/access/reviews',permission:'settings.users_access.view',namespace:'admin',screen:'administration'},
 {id:'system-health',label:'System diagnostics',route:'/admin/system-health',permission:'settings.system.view',namespace:'admin',screen:'administration'},
];
export const allRoutes = [...modules.flatMap(module=>module.children.map(child=>({module,child}))),...auxiliaryRoutes.map(child=>({module:adminModule,child}))];

export function routeEntry(pathname: string) {
  if(/^\/settings\/access\/users\/\d+$/.test(pathname))return {module:adminModule,child:{...adminModule.children[1],label:'User profile'}};
  return (
    allRoutes.find(({ child }) => child.route === pathname) ||
    allRoutes.find(({ child }) => child.route === "/dashboard")!
  );
}

export function routeForDocumentType(type: string) {
  return (
    allRoutes.find(({ child }) => child.documentType === type)?.child.route ||
    "/dashboard"
  );
}

const permissionMatches = (granted: string, requested: string) =>
  granted === "system.super_admin" ||
  granted === requested ||
  (granted.endsWith(".*") && requested.startsWith(granted.slice(0, -1)));

/**
 * Company-scoped and temporary grants are valid for navigation visibility even
 * though they intentionally remain separate in the session actor. Denials are
 * carried as display-only markers so an explicit deny still wins over a broad
 * grant. API authorization remains the source of truth for the selected
 * company, branch, and resource.
 */
export function displayPermissionsFor(user: {
  permissions?: readonly string[];
  companyScopedPermissions?: Readonly<Record<string, readonly string[]>>;
  deniedPermissions?: readonly string[];
}) {
  const grants = [
    ...(user.permissions || []),
    ...Object.values(user.companyScopedPermissions || {}).flat(),
  ];
  const denials = (user.deniedPermissions || []).map(
    (permission) => `!${permission}`,
  );
  return [...new Set([...grants, ...denials])].sort();
}

export function canAccess(
  permissions: readonly string[],
  permission: string | readonly string[],
) {
  const alternatives =
    typeof permission === "string" ? [permission] : permission;
  return alternatives.some((requested) => {
    if (
      permissions.some(
        (candidate) =>
          candidate.startsWith("!") &&
          permissionMatches(candidate.slice(1), requested),
      )
    )
      return false;
    return permissions.some(
      (candidate) =>
        !candidate.startsWith("!") && permissionMatches(candidate, requested),
    );
  });
}
