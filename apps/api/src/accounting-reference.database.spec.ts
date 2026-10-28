import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { Actor } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('Accounting reference scenario PostgreSQL reconciliation', () => {
  let admin: PrismaClient;
  let database: PrismaService;
  let erp: ErpService;
  let governance: { enforceAuthorityLimit: jest.Mock };
  let tenantId: bigint | undefined;

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService();
    governance = { enforceAuthorityLimit: jest.fn().mockResolvedValue(undefined) };
    erp = new ErpService(database, governance as any);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Accounting reference ' } } });
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: tenantId } });
      });
    }
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  it('reconciles opening funds, purchase, sale, receipt, and supplier payment through real workflows', async () => {
    const tenant = await admin.tenant.create({ data: {
      name: `Accounting reference ${Date.now()}`,
      baseCurrency: 'EGP',
      makerChecker: true,
      negativeStock: false,
    } });
    tenantId = tenant.id;
    const company = await admin.company.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: tenant.id, code: 'DEFAULT' } },
    });
    const branch = await admin.branch.create({ data: {
      tenantId: tenant.id,
      code: 'REF',
      name: 'Reference branch',
    } });
    const warehouse = await admin.warehouse.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      code: 'REF-WH',
      name: 'Reference warehouse',
    } });
    const role = await admin.role.create({ data: {
      tenantId: tenant.id,
      name: 'Reference scenario administrator',
      permissions: ['*'],
    } });
    const [makerUser, checkerUser] = await Promise.all([
      admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `reference-maker-${tenant.id}@odin.test`,
        name: 'Reference Maker',
        passwordHash: 'service-test-only',
        branchIds: [branch.id.toString()],
        warehouseIds: [warehouse.id.toString()],
      } }),
      admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `reference-checker-${tenant.id}@odin.test`,
        name: 'Reference Checker',
        passwordHash: 'service-test-only',
        branchIds: [branch.id.toString()],
        warehouseIds: [warehouse.id.toString()],
      } }),
    ]);
    await admin.currency.create({ data: {
      tenantId: tenant.id,
      code: 'EGP',
      name: 'Egyptian Pound',
      symbol: 'E£',
    } });
    await admin.fiscalPeriod.create({ data: {
      tenantId: tenant.id,
      year: 2026,
      month: 9,
      name: 'September 2026',
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      status: 'OPEN',
    } });

    const accountDefinitions = [
      ['1010', 'Bank current account', 'ASSET', null],
      ['1100', 'Accounts receivable', 'ASSET', 'AR'],
      ['1200', 'Inventory', 'ASSET', 'INVENTORY'],
      ['1300', 'Input VAT', 'ASSET', 'INPUT_VAT'],
      ['2000', 'Accounts payable', 'LIABILITY', 'AP'],
      ['2100', 'Goods received not invoiced', 'LIABILITY', 'GRNI'],
      ['2200', 'Output VAT', 'LIABILITY', 'OUTPUT_VAT'],
      ['3000', 'Owner equity', 'EQUITY', null],
      ['4000', 'Sales revenue', 'REVENUE', null],
      ['5000', 'Cost of goods sold', 'COGS', null],
      ['5100', 'Purchase variance', 'EXPENSE', null],
    ] as const;
    for (const [code, name, type, controlType] of accountDefinitions) {
      await admin.account.create({ data: {
        tenantId: tenant.id,
        code,
        name,
        type,
        controlType,
      } });
    }
    const accounts = new Map((await admin.account.findMany({ where: { tenantId: tenant.id } }))
      .map((account) => [account.code, account]));
    const bank = await admin.bankAccount.create({ data: {
      tenantId: tenant.id,
      code: 'REF-BANK',
      name: 'Reference bank',
      type: 'BANK',
      currency: 'EGP',
      glAccountId: accounts.get('1010')!.id,
    } });
    const supplier = await admin.supplier.create({ data: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'REF-SUP',
      name: 'Reference supplier',
      city: 'Cairo',
    } });
    const customer = await admin.customer.create({ data: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'REF-CUS',
      name: 'Reference customer',
      city: 'Cairo',
      defaultBranchId: branch.id,
      defaultCurrency: 'EGP',
    } });
    const department = await admin.department.create({ data: {
      tenantId: tenant.id,
      code: 'SALES',
      name: 'Sales',
    } });
    const salesperson = await admin.employee.create({ data: {
      tenantId: tenant.id,
      departmentId: department.id,
      code: 'REF-SALES',
      name: 'Reference salesperson',
      salesEligible: true,
      branchIds: [branch.id.toString()],
    } });
    const category = await admin.itemCategory.create({ data: {
      tenantId: tenant.id,
      code: 'REF-CAT',
      name: 'Reference category',
    } });
    const uom = await admin.unitOfMeasure.create({ data: {
      tenantId: tenant.id,
      code: 'EA',
      name: 'Each',
    } });
    const item = await admin.item.create({ data: {
      tenantId: tenant.id,
      categoryId: category.id,
      uomId: uom.id,
      sku: 'REF-ITEM',
      barcode: `REF-${tenant.id}`,
      name: 'Reference item',
      nameAr: 'صنف مرجعي',
      purchasePriceMinor: 10_000n,
      salePriceMinor: 15_000n,
      taxRateBps: 0,
    } });

    const actor = (user: typeof makerUser): Actor => ({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: user.name,
      role: role.name,
      roleIds: [role.id.toString()],
      permissions: ['system.super_admin'],
      deniedPermissions: [],
      legacyPermissions: ['*'],
      dataScopes: [],
      fieldPermissions: [],
      limits: {},
      branchIds: [branch.id.toString()],
      warehouseIds: [warehouse.id.toString()],
      companyIds: [company.id.toString()],
      companyAdminIds: [company.id.toString()],
      companyBranchIds: { [company.id.toString()]: [branch.id.toString()] },
      companyScopedPermissions: {},
      companyResourceAssignments: {},
    });
    const maker = actor(makerUser);
    const checker = actor(checkerUser);
    const approve = async (document: any) => {
      await erp.workflow(maker, BigInt(document.id), 'submit');
      return erp.workflow(checker, BigInt(document.id), 'approve');
    };
    const approveAndPost = async (document: any) => {
      await approve(document);
      return erp.postDocument(checker, BigInt(document.id));
    };

    const opening = await erp.createJournal(maker, {
      branchId: branch.id.toString(),
      postingDate: '2026-09-01',
      description: 'Reference opening funds',
      lines: [
        { accountId: accounts.get('1010')!.id.toString(), debit: '10000.00', description: 'Bank opening' },
        { accountId: accounts.get('3000')!.id.toString(), credit: '10000.00', description: 'Owner equity' },
      ],
    });
    await erp.journalWorkflow(maker, BigInt(opening.id), 'submit');
    await erp.journalWorkflow(checker, BigInt(opening.id), 'approve');
    await erp.journalWorkflow(checker, BigInt(opening.id), 'post');

    const purchaseOrder = await erp.createDocument(maker, {
      type: 'PURCHASE_ORDER',
      branchId: branch.id.toString(),
      warehouseId: warehouse.id.toString(),
      supplierId: supplier.id.toString(),
      documentDate: '2026-09-02',
      taxMode: 'EXEMPT',
      lines: [{ itemId: item.id.toString(), quantity: '10', unitPrice: '100.00', taxRateBps: 0 }],
    });
    await approve(purchaseOrder);
    const goodsReceipt = await erp.convertDocument(maker, BigInt(purchaseOrder.id), {
      targetType: 'GOODS_RECEIPT',
      warehouseId: warehouse.id.toString(),
      documentDate: '2026-09-03',
    });
    await approveAndPost(goodsReceipt);
    const purchaseBill = await erp.convertDocument(maker, BigInt(goodsReceipt.id), {
      targetType: 'PURCHASE_BILL',
      documentDate: '2026-09-04',
      dueDate: '2026-09-30',
    });
    await approveAndPost(purchaseBill);

    const salesOrder = await erp.createDocument(maker, {
      type: 'SALES_ORDER',
      branchId: branch.id.toString(),
      warehouseId: warehouse.id.toString(),
      customerId: customer.id.toString(),
      salespersonId: salesperson.id.toString(),
      documentDate: '2026-09-05',
      taxMode: 'EXEMPT',
      lines: [{ itemId: item.id.toString(), quantity: '4', unitPrice: '150.00', taxRateBps: 0 }],
    });
    await approve(salesOrder);
    const delivery = await erp.convertDocument(maker, BigInt(salesOrder.id), {
      targetType: 'DELIVERY_NOTE',
      warehouseId: warehouse.id.toString(),
      documentDate: '2026-09-06',
    });
    await approveAndPost(delivery);
    const salesInvoice = await erp.convertDocument(maker, BigInt(delivery.id), {
      targetType: 'SALES_INVOICE',
      documentDate: '2026-09-07',
      dueDate: '2026-09-30',
    });
    await approveAndPost(salesInvoice);

    await erp.createPayment(maker, {
      kind: 'RECEIPT',
      branchId: branch.id.toString(),
      bankAccountId: bank.id.toString(),
      postingDate: '2026-09-08',
      amount: '300.00',
      method: 'BANK',
      reference: 'Reference customer receipt',
      allocations: [{ documentId: salesInvoice.id.toString(), amount: '300.00' }],
    });
    const supplierPayment: any = await erp.createPayment(maker, {
      kind: 'PAYMENT',
      branchId: branch.id.toString(),
      bankAccountId: bank.id.toString(),
      postingDate: '2026-09-09',
      amount: '400.00',
      method: 'BANK',
      reference: 'Reference supplier payment',
      allocations: [{ documentId: purchaseBill.id.toString(), amount: '400.00' }],
    });
    await erp.paymentWorkflow(checker, BigInt(supplierPayment.id), 'approve', { comment: 'Reference approval' });

    await expect(erp.postDocument(checker, BigInt(salesInvoice.id))).rejects.toThrow(/Only an approved document can be posted/i);
    expect(await admin.journalEntry.count({ where: {
      tenantId: tenant.id,
      sourceType: 'SALES_INVOICE',
      sourceId: BigInt(salesInvoice.id),
    } })).toBe(1);

    const journalLines = await admin.journalLine.findMany({
      where: { tenantId: tenant.id, journalEntry: { status: 'POSTED' } },
      include: { account: true },
    });
    const balance = (code: string) => journalLines
      .filter((line) => line.account.code === code)
      .reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
    const debitTotal = journalLines.reduce((sum, line) => sum + line.debitMinor, 0n);
    const creditTotal = journalLines.reduce((sum, line) => sum + line.creditMinor, 0n);

    expect({ debitTotal, creditTotal }).toEqual({ debitTotal: 1_370_000n, creditTotal: 1_370_000n });
    expect(balance('1010')).toBe(990_000n);
    expect(balance('1200')).toBe(60_000n);
    expect(balance('1100')).toBe(30_000n);
    expect(balance('2000')).toBe(-60_000n);
    expect(balance('2100')).toBe(0n);
    expect(balance('3000')).toBe(-1_000_000n);
    expect(balance('4000')).toBe(-60_000n);
    expect(balance('5000')).toBe(40_000n);

    const stock = await admin.stockBalance.findUniqueOrThrow({
      where: {
        tenantId_warehouseId_itemId: {
          tenantId: tenant.id,
          warehouseId: warehouse.id,
          itemId: item.id,
        },
      },
    });
    expect(stock).toMatchObject({ quantityMilli: 6_000n, valueMinor: 60_000n });

    const trial: any = await erp.report(checker, 'trial-balance');
    const income: any = await erp.report(checker, 'income-statement');
    const arAging: any = await erp.report(checker, 'ar-aging');
    const apAging: any = await erp.report(checker, 'ap-aging');
    const inventory: any = await erp.report(checker, 'inventory-valuation');
    const reconciliation: any = await erp.report(checker, 'reconciliation');

    expect(BigInt(trial.totals.debitMinor)).toBe(1_120_000n);
    expect(BigInt(trial.totals.creditMinor)).toBe(1_120_000n);
    expect(BigInt(income.totals.profitMinor)).toBe(20_000n);
    expect(BigInt(arAging.totals.outstandingMinor)).toBe(30_000n);
    expect(BigInt(apAging.totals.outstandingMinor)).toBe(60_000n);
    expect(BigInt(inventory.totals.valueMinor)).toBe(60_000n);
    expect(reconciliation.rows.map((row: any) => ({
      control: row.control,
      ledgerMinor: BigInt(row.ledgerMinor),
      subledgerMinor: BigInt(row.subledgerMinor),
      differenceMinor: BigInt(row.differenceMinor),
    }))).toEqual([
      { control: 'Accounts receivable', ledgerMinor: 30_000n, subledgerMinor: 30_000n, differenceMinor: 0n },
      { control: 'Accounts payable', ledgerMinor: 60_000n, subledgerMinor: 60_000n, differenceMinor: 0n },
      { control: 'Inventory', ledgerMinor: 60_000n, subledgerMinor: 60_000n, differenceMinor: 0n },
    ]);
    expect(governance.enforceAuthorityLimit).toHaveBeenCalled();
  }, 30_000);
});
