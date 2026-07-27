import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, WorkflowStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Actor, AuthService } from './auth';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env') });

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
