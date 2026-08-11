import { PrismaPg } from '@prisma/adapter-pg';
import { JournalStatus, PrismaClient, WorkflowStatus } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { AccessControlService } from './access-control.service';
import type { Actor } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

type TestUser = { id: bigint; email: string; name: string };
type FieldAccess = 'HIDDEN' | 'VIEW' | 'EDIT';

describe('ERP authorization PostgreSQL regressions', () => {
  let admin: PrismaClient;
  let database: PrismaService;
  let erp: ErpService;
  let access: AccessControlService;
  let governance: { enforceAuthorityLimit: jest.Mock };
  let tenant: { id: bigint };
  let company: { id: bigint };
  let branch: { id: bigint };
  let warehouse: { id: bigint };
  let role: { id: bigint; name: string };
  let owner: TestUser;
  let operator: TestUser;
  let approver: TestUser;
  let customer: { id: bigint };
  let item: { id: bigint };
  let debitAccount: { id: bigint };
  let creditAccount: { id: bigint };
  let bankAccount: { id: bigint };
  let journalOrdinal = 0n;

  const actor = (user: TestUser, input: Partial<Actor> = {}): Actor => ({
    userId: user.id,
    tenantId: tenant.id,
    email: user.email,
    name: user.name,
    role: role.name,
    roleIds: [role.id.toString()],
    permissions: [],
    deniedPermissions: [],
    legacyPermissions: [],
    dataScopes: [],
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

  const fieldActor = (resource: string, field: string, access: FieldAccess) => actor(operator, {
    permissions: resource === 'document'
      ? ['purchasing.request.create', 'purchasing.request.edit']
      : ['accounting.journal.create'],
    dataScopes: resource === 'document'
      ? [{ resource: 'purchase_request', scope: 'ALL' }]
      : [{ resource: 'journal', scope: 'ALL' }, { resource: 'account', scope: 'ALL' }],
    fieldPermissions: [{ resource, field, access }],
  });

  const purchaseRequest = (notes: string) => ({
    type: 'PURCHASE_REQUEST',
    branchId: branch.id.toString(),
    documentDate: '2026-08-10',
    currency: 'EGP',
    notes,
    lines: [{ itemId: item.id.toString(), quantity: '1', unitPrice: '10.00', discount: '0', taxRateBps: 0 }],
  });

  const journalBody = {
    get branchId() { return branch.id.toString(); },
    postingDate: '2026-08-10',
    description: 'Authorization regression journal',
    get lines() {
      return [
        { accountId: debitAccount.id.toString(), description: 'Debit line', debit: '10.00', credit: '0' },
        { accountId: creditAccount.id.toString(), description: 'Credit line', debit: '0', credit: '10.00' },
      ];
    },
  };

  async function createJournalRecord(
    status: JournalStatus,
    createdBy: TestUser,
    label: string,
  ) {
    journalOrdinal += 1n;
    const now = new Date();
    const controlled = status !== JournalStatus.DRAFT;
    const approved = status === JournalStatus.APPROVED || status === JournalStatus.POSTED;
    const posted = status === JournalStatus.POSTED;
    return admin.journalEntry.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      number: `JE-AUTH-${label}-${journalOrdinal}`,
      postingDate: new Date('2026-08-10T00:00:00.000Z'),
      description: `${label} journal`,
      status,
      sourceModule: 'AUTHORIZATION_TEST',
      sourceType: `AUTH_${label}_${journalOrdinal}`,
      sourceId: 90_000n + journalOrdinal,
      sourceNumber: `AUTH-${label}-${journalOrdinal}`,
      createdById: createdBy.id,
      submittedById: controlled ? createdBy.id : null,
      submittedAt: controlled ? now : null,
      approvedById: approved ? owner.id : null,
      approvedAt: approved ? now : null,
      postedById: posted ? owner.id : null,
      postedAt: posted ? now : null,
      lines: { create: [
        { tenantId: tenant.id, accountId: debitAccount.id, description: 'Debit', debitMinor: 1_000n, creditMinor: 0n },
        { tenantId: tenant.id, accountId: creditAccount.id, description: 'Credit', debitMinor: 0n, creditMinor: 1_000n },
      ] },
    } });
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService();
    governance = { enforceAuthorityLimit: jest.fn().mockResolvedValue(undefined) };
    erp = new ErpService(database, governance as any);
    access = new AccessControlService(database);

    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'ERP authorization regression ' } } });
    });

    tenant = await admin.tenant.create({ data: {
      name: `ERP authorization regression ${Date.now()}`,
      baseCurrency: 'EGP',
      makerChecker: true,
    }, select: { id: true } });
    company = await admin.company.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: tenant.id, code: 'DEFAULT' } },
      select: { id: true },
    });
    branch = await admin.branch.create({
      data: { tenantId: tenant.id, code: 'AUTH', name: 'Authorization branch' },
      select: { id: true },
    });
    warehouse = await admin.warehouse.create({
      data: { tenantId: tenant.id, branchId: branch.id, code: 'AUTH-WH', name: 'Authorization warehouse' },
      select: { id: true },
    });
    role = await admin.role.create({
      data: { tenantId: tenant.id, key: 'authorization_test', name: 'Authorization test role', permissions: [] },
      select: { id: true, name: true },
    });
    const createUser = (suffix: string, name: string) => admin.user.create({
      data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `${suffix}-${tenant.id}@odin.test`,
        name,
        passwordHash: 'not-used-by-service-tests',
        branchIds: [branch.id.toString()],
        warehouseIds: [warehouse.id.toString()],
      },
      select: { id: true, email: true, name: true },
    });
    [owner, operator, approver] = await Promise.all([
      createUser('authorization-owner', 'Authorization Owner'),
      createUser('authorization-operator', 'Authorization Operator'),
      createUser('authorization-approver', 'Authorization Approver'),
    ]);

    await admin.currency.create({ data: {
      tenantId: tenant.id, code: 'EGP', name: 'Egyptian Pound', symbol: 'E£',
    } });
    await admin.fiscalPeriod.create({ data: {
      tenantId: tenant.id,
      year: 2026,
      month: 8,
      name: 'August 2026',
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-31T00:00:00.000Z'),
      status: 'OPEN',
    } });
    const category = await admin.itemCategory.create({
      data: { tenantId: tenant.id, code: 'AUTH', name: 'Authorization items' },
    });
    const unit = await admin.unitOfMeasure.create({
      data: { tenantId: tenant.id, code: 'EA', name: 'Each' },
    });
    item = await admin.item.create({
      data: {
        tenantId: tenant.id,
        categoryId: category.id,
        uomId: unit.id,
        sku: 'AUTH-ITEM',
        barcode: 'AUTH-ITEM',
        name: 'Authorization item',
        nameAr: 'صنف اختبار الصلاحيات',
        purchasePriceMinor: 1_000n,
        salePriceMinor: 1_500n,
        taxRateBps: 0,
      },
      select: { id: true },
    });
    customer = await admin.customer.create({
      data: {
        tenantId: tenant.id,
        companyId: company.id,
        code: 'AUTH-CUSTOMER',
        name: 'Authorization Customer',
        city: 'Cairo',
        defaultBranchId: branch.id,
        ownerUserId: owner.id,
      },
      select: { id: true },
    });
    [debitAccount, creditAccount] = await Promise.all([
      admin.account.create({
        data: { tenantId: tenant.id, code: 'AUTH-DR', name: 'Authorization debit', type: 'ASSET' },
        select: { id: true },
      }),
      admin.account.create({
        data: { tenantId: tenant.id, code: 'AUTH-CR', name: 'Authorization credit', type: 'REVENUE' },
        select: { id: true },
      }),
    ]);
    await admin.account.create({
      data: { tenantId: tenant.id, code: '2000', name: 'Accounts payable control', type: 'LIABILITY', controlType: 'AP' },
    });
    bankAccount = await admin.bankAccount.create({
      data: {
        tenantId: tenant.id,
        code: 'AUTH-BANK',
        name: 'Authorization bank',
        type: 'BANK',
        currency: 'EGP',
        glAccountId: debitAccount.id,
        accountNumber: 'AUTH-0001',
      },
      select: { id: true },
    });
    await Promise.all([
      admin.financialResource.findFirstOrThrow({ where: { companyId: company.id, type: 'GL_ACCOUNT', linkedAccountId: debitAccount.id, active: true } }),
      admin.financialResource.findFirstOrThrow({ where: { companyId: company.id, type: 'GL_ACCOUNT', linkedAccountId: creditAccount.id, active: true } }),
      admin.financialResource.findFirstOrThrow({ where: { companyId: company.id, type: 'BANK_ACCOUNT', linkedBankAccountId: bankAccount.id, active: true } }),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (tenant?.id) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: tenant.id } });
      });
    }
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  it('allows only EDIT field access to create or update internal document notes', async () => {
    const hidden = fieldActor('document', 'notes', 'HIDDEN');
    const view = fieldActor('document', 'notes', 'VIEW');
    const edit = fieldActor('document', 'notes', 'EDIT');
    const before = await admin.document.count({ where: { tenantId: tenant.id, type: 'PURCHASE_REQUEST' } });

    await expect(erp.createDocument(hidden, purchaseRequest('Hidden create attempt'))).rejects.toThrow(/read-only/i);
    await expect(erp.createDocument(view, purchaseRequest('View create attempt'))).rejects.toThrow(/read-only/i);
    expect(await admin.document.count({ where: { tenantId: tenant.id, type: 'PURCHASE_REQUEST' } })).toBe(before);

    const created: any = await erp.createDocument(edit, purchaseRequest('Original private note'));
    await expect(erp.updateDocument(hidden, BigInt(created.id), { notes: 'Hidden update attempt' })).rejects.toThrow(/read-only/i);
    await expect(erp.updateDocument(view, BigInt(created.id), { notes: 'View update attempt' })).rejects.toThrow(/read-only/i);
    expect((await admin.document.findUniqueOrThrow({ where: { id: BigInt(created.id) } })).notes).toBe('Original private note');

    await expect(erp.updateDocument(edit, BigInt(created.id), { notes: 'Authorized private note' }))
      .resolves.toMatchObject({ notes: 'Authorized private note' });
    expect((await admin.document.findUniqueOrThrow({ where: { id: BigInt(created.id) } })).notes).toBe('Authorized private note');
  });

  it('allows only EDIT field access to create journal lines', async () => {
    const hidden = fieldActor('journal', 'lines', 'HIDDEN');
    const view = fieldActor('journal', 'lines', 'VIEW');
    const edit = fieldActor('journal', 'lines', 'EDIT');
    const before = await admin.journalEntry.count({ where: { tenantId: tenant.id } });

    await expect(erp.createJournal(hidden, journalBody)).rejects.toThrow(/read-only/i);
    await expect(erp.createJournal(view, journalBody)).rejects.toThrow(/read-only/i);
    expect(await admin.journalEntry.count({ where: { tenantId: tenant.id } })).toBe(before);

    const created: any = await erp.createJournal(edit, journalBody);
    expect(created.lines).toHaveLength(2);
    expect(await admin.journalLine.count({ where: { journalEntryId: BigInt(created.id) } })).toBe(2);
  });

  it('blocks blind journal workflow decisions when journal lines are hidden', async () => {
    const draft = await createJournalRecord(JournalStatus.DRAFT, owner, 'HIDDEN-SUBMIT');
    const submitted = await createJournalRecord(JournalStatus.SUBMITTED, owner, 'HIDDEN-APPROVE');
    const approved = await createJournalRecord(JournalStatus.APPROVED, owner, 'HIDDEN-POST');
    const hidden = actor(operator, {
      permissions: ['accounting.journal.edit', 'accounting.journal.approve', 'accounting.journal.post'],
      dataScopes: [{ resource: 'journal', scope: 'ALL' }],
      fieldPermissions: [{ resource: 'journal', field: 'lines', access: 'HIDDEN' }],
    });

    await expect(erp.journalWorkflow(hidden, draft.id, 'submit')).rejects.toThrow(/read-only/i);
    await expect(erp.journalWorkflow(hidden, submitted.id, 'approve')).rejects.toThrow(/hidden/i);
    await expect(erp.journalWorkflow(hidden, approved.id, 'post')).rejects.toThrow(/hidden/i);

    const unchanged = await admin.journalEntry.findMany({
      where: { id: { in: [draft.id, submitted.id, approved.id] } },
      select: { id: true, status: true },
    });
    expect(new Map(unchanged.map((journal) => [journal.id.toString(), journal.status]))).toEqual(new Map([
      [draft.id.toString(), JournalStatus.DRAFT],
      [submitted.id.toString(), JournalStatus.SUBMITTED],
      [approved.id.toString(), JournalStatus.APPROVED],
    ]));
  });

  it.each(['OWN', 'NONE'] as const)('keeps %s journal scope on every direct-ID mutation', async (scope) => {
    const records = {
      update: await createJournalRecord(JournalStatus.DRAFT, owner, `${scope}-UPDATE`),
      submit: await createJournalRecord(JournalStatus.DRAFT, owner, `${scope}-SUBMIT`),
      approve: await createJournalRecord(JournalStatus.SUBMITTED, owner, `${scope}-APPROVE`),
      post: await createJournalRecord(JournalStatus.APPROVED, owner, `${scope}-POST`),
      reverse: await createJournalRecord(JournalStatus.POSTED, owner, `${scope}-REVERSE`),
    };
    const restricted = actor(operator, {
      permissions: [
        'accounting.journal.create', 'accounting.journal.edit', 'accounting.journal.approve',
        'accounting.journal.reject', 'accounting.journal.post',
      ],
      dataScopes: [{ resource: 'journal', scope }, { resource: 'account', scope: 'ALL' }],
      fieldPermissions: [{ resource: 'journal', field: 'lines', access: 'EDIT' }],
    });

    await expect(erp.updateJournal(restricted, records.update.id, { description: 'Unauthorized update' })).rejects.toThrow(/Journal not found/i);
    await expect(erp.journalWorkflow(restricted, records.submit.id, 'submit')).rejects.toThrow(/Journal not found/i);
    await expect(erp.journalWorkflow(restricted, records.approve.id, 'approve')).rejects.toThrow(/Journal not found/i);
    await expect(erp.journalWorkflow(restricted, records.post.id, 'post')).rejects.toThrow(/Journal not found/i);
    await expect(erp.reverseJournal(restricted, records.reverse.id, { reason: 'Unauthorized reversal' })).rejects.toThrow(/Journal not found/i);

    const persisted = await admin.journalEntry.findMany({
      where: { id: { in: Object.values(records).map(({ id }) => id) } },
      select: { id: true, description: true, status: true, reversedBy: { select: { id: true } } },
    });
    const persistedById = new Map(persisted.map((record) => [record.id.toString(), record]));
    expect(persistedById.get(records.update.id.toString())).toMatchObject({ description: `${scope}-UPDATE journal`, status: JournalStatus.DRAFT, reversedBy: null });
    expect(persistedById.get(records.submit.id.toString())).toMatchObject({ status: JournalStatus.DRAFT, reversedBy: null });
    expect(persistedById.get(records.approve.id.toString())).toMatchObject({ status: JournalStatus.SUBMITTED, reversedBy: null });
    expect(persistedById.get(records.post.id.toString())).toMatchObject({ status: JournalStatus.APPROVED, reversedBy: null });
    expect(persistedById.get(records.reverse.id.toString())).toMatchObject({ status: JournalStatus.POSTED, reversedBy: null });
  });

  it('rechecks assigned GL accounts before creating a reversal', async () => {
    const original = await createJournalRecord(JournalStatus.POSTED, operator, 'ASSIGNED-REVERSAL');
    const assigned = actor(operator, {
      permissions: ['accounting.journal.create'],
      dataScopes: [
        { resource: 'journal', scope: 'OWN' },
        { resource: 'account', scope: 'ASSIGNED', config: { resourceIds: [debitAccount.id.toString()] } },
      ],
      fieldPermissions: [{ resource: 'journal', field: 'lines', access: 'EDIT' }],
    });

    await expect(erp.reverseJournal(assigned, original.id, { reason: 'Authorized correction request' }))
      .rejects.toThrow(/account.*outside|outside.*account/i);
    await expect(admin.journalEntry.findFirst({ where: { reversesEntryId: original.id } })).resolves.toBeNull();
  });

  it('omits dependent customer data unless every related permission and scope is effective', async () => {
    const paymentJournal = await createJournalRecord(JournalStatus.POSTED, owner, 'CUSTOMER-PAYMENT');
    const invoice = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'SALES_INVOICE',
      number: 'SI-AUTH-DETAIL',
      status: WorkflowStatus.POSTED,
      branchId: branch.id,
      customerId: customer.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
      subtotalMinor: 10_000n,
      totalMinor: 10_000n,
      paidMinor: 4_000n,
      createdById: owner.id,
      postedById: owner.id,
      postedAt: new Date(),
    } });
    const payment = await admin.payment.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      kind: 'RECEIPT',
      status: 'POSTED',
      partyType: 'CUSTOMER',
      customerId: customer.id,
      bankAccountId: bankAccount.id,
      number: 'RC-AUTH-DETAIL',
      postingDate: new Date('2026-08-10T00:00:00.000Z'),
      amountMinor: 4_000n,
      method: 'BANK',
      journalEntryId: paymentJournal.id,
      createdById: owner.id,
      allocations: { create: { tenantId: tenant.id, documentId: invoice.id, amountMinor: 4_000n } },
    } });
    await admin.auditEvent.create({ data: {
      tenantId: tenant.id,
      userId: owner.id,
      action: 'CUSTOMER_REVIEWED',
      entityType: 'CUSTOMER',
      entityId: customer.id.toString(),
      companyId: company.id.toString(),
      branchId: branch.id,
      newValues: { paymentId: payment.id.toString() },
    } });

    const customerOnly = actor(operator, {
      permissions: ['sales.customer.view'],
      dataScopes: [{ resource: 'customer', scope: 'ALL' }],
      fieldPermissions: [{ resource: 'customer', field: 'balanceMinor', access: 'VIEW' }],
    });
    const restricted: any = await erp.customerDetail(customerOnly, customer.id);
    for (const field of ['documents', 'payments', 'outstandingMinor', 'statement', 'ageing', 'audit']) {
      expect(restricted).not.toHaveProperty(field);
    }

    const full = actor(approver, {
      permissions: ['sales.customer.view', 'sales.invoice.view', 'payments.receipt.view', 'audit.business.view'],
      dataScopes: [
        { resource: 'customer', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'payment', scope: 'ALL' },
        { resource: 'journal', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
      fieldPermissions: [
        { resource: 'customer', field: 'balanceMinor', access: 'VIEW' },
        { resource: 'bankAccount', field: 'accountNumber', access: 'VIEW' },
        { resource: 'journal', field: 'lines', access: 'VIEW' },
        { resource: 'audit', field: 'values', access: 'VIEW' },
        { resource: 'audit', field: 'metadata', access: 'VIEW' },
        { resource: 'audit', field: 'references', access: 'VIEW' },
      ],
    });
    const visible: any = await erp.customerDetail(full, customer.id);
    expect(visible.documents.map((document: any) => document.number)).toEqual(['SI-AUTH-DETAIL']);
    expect(visible.payments.map((row: any) => row.number)).toEqual(['RC-AUTH-DETAIL']);
    expect(visible.outstandingMinor).toBe('6000');
    expect(visible.statement).toHaveLength(2);
    expect(visible.ageing).toHaveLength(1);
    expect(visible.audit.map((event: any) => event.action)).toContain('CUSTOMER_REVIEWED');
  });

  it.each([
    ['ar-aging', 'reports.standard.view', 'sales.customer.view', 'sales.invoice.view'],
    ['ap-aging', 'reports.standard.view', 'purchasing.supplier.view', 'purchasing.bill.view'],
    ['inventory-valuation', 'reports.standard.view', 'inventory.overview.view', 'inventory.item.view'],
    ['sales-profitability', 'reports.profitability.view', 'sales.invoice.view', 'sales.overview.view'],
  ])('requires both compound dependencies for %s', async (reportName, reportPermission, first, second) => {
    const reportActor = (dependency: string) => actor(operator, {
      permissions: [reportPermission, dependency],
      dataScopes: [{ resource: 'report', scope: 'ALL' }],
      fieldPermissions: [
        { resource: 'customer', field: 'balanceMinor', access: 'VIEW' },
        { resource: 'document', field: 'costMinor', access: 'VIEW' },
        { resource: 'item', field: 'costPriceMinor', access: 'VIEW' },
      ],
    });

    await expect(erp.report(reportActor(first), reportName)).rejects.toThrow(/dependency permission/i);
    await expect(erp.report(reportActor(second), reportName)).rejects.toThrow(/dependency permission/i);
  });

  it('requires customer and delivery permission in the same branch before returning profitability data', async () => {
    const missingCustomer = actor(operator, {
      permissions: ['reports.profitability.view', 'sales.invoice.view', 'sales.delivery.view', 'sales.overview.view'],
      dataScopes: [
        { resource: 'report', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'delivery', scope: 'ALL' },
        { resource: 'customer', scope: 'ALL' },
      ],
      fieldPermissions: [{ resource: 'document', field: 'costMinor', access: 'VIEW' }],
    });
    await expect(erp.report(missingCustomer, 'sales-profitability')).rejects.toThrow(/dependency permission/i);

    const missingDelivery = actor(operator, {
      permissions: ['reports.profitability.view', 'sales.invoice.view', 'sales.customer.view', 'sales.overview.view'],
      dataScopes: [
        { resource: 'report', scope: 'ALL' },
        { resource: 'invoice', scope: 'ALL' },
        { resource: 'delivery', scope: 'ALL' },
        { resource: 'customer', scope: 'ALL' },
      ],
      fieldPermissions: [{ resource: 'document', field: 'costMinor', access: 'VIEW' }],
    });
    await expect(erp.report(missingDelivery, 'sales-profitability')).rejects.toThrow(/dependency permission/i);
  });

  it('requires every actual statement and reconciliation source permission in the same branch', async () => {
    const scopedActor = (permissions: string[]) => actor(operator, {
      permissions,
      dataScopes: [
        { resource: 'report', scope: 'ALL' }, { resource: 'invoice', scope: 'ALL' },
        { resource: 'return', scope: 'ALL' }, { resource: 'credit_note', scope: 'ALL' },
        { resource: 'customer', scope: 'ALL' }, { resource: 'payment', scope: 'ALL' },
        { resource: 'bill', scope: 'ALL' }, { resource: 'purchase_return', scope: 'ALL' },
        { resource: 'supplier', scope: 'ALL' }, { resource: 'journal', scope: 'ALL' },
        { resource: 'account', scope: 'ALL' }, { resource: 'item', scope: 'ALL' },
        { resource: 'warehouse', scope: 'ALL' },
      ],
      fieldPermissions: [
        { resource: 'customer', field: 'balanceMinor', access: 'VIEW' },
        { resource: 'journal', field: 'lines', access: 'VIEW' },
        { resource: 'document', field: 'costMinor', access: 'VIEW' },
      ],
    });
    const customerStatementDependencies = [
      'reports.standard.view', 'sales.customer.view', 'sales.invoice.view',
      'sales.return.view', 'sales.credit_note.view', 'payments.receipt.view',
    ];
    await expect(erp.report(scopedActor(customerStatementDependencies.filter((permission) => permission !== 'payments.receipt.view')), 'customer-statement'))
      .rejects.toThrow(/dependency permission/i);
    const supplierStatementDependencies = [
      'reports.standard.view', 'purchasing.supplier.view', 'purchasing.bill.view',
      'purchasing.return.view', 'payments.payment.view',
    ];
    await expect(erp.report(scopedActor(supplierStatementDependencies.filter((permission) => permission !== 'payments.payment.view')), 'supplier-statement'))
      .rejects.toThrow(/dependency permission/i);
    await expect(erp.report(scopedActor(supplierStatementDependencies.filter((permission) => permission !== 'purchasing.return.view')), 'purchase-analysis'))
      .rejects.toThrow(/dependency permission/i);

    const reconciliationDependencies = [
      'reports.standard.view', 'accounting.journal.view', 'sales.customer.view', 'sales.invoice.view',
      'purchasing.supplier.view', 'purchasing.bill.view', 'inventory.overview.view', 'inventory.item.view',
    ];
    for (const omitted of reconciliationDependencies.slice(1)) {
      await expect(erp.report(scopedActor(reconciliationDependencies.filter((permission) => permission !== omitted)), 'reconciliation'))
        .rejects.toThrow(/dependency permission/i);
    }
  });

  it('intersects report ALL with persisted invoice, bill, journal, and customer NONE/OWN scopes', async () => {
    const scopedCustomer = await admin.customer.create({ data: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'AUTH-REPORT-CUSTOMER',
      name: 'Authorization Report Customer',
      city: 'Cairo',
      defaultBranchId: branch.id,
      ownerUserId: operator.id,
    } });
    const supplier = await admin.supplier.create({ data: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'AUTH-REPORT-SUPPLIER',
      name: 'Authorization Report Supplier',
      city: 'Cairo',
    } });
    const unassignedSupplier = await admin.supplier.create({ data: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'AUTH-REPORT-SUPPLIER-OUTSIDE',
      name: 'Authorization Unassigned Supplier',
      city: 'Cairo',
    } });
    const documentDate = new Date('2026-08-01T00:00:00.000Z');
    const [ownerDelivery, operatorDelivery] = await Promise.all([
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'DELIVERY_NOTE', number: 'DN-AUTH-REPORT-OWNER', status: WorkflowStatus.POSTED,
        branchId: branch.id, customerId: customer.id, documentDate, costMinor: 3_000n,
        createdById: owner.id, postedById: owner.id, postedAt: new Date(),
      } }),
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'DELIVERY_NOTE', number: 'DN-AUTH-REPORT-OPERATOR', status: WorkflowStatus.POSTED,
        branchId: branch.id, customerId: scopedCustomer.id, documentDate, costMinor: 4_000n,
        createdById: operator.id, postedById: operator.id, postedAt: new Date(),
      } }),
    ]);
    const [ownerInvoice, operatorInvoice, ownerBill, operatorBill] = await Promise.all([
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'SALES_INVOICE', number: 'SI-AUTH-REPORT-OWNER', status: WorkflowStatus.POSTED,
        branchId: branch.id, customerId: customer.id, sourceDocumentId: ownerDelivery.id, documentDate, dueDate: documentDate,
        subtotalMinor: 11_000n, totalMinor: 11_000n, createdById: owner.id, postedById: owner.id, postedAt: new Date(),
      } }),
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'SALES_INVOICE', number: 'SI-AUTH-REPORT-OPERATOR', status: WorkflowStatus.POSTED,
        branchId: branch.id, customerId: scopedCustomer.id, sourceDocumentId: operatorDelivery.id, documentDate, dueDate: documentDate,
        subtotalMinor: 12_000n, totalMinor: 12_000n, createdById: operator.id, postedById: operator.id, postedAt: new Date(),
      } }),
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'PURCHASE_BILL', number: 'PB-AUTH-REPORT-OWNER', status: WorkflowStatus.POSTED,
        branchId: branch.id, supplierId: supplier.id, documentDate, dueDate: documentDate,
        subtotalMinor: 13_000n, totalMinor: 13_000n, createdById: owner.id, postedById: owner.id, postedAt: new Date(),
      } }),
      admin.document.create({ data: {
        tenantId: tenant.id, type: 'PURCHASE_BILL', number: 'PB-AUTH-REPORT-OPERATOR', status: WorkflowStatus.POSTED,
        branchId: branch.id, supplierId: supplier.id, documentDate, dueDate: documentDate,
        subtotalMinor: 14_000n, totalMinor: 14_000n, createdById: operator.id, postedById: operator.id, postedAt: new Date(),
      } }),
    ]);
    const [ownerJournal, operatorJournal] = await Promise.all([
      createJournalRecord(JournalStatus.POSTED, owner, 'REPORT-OWNER'),
      createJournalRecord(JournalStatus.POSTED, operator, 'REPORT-OPERATOR'),
    ]);
    const unassignedSupplierBill = await admin.document.create({ data: {
      tenantId: tenant.id, type: 'PURCHASE_BILL', number: 'PB-AUTH-REPORT-UNASSIGNED-SUPPLIER', status: WorkflowStatus.POSTED,
      branchId: branch.id, supplierId: unassignedSupplier.id, documentDate, dueDate: documentDate,
      subtotalMinor: 15_000n, totalMinor: 15_000n, createdById: operator.id, postedById: operator.id, postedAt: new Date(),
    } });
    const crossCreatorReturn = await admin.document.create({ data: {
      tenantId: tenant.id, type: 'PURCHASE_RETURN', number: 'PR-AUTH-REPORT-CROSS-CREATOR', status: WorkflowStatus.POSTED,
      branchId: branch.id, supplierId: supplier.id, sourceDocumentId: operatorBill.id, documentDate,
      subtotalMinor: 1_000n, totalMinor: 1_000n, createdById: owner.id, postedById: owner.id, postedAt: new Date(),
    } });
    const ownerReceipt = await admin.payment.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      kind: 'RECEIPT',
      status: 'POSTED',
      partyType: 'CUSTOMER',
      customerId: customer.id,
      bankAccountId: bankAccount.id,
      number: 'RC-AUTH-REPORT-OWNER',
      postingDate: documentDate,
      amountMinor: 1_000n,
      method: 'BANK',
      journalEntryId: ownerJournal.id,
      createdById: owner.id,
      allocations: { create: { tenantId: tenant.id, documentId: ownerInvoice.id, amountMinor: 1_000n } },
    } });
    const reportPermissions = [
      'reports.standard.view', 'reports.profitability.view', 'sales.customer.view', 'sales.invoice.view', 'sales.delivery.view', 'sales.overview.view',
      'sales.return.view', 'sales.credit_note.view', 'payments.receipt.view',
      'purchasing.supplier.view', 'purchasing.bill.view', 'purchasing.return.view', 'payments.payment.view',
      'accounting.journal.view',
    ];
    const baseScopes: Actor['dataScopes'] = [
      { resource: 'report', scope: 'ALL' },
      { resource: 'invoice', scope: 'ALL' },
      { resource: 'delivery', scope: 'ALL' },
      { resource: 'return', scope: 'ALL' },
      { resource: 'credit_note', scope: 'ALL' },
      { resource: 'bill', scope: 'ALL' },
      { resource: 'purchase_return', scope: 'ALL' },
      { resource: 'journal', scope: 'ALL' },
      { resource: 'customer', scope: 'ALL' },
      { resource: 'supplier', scope: 'ALL' },
      { resource: 'payment', scope: 'ALL' },
      { resource: 'account', scope: 'ALL' },
    ];
    const reportActor = (resource: string, scope: Actor['dataScopes'][number]['scope'], config?: unknown) => actor(operator, {
      permissions: reportPermissions,
      dataScopes: baseScopes.map((entry) => entry.resource === resource ? { ...entry, scope, ...(config ? { config } : {}) } : entry),
      fieldPermissions: [
        { resource: 'customer', field: 'balanceMinor', access: 'VIEW' },
        { resource: 'journal', field: 'lines', access: 'VIEW' },
        { resource: 'document', field: 'costMinor', access: 'VIEW' },
      ],
    });

    const noInvoices: any = await erp.report(reportActor('invoice', 'NONE'), 'ar-aging');
    expect(noInvoices.rows).toEqual([]);
    const ownInvoices: any = await erp.report(reportActor('invoice', 'OWN'), 'ar-aging');
    expect(ownInvoices.rows.map((row: any) => row.number)).toContain(operatorInvoice.number);
    expect(ownInvoices.rows.map((row: any) => row.number)).not.toContain(ownerInvoice.number);

    const noBills: any = await erp.report(reportActor('bill', 'NONE'), 'ap-aging');
    expect(noBills.rows).toEqual([]);
    const ownBills: any = await erp.report(reportActor('bill', 'OWN'), 'ap-aging');
    expect(ownBills.rows.map((row: any) => row.number)).toContain(operatorBill.number);
    expect(ownBills.rows.map((row: any) => row.number)).not.toContain(ownerBill.number);
    expect(ownBills.rows.find((row: any) => row.number === operatorBill.number)?.outstandingMinor).toBe('13000');

    for (const reportName of ['ap-aging', 'supplier-statement', 'purchase-analysis']) {
      const noSuppliers: any = await erp.report(reportActor('supplier', 'NONE'), reportName);
      expect(noSuppliers.rows).toEqual([]);
      const assignedSupplier: any = await erp.report(reportActor('supplier', 'ASSIGNED', { resourceIds: [supplier.id.toString()] }), reportName);
      expect(assignedSupplier.rows.map((row: any) => row.number || row.reference)).not.toContain(unassignedSupplierBill.number);
      expect(assignedSupplier.rows.length).toBeGreaterThan(0);
    }

    for (const reportName of ['supplier-statement', 'purchase-analysis']) {
      const noReturns: any = await erp.report(reportActor('purchase_return', 'NONE'), reportName);
      expect(noReturns.rows.map((row: any) => row.reference || row.number)).not.toContain(crossCreatorReturn.number);
      const allReturns: any = await erp.report(reportActor('purchase_return', 'ALL'), reportName);
      expect(allReturns.rows.map((row: any) => row.reference || row.number)).toContain(crossCreatorReturn.number);
    }

    const noJournals: any = await erp.report(reportActor('journal', 'NONE'), 'general-ledger');
    expect(noJournals.rows).toEqual([]);
    const noJournalBalanceSheet: any = await erp.report(reportActor('journal', 'NONE'), 'balance-sheet');
    expect(noJournalBalanceSheet.rows).toEqual([]);
    const noReportBalanceSheet: any = await erp.report(reportActor('report', 'NONE'), 'balance-sheet');
    expect(noReportBalanceSheet.rows).toEqual([]);
    const ownJournals: any = await erp.report(reportActor('journal', 'OWN'), 'general-ledger');
    expect(ownJournals.rows.map((row: any) => row.journal)).toContain(operatorJournal.number);
    expect(ownJournals.rows.map((row: any) => row.journal)).not.toContain(ownerJournal.number);

    const noCustomers: any = await erp.report(reportActor('customer', 'NONE'), 'customer-balances');
    expect(noCustomers.rows).toEqual([]);
    const ownCustomers: any = await erp.report(reportActor('customer', 'OWN'), 'customer-balances');
    expect(ownCustomers.rows.map((row: any) => row.customerCode)).toContain(scopedCustomer.code);
    expect(ownCustomers.rows.map((row: any) => row.customerCode)).not.toContain('AUTH-CUSTOMER');
    const noProfitabilityCustomers: any = await erp.report(reportActor('customer', 'NONE'), 'sales-profitability');
    expect(noProfitabilityCustomers.rows).toEqual([]);
    const ownProfitabilityCustomers: any = await erp.report(reportActor('customer', 'OWN'), 'sales-profitability');
    expect(ownProfitabilityCustomers.rows.map((row: any) => row.number)).toContain(operatorInvoice.number);
    expect(ownProfitabilityCustomers.rows.map((row: any) => row.number)).not.toContain(ownerInvoice.number);
    expect(ownProfitabilityCustomers.rows.find((row: any) => row.number === operatorInvoice.number)).toMatchObject({
      costMinor: '4000',
      marginMinor: '8000',
    });
    const noDeliveryProfitability: any = await erp.report(reportActor('delivery', 'NONE'), 'sales-profitability');
    expect(noDeliveryProfitability.rows).toEqual([]);
    const ownDeliveryProfitability: any = await erp.report(reportActor('delivery', 'OWN'), 'sales-profitability');
    expect(ownDeliveryProfitability.rows.map((row: any) => row.number)).toContain(operatorInvoice.number);
    expect(ownDeliveryProfitability.rows.map((row: any) => row.number)).not.toContain(ownerInvoice.number);

    const noReceiptScope: any = await erp.report(reportActor('payment', 'NONE'), 'customer-statement');
    expect(noReceiptScope.rows.map((row: any) => row.documentNumber)).not.toContain(ownerReceipt.number);
    const allReceiptScope: any = await erp.report(reportActor('payment', 'ALL'), 'customer-statement');
    expect(allReceiptScope.rows.map((row: any) => row.documentNumber)).toContain(ownerReceipt.number);

    const paymentMaker = actor(owner, {
      permissions: ['payments.payment.create', 'purchasing.bill.view'],
      dataScopes: [
        { resource: 'payment', scope: 'ALL' }, { resource: 'bill', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const paymentChecker = actor(approver, {
      permissions: ['payments.payment.approve', 'purchasing.bill.view'],
      dataScopes: [
        { resource: 'payment', scope: 'ALL' }, { resource: 'bill', scope: 'ALL' },
        { resource: 'bank_account', scope: 'ALL' },
      ],
    });
    const mixedPayment: any = await erp.createPayment(paymentMaker, {
      kind: 'PAYMENT', branchId: branch.id.toString(), bankAccountId: bankAccount.id.toString(),
      postingDate: '2026-08-01', amount: '20.00', method: 'BANK',
      allocations: [
        { documentId: ownerBill.id.toString(), amount: '10.00' },
        { documentId: operatorBill.id.toString(), amount: '10.00' },
      ],
    });
    await erp.paymentWorkflow(paymentChecker, BigInt(mixedPayment.id), 'approve');
    const ownBillStatement: any = await erp.report(reportActor('bill', 'OWN'), 'supplier-statement');
    const scopedPaymentRow = ownBillStatement.rows.find((row: any) => row.reference === mixedPayment.number);
    expect(scopedPaymentRow?.creditMinor).toBe('1000');
    const noBillStatement: any = await erp.report(reportActor('bill', 'NONE'), 'supplier-statement');
    expect(noBillStatement.rows.map((row: any) => row.reference)).not.toContain(mixedPayment.number);
  });

  it('intersects inventory item/report and POS terminal/report scopes with persisted records', async () => {
    await admin.stockBalance.upsert({
      where: { tenantId_warehouseId_itemId: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id } },
      create: { tenantId: tenant.id, warehouseId: warehouse.id, itemId: item.id, quantityMilli: 2_000n, valueMinor: 2_000n },
      update: { quantityMilli: 2_000n, valueMinor: 2_000n },
    });
    await admin.stockMovement.create({ data: {
      tenantId: tenant.id,
      branchId: branch.id,
      warehouseId: warehouse.id,
      itemId: item.id,
      postingDate: new Date('2026-08-01T00:00:00.000Z'),
      quantityInMilli: 2_000n,
      unitCostMinor: 1_000n,
      totalCostMinor: 2_000n,
      runningQuantityMilli: 2_000n,
      runningValueMinor: 2_000n,
      sourceType: 'AUTHORIZATION_REPORT',
      sourceId: 98_001n,
      sourceNumber: 'AUTH-STOCK-REPORT',
      createdById: operator.id,
    } });
    const [ownerShift, operatorShift] = await Promise.all([
      admin.posShift.create({ data: {
        tenantId: tenant.id, branchId: branch.id, warehouseId: warehouse.id,
        registerCode: 'AUTH-REPORT-OWNER', openedById: owner.id, openingCashMinor: 1_000n,
      } }),
      admin.posShift.create({ data: {
        tenantId: tenant.id, branchId: branch.id, warehouseId: warehouse.id,
        registerCode: 'AUTH-REPORT-OPERATOR', openedById: operator.id, openingCashMinor: 1_000n,
      } }),
    ]);
    const reportPermissions = [
      'reports.standard.view', 'inventory.overview.view', 'inventory.item.view', 'inventory.warehouse.view',
      'pos.shift.view', 'pos.sale.view',
    ];
    const baseScopes: Actor['dataScopes'] = [
        { resource: 'report', scope: 'ALL' },
        { resource: 'item', scope: 'ALL' },
        { resource: 'warehouse', scope: 'ALL' },
        { resource: 'pos_terminal', scope: 'ALL' },
        { resource: 'journal', scope: 'ALL' },
        { resource: 'account', scope: 'ALL' },
    ];
    const scoped = (overrides: Actor['dataScopes']) => actor(operator, {
      permissions: reportPermissions,
      dataScopes: baseScopes.map((entry) => overrides.find((override) => override.resource === entry.resource) || entry),
      fieldPermissions: [
        { resource: 'document', field: 'costMinor', access: 'VIEW' },
        { resource: 'item', field: 'costPriceMinor', access: 'VIEW' },
      ],
    });

    for (const reportName of ['inventory-valuation', 'stock-movements']) {
      const noItems: any = await erp.report(scoped([{ resource: 'item', scope: 'NONE' }]), reportName);
      expect(noItems.rows).toEqual([]);
      const missingItemActor = scoped([]);
      missingItemActor.dataScopes = missingItemActor.dataScopes.filter((entry) => entry.resource !== 'item');
      const missingItems: any = await erp.report(missingItemActor, reportName);
      expect(missingItems.rows).toEqual([]);
      const assignedItem: any = await erp.report(scoped([{ resource: 'item', scope: 'ASSIGNED', config: { resourceIds: [item.id.toString()] } }]), reportName);
      expect(assignedItem.rows.length).toBeGreaterThan(0);
      const ownReport: any = await erp.report(scoped([{ resource: 'report', scope: 'OWN' }]), reportName);
      expect(ownReport.rows).toEqual([]);
    }

    const noTerminals: any = await erp.report(scoped([{ resource: 'pos_terminal', scope: 'NONE' }]), 'pos-shifts');
    expect(noTerminals.rows).toEqual([]);
    const ownTerminal: any = await erp.report(scoped([{ resource: 'pos_terminal', scope: 'OWN' }]), 'pos-shifts');
    expect(ownTerminal.rows.map((row: any) => row.register)).toContain(operatorShift.registerCode);
    expect(ownTerminal.rows.map((row: any) => row.register)).not.toContain(ownerShift.registerCode);
    const assignedTerminal: any = await erp.report(scoped([{
      resource: 'pos_terminal', scope: 'ASSIGNED', config: { resourceIds: [operatorShift.id.toString()] },
    }]), 'pos-shifts');
    expect(assignedTerminal.rows.map((row: any) => row.register)).toEqual([operatorShift.registerCode]);
    const ownPosReport: any = await erp.report(scoped([{ resource: 'report', scope: 'OWN' }]), 'pos-shifts');
    expect(ownPosReport.rows.map((row: any) => row.register)).toContain(operatorShift.registerCode);
    expect(ownPosReport.rows.map((row: any) => row.register)).not.toContain(ownerShift.registerCode);
  });

  it('never OR-widens persisted audit rows across company and branch mismatches', async () => {
    const outsideCompany = await admin.company.create({ data: {
      tenantId: tenant.id,
      code: 'AUTH-OUTSIDE',
      name: 'Authorization Outside Company',
      baseCurrency: 'EGP',
    } });
    const outsideBranch = await admin.branch.create({ data: {
      tenantId: tenant.id,
      code: 'AUTH-OUTSIDE',
      name: 'Authorization Outside Branch',
    } });
    const secondAllowedCompany = await admin.company.create({ data: {
      tenantId: tenant.id,
      code: 'AUTH-SECOND-ALLOWED',
      name: 'Authorization Second Allowed Company',
      baseCurrency: 'EGP',
    } });
    const secondAllowedBranch = await admin.branch.create({ data: {
      tenantId: tenant.id,
      code: 'AUTH-SECOND-ALLOWED',
      name: 'Authorization Second Allowed Branch',
    } });
    await admin.companyBranch.update({
      where: { branchId: secondAllowedBranch.id },
      data: { companyId: secondAllowedCompany.id },
    });
    const actions = {
      visible: 'AUTH_AUDIT_VISIBLE',
      wrongBranch: 'AUTH_AUDIT_WRONG_BRANCH',
      wrongCompany: 'AUTH_AUDIT_WRONG_COMPANY',
      crossedAllowedPair: 'AUTH_AUDIT_CROSSED_ALLOWED_PAIR',
      documentVisible: 'AUTH_DOCUMENT_AUDIT_VISIBLE',
      documentWrongBranch: 'AUTH_DOCUMENT_AUDIT_WRONG_BRANCH',
      documentWrongCompany: 'AUTH_DOCUMENT_AUDIT_WRONG_COMPANY',
    };
    const auditDocument = await admin.document.create({ data: {
      tenantId: tenant.id, type: 'SALES_INVOICE', number: 'SI-AUTH-AUDIT-SCOPE', status: WorkflowStatus.POSTED,
      branchId: branch.id, customerId: customer.id, documentDate: new Date('2026-08-01T00:00:00.000Z'),
      subtotalMinor: 1_000n, totalMinor: 1_000n, createdById: owner.id, postedById: owner.id, postedAt: new Date(),
    } });
    await admin.auditEvent.createMany({ data: [
      {
        tenantId: tenant.id, userId: owner.id, action: actions.visible, entityType: 'CUSTOMER', entityId: customer.id.toString(),
        companyId: company.id.toString(), branchId: branch.id,
      },
      {
        tenantId: tenant.id, userId: operator.id, action: actions.wrongBranch, entityType: 'CUSTOMER', entityId: customer.id.toString(),
        companyId: company.id.toString(), branchId: outsideBranch.id,
      },
      {
        tenantId: tenant.id, userId: operator.id, action: actions.wrongCompany, entityType: 'CUSTOMER', entityId: customer.id.toString(),
        companyId: outsideCompany.id.toString(), branchId: branch.id,
      },
      {
        tenantId: tenant.id, userId: operator.id, action: actions.crossedAllowedPair, entityType: 'CUSTOMER', entityId: customer.id.toString(),
        companyId: company.id.toString(), branchId: secondAllowedBranch.id,
      },
      {
        tenantId: tenant.id, userId: owner.id, action: actions.documentVisible, entityType: 'DOCUMENT', entityId: auditDocument.id.toString(),
        companyId: company.id.toString(), branchId: branch.id,
      },
      {
        tenantId: tenant.id, userId: operator.id, action: actions.documentWrongBranch, entityType: 'DOCUMENT', entityId: auditDocument.id.toString(),
        companyId: company.id.toString(), branchId: outsideBranch.id,
      },
      {
        tenantId: tenant.id, userId: operator.id, action: actions.documentWrongCompany, entityType: 'DOCUMENT', entityId: auditDocument.id.toString(),
        companyId: outsideCompany.id.toString(), branchId: branch.id,
      },
    ] });
    const scoped = actor(operator, {
      permissions: [],
      branchIds: [branch.id.toString(), secondAllowedBranch.id.toString()],
      companyIds: [company.id.toString(), secondAllowedCompany.id.toString()],
      companyBranchIds: {
        [company.id.toString()]: [branch.id.toString()],
        [secondAllowedCompany.id.toString()]: [secondAllowedBranch.id.toString()],
      },
      companyScopedPermissions: {
        [company.id.toString()]: ['audit.business.view', 'dashboard.overview.view', 'sales.customer.view', 'sales.invoice.view'],
        [secondAllowedCompany.id.toString()]: ['audit.business.view', 'dashboard.overview.view', 'sales.customer.view', 'sales.invoice.view'],
      },
      dataScopes: [
        { resource: 'customer', scope: 'ALL' }, { resource: 'invoice', scope: 'ALL' },
        { resource: 'report', scope: 'ALL' },
      ],
      fieldPermissions: [
        { resource: 'audit', field: 'values', access: 'VIEW' },
        { resource: 'audit', field: 'metadata', access: 'VIEW' },
        { resource: 'audit', field: 'references', access: 'VIEW' },
      ],
    });

    const audit: any = await erp.auditLog(scoped);
    expect(audit.map((entry: any) => entry.action)).toContain(actions.visible);
    expect(audit.map((entry: any) => entry.action)).not.toEqual(expect.arrayContaining([
      actions.wrongBranch,
      actions.wrongCompany,
      actions.crossedAllowedPair,
    ]));

    const dashboard: any = await erp.dashboard(scoped);
    expect(dashboard.activity.map((entry: any) => entry.action)).toContain(actions.visible);
    expect(dashboard.activity.map((entry: any) => entry.action)).not.toEqual(expect.arrayContaining([
      actions.wrongBranch,
      actions.wrongCompany,
      actions.crossedAllowedPair,
    ]));

    const detail: any = await erp.customerDetail(scoped, customer.id);
    expect(detail.audit.map((entry: any) => entry.action)).toContain(actions.visible);
    expect(detail.audit.map((entry: any) => entry.action)).not.toEqual(expect.arrayContaining([
      actions.wrongBranch,
      actions.wrongCompany,
      actions.crossedAllowedPair,
    ]));

    const documentDetail: any = await erp.documentDetail(scoped, auditDocument.id);
    expect(documentDetail.audit.map((entry: any) => entry.action)).toContain(actions.documentVisible);
    expect(documentDetail.audit.map((entry: any) => entry.action)).not.toEqual(expect.arrayContaining([
      actions.documentWrongBranch,
      actions.documentWrongCompany,
    ]));
  });

  it('checks discount authority under the exact sales.discount_percent policy key', async () => {
    const quotation = await admin.document.create({ data: {
      tenantId: tenant.id,
      type: 'QUOTATION',
      number: 'QT-AUTH-DISCOUNT',
      status: WorkflowStatus.SUBMITTED,
      branchId: branch.id,
      documentDate: new Date('2026-08-10T00:00:00.000Z'),
      currency: 'EGP',
      subtotalMinor: 10_000n,
      discountMinor: 1_000n,
      totalMinor: 9_000n,
      createdById: owner.id,
      submittedById: owner.id,
      submittedAt: new Date(),
    } });
    const discountApprover = actor(approver, {
      permissions: ['sales.quotation.approve'],
      dataScopes: [{ resource: 'quotation', scope: 'ALL' }],
      limits: { 'sales.discount_percent': 100, 'sales.quotation_amount_minor': 1_000_000 },
    });
    governance.enforceAuthorityLimit.mockClear();

    await expect(erp.workflow(discountApprover, quotation.id, 'approve')).resolves.toMatchObject({ status: WorkflowStatus.APPROVED });
    expect(governance.enforceAuthorityLimit).toHaveBeenCalledWith(
      expect.anything(),
      discountApprover,
      expect.objectContaining({
        companyId: company.id,
        branchId: branch.id,
        key: 'sales.discount_percent',
        currency: 'EGP',
        percentBps: 1_000,
        documentType: 'QUOTATION',
      }),
    );
  });

  it('surfaces SoD WARN conflicts and rolls back BLOCK conflicts on role mutations', async () => {
    await admin.sodRule.createMany({ data: [
      {
        tenantId: tenant.id,
        key: 'authorization-warn-role',
        name: 'Customer maker and approver warning',
        description: 'Warn when customer maker and approver permissions are combined.',
        leftPermissions: ['sales.customer.create'],
        rightPermissions: ['sales.customer.approve'],
        enforcement: 'WARN',
      },
      {
        tenantId: tenant.id,
        key: 'authorization-block-role',
        name: 'Journal maker and poster block',
        description: 'Block journal maker and poster permissions from being combined.',
        leftPermissions: ['accounting.journal.create'],
        rightPermissions: ['accounting.journal.post'],
        enforcement: 'BLOCK',
      },
    ] });
    const administrator = actor(owner, { permissions: ['system.super_admin'], legacyPermissions: ['*'] });
    const warned = await access.createRole(administrator, {
      name: 'Authorization warned role',
      permissionKeys: ['sales.customer.create', 'sales.customer.approve'],
    }, { requestId: 'authorization-role-warn' });
    expect(warned.sodWarnings).toEqual([
      expect.objectContaining({ ruleKey: 'authorization-warn-role', enforcement: 'WARN' }),
    ]);
    expect(await admin.rolePermission.count({ where: { roleId: BigInt(warned.id) } })).toBe(2);

    await expect(access.createRole(administrator, {
      name: 'Authorization blocked role',
      permissionKeys: ['accounting.journal.create', 'accounting.journal.post'],
    }, { requestId: 'authorization-role-block' })).rejects.toThrow(/blocking segregation-of-duties/i);
    await expect(admin.role.findFirst({ where: { tenantId: tenant.id, name: 'Authorization blocked role' } })).resolves.toBeNull();
  });

  it('surfaces SoD WARN conflicts and preserves prior user access after a BLOCK conflict', async () => {
    const [warnPrimary, warnAdditional, blockPrimary, blockAdditional] = await Promise.all([
      admin.role.create({ data: { tenantId: tenant.id, name: 'Authorization warning primary', permissions: ['sales.customer.create'] } }),
      admin.role.create({ data: { tenantId: tenant.id, name: 'Authorization warning additional', permissions: ['sales.customer.approve'] } }),
      admin.role.create({ data: { tenantId: tenant.id, name: 'Authorization block primary', permissions: ['accounting.journal.create'] } }),
      admin.role.create({ data: { tenantId: tenant.id, name: 'Authorization block additional', permissions: ['accounting.journal.post'] } }),
    ]);
    const administrator = actor(owner, { permissions: ['system.super_admin'], legacyPermissions: ['*'] });
    const warned = await access.updateUser(administrator, operator.id, {
      primaryRoleId: warnPrimary.id.toString(),
      additionalRoleIds: [warnAdditional.id.toString()],
      overrides: [],
    }, { requestId: 'authorization-user-warn' });
    expect(warned.sodWarnings).toEqual([
      expect.objectContaining({ ruleKey: 'authorization-warn-role', enforcement: 'WARN' }),
    ]);

    await expect(access.updateUser(administrator, operator.id, {
      primaryRoleId: blockPrimary.id.toString(),
      additionalRoleIds: [blockAdditional.id.toString()],
      overrides: [],
    }, { requestId: 'authorization-user-block' })).rejects.toThrow(/blocking segregation-of-duties/i);
    const persisted = await admin.user.findUniqueOrThrow({
      where: { id: operator.id },
      include: { additionalRoles: true },
    });
    expect(persisted.roleId).toBe(warnPrimary.id);
    expect(persisted.additionalRoles.map(({ roleId }) => roleId)).toEqual([warnAdditional.id]);
  });

  it('blocks persisted legacy role aliases when their canonical permissions violate SoD', async () => {
    await admin.sodRule.create({ data: {
      tenantId: tenant.id,
      key: 'authorization-block-legacy-aliases',
      name: 'Quotation maker and converter block',
      description: 'Block quotation creation and conversion from being combined.',
      leftPermissions: ['sales.quotation.create'],
      rightPermissions: ['sales.quotation.convert'],
      enforcement: 'BLOCK',
    } });
    const [legacyMaker, legacyConverter] = await Promise.all([
      admin.role.create({ data: {
        tenantId: tenant.id,
        name: 'Authorization legacy quotation maker',
        permissions: ['quotations.create'],
      } }),
      admin.role.create({ data: {
        tenantId: tenant.id,
        name: 'Authorization legacy quotation converter',
        permissions: ['quotations.convert'],
      } }),
    ]);
    const before = await admin.user.findUniqueOrThrow({
      where: { id: operator.id },
      include: { additionalRoles: true },
    });
    const administrator = actor(owner, { permissions: ['system.super_admin'], legacyPermissions: ['*'] });

    await expect(access.updateUser(administrator, operator.id, {
      primaryRoleId: legacyMaker.id.toString(),
      additionalRoleIds: [legacyConverter.id.toString()],
      overrides: [],
    }, { requestId: 'authorization-user-legacy-alias-block' })).rejects.toThrow(/blocking segregation-of-duties/i);

    const persisted = await admin.user.findUniqueOrThrow({
      where: { id: operator.id },
      include: { additionalRoles: true },
    });
    expect(persisted.roleId).toBe(before.roleId);
    expect(persisted.additionalRoles.map(({ roleId }) => roleId).sort()).toEqual(
      before.additionalRoles.map(({ roleId }) => roleId).sort(),
    );
  });
});
