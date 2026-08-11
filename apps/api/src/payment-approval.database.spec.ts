import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PaymentStatus, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import request from 'supertest';
import type { Actor } from './auth';
import { AuthService } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('Outgoing payment approval PostgreSQL integration', () => {
  let admin: PrismaClient;
  let database: PrismaService;
  let erp: ErpService;
  let app: INestApplication;
  let apiActor!: Actor;
  let governance: { enforceAuthorityLimit: jest.Mock };
  let tenant: { id: bigint };
  let company: { id: bigint };
  let branch: { id: bigint };
  let warehouse: { id: bigint };
  let role: { id: bigint; name: string };
  let makerUser: { id: bigint; email: string; name: string };
  let checkerUser: { id: bigint; email: string; name: string };
  let supplier: { id: bigint };
  let customer: { id: bigint };
  let bank: { id: bigint };
  let payableAccount: { id: bigint };
  let purchaseAccount: { id: bigint };
  let uom: { id: bigint };
  let item: { id: bigint };
  let billOrdinal = 0;
  let journalOrdinal = 0;

  const actor = (user: { id: bigint; email: string; name: string }, permissions: string[], input: Partial<Actor> = {}): Actor => ({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    name: user.name,
    role: role.name,
    roleIds: [role.id.toString()],
    permissions,
    deniedPermissions: [],
    legacyPermissions: [],
    dataScopes: [
      { resource: 'payment', scope: 'ALL' },
      { resource: 'bill', scope: 'ALL' },
      { resource: 'bank_account', scope: 'ALL' },
    ],
    fieldPermissions: [],
    limits: {},
    branchIds: [branch.id.toString()],
    warehouseIds: [warehouse.id.toString()],
    companyIds: [company.id.toString()],
    companyAdminIds: [],
    companyBranchIds: { [company.id.toString()]: [branch.id.toString()] },
    companyScopedPermissions: {},
    companyResourceAssignments: {},
    ...input,
  });

  const maker = () => actor(makerUser, ['payments.payment.create', 'purchasing.bill.view']);
  const checker = () => actor(checkerUser, ['payments.payment.approve', 'payments.payment.reject', 'purchasing.bill.view']);

  async function bill(totalMinor = 10_000n) {
    billOrdinal += 1;
    return admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'PURCHASE_BILL',
      number: `PB-PAYMENT-${billOrdinal}`,
      status: 'POSTED',
      branchId: branch.id,
      supplierId: supplier.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      subtotalMinor: totalMinor,
      totalMinor,
      createdById: makerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
  }

  async function purchaseReturn(purchaseBillId: bigint, totalMinor: bigint) {
    billOrdinal += 1;
    return admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'PURCHASE_RETURN',
      number: `PR-PAYMENT-${billOrdinal}`,
      status: 'POSTED',
      branchId: branch.id,
      supplierId: supplier.id,
      sourceDocumentId: purchaseBillId,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      subtotalMinor: totalMinor,
      totalMinor,
      createdById: makerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
  }

  async function approvedPurchaseReturn(purchaseBillId: bigint, totalMinor = 2_000n) {
    billOrdinal += 1;
    return admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'PURCHASE_RETURN',
      number: `PR-RACE-${billOrdinal}`,
      status: 'APPROVED',
      branchId: branch.id,
      warehouseId: warehouse.id,
      supplierId: supplier.id,
      sourceDocumentId: purchaseBillId,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      subtotalMinor: totalMinor,
      totalMinor,
      createdById: makerUser.id,
      submittedById: makerUser.id,
      approvedById: checkerUser.id,
      submittedAt: new Date(),
      approvedAt: new Date(),
      lines: { create: {
        tenantId: tenant.id,
        itemId: item.id,
        uomId: uom.id,
        description: 'Postable concurrency return',
        quantityMilli: 1_000n,
        unitPriceMinor: totalMinor,
        taxableMinor: totalMinor,
        taxMinor: 0n,
        totalMinor,
        unitCostMinor: 1_000n,
      } },
    } });
  }

  async function approvedCreditNote(salesInvoiceId: bigint, totalMinor = 6_000n) {
    billOrdinal += 1;
    return admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'CREDIT_NOTE',
      number: `CN-RACE-${billOrdinal}`,
      status: 'APPROVED',
      branchId: branch.id,
      customerId: customer.id,
      sourceDocumentId: salesInvoiceId,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      subtotalMinor: totalMinor,
      totalMinor,
      createdById: makerUser.id,
      submittedById: makerUser.id,
      approvedById: checkerUser.id,
      submittedAt: new Date(),
      approvedAt: new Date(),
    } });
  }

  async function postedJournal(label: string, sourceType: string, sourceId: bigint, amountMinor: bigint, payableCredit: boolean) {
    journalOrdinal += 1;
    const entry = await admin.journalEntry.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      number: `JE-PAY-${label}-${journalOrdinal}`,
      postingDate: new Date('2026-08-10T00:00:00.000Z'),
      description: label,
      sourceModule: 'PURCHASING',
      sourceType,
      sourceId,
      sourceNumber: label,
      createdById: makerUser.id,
      submittedById: makerUser.id,
      approvedById: checkerUser.id,
      postedById: checkerUser.id,
      submittedAt: new Date(),
      approvedAt: new Date(),
      postedAt: new Date(),
      lines: { create: payableCredit ? [
        { tenantId: tenant.id, accountId: purchaseAccount.id, description: label, debitMinor: amountMinor, creditMinor: 0n },
        { tenantId: tenant.id, accountId: payableAccount.id, description: label, debitMinor: 0n, creditMinor: amountMinor },
      ] : [
        { tenantId: tenant.id, accountId: payableAccount.id, description: label, debitMinor: amountMinor, creditMinor: 0n },
        { tenantId: tenant.id, accountId: purchaseAccount.id, description: label, debitMinor: 0n, creditMinor: amountMinor },
      ] },
    } });
    return admin.journalEntry.update({ where: { id: entry.id }, data: { status: 'POSTED' } });
  }

  const paymentBody = (documentId: bigint, amount = '100.00') => ({
    kind: 'PAYMENT',
    branchId: branch.id.toString(),
    bankAccountId: bank.id.toString(),
    postingDate: '2026-08-10',
    amount,
    method: 'BANK',
    reference: 'Supplier settlement under approval',
    allocations: [{ documentId: documentId.toString(), amount }],
  });

  async function effects(paymentId: bigint, documentId: bigint) {
    const [payment, allocationCount, journalCount, document] = await Promise.all([
      admin.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      admin.paymentAllocation.count({ where: { paymentId } }),
      admin.journalEntry.count({ where: { sourceType: 'PAYMENT', sourceId: paymentId } }),
      admin.document.findUniqueOrThrow({ where: { id: documentId }, select: { paidMinor: true } }),
    ]);
    return { payment, allocationCount, journalCount, paidMinor: document.paidMinor };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService();
    governance = { enforceAuthorityLimit: jest.fn().mockResolvedValue(undefined) };
    erp = new ErpService(database, governance as any);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Payment approval test ' } } });
    });

    tenant = await admin.tenant.create({ data: { name: `Payment approval test ${Date.now()}`, baseCurrency: 'EGP', makerChecker: true }, select: { id: true } });
    company = await admin.company.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'DEFAULT' } }, select: { id: true } });
    branch = await admin.branch.create({ data: { tenantId: tenant.id, code: 'PAY', name: 'Payment approval branch' }, select: { id: true } });
    warehouse = await admin.warehouse.create({ data: { tenantId: tenant.id, branchId: branch.id, code: 'PAY-WH', name: 'Payment test warehouse' }, select: { id: true } });
    role = await admin.role.create({ data: { tenantId: tenant.id, name: 'Payment workflow test role', permissions: [] }, select: { id: true, name: true } });
    const createUser = (key: string, name: string) => admin.user.create({ data: {
      tenantId: tenant.id,
      roleId: role.id,
      email: `${key}-${tenant.id}@odin.test`,
      name,
      passwordHash: 'not-used-by-service-test',
      branchIds: [branch.id.toString()],
      warehouseIds: [warehouse.id.toString()],
    }, select: { id: true, email: true, name: true } });
    [makerUser, checkerUser] = await Promise.all([
      createUser('payment-maker', 'Payment Maker'),
      createUser('payment-checker', 'Payment Checker'),
    ]);
    await admin.currency.create({ data: { tenantId: tenant.id, code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' } });
    await admin.fiscalPeriod.create({ data: {
      tenantId: tenant.id, year: 2026, month: 8, name: 'August 2026',
      startDate: new Date('2026-08-01T00:00:00.000Z'), endDate: new Date('2026-08-31T00:00:00.000Z'), status: 'OPEN',
    } });
    const [bankGl, apGl, purchasesGl] = await Promise.all([
      admin.account.create({ data: { tenantId: tenant.id, code: '1010', name: 'Bank current account', type: 'ASSET' } }),
      admin.account.create({ data: { tenantId: tenant.id, code: '2000', name: 'Accounts payable control', type: 'LIABILITY', controlType: 'AP' } }),
      admin.account.create({ data: { tenantId: tenant.id, code: '5100', name: 'Purchases', type: 'EXPENSE' } }),
      admin.account.create({ data: { tenantId: tenant.id, code: '1100', name: 'Accounts receivable control', type: 'ASSET', controlType: 'AR' } }),
      admin.account.create({ data: { tenantId: tenant.id, code: '1200', name: 'Inventory control', type: 'ASSET', controlType: 'INVENTORY' } }),
      admin.account.create({ data: { tenantId: tenant.id, code: '4000', name: 'Sales revenue', type: 'REVENUE' } }),
    ]);
    payableAccount = apGl;
    purchaseAccount = purchasesGl;
    bank = await admin.bankAccount.create({ data: {
      tenantId: tenant.id, code: 'PAY-BANK', name: 'Payment bank', type: 'BANK', currency: 'EGP', glAccountId: bankGl.id,
    }, select: { id: true } });
    supplier = await admin.supplier.create({ data: {
      tenantId: tenant.id, companyId: company.id, code: 'SUP-PAY', name: 'Payment Supplier', city: 'Cairo',
    }, select: { id: true } });
    customer = await admin.customer.create({ data: {
      tenantId: tenant.id, companyId: company.id, code: 'CUS-PAY', name: 'Payment Customer', city: 'Cairo', defaultBranchId: branch.id,
    }, select: { id: true } });
    const category = await admin.itemCategory.create({ data: { tenantId: tenant.id, code: 'PAY-CAT', name: 'Payment test category' } });
    uom = await admin.unitOfMeasure.create({ data: { tenantId: tenant.id, code: 'EA', name: 'Each' }, select: { id: true } });
    item = await admin.item.create({ data: {
      tenantId: tenant.id,
      categoryId: category.id,
      uomId: uom.id,
      sku: 'PAY-ITEM',
      barcode: 'PAY-ITEM',
      name: 'Payment test item',
      nameAr: 'Payment test item',
      purchasePriceMinor: 1_000n,
      salePriceMinor: 2_000n,
      taxRateBps: 0,
    }, select: { id: true } });
    await admin.stockBalance.create({ data: {
      tenantId: tenant.id,
      warehouseId: warehouse.id,
      itemId: item.id,
      quantityMilli: 20_000n,
      valueMinor: 20_000n,
    } });

    const module = await Test.createTestingModule({
      controllers: [ErpController],
      providers: [
        { provide: ErpService, useValue: erp },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.actor = apiActor;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenant?.id) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: tenant.id } });
      });
    }
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  it('creates outgoing payments as submitted instructions with no financial effects', async () => {
    const purchaseBill = await bill();
    const noPaymentScope = maker();
    noPaymentScope.dataScopes = [{ resource: 'payment', scope: 'NONE' }, { resource: 'bill', scope: 'ALL' }, { resource: 'bank_account', scope: 'ALL' }];
    await expect(erp.createPayment(noPaymentScope, paymentBody(purchaseBill.id))).rejects.toThrow(/outside your data scope/i);
    const created: any = await erp.createPayment(maker(), paymentBody(purchaseBill.id));

    expect(created).toMatchObject({ kind: 'PAYMENT', status: PaymentStatus.SUBMITTED, journalEntryId: null });
    expect(created.allocations).toEqual([]);
    expect(await effects(BigInt(created.id), purchaseBill.id)).toMatchObject({
      allocationCount: 0,
      journalCount: 0,
      paidMinor: 0n,
      payment: { status: PaymentStatus.SUBMITTED, journalEntryId: null, approvedById: null },
    });
    expect(await admin.approvalEvent.findMany({ where: { entityType: 'PAYMENT', entityId: BigInt(created.id) }, select: { action: true } }))
      .toEqual([{ action: 'SUBMIT' }]);
    expect(await admin.auditEvent.findMany({ where: { entityType: 'PAYMENT', entityId: String(created.id) }, select: { action: true } }))
      .toEqual([{ action: 'SUBMIT' }]);
    const noScopeViewer = actor(checkerUser, ['payments.payment.view', 'purchasing.bill.view']);
    noScopeViewer.dataScopes = [{ resource: 'payment', scope: 'NONE' }, { resource: 'bill', scope: 'ALL' }, { resource: 'bank_account', scope: 'ALL' }];
    await expect(erp.payments(noScopeViewer)).resolves.toEqual([]);
  });

  it('enforces independent checker, bank and bill scope, authority, and posts exactly once', async () => {
    const purchaseBill = await bill();
    const created: any = await erp.createPayment(maker(), paymentBody(purchaseBill.id));
    const paymentId = BigInt(created.id);
    const noPaymentScope = checker();
    noPaymentScope.dataScopes = [{ resource: 'payment', scope: 'NONE' }, { resource: 'bill', scope: 'ALL' }, { resource: 'bank_account', scope: 'ALL' }];
    await expect(erp.paymentWorkflow(noPaymentScope, paymentId, 'approve')).rejects.toThrow(/payment not found/i);
    const selfApprover = actor(makerUser, ['payments.payment.create', 'payments.payment.approve', 'purchasing.bill.view']);
    await expect(erp.paymentWorkflow(selfApprover, paymentId, 'approve')).rejects.toThrow(/maker-checker/i);

    const noBankScope = checker();
    noBankScope.dataScopes = [{ resource: 'payment', scope: 'ALL' }, { resource: 'bill', scope: 'ALL' }, { resource: 'bank_account', scope: 'NONE' }];
    await expect(erp.paymentWorkflow(noBankScope, paymentId, 'approve')).rejects.toThrow(/bank account.*outside|outside.*bank account/i);

    const noBillScope = checker();
    noBillScope.dataScopes = [{ resource: 'payment', scope: 'ALL' }, { resource: 'bill', scope: 'NONE' }, { resource: 'bank_account', scope: 'ALL' }];
    await expect(erp.paymentWorkflow(noBillScope, paymentId, 'approve')).rejects.toThrow(/data scope|outside your company/i);

    governance.enforceAuthorityLimit.mockRejectedValueOnce(new ForbiddenException('Payment authority exceeded'));
    await expect(erp.paymentWorkflow(checker(), paymentId, 'approve')).rejects.toThrow(/authority exceeded/i);
    expect(await effects(paymentId, purchaseBill.id)).toMatchObject({ allocationCount: 0, journalCount: 0, paidMinor: 0n });

    governance.enforceAuthorityLimit.mockClear();
    const approved: any = await erp.paymentWorkflow(checker(), paymentId, 'approve', { comment: 'Approved within treasury authority' });
    expect(approved).toMatchObject({ status: PaymentStatus.POSTED, approvedById: checkerUser.id.toString() });
    expect(approved.journalEntry).toMatchObject({ status: 'POSTED', sourceType: 'PAYMENT', sourceId: paymentId.toString() });
    expect(approved.allocations).toHaveLength(1);
    expect(governance.enforceAuthorityLimit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: checkerUser.id }), {
      companyId: company.id,
      branchId: branch.id,
      key: 'payments.payment_amount_minor',
      currency: 'EGP',
      amountMinor: 10_000n,
    });
    expect(await effects(paymentId, purchaseBill.id)).toMatchObject({ allocationCount: 1, journalCount: 1, paidMinor: 10_000n });
    const journalLines = await admin.journalLine.findMany({ where: { journalEntryId: BigInt(approved.journalEntryId) } });
    expect(journalLines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(10_000n);
    expect(journalLines.reduce((sum, line) => sum + line.creditMinor, 0n)).toBe(10_000n);
    expect(await admin.approvalEvent.findMany({ where: { entityType: 'PAYMENT', entityId: paymentId }, orderBy: { id: 'asc' }, select: { action: true, actorId: true } }))
      .toEqual([{ action: 'SUBMIT', actorId: makerUser.id }, { action: 'APPROVE', actorId: checkerUser.id }]);
    await expect(erp.paymentWorkflow(checker(), paymentId, 'approve')).rejects.toThrow(/only a submitted/i);
    expect(await effects(paymentId, purchaseBill.id)).toMatchObject({ allocationCount: 1, journalCount: 1, paidMinor: 10_000n });
  });

  it('subtracts posted purchase returns at request and approval time and keeps AP reconciled', async () => {
    const returnedBill = await bill(10_000n);
    const billJournal = await postedJournal(returnedBill.number, 'PURCHASE_BILL', returnedBill.id, 10_000n, true);
    const postedReturn = await purchaseReturn(returnedBill.id, 4_000n);
    const returnJournal = await postedJournal(postedReturn.number, 'PURCHASE_RETURN', postedReturn.id, 4_000n, false);

    await expect(erp.createPayment(maker(), paymentBody(returnedBill.id, '70.00')))
      .rejects.toThrow(/exceeds net outstanding/i);

    const submitted: any = await erp.createPayment(maker(), paymentBody(returnedBill.id, '60.00'));
    expect(submitted.plannedAllocations[0].document).toMatchObject({
      returnedMinor: '4000',
      netPayableMinor: '6000',
      remainingMinor: '6000',
    });
    const approved: any = await erp.paymentWorkflow(checker(), BigInt(submitted.id), 'approve');
    expect(approved.allocations[0].document).toMatchObject({
      returnedMinor: '4000',
      netPayableMinor: '6000',
      remainingMinor: '0',
    });

    const persistedBill = await admin.document.findUniqueOrThrow({ where: { id: returnedBill.id } });
    const subledgerMinor = persistedBill.totalMinor - persistedBill.paidMinor - postedReturn.totalMinor;
    const journalIds = [billJournal.id, returnJournal.id, BigInt(approved.journalEntryId)];
    const payableLines = await admin.journalLine.findMany({
      where: { journalEntryId: { in: journalIds }, accountId: payableAccount.id },
    });
    const ledgerMinor = payableLines.reduce((sum, line) => sum + line.creditMinor - line.debitMinor, 0n);
    expect({ ledgerMinor, subledgerMinor }).toEqual({ ledgerMinor: 0n, subledgerMinor: 0n });

    const listed: any[] = await erp.listDocuments(maker(), 'PURCHASE_BILL', 'POSTED');
    expect(listed.find((document) => document.id === returnedBill.id.toString())).toMatchObject({
      returnedMinor: '4000',
      netPayableMinor: '6000',
      remainingMinor: '0',
    });

    const revalidatedBill = await bill(10_000n);
    const pending: any = await erp.createPayment(maker(), paymentBody(revalidatedBill.id, '100.00'));
    await purchaseReturn(revalidatedBill.id, 1_000n);
    const pendingRows: any[] = await erp.payments(actor(checkerUser, ['payments.payment.view', 'purchasing.bill.view']));
    expect(pendingRows.find((payment) => payment.id === pending.id).plannedAllocations[0].document).toMatchObject({
      returnedMinor: '1000',
      netPayableMinor: '9000',
      remainingMinor: '9000',
    });
    await expect(erp.paymentWorkflow(checker(), BigInt(pending.id), 'approve'))
      .rejects.toThrow(/exceeds net outstanding/i);
    expect(await effects(BigInt(pending.id), revalidatedBill.id)).toMatchObject({
      allocationCount: 0,
      journalCount: 0,
      paidMinor: 0n,
    });
  });

  it('serializes payment approval and purchase-return posting on the same source bill', async () => {
    const purchaseBill = await bill(10_000n);
    const submitted: any = await erp.createPayment(maker(), paymentBody(purchaseBill.id, '100.00'));
    const approvedReturn = await approvedPurchaseReturn(purchaseBill.id);
    const returnPoster = actor(checkerUser, ['purchasing.return.post'], {
      dataScopes: [{ resource: 'purchase_return', scope: 'ALL' }],
    });
    const stockBefore = await admin.stockBalance.findUniqueOrThrow({
      where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id } },
    });

    const outcomes = await Promise.allSettled([
      erp.paymentWorkflow(checker(), BigInt(submitted.id), 'approve'),
      erp.postDocument(returnPoster, approvedReturn.id),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')!;
    expect(String(rejected.reason?.message || rejected.reason)).toMatch(/exceeds net outstanding|exceeds the remaining payable/i);

    const [paymentState, returnState, billState, paymentAllocations, paymentJournals, returnJournals, returnMovements, returnAudits, stockAfter] = await Promise.all([
      admin.payment.findUniqueOrThrow({ where: { id: BigInt(submitted.id) } }),
      admin.document.findUniqueOrThrow({ where: { id: approvedReturn.id } }),
      admin.document.findUniqueOrThrow({ where: { id: purchaseBill.id } }),
      admin.paymentAllocation.count({ where: { paymentId: BigInt(submitted.id) } }),
      admin.journalEntry.count({ where: { sourceType: 'PAYMENT', sourceId: BigInt(submitted.id) } }),
      admin.journalEntry.count({ where: { sourceType: 'PURCHASE_RETURN', sourceId: approvedReturn.id } }),
      admin.stockMovement.count({ where: { sourceType: 'PURCHASE_RETURN', sourceId: approvedReturn.id } }),
      admin.auditEvent.count({ where: { action: 'POST', entityType: 'DOCUMENT', entityId: approvedReturn.id.toString() } }),
      admin.stockBalance.findUniqueOrThrow({
        where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id } },
      }),
    ]);
    const paymentPosted = paymentState.status === PaymentStatus.POSTED;
    const returnPosted = returnState.status === 'POSTED';
    const postedReturnMinor = returnPosted ? returnState.totalMinor : 0n;
    expect(billState.totalMinor - billState.paidMinor - postedReturnMinor).toBeGreaterThanOrEqual(0n);
    expect([paymentPosted, returnPosted].filter(Boolean)).toHaveLength(1);
    expect(paymentState.status).toBe(paymentPosted ? PaymentStatus.POSTED : PaymentStatus.SUBMITTED);
    expect(returnState.status).toBe(returnPosted ? 'POSTED' : 'APPROVED');
    expect({ paymentAllocations, paymentJournals }).toEqual({
      paymentAllocations: paymentPosted ? 1 : 0,
      paymentJournals: paymentPosted ? 1 : 0,
    });
    expect({ returnJournals, returnMovements, returnAudits }).toEqual({
      returnJournals: returnPosted ? 1 : 0,
      returnMovements: returnPosted ? 1 : 0,
      returnAudits: returnPosted ? 1 : 0,
    });
    expect(billState.paidMinor).toBe(paymentPosted ? 10_000n : 0n);
    expect(stockBefore.quantityMilli - stockAfter.quantityMilli).toBe(returnPosted ? 1_000n : 0n);
    expect(stockBefore.valueMinor - stockAfter.valueMinor).toBe(returnPosted ? 1_000n : 0n);
  });

  it('posts the same approved stock-affecting return exactly once under concurrency', async () => {
    const purchaseBill = await bill(10_000n);
    const approvedReturn = await approvedPurchaseReturn(purchaseBill.id);
    const returnPoster = actor(checkerUser, ['purchasing.return.post'], {
      dataScopes: [{ resource: 'purchase_return', scope: 'ALL' }],
    });
    const stockBefore = await admin.stockBalance.findUniqueOrThrow({
      where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id } },
    });

    const outcomes = await Promise.allSettled([
      erp.postDocument(returnPoster, approvedReturn.id),
      erp.postDocument(returnPoster, approvedReturn.id),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')!;
    expect(String(rejected.reason?.message || rejected.reason)).toMatch(/only an approved document can be posted/i);

    const [returnState, journalCount, movementCount, auditCount, stockAfter] = await Promise.all([
      admin.document.findUniqueOrThrow({ where: { id: approvedReturn.id } }),
      admin.journalEntry.count({ where: { sourceType: 'PURCHASE_RETURN', sourceId: approvedReturn.id } }),
      admin.stockMovement.count({ where: { sourceType: 'PURCHASE_RETURN', sourceId: approvedReturn.id } }),
      admin.auditEvent.count({ where: { action: 'POST', entityType: 'DOCUMENT', entityId: approvedReturn.id.toString() } }),
      admin.stockBalance.findUniqueOrThrow({
        where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id } },
      }),
    ]);
    expect(returnState.status).toBe('POSTED');
    expect({ journalCount, movementCount, auditCount }).toEqual({ journalCount: 1, movementCount: 1, auditCount: 1 });
    expect(stockBefore.quantityMilli - stockAfter.quantityMilli).toBe(1_000n);
    expect(stockBefore.valueMinor - stockAfter.valueMinor).toBe(1_000n);
  });

  it('serializes distinct credits against the same source invoice', async () => {
    billOrdinal += 1;
    const invoice = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'SALES_INVOICE',
      number: `SI-CREDIT-RACE-${billOrdinal}`,
      status: 'POSTED',
      branchId: branch.id,
      customerId: customer.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
      subtotalMinor: 10_000n,
      totalMinor: 10_000n,
      createdById: makerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
    const [firstCredit, secondCredit] = await Promise.all([
      approvedCreditNote(invoice.id),
      approvedCreditNote(invoice.id),
    ]);
    const creditPoster = actor(checkerUser, ['sales.credit_note.post'], {
      dataScopes: [{ resource: 'credit_note', scope: 'ALL' }],
    });

    const outcomes = await Promise.allSettled([
      erp.postDocument(creditPoster, firstCredit.id),
      erp.postDocument(creditPoster, secondCredit.id),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')!;
    expect(String(rejected.reason?.message || rejected.reason)).toMatch(/exceeds the remaining receivable/i);

    const creditIds = [firstCredit.id, secondCredit.id];
    const [credits, journalCount, auditCount] = await Promise.all([
      admin.document.findMany({ where: { id: { in: creditIds } }, orderBy: { id: 'asc' } }),
      admin.journalEntry.count({ where: { sourceType: 'CREDIT_NOTE', sourceId: { in: creditIds } } }),
      admin.auditEvent.count({ where: {
        action: 'POST', entityType: 'DOCUMENT', entityId: { in: creditIds.map((creditId) => creditId.toString()) },
      } }),
    ]);
    expect(credits.map(({ status }) => status).sort()).toEqual(['APPROVED', 'POSTED']);
    expect(credits.filter(({ status }) => status === 'POSTED').reduce((sum, credit) => sum + credit.totalMinor, 0n)).toBe(6_000n);
    expect({ journalCount, auditCount }).toEqual({ journalCount: 1, auditCount: 1 });
  });

  it('serializes a full receipt against a credit on the same source invoice', async () => {
    billOrdinal += 1;
    const invoice = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'SALES_INVOICE',
      number: `SI-RECEIPT-CREDIT-RACE-${billOrdinal}`,
      status: 'POSTED',
      branchId: branch.id,
      customerId: customer.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
      subtotalMinor: 10_000n,
      totalMinor: 10_000n,
      createdById: makerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
    const credit = await approvedCreditNote(invoice.id);
    const creditPoster = actor(checkerUser, ['sales.credit_note.post'], {
      dataScopes: [{ resource: 'credit_note', scope: 'ALL' }],
    });
    const receiptCreator = actor(makerUser, ['payments.receipt.create', 'sales.invoice.view'], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const receiptReference = `Receipt-credit race ${invoice.id}`;

    const outcomes = await Promise.allSettled([
      erp.createPayment(receiptCreator, {
        kind: 'RECEIPT',
        branchId: branch.id.toString(),
        bankAccountId: bank.id.toString(),
        postingDate: '2026-08-10',
        amount: '100.00',
        method: 'BANK',
        reference: receiptReference,
        allocations: [{ documentId: invoice.id.toString(), amount: '100.00' }],
      }),
      erp.postDocument(creditPoster, credit.id),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')!;
    expect(String(rejected.reason?.message || rejected.reason)).toMatch(/exceeds net outstanding|exceeds the remaining receivable/i);

    const [invoiceState, creditState, receipts, creditJournalCount, creditAuditCount] = await Promise.all([
      admin.document.findUniqueOrThrow({ where: { id: invoice.id } }),
      admin.document.findUniqueOrThrow({ where: { id: credit.id } }),
      admin.payment.findMany({ where: { reference: receiptReference } }),
      admin.journalEntry.count({ where: { sourceType: 'CREDIT_NOTE', sourceId: credit.id } }),
      admin.auditEvent.count({ where: { action: 'POST', entityType: 'DOCUMENT', entityId: credit.id.toString() } }),
    ]);
    const receiptPosted = receipts.length === 1;
    const creditPosted = creditState.status === 'POSTED';
    const receiptJournalCount = receiptPosted
      ? await admin.journalEntry.count({ where: { sourceType: 'RECEIPT', sourceId: receipts[0].id } })
      : 0;
    const receiptAuditCount = receiptPosted
      ? await admin.auditEvent.count({ where: { action: 'POST', entityType: 'PAYMENT', entityId: receipts[0].id.toString() } })
      : 0;
    expect([receiptPosted, creditPosted].filter(Boolean)).toHaveLength(1);
    expect(invoiceState.totalMinor - invoiceState.paidMinor - (creditPosted ? creditState.totalMinor : 0n)).toBeGreaterThanOrEqual(0n);
    expect(invoiceState.paidMinor).toBe(receiptPosted ? 10_000n : 0n);
    expect(creditState.status).toBe(creditPosted ? 'POSTED' : 'APPROVED');
    expect(receipts).toHaveLength(receiptPosted ? 1 : 0);
    expect({ creditJournalCount, creditAuditCount }).toEqual({
      creditJournalCount: creditPosted ? 1 : 0,
      creditAuditCount: creditPosted ? 1 : 0,
    });
    expect({ receiptJournalCount, receiptAuditCount }).toEqual({
      receiptJournalCount: receiptPosted ? 1 : 0,
      receiptAuditCount: receiptPosted ? 1 : 0,
    });
    expect(creditJournalCount + receiptJournalCount).toBe(1);
  });

  it('omits allocation documents without the related document permission and data scope in service and HTTP responses', async () => {
    const purchaseBill = await bill(2_000n);
    const submitted: any = await erp.createPayment(maker(), paymentBody(purchaseBill.id, '20.00'));
    const outgoing: any = await erp.paymentWorkflow(checker(), BigInt(submitted.id), 'approve');
    const invoice = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'SALES_INVOICE',
      number: `SI-PAYMENT-${billOrdinal + 1}`,
      status: 'POSTED',
      branchId: branch.id,
      customerId: customer.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
      subtotalMinor: 5_000n,
      totalMinor: 5_000n,
      createdById: makerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
    const receiptCreator = actor(makerUser, ['payments.receipt.create', 'sales.invoice.view'], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const receipt: any = await erp.createPayment(receiptCreator, {
      kind: 'RECEIPT',
      branchId: branch.id.toString(),
      bankAccountId: bank.id.toString(),
      postingDate: '2026-08-10',
      amount: '10.00',
      method: 'BANK',
      reference: 'Scoped receipt evidence',
      allocations: [{ documentId: invoice.id.toString(), amount: '10.00' }],
    });
    billOrdinal += 1;
    const ownInvoice = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'SALES_INVOICE',
      number: `SI-OWN-PAYMENT-${billOrdinal}`,
      status: 'POSTED',
      branchId: branch.id,
      customerId: customer.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
      subtotalMinor: 3_000n,
      totalMinor: 3_000n,
      createdById: checkerUser.id,
      postedById: makerUser.id,
      postedAt: new Date(),
    } });
    const mixedScopeReceipt: any = await erp.createPayment(receiptCreator, {
      kind: 'RECEIPT',
      branchId: branch.id.toString(),
      bankAccountId: bank.id.toString(),
      postingDate: '2026-08-10',
      amount: '20.00',
      method: 'BANK',
      reference: 'Mixed invoice scope receipt',
      allocations: [
        { documentId: invoice.id.toString(), amount: '10.00' },
        { documentId: ownInvoice.id.toString(), amount: '10.00' },
      ],
    });

    const hiddenDocumentActor = actor(checkerUser, [
      'payments.payment.view', 'payments.receipt.view', 'sales.customer.view', 'audit.business.view',
    ], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'bill', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'customer', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const hiddenPayments: any[] = await erp.payments(hiddenDocumentActor);
    expect(hiddenPayments.find((payment) => payment.id === outgoing.id).allocations).toEqual([]);
    expect(hiddenPayments.find((payment) => payment.id === receipt.id).allocations).toEqual([]);
    expect(hiddenPayments.find((payment) => payment.id === outgoing.id)).not.toHaveProperty('allocationPlan');

    const ownScopeActor = actor(checkerUser, [
      'payments.payment.view', 'payments.receipt.view', 'purchasing.bill.view', 'sales.invoice.view',
    ], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'bill', scope: 'OWN' },
        { resource: 'invoice', scope: 'OWN' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const ownScopePayments: any[] = await erp.payments(ownScopeActor);
    expect(ownScopePayments.find((payment) => payment.id === outgoing.id).allocations).toEqual([]);
    expect(ownScopePayments.find((payment) => payment.id === receipt.id).allocations).toEqual([]);

    const fullyVisibleActor = actor(checkerUser, [
      'payments.payment.view', 'payments.receipt.view', 'purchasing.bill.view', 'sales.invoice.view',
    ], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'bill', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const visiblePayments: any[] = await erp.payments(fullyVisibleActor);
    expect(visiblePayments.find((payment) => payment.id === outgoing.id).allocations[0].document.number).toBe(purchaseBill.number);
    expect(visiblePayments.find((payment) => payment.id === receipt.id).allocations[0].document.number).toBe(invoice.number);

    const customerDetail: any = await erp.customerDetail(hiddenDocumentActor, customer.id);
    expect(customerDetail).not.toHaveProperty('documents');
    expect(customerDetail.payments.find((payment: any) => payment.id === receipt.id).allocations).toEqual([]);
    const receiptEvidence: any = await erp.referenceEvidence(hiddenDocumentActor, receipt.number);
    const outgoingEvidence: any = await erp.referenceEvidence(hiddenDocumentActor, outgoing.number);
    expect(receiptEvidence).toMatchObject({ kind: 'PAYMENT', lines: [] });
    expect(outgoingEvidence).toMatchObject({ kind: 'PAYMENT', lines: [] });

    const scopedStatementActor = actor(checkerUser, [
      'payments.receipt.view', 'sales.customer.view', 'sales.invoice.view',
    ], {
      dataScopes: [
        { resource: 'payment', scope: 'ALL' },
        { resource: 'invoice', scope: 'OWN' },
        { resource: 'customer', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
      fieldPermissions: [{ resource: 'customer', field: 'balanceMinor', access: 'VIEW' }],
    });
    const scopedCustomer: any = await erp.customerDetail(scopedStatementActor, customer.id);
    const mixedPayment = scopedCustomer.payments.find((payment: any) => payment.id === mixedScopeReceipt.id);
    expect(mixedPayment.allocations.map((allocation: any) => allocation.document.number)).toEqual([ownInvoice.number]);
    expect(scopedCustomer.statement.find((row: any) => row.documentNumber === mixedScopeReceipt.number)).toMatchObject({
      sourceDocument: ownInvoice.number,
      transactionAmountMinor: '1000',
    });
    expect(JSON.stringify(scopedCustomer)).not.toContain(invoice.number);

    apiActor = scopedStatementActor;
    const scopedCustomerResponse = await request(app.getHttpServer()).get(`/api/sales/customers/${customer.id}`).expect(200);
    expect(JSON.stringify(scopedCustomerResponse.body)).not.toContain(invoice.number);
    expect(scopedCustomerResponse.body.statement.find((row: any) => row.documentNumber === mixedScopeReceipt.number).sourceDocument)
      .toBe(ownInvoice.number);

    apiActor = hiddenDocumentActor;
    const paymentResponse = await request(app.getHttpServer()).get('/api/payments').expect(200);
    expect(paymentResponse.body.find((payment: any) => payment.id === outgoing.id).allocations).toEqual([]);
    expect(paymentResponse.body.find((payment: any) => payment.id === receipt.id).allocations).toEqual([]);
    const customerResponse = await request(app.getHttpServer()).get(`/api/sales/customers/${customer.id}`).expect(200);
    expect(customerResponse.body.payments.find((payment: any) => payment.id === receipt.id).allocations).toEqual([]);
    expect(JSON.stringify(customerResponse.body)).not.toContain(invoice.number);
    const receiptEvidenceResponse = await request(app.getHttpServer()).get(`/api/evidence/${receipt.number}`).expect(200);
    const outgoingEvidenceResponse = await request(app.getHttpServer()).get(`/api/evidence/${outgoing.number}`).expect(200);
    expect(receiptEvidenceResponse.body).toMatchObject({ kind: 'PAYMENT', lines: [] });
    expect(outgoingEvidenceResponse.body).toMatchObject({ kind: 'PAYMENT', lines: [] });
    expect(JSON.stringify([receiptEvidenceResponse.body, outgoingEvidenceResponse.body])).not.toContain(invoice.number);
    expect(JSON.stringify([receiptEvidenceResponse.body, outgoingEvidenceResponse.body])).not.toContain(purchaseBill.number);
  });

  it('rejects through an independent checker without creating allocations or ledger effects', async () => {
    const purchaseBill = await bill();
    const created: any = await erp.createPayment(maker(), paymentBody(purchaseBill.id, '25.00'));
    const paymentId = BigInt(created.id);
    const selfRejector = actor(makerUser, ['payments.payment.create', 'payments.payment.reject', 'purchasing.bill.view']);
    await expect(erp.paymentWorkflow(selfRejector, paymentId, 'reject', { comment: 'Maker cancellation' })).rejects.toThrow(/maker-checker/i);
    await expect(erp.paymentWorkflow(checker(), paymentId, 'reject', { comment: 'x' })).rejects.toThrow(/at least 3/i);

    const rejected: any = await erp.paymentWorkflow(checker(), paymentId, 'reject', { comment: 'Supplier bank details require correction' });
    expect(rejected).toMatchObject({
      status: PaymentStatus.REJECTED,
      rejectedById: checkerUser.id.toString(),
      decisionComment: 'Supplier bank details require correction',
      journalEntryId: null,
    });
    expect(await effects(paymentId, purchaseBill.id)).toMatchObject({ allocationCount: 0, journalCount: 0, paidMinor: 0n });
    expect(await admin.approvalEvent.findMany({ where: { entityType: 'PAYMENT', entityId: paymentId }, orderBy: { id: 'asc' }, select: { action: true, actorId: true } }))
      .toEqual([{ action: 'SUBMIT', actorId: makerUser.id }, { action: 'REJECT', actorId: checkerUser.id }]);
  });
});
