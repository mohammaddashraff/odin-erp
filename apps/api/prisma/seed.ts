import { PrismaPg } from '@prisma/adapter-pg';
import { AccountType, DocumentType, JournalStatus, PrismaClient, WorkflowStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../../.env') });

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

const rolePermissions: Record<string, string[]> = {
  'Company Administrator': ['*'],
  'Chief Financial Officer': ['dashboard.read', 'accounting.read', 'journals.write', 'approvals.read', 'approvals.act', 'approvals.request-changes', 'posting.execute', 'periods.manage', 'reports.read', 'reports.profitability', 'payments.read', 'payments.write', 'banking.read', 'banking.write', 'banking.reconcile', 'customers.view-credit', 'invoices.view-accounting', 'audit.read'],
  'Finance Manager': ['dashboard.read', 'accounting.read', 'journals.write', 'approvals.read', 'approvals.act', 'approvals.request-changes', 'posting.execute', 'reports.read', 'reports.profitability', 'payments.read', 'payments.write', 'banking.read', 'banking.write', 'banking.reconcile', 'customers.view-credit', 'invoices.view-accounting'],
  Accountant: ['dashboard.read', 'accounting.read', 'journals.write', 'reports.read', 'reports.profitability', 'payments.read', 'payments.write', 'banking.read'],
  Auditor: ['dashboard.read', 'accounting.read', 'reports.read', 'reports.profitability', 'audit.read', 'payments.read', 'banking.read'],
  'Sales Manager': ['dashboard.read', 'sales.write', 'customers.view', 'customers.create', 'customers.edit', 'customers.view-credit', 'customers.edit-credit', 'quotations.view', 'quotations.create', 'quotations.edit', 'quotations.submit', 'quotations.convert', 'prices.override', 'exchange-rates.override', 'invoices.view', 'approvals.read', 'approvals.act', 'approvals.request-changes', 'employees.sales.read', 'reports.read', 'reports.profitability', 'payments.read'],
  'Purchasing Manager': ['dashboard.read', 'purchases.write', 'approvals.read', 'approvals.act', 'reports.read', 'payments.read'],
  'Warehouse Manager': ['dashboard.read', 'inventory.write', 'approvals.read', 'approvals.act', 'reports.read'],
  'POS Cashier': ['dashboard.read', 'pos.use', 'pos.returns', 'pos.close'],
  'Branch Manager': ['dashboard.read', 'sales.write', 'customers.view', 'customers.create', 'customers.edit', 'quotations.view', 'quotations.create', 'quotations.edit', 'quotations.submit', 'quotations.convert', 'invoices.view', 'purchases.write', 'inventory.write', 'approvals.read', 'approvals.act', 'approvals.request-changes', 'employees.sales.read', 'reports.read'],
  'AR Clerk': ['dashboard.read', 'sales.write', 'customers.view', 'customers.create', 'customers.edit', 'quotations.view', 'quotations.create', 'quotations.edit', 'quotations.submit', 'invoices.view', 'payments.read', 'payments.write', 'reports.read'],
  'AP Clerk': ['dashboard.read', 'purchases.write', 'payments.read', 'payments.write', 'reports.read'],
  'Inventory Clerk': ['dashboard.read', 'inventory.write', 'reports.read'],
  'Read Only': ['dashboard.read', 'reports.read'],
};

const users: Array<[string, string, string]> = [
  ['admin@odin.demo', 'Odin Administrator', 'Company Administrator'],
  ['cfo@odin.demo', 'Mariam Nassar', 'Chief Financial Officer'],
  ['finance@odin.demo', 'Omar Selim', 'Finance Manager'],
  ['accountant@odin.demo', 'Nour Adel', 'Accountant'],
  ['auditor@odin.demo', 'Karim Fawzy', 'Auditor'],
  ['sales@odin.demo', 'Salma Hafez', 'Sales Manager'],
  ['purchasing@odin.demo', 'Hassan Youssef', 'Purchasing Manager'],
  ['warehouse@odin.demo', 'Tarek Mansour', 'Warehouse Manager'],
  ['cashier@odin.demo', 'Dina Samir', 'POS Cashier'],
];

const accountData: Array<[string, string, AccountType, string?]> = [
  ['1000', 'Cash on Hand', AccountType.ASSET], ['1010', 'Bank Current Account', AccountType.ASSET], ['1020', 'Card Clearing', AccountType.ASSET],
  ['1100', 'Accounts Receivable Control', AccountType.ASSET, 'AR'], ['1200', 'Inventory Control', AccountType.ASSET, 'INVENTORY'], ['1300', 'Recoverable Input VAT', AccountType.ASSET, 'VAT_IN'],
  ['2000', 'Accounts Payable Control', AccountType.LIABILITY, 'AP'], ['2100', 'Goods Received Not Invoiced', AccountType.LIABILITY, 'GRNI'], ['2200', 'Output VAT Payable', AccountType.LIABILITY, 'VAT_OUT'],
  ['3000', 'Owner Capital', AccountType.EQUITY], ['3100', 'Retained Earnings', AccountType.EQUITY],
  ['4000', 'Sales Revenue', AccountType.REVENUE], ['5000', 'Cost of Goods Sold', AccountType.COGS],
  ['5100', 'Inventory Gain or Loss', AccountType.EXPENSE], ['5200', 'Cash Over or Short', AccountType.EXPENSE], ['6000', 'Operating Expenses', AccountType.EXPENSE],
];

export async function seed(initiatedBy = 'CLI', targetTenantId?: bigint) {
  const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
  const db = new PrismaClient({ adapter: new PrismaPg(adminUrl) });
  let resetVersion = 0;
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
    if (targetTenantId) {
      const existing = await tx.tenant.findUnique({ where: { id: targetTenantId }, select: { resetVersion: true } });
      if (!existing) throw new Error('Selected demo tenant no longer exists');
      resetVersion = existing.resetVersion + 1;
      const tenantTables = [
        'refresh_sessions', 'currency_rates', 'currencies', 'employees', 'departments', 'master_sequences',
        'bank_statement_lines', 'bank_statements', 'bank_transactions', 'bank_accounts', 'pos_tenders', 'pos_sale_lines', 'pos_sales', 'pos_shifts',
        'payment_allocations', 'payments', 'journal_lines', 'journal_entries', 'document_lines', 'documents', 'stock_movements', 'stock_balances',
        'items', 'units_of_measure', 'item_categories', 'suppliers', 'customers', 'document_sequences', 'accounts', 'fiscal_periods',
        'approval_events', 'audit_events', 'idempotency_keys', 'users', 'roles', 'warehouses', 'branches',
      ];
      for (const table of tenantTables) await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE tenant_id = $1`, targetTenantId);
      await tx.$executeRaw`DELETE FROM tenants WHERE id = ${targetTenantId}`;
    } else {
      await tx.$executeRawUnsafe('TRUNCATE TABLE tenants RESTART IDENTITY CASCADE');
    }
  });

  const tenant = await db.tenant.create({ data: { ...(targetTenantId ? { id: targetTenantId } : {}), name: 'Odin Distribution Egypt', baseCurrency: 'EGP', negativeStock: false, makerChecker: true, approvalLimit: 5_000_000n, resetVersion } });
  const branch = await db.branch.create({ data: { tenantId: tenant.id, code: 'CAI', name: 'Cairo Headquarters' } });
  const alex = await db.branch.create({ data: { tenantId: tenant.id, code: 'ALX', name: 'Alexandria Branch' } });
  const main = await db.warehouse.create({ data: { tenantId: tenant.id, branchId: branch.id, code: 'CAI-MAIN', name: 'Cairo Main Warehouse' } });
  const retail = await db.warehouse.create({ data: { tenantId: tenant.id, branchId: branch.id, code: 'CAI-RTL', name: 'Cairo Retail Store' } });
  const alexWarehouse = await db.warehouse.create({ data: { tenantId: tenant.id, branchId: alex.id, code: 'ALX-MAIN', name: 'Alexandria Warehouse' } });

  const roles = new Map<string, bigint>();
  for (const [name, permissions] of Object.entries(rolePermissions)) {
    const role = await db.role.create({ data: { tenantId: tenant.id, name, permissions } }); roles.set(name, role.id);
  }
  const passwordHash = await hash(process.env.ODIN_DEMO_PASSWORD || 'OdinDemo2026!', 12);
  const createdUsers = new Map<string, bigint>();
  for (const [email, name, role] of users) {
    const user = await db.user.create({ data: { tenantId: tenant.id, roleId: roles.get(role)!, email, name, passwordHash, branchIds: [branch.id.toString(), alex.id.toString()], warehouseIds: [main.id.toString(), retail.id.toString(), alexWarehouse.id.toString()] } });
    createdUsers.set(email, user.id);
  }
  const adminId = createdUsers.get('admin@odin.demo')!;

  const salesDepartment = await db.department.create({ data: { tenantId: tenant.id, code: 'SALES', name: 'Sales' } });
  const financeDepartment = await db.department.create({ data: { tenantId: tenant.id, code: 'FIN', name: 'Finance' } });
  const employeeRows: Array<[string, string, string, bigint, boolean, boolean]> = [
    ['EMP-0015', 'Ahmed Hassan', 'Senior Sales Executive', salesDepartment.id, true, true],
    ['EMP-0021', 'Laila Mostafa', 'Key Accounts Manager', salesDepartment.id, true, true],
    ['EMP-0027', 'Omar Khalil', 'Alexandria Sales Executive', salesDepartment.id, true, true],
    ['EMP-0032', 'Mona El-Sayed', 'Sales Coordinator', salesDepartment.id, false, true],
    ['EMP-0008', 'Karim Nassar', 'Finance Manager', financeDepartment.id, false, true],
    ['EMP-0041', 'Youssef Hamdy', 'Former Sales Executive', salesDepartment.id, true, false],
  ];
  const employees = new Map<string, bigint>();
  for (const [code, name, jobTitle, departmentId, salesEligible, active] of employeeRows) {
    const employee = await db.employee.create({ data: {
      tenantId: tenant.id, departmentId, code, name, jobTitle, salesEligible, active,
      branchIds: code === 'EMP-0027' ? [alex.id.toString()] : [branch.id.toString(), alex.id.toString()],
    } });
    employees.set(code, employee.id);
  }

  await db.currency.createMany({ data: [
    { tenantId: tenant.id, code: 'EGP', name: 'Egyptian Pound', symbol: 'EGP', precision: 2 },
    { tenantId: tenant.id, code: 'USD', name: 'US Dollar', symbol: '$', precision: 2 },
    { tenantId: tenant.id, code: 'EUR', name: 'Euro', symbol: '€', precision: 2 },
    { tenantId: tenant.id, code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', precision: 2 },
  ] });
  await db.currencyRate.createMany({ data: [
    { tenantId: tenant.id, baseCurrency: 'EGP', targetCurrency: 'USD', rateMicros: 49_250_000n, rateDate: d('2026-07-18'), source: 'CENTRAL_RATE_TABLE' },
    { tenantId: tenant.id, baseCurrency: 'EGP', targetCurrency: 'EUR', rateMicros: 53_720_000n, rateDate: d('2026-07-18'), source: 'CENTRAL_RATE_TABLE' },
    { tenantId: tenant.id, baseCurrency: 'EGP', targetCurrency: 'SAR', rateMicros: 13_120_000n, rateDate: d('2026-07-18'), source: 'CENTRAL_RATE_TABLE' },
  ] });

  for (let month = 1; month <= 12; month++) {
    const start = d(`2026-${String(month).padStart(2, '0')}-01`);
    const end = new Date(Date.UTC(2026, month, 0));
    await db.fiscalPeriod.create({ data: { tenantId: tenant.id, year: 2026, month, name: `${start.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} 2026`, startDate: start, endDate: end, status: month === 6 ? 'CLOSED' : 'OPEN' } });
  }

  const accounts = new Map<string, bigint>();
  for (const [code, name, type, controlType] of accountData) {
    const account = await db.account.create({ data: { tenantId: tenant.id, code, name, type, controlType: controlType || null } }); accounts.set(code, account.id);
  }
  await db.bankAccount.create({ data: { tenantId: tenant.id, code: 'CASH-EGP', name: 'Main Cash Drawer', type: 'CASH', glAccountId: accounts.get('1000')! } });
  await db.bankAccount.create({ data: { tenantId: tenant.id, code: 'CIB-EGP', name: 'CIB Current Account', type: 'BANK', glAccountId: accounts.get('1010')!, bankName: 'Commercial International Bank', accountNumber: 'ODIN-001-EGP' } });
  await db.bankAccount.create({ data: { tenantId: tenant.id, code: 'CARD-EGP', name: 'Card Settlement Clearing', type: 'CARD_CLEARING', glAccountId: accounts.get('1020')! } });

  const customer = await db.customer.create({ data: { tenantId: tenant.id, code: 'CUS-000001', name: 'Nile Retail Group', taxNumber: '200-111-901', registrationNumber: 'CR-458219', email: 'ap@nileretail.example', phone: '+20 2 5550 1000', address: 'New Cairo', billingAddress: '90th Street, New Cairo', shippingAddress: 'Nile Logistics Hub, Obour City', city: 'Cairo', defaultBranchId: branch.id, defaultCurrency: 'EGP', creditLimitMinor: 2_000_000_00n, paymentTermsDays: 30 } });
  const alexCustomer = await db.customer.create({ data: { tenantId: tenant.id, code: 'CUS-000002', name: 'Alexandria Office Supplies', taxNumber: '200-111-902', email: 'finance@alexoffice.example', phone: '+20 3 555 1880', city: 'Alexandria', defaultBranchId: alex.id, defaultCurrency: 'EGP', creditLimitMinor: null, paymentTermsDays: null } });
  const meridianCustomer = await db.customer.create({ data: { tenantId: tenant.id, code: 'CUS-000003', name: 'Meridian Facilities Management', taxNumber: '200-111-903', email: 'accounts@meridianfm.example', phone: '+20 2 5550 2110', city: 'Giza', defaultBranchId: branch.id, defaultCurrency: 'USD', creditLimitMinor: 1_250_000_00n, paymentTermsDays: null } });
  await db.masterSequence.create({ data: { tenantId: tenant.id, key: 'CUSTOMER', prefix: tenant.customerCodePrefix, nextValue: 4n } });
  const supplier = await db.supplier.create({ data: { tenantId: tenant.id, code: 'SUP-001', name: 'Delta Technology Imports', taxNumber: '100-222-701', email: 'sales@deltatech.example', city: 'Cairo', paymentTermsDays: 30 } });
  await db.supplier.create({ data: { tenantId: tenant.id, code: 'SUP-002', name: 'Sphinx Office Systems', taxNumber: '100-222-702', city: 'Giza', paymentTermsDays: 45 } });

  const category = await db.itemCategory.create({ data: { tenantId: tenant.id, code: 'TECH', name: 'Technology and Office Equipment' } });
  const uom = await db.unitOfMeasure.create({ data: { tenantId: tenant.id, code: 'EA', name: 'Each', precision: 3 } });
  const itemRows: Array<[string, string, string, bigint, bigint, bigint]> = [
    ['LAP-14', '6221000000011', 'OdinBook 14 Laptop', 40_000_00n, 60_000_00n, 10_000n],
    ['MON-27', '6221000000028', 'VisionPro 27 Monitor', 10_000_00n, 15_000_00n, 12_000n],
    ['KEY-MX', '6221000000035', 'Mechanical Keyboard', 1_200_00n, 2_100_00n, 20_000n],
    ['MOU-WL', '6221000000042', 'Wireless Mouse', 650_00n, 1_100_00n, 25_000n],
    ['DOC-USBC', '6221000000059', 'USB-C Dock', 3_500_00n, 5_500_00n, 10_000n],
    ['CHA-ERG', '6221000000066', 'Ergonomic Office Chair', 4_800_00n, 7_900_00n, 8_000n],
  ];
  const itemNamesAr: Record<string, string> = {
    'LAP-14': 'حاسوب أودين بوك المحمول 14 بوصة', 'MON-27': 'شاشة فيجن برو 27 بوصة', 'KEY-MX': 'لوحة مفاتيح ميكانيكية',
    'MOU-WL': 'فأرة لاسلكية', 'DOC-USBC': 'وحدة توصيل USB-C', 'CHA-ERG': 'كرسي مكتبي مريح',
  };
  const items = new Map<string, any>();
  for (const [sku, barcode, name, purchasePriceMinor, salePriceMinor, reorderMilli] of itemRows) {
    const item = await db.item.create({ data: { tenantId: tenant.id, categoryId: category.id, uomId: uom.id, sku, barcode, name, nameAr: itemNamesAr[sku], purchasePriceMinor, salePriceMinor, reorderMilli, taxRateBps: 1400 } }); items.set(sku, item);
  }

  const openingDate = d('2026-01-01');
  let inventoryOpening = 0n;
  for (const [sku, item] of items) {
    const qty = sku === 'LAP-14' ? 10_000n : sku === 'MON-27' ? 20_000n : 30_000n;
    const value = qty * item.purchasePriceMinor / 1000n; inventoryOpening += value;
    await db.stockBalance.create({ data: { tenantId: tenant.id, warehouseId: main.id, itemId: item.id, quantityMilli: qty, valueMinor: value } });
    await db.stockMovement.create({ data: { tenantId: tenant.id, branchId: branch.id, warehouseId: main.id, itemId: item.id, postingDate: openingDate, quantityInMilli: qty, unitCostMinor: item.purchasePriceMinor, totalCostMinor: value, runningQuantityMilli: qty, runningValueMinor: value, sourceType: 'OPENING_BALANCE', sourceId: item.id, sourceNumber: 'OPEN-2026', createdById: adminId } });
  }

  async function journal(number: string, date: Date, sourceType: string, sourceId: bigint, description: string, lines: Array<[string, bigint, bigint, string]>) {
    const entry = await db.journalEntry.create({ data: { tenantId: tenant.id, branchId: branch.id, number, postingDate: date, description, sourceModule: 'SEED', sourceType, sourceId, sourceNumber: number, createdById: adminId, submittedById: adminId, approvedById: adminId, postedById: adminId, submittedAt: new Date(), approvedAt: new Date(), postedAt: new Date(), lines: { create: lines.map(([code, debitMinor, creditMinor, lineDescription]) => ({ tenantId: tenant.id, accountId: accounts.get(code)!, debitMinor, creditMinor, description: lineDescription })) } } });
    return db.journalEntry.update({ where: { id: entry.id }, data: { status: JournalStatus.POSTED } });
  }
  const openingJournal = await journal('JE-2026-00001', openingDate, 'OPENING', 1n, 'Opening balances', [['1000', 500_000_00n, 0n, 'Opening cash'], ['1010', 1_000_000_00n, 0n, 'Opening bank'], ['1200', inventoryOpening, 0n, 'Opening perpetual inventory'], ['3000', 0n, 1_500_000_00n + inventoryOpening, 'Owner capital']]);

  const laptop = items.get('LAP-14'), monitor = items.get('MON-27');
  const dock = items.get('DOC-USBC');
  const quotationDraft = await db.document.create({ data: {
    tenantId: tenant.id, type: DocumentType.QUOTATION, number: 'QT-CAI-2026-00001', status: WorkflowStatus.DRAFT,
    branchId: branch.id, warehouseId: main.id, customerId: customer.id, salespersonId: employees.get('EMP-0015'),
    documentDate: d('2026-07-18'), dueDate: d('2026-07-28'), currency: 'EGP', exchangeRateDate: d('2026-07-18'),
    subtotalMinor: 60_000_00n, taxMinor: 8_400_00n, totalMinor: 68_400_00n, createdById: createdUsers.get('sales@odin.demo')!,
    paymentTerms: '30 days net', notes: 'Delivery within seven business days.',
    lines: { create: { tenantId: tenant.id, itemId: laptop.id, uomId: uom.id, quantityMilli: 1_000n, unitPriceMinor: laptop.salePriceMinor, taxableMinor: 60_000_00n, taxMinor: 8_400_00n, totalMinor: 68_400_00n, unitCostMinor: laptop.purchasePriceMinor } },
  } });
  const quotationPending = await db.document.create({ data: {
    tenantId: tenant.id, type: DocumentType.QUOTATION, number: 'QT-CAI-2026-00002', status: WorkflowStatus.SUBMITTED,
    branchId: branch.id, warehouseId: main.id, customerId: meridianCustomer.id, salespersonId: employees.get('EMP-0015'),
    documentDate: d('2026-07-18'), dueDate: d('2026-07-31'), currency: 'USD', exchangeRateMicros: 49_250_000n,
    exchangeRateDate: d('2026-07-18'), subtotalMinor: 91_371n, taxMinor: 12_792n, totalMinor: 104_163n,
    createdById: createdUsers.get('sales@odin.demo')!, submittedById: createdUsers.get('sales@odin.demo')!, submittedAt: new Date(),
    paymentTerms: 'Payment within 21 days',
    lines: { create: { tenantId: tenant.id, itemId: monitor.id, uomId: uom.id, quantityMilli: 3_000n, unitPriceMinor: 30_457n, taxableMinor: 91_371n, taxMinor: 12_792n, totalMinor: 104_163n, unitCostMinor: monitor.purchasePriceMinor } },
  } });
  await db.approvalEvent.create({ data: { tenantId: tenant.id, entityType: 'DOCUMENT', entityId: quotationPending.id, action: 'SUBMIT', actorId: createdUsers.get('sales@odin.demo')!, comment: 'Commercial terms reviewed and ready for approval.' } });
  const quotationApproved = await db.document.create({ data: {
    tenantId: tenant.id, type: DocumentType.QUOTATION, number: 'QT-ALX-2026-00001', status: WorkflowStatus.APPROVED,
    branchId: alex.id, warehouseId: alexWarehouse.id, customerId: alexCustomer.id, salespersonId: employees.get('EMP-0027'),
    documentDate: d('2026-07-16'), dueDate: d('2026-07-26'), currency: 'EGP', exchangeRateDate: d('2026-07-16'),
    subtotalMinor: 30_000_00n, taxMinor: 4_200_00n, totalMinor: 34_200_00n, createdById: createdUsers.get('sales@odin.demo')!,
    submittedById: createdUsers.get('sales@odin.demo')!, approvedById: createdUsers.get('cfo@odin.demo')!, submittedAt: new Date(), approvedAt: new Date(),
    lines: { create: { tenantId: tenant.id, itemId: monitor.id, uomId: uom.id, quantityMilli: 2_000n, unitPriceMinor: monitor.salePriceMinor, taxableMinor: 30_000_00n, taxMinor: 4_200_00n, totalMinor: 34_200_00n, unitCostMinor: monitor.purchasePriceMinor } },
  } });
  const quotationRejected = await db.document.create({ data: {
    tenantId: tenant.id, type: DocumentType.QUOTATION, number: 'QT-CAI-2026-00003', status: WorkflowStatus.REJECTED,
    branchId: branch.id, warehouseId: main.id, customerId: meridianCustomer.id, salespersonId: employees.get('EMP-0021'),
    documentDate: d('2026-07-15'), dueDate: d('2026-07-25'), currency: 'EGP', exchangeRateDate: d('2026-07-15'),
    subtotalMinor: 22_000_00n, taxMinor: 3_080_00n, totalMinor: 25_080_00n, createdById: createdUsers.get('sales@odin.demo')!,
    submittedById: createdUsers.get('sales@odin.demo')!, submittedAt: new Date(),
    lines: { create: { tenantId: tenant.id, itemId: dock.id, uomId: uom.id, quantityMilli: 4_000n, unitPriceMinor: dock.salePriceMinor, taxableMinor: 22_000_00n, taxMinor: 3_080_00n, totalMinor: 25_080_00n, unitCostMinor: dock.purchasePriceMinor } },
  } });
  await db.approvalEvent.createMany({ data: [
    { tenantId: tenant.id, entityType: 'DOCUMENT', entityId: quotationApproved.id, action: 'SUBMIT', actorId: createdUsers.get('sales@odin.demo')!, comment: 'Submitted for customer deadline.' },
    { tenantId: tenant.id, entityType: 'DOCUMENT', entityId: quotationApproved.id, action: 'APPROVE', actorId: createdUsers.get('cfo@odin.demo')!, comment: 'Approved within delegated authority.' },
    { tenantId: tenant.id, entityType: 'DOCUMENT', entityId: quotationRejected.id, action: 'SUBMIT', actorId: createdUsers.get('sales@odin.demo')!, comment: 'Submitted for margin review.' },
    { tenantId: tenant.id, entityType: 'DOCUMENT', entityId: quotationRejected.id, action: 'REJECT', actorId: createdUsers.get('cfo@odin.demo')!, comment: 'Revise delivery cost and resubmit.' },
  ] });
  const so = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.SALES_ORDER, number: 'SO-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, warehouseId: main.id, customerId: customer.id, salespersonId: employees.get('EMP-0015'), documentDate: d('2026-07-01'), dueDate: d('2026-07-31'), subtotalMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, createdById: adminId, submittedById: createdUsers.get('sales@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: laptop.id, uomId: uom.id, quantityMilli: 2_000n, unitPriceMinor: laptop.salePriceMinor, taxableMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, unitCostMinor: laptop.purchasePriceMinor } } } });
  const soLine = await db.documentLine.findFirstOrThrow({ where: { documentId: so.id } });
  const delivery = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.DELIVERY_NOTE, number: 'DN-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, warehouseId: main.id, customerId: customer.id, salespersonId: employees.get('EMP-0015'), sourceDocumentId: so.id, documentDate: d('2026-07-02'), subtotalMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, costMinor: 80_000_00n, createdById: adminId, submittedById: createdUsers.get('sales@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: laptop.id, uomId: uom.id, sourceLineId: soLine.id, quantityMilli: 2_000n, unitPriceMinor: laptop.salePriceMinor, taxableMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, unitCostMinor: laptop.purchasePriceMinor, costMinor: 80_000_00n } } } });
  const deliveryJournal = await journal('JE-2026-00002', d('2026-07-02'), DocumentType.DELIVERY_NOTE, delivery.id, `Delivery ${delivery.number}`, [['5000', 80_000_00n, 0n, 'Cost of goods sold'], ['1200', 0n, 80_000_00n, 'Inventory issued']]);
  await db.document.update({ where: { id: delivery.id }, data: { status: WorkflowStatus.POSTED, journalEntryId: deliveryJournal.id, postedById: adminId, postedAt: new Date() } });
  await db.stockBalance.update({ where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: main.id, itemId: laptop.id } }, data: { quantityMilli: 8_000n, valueMinor: 320_000_00n } });
  await db.stockMovement.create({ data: { tenantId: tenant.id, branchId: branch.id, warehouseId: main.id, itemId: laptop.id, postingDate: d('2026-07-02'), quantityOutMilli: 2_000n, unitCostMinor: laptop.purchasePriceMinor, totalCostMinor: 80_000_00n, runningQuantityMilli: 8_000n, runningValueMinor: 320_000_00n, sourceType: DocumentType.DELIVERY_NOTE, sourceId: delivery.id, sourceNumber: delivery.number, createdById: adminId } });
  const deliveryLine = await db.documentLine.findFirstOrThrow({ where: { documentId: delivery.id } });
  const invoice = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.SALES_INVOICE, number: 'SI-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, customerId: customer.id, salespersonId: employees.get('EMP-0015'), sourceDocumentId: delivery.id, documentDate: d('2026-07-02'), dueDate: d('2026-08-01'), subtotalMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, createdById: adminId, submittedById: createdUsers.get('sales@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: laptop.id, uomId: uom.id, sourceLineId: deliveryLine.id, quantityMilli: 2_000n, unitPriceMinor: laptop.salePriceMinor, taxableMinor: 120_000_00n, taxMinor: 16_800_00n, totalMinor: 136_800_00n, unitCostMinor: laptop.purchasePriceMinor } } } });
  const invoiceJournal = await journal('JE-2026-00003', d('2026-07-02'), DocumentType.SALES_INVOICE, invoice.id, `Invoice ${invoice.number}`, [['1100', 136_800_00n, 0n, 'Customer receivable'], ['4000', 0n, 120_000_00n, 'Sales revenue'], ['2200', 0n, 16_800_00n, 'Output VAT']]);
  await db.document.update({ where: { id: invoice.id }, data: { status: WorkflowStatus.POSTED, journalEntryId: invoiceJournal.id, postedById: adminId, postedAt: new Date() } });

  const po = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.PURCHASE_ORDER, number: 'PO-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, warehouseId: main.id, supplierId: supplier.id, documentDate: d('2026-07-03'), subtotalMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, createdById: adminId, submittedById: createdUsers.get('purchasing@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: monitor.id, uomId: uom.id, quantityMilli: 5_000n, unitPriceMinor: monitor.purchasePriceMinor, taxableMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, unitCostMinor: monitor.purchasePriceMinor } } } });
  const poLine = await db.documentLine.findFirstOrThrow({ where: { documentId: po.id } });
  const receipt = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.GOODS_RECEIPT, number: 'GR-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, warehouseId: main.id, supplierId: supplier.id, sourceDocumentId: po.id, documentDate: d('2026-07-04'), subtotalMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, costMinor: 50_000_00n, createdById: adminId, submittedById: createdUsers.get('warehouse@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: monitor.id, uomId: uom.id, sourceLineId: poLine.id, quantityMilli: 5_000n, unitPriceMinor: monitor.purchasePriceMinor, taxableMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, unitCostMinor: monitor.purchasePriceMinor, costMinor: 50_000_00n } } } });
  const receiptJournal = await journal('JE-2026-00004', d('2026-07-04'), DocumentType.GOODS_RECEIPT, receipt.id, `Receipt ${receipt.number}`, [['1200', 50_000_00n, 0n, 'Inventory received'], ['2100', 0n, 50_000_00n, 'GRNI']]);
  await db.document.update({ where: { id: receipt.id }, data: { status: WorkflowStatus.POSTED, journalEntryId: receiptJournal.id, postedById: adminId, postedAt: new Date() } });
  await db.stockBalance.update({ where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: main.id, itemId: monitor.id } }, data: { quantityMilli: 25_000n, valueMinor: 250_000_00n } });
  await db.stockMovement.create({ data: { tenantId: tenant.id, branchId: branch.id, warehouseId: main.id, itemId: monitor.id, postingDate: d('2026-07-04'), quantityInMilli: 5_000n, unitCostMinor: monitor.purchasePriceMinor, totalCostMinor: 50_000_00n, runningQuantityMilli: 25_000n, runningValueMinor: 250_000_00n, sourceType: DocumentType.GOODS_RECEIPT, sourceId: receipt.id, sourceNumber: receipt.number, createdById: adminId } });
  const receiptLine = await db.documentLine.findFirstOrThrow({ where: { documentId: receipt.id } });
  const bill = await db.document.create({ data: { tenantId: tenant.id, type: DocumentType.PURCHASE_BILL, number: 'PB-2026-00001', status: WorkflowStatus.APPROVED, branchId: branch.id, supplierId: supplier.id, sourceDocumentId: receipt.id, documentDate: d('2026-07-05'), dueDate: d('2026-08-04'), subtotalMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, createdById: adminId, submittedById: createdUsers.get('purchasing@odin.demo'), approvedById: createdUsers.get('cfo@odin.demo'), submittedAt: new Date(), approvedAt: new Date(), lines: { create: { tenantId: tenant.id, itemId: monitor.id, uomId: uom.id, sourceLineId: receiptLine.id, quantityMilli: 5_000n, unitPriceMinor: monitor.purchasePriceMinor, taxableMinor: 50_000_00n, taxMinor: 7_000_00n, totalMinor: 57_000_00n, unitCostMinor: monitor.purchasePriceMinor } } } });
  const billJournal = await journal('JE-2026-00005', d('2026-07-05'), DocumentType.PURCHASE_BILL, bill.id, `Bill ${bill.number}`, [['2100', 50_000_00n, 0n, 'Clear GRNI'], ['1300', 7_000_00n, 0n, 'Recoverable VAT'], ['2000', 0n, 57_000_00n, 'Supplier payable']]);
  await db.document.update({ where: { id: bill.id }, data: { status: WorkflowStatus.POSTED, journalEntryId: billJournal.id, postedById: adminId, postedAt: new Date() } });

  const sequences = ['SALES_ORDER', 'DELIVERY_NOTE', 'SALES_INVOICE', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'PURCHASE_BILL', 'JOURNAL'];
  for (const documentType of sequences) await db.documentSequence.create({ data: { tenantId: tenant.id, branchId: branch.id, documentType, fiscalYear: 2026, nextValue: documentType === 'JOURNAL' ? 6n : 2n } });
  await db.documentSequence.create({ data: { tenantId: tenant.id, branchId: branch.id, documentType: 'QUOTATION', fiscalYear: 2026, nextValue: 4n } });
  await db.documentSequence.create({ data: { tenantId: tenant.id, branchId: alex.id, documentType: 'QUOTATION', fiscalYear: 2026, nextValue: 2n } });
  for (const doc of [delivery, invoice, receipt, bill]) await db.auditEvent.create({ data: { tenantId: tenant.id, userId: adminId, action: 'SEED_POST', entityType: 'DOCUMENT', entityId: doc.id.toString(), newValues: { number: doc.number, type: doc.type }, postingReference: doc.number } });
  await db.auditEvent.create({ data: { tenantId: tenant.id, userId: createdUsers.get('cashier@odin.demo')!, action: 'CLOSE_SHIFT', entityType: 'POS_SHIFT', entityId: 'DEMO-SHIFT-001', newValues: { registerCode: 'CAI-POS-01', differenceMinor: '0' } } });
  await db.auditEvent.create({ data: { tenantId: tenant.id, userId: adminId, action: initiatedBy === 'CLI' ? 'SEED_COMPLETE' : 'RESET_COMPLETE', entityType: 'TENANT', entityId: tenant.id.toString(), newValues: { database: 'PostgreSQL', balancedOpeningJournal: openingJournal.number, deterministic: true, initiatedBy } } });
  console.log(`Seeded ${tenant.name} with ${users.length} users, ${items.size} items and balanced posted chains.`);
  await db.$disconnect();
}

if (require.main === module) void seed();
