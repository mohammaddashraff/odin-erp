import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, WorkflowStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Actor, AuthService } from './auth';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('Sales workflow PostgreSQL integration', () => {
  let admin: PrismaClient;
  let database: PrismaService;
  let erp: ErpService;

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_ADMIN_URL!) });
    database = new PrismaService();
    erp = new ErpService(database);
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Workflow test ' } } });
    });
  });

  afterAll(async () => {
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  async function cleanup(tenantId: bigint) {
    await admin.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.tenant.delete({ where: { id: tenantId } });
    });
  }

  async function fixture(label: string) {
    const tenant = await admin.tenant.create({ data: {
      name: `Workflow test ${label}`,
      baseCurrency: 'EGP',
      customerCodePrefix: 'TST',
    } });
    const branch = await admin.branch.create({ data: { tenantId: tenant.id, code: 'TST', name: 'Test branch' } });
    const role = await admin.role.create({ data: { tenantId: tenant.id, name: 'Test administrator', permissions: ['*'] } });
    const user = await admin.user.create({ data: {
      tenantId: tenant.id,
      roleId: role.id,
      email: `workflow-${label}-${tenant.id}@odin.test`,
      name: 'Workflow Tester',
      passwordHash: await hash('WorkflowTest2026!', 4),
      branchIds: [branch.id.toString()],
      warehouseIds: [],
    } });
    await admin.currency.create({ data: { tenantId: tenant.id, code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' } });
    const actor: Actor = {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: user.name,
      role: role.name,
      permissions: ['*'],
      branchIds: [branch.id.toString()],
      warehouseIds: [],
    };
    return { tenant, branch, user, actor };
  }

  it('allocates unique customer codes concurrently and preserves nullable credit terms', async () => {
    const { tenant, branch, actor } = await fixture('customer-sequence');
    try {
      const customers = await Promise.all(Array.from({ length: 8 }, (_, index) => erp.createCustomer(actor, {
        name: `Concurrent customer ${index + 1}`,
        city: 'Cairo',
        defaultBranchId: branch.id.toString(),
        defaultCurrency: 'EGP',
        creditLimit: '',
        paymentTermsDays: '',
      })));
      expect(new Set(customers.map((customer: any) => customer.code)).size).toBe(8);
      expect(customers.map((customer: any) => customer.code).sort()).toEqual(
        Array.from({ length: 8 }, (_, index) => `TST-${String(index + 1).padStart(6, '0')}`),
      );
      expect(customers.every((customer: any) => customer.creditLimitMinor === null && customer.paymentTermsDays === null)).toBe(true);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('rotates refresh sessions, rejects token reuse, and issues a verifiable access token', async () => {
    const { tenant, user } = await fixture('refresh');
    const auth = new AuthService(database);
    try {
      const login = await auth.login(user.email, 'WorkflowTest2026!', true);
      const refreshed = await auth.refresh(login.refreshToken);
      await expect(auth.refresh(login.refreshToken)).rejects.toThrow(UnauthorizedException);
      await expect(auth.verifyToken(refreshed.accessToken)).resolves.toMatchObject({
        userId: user.id,
        tenantId: tenant.id,
      });
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('redacts customer credit fields and blocks credit edits without the granular permission', async () => {
    const { tenant, branch, actor } = await fixture('credit-permission');
    const limitedActor = {
      ...actor,
      permissions: ['customers.create', 'customers.view', 'customers.edit'],
    };
    try {
      const customer: any = await erp.createCustomer(limitedActor, {
        name: 'Credit restricted customer',
        city: 'Cairo',
        defaultBranchId: branch.id.toString(),
      });
      const result: any = await erp.listCustomers(limitedActor, { search: customer.code });
      expect(result.rows[0]).not.toHaveProperty('creditLimitMinor');
      expect(result.rows[0]).not.toHaveProperty('paymentTermsDays');
      expect(result.rows[0]).not.toHaveProperty('creditHold');
      await expect(erp.updateCustomer(limitedActor, BigInt(customer.id), { creditLimit: '1000.00' })).rejects.toThrow(/customers.edit-credit/);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('reconciles customer detail, statement, ageing, and account 1100 after receipts and credits', async () => {
    const { tenant, branch, user, actor } = await fixture('receivables');
    try {
      const accountRows = [
        ['1010', 'Test bank', 'ASSET', null],
        ['1100', 'Accounts receivable', 'ASSET', 'AR'],
        ['2200', 'Output VAT', 'LIABILITY', 'VAT_OUT'],
        ['4000', 'Sales revenue', 'REVENUE', null],
      ] as const;
      const accounts = new Map<string, bigint>();
      for (const [code, name, type, controlType] of accountRows) {
        const account = await admin.account.create({ data: { tenantId: tenant.id, code, name, type, controlType } });
        accounts.set(code, account.id);
      }
      const bank = await admin.bankAccount.create({ data: {
        tenantId: tenant.id,
        code: 'TEST-BANK',
        name: 'Test bank',
        type: 'BANK',
        currency: 'EGP',
        glAccountId: accounts.get('1010')!,
      } });
      const customer = await admin.customer.create({ data: {
        tenantId: tenant.id,
        code: 'TST-AR-001',
        name: 'Receivables integration customer',
        city: 'Cairo',
        defaultBranchId: branch.id,
        defaultCurrency: 'EGP',
      } });
      const postingDate = new Date('2026-07-01T00:00:00.000Z');
      const journal = async (number: string, sourceType: string, sourceId: bigint, lines: Array<[string, bigint, bigint]>) => {
        const entry = await admin.journalEntry.create({ data: {
          tenantId: tenant.id,
          branchId: branch.id,
          number,
          postingDate,
          description: number,
          sourceModule: 'TEST',
          sourceType,
          sourceId,
          sourceNumber: number,
          createdById: user.id,
          submittedById: user.id,
          approvedById: user.id,
          postedById: user.id,
          submittedAt: new Date(),
          approvedAt: new Date(),
          postedAt: new Date(),
          lines: { create: lines.map(([code, debitMinor, creditMinor]) => ({
            tenantId: tenant.id,
            accountId: accounts.get(code)!,
            description: number,
            debitMinor,
            creditMinor,
          })) },
        } });
        return admin.journalEntry.update({ where: { id: entry.id }, data: { status: 'POSTED' } });
      };
      const invoiceJournal = await journal('JE-AR-INV', 'SALES_INVOICE', 91_001n, [
        ['1100', 10_000n, 0n],
        ['4000', 0n, 8_600n],
        ['2200', 0n, 1_400n],
      ]);
      const invoice = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'SALES_INVOICE',
        number: 'SI-AR-001',
        status: 'POSTED',
        branchId: branch.id,
        customerId: customer.id,
        documentDate: postingDate,
        dueDate: postingDate,
        subtotalMinor: 8_600n,
        taxMinor: 1_400n,
        totalMinor: 10_000n,
        journalEntryId: invoiceJournal.id,
        createdById: user.id,
        postedById: user.id,
        postedAt: new Date(),
      } });
      const receiptJournal = await journal('JE-AR-RC', 'RECEIPT', 91_002n, [
        ['1010', 4_000n, 0n],
        ['1100', 0n, 4_000n],
      ]);
      const payment = await admin.payment.create({ data: {
        tenantId: tenant.id,
        kind: 'RECEIPT',
        partyType: 'CUSTOMER',
        customerId: customer.id,
        bankAccountId: bank.id,
        number: 'RC-AR-001',
        postingDate,
        amountMinor: 4_000n,
        method: 'BANK',
        journalEntryId: receiptJournal.id,
        createdById: user.id,
        allocations: { create: { tenantId: tenant.id, documentId: invoice.id, amountMinor: 4_000n } },
      } });
      await admin.document.update({ where: { id: invoice.id }, data: { paidMinor: payment.amountMinor } });
      const returnJournal = await journal('JE-AR-SR', 'SALES_RETURN', 91_003n, [
        ['4000', 2_000n, 0n],
        ['1100', 0n, 2_000n],
      ]);
      const salesReturn = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'SALES_RETURN',
        number: 'SR-AR-001',
        status: 'POSTED',
        branchId: branch.id,
        customerId: customer.id,
        sourceDocumentId: invoice.id,
        documentDate: postingDate,
        subtotalMinor: 2_000n,
        totalMinor: 2_000n,
        journalEntryId: returnJournal.id,
        createdById: user.id,
        postedById: user.id,
        postedAt: new Date(),
      } });
      const creditJournal = await journal('JE-AR-CN', 'CREDIT_NOTE', 91_004n, [
        ['4000', 1_000n, 0n],
        ['1100', 0n, 1_000n],
      ]);
      const creditNote = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'CREDIT_NOTE',
        number: 'CN-AR-001',
        status: 'POSTED',
        branchId: branch.id,
        customerId: customer.id,
        sourceDocumentId: invoice.id,
        documentDate: postingDate,
        subtotalMinor: 1_000n,
        totalMinor: 1_000n,
        journalEntryId: creditJournal.id,
        createdById: user.id,
        postedById: user.id,
        postedAt: new Date(),
      } });

      const detail: any = await erp.customerDetail(actor, customer.id);
      expect(BigInt(detail.outstandingMinor)).toBe(3_000n);
      expect(detail.statement.map((row: any) => row.transaction)).toEqual([
        'SALES_INVOICE', 'RECEIPT', 'SALES_RETURN', 'CREDIT_NOTE',
      ]);
      expect(BigInt(detail.statement.at(-1).runningBalanceMinor)).toBe(3_000n);
      expect(detail.ageing).toHaveLength(1);
      expect(BigInt(detail.ageing[0].outstandingMinor)).toBe(3_000n);
      const invoiceDetail: any = await erp.documentDetail(actor, invoice.id);
      expect(invoiceDetail).toMatchObject({
        grossInvoiceMinor: '10000',
        paidMinor: '4000',
        returnedMinor: '2000',
        creditedMinor: '1000',
        netReceivableMinor: '7000',
        remainingMinor: '3000',
        paymentStatus: 'PARTIALLY_PAID',
      });
      const reconciliation: any = await erp.report(actor, 'reconciliation');
      expect(reconciliation.rows.find((row: any) => row.control === 'Accounts receivable')).toMatchObject({
        ledgerMinor: '3000',
        subledgerMinor: '3000',
        differenceMinor: '0',
      });
      expect([salesReturn.sourceDocumentId, creditNote.sourceDocumentId]).toEqual([invoice.id, invoice.id]);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('blocks document posting when its fiscal period is closed', async () => {
    const { tenant, branch, user, actor } = await fixture('closed-period');
    try {
      const postingDate = new Date('2026-06-15T00:00:00.000Z');
      await admin.fiscalPeriod.create({ data: {
        tenantId: tenant.id,
        year: 2026,
        month: 6,
        name: 'June 2026',
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-30T00:00:00.000Z'),
        status: 'CLOSED',
      } });
      const invoice = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'SALES_INVOICE',
        number: 'SI-CLOSED-001',
        status: 'APPROVED',
        branchId: branch.id,
        documentDate: postingDate,
        createdById: user.id,
        submittedById: user.id,
        approvedById: user.id,
        submittedAt: new Date(),
        approvedAt: new Date(),
      } });

      await expect(erp.postDocument(actor, invoice.id)).rejects.toThrow(/Fiscal period June 2026 is CLOSED/);
      await expect(admin.document.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
        status: 'APPROVED',
        journalEntryId: null,
      });
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('requires a rejection reason and enforces maker-checker separation', async () => {
    const submitted = await admin.document.findFirstOrThrow({ where: {
      type: 'QUOTATION',
      status: WorkflowStatus.SUBMITTED,
    } });
    const submitter = await admin.user.findUniqueOrThrow({
      where: { id: submitted.submittedById! },
      include: { tenant: true, role: true },
    });
    const actor: Actor = {
      userId: submitter.id,
      tenantId: submitter.tenantId,
      email: submitter.email,
      name: submitter.name,
      role: submitter.role.name,
      permissions: ['*'],
      branchIds: submitter.branchIds as string[],
      warehouseIds: submitter.warehouseIds as string[],
    };
    await expect(erp.commentDocument(actor, submitted.id, {})).rejects.toThrow(/comment is required/i);
    const comment = await erp.commentDocument(actor, submitted.id, { comment: 'Customer scope and commercial terms confirmed.' });
    expect(comment.action).toBe('COMMENT');
    expect(comment.comment).toBe('Customer scope and commercial terms confirmed.');
    await expect(erp.workflow(actor, submitted.id, 'reject', {})).rejects.toThrow(BadRequestException);
    await expect(erp.workflow(actor, submitted.id, 'approve', { comment: 'Self approval attempt' })).rejects.toThrow(/maker-checker/i);
    expect((await admin.document.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe(WorkflowStatus.SUBMITTED);
  });
});
