import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { JournalStatus, PrismaClient, WorkflowStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Actor, AuthService } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';
import { totpCode } from './mfa-security';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('Sales workflow PostgreSQL integration', () => {
  let admin: PrismaClient;
  let database: PrismaService;
  let erp: ErpService;
  let governance: { enforceAuthorityLimit: jest.Mock };

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService();
    governance = { enforceAuthorityLimit: jest.fn().mockResolvedValue(undefined) };
    erp = new ErpService(database, governance as any);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Workflow test ' } } });
    });
  });

  afterAll(async () => {
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  async function cleanup(tenantId: bigint) {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
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
    const company = await admin.company.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'DEFAULT' } } });
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
      roleIds: [role.id.toString()],
      permissions: ['system.super_admin'],
      deniedPermissions: [],
      legacyPermissions: ['*'],
      dataScopes: [],
      fieldPermissions: [],
      limits: {},
      branchIds: [branch.id.toString()],
      warehouseIds: [],
      companyIds: [company.id.toString()],
      companyAdminIds: [company.id.toString()],
      companyBranchIds: { [company.id.toString()]: [branch.id.toString()] },
      companyScopedPermissions: {},
      companyResourceAssignments: {},
    };
    return { tenant, company, branch, role, user, actor };
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

  it('enrolls MFA, verifies a login challenge, permits step-up, and revokes every session', async () => {
    const { tenant, actor } = await fixture('mfa-session');
    const auth = new AuthService(database);
    try {
      const enrollment = await auth.beginMfaEnrollment(actor, 'WorkflowTest2026!');
      await expect(auth.confirmMfaEnrollment(actor, totpCode(enrollment.secret))).resolves.toMatchObject({ ok: true, reauthenticate: true });

      const challenged = await auth.login(actor.email, 'WorkflowTest2026!', true, { ipAddress: '192.0.2.41', userAgent: 'database-test' });
      expect(challenged).toMatchObject({ mfaRequired: true });
      const session = await auth.completeMfaChallenge(challenged.challengeToken, totpCode(enrollment.secret));
      const verifiedActor = await auth.verifyToken(session.accessToken);
      expect(verifiedActor).toMatchObject({ userId: actor.userId, tenantId: tenant.id, mfaEnabled: true });
      expect(verifiedActor.sessionId).toBeTruthy();

      const stepUp = await auth.stepUp(verifiedActor, 'WorkflowTest2026!', totpCode(enrollment.secret));
      expect(auth.verifyStepUp(stepUp.stepUpToken, verifiedActor)).toBe(true);
      await expect(auth.completeMfaChallenge(challenged.challengeToken, totpCode(enrollment.secret))).rejects.toThrow(/invalid or expired/i);

      await auth.logoutAll(verifiedActor);
      await expect(auth.verifyToken(session.accessToken)).rejects.toThrow(UnauthorizedException);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('atomically consumes one MFA challenge before minting a refresh session', async () => {
    const { tenant, actor } = await fixture('mfa-challenge-concurrency');
    const auth = new AuthService(database);
    try {
      const enrollment = await auth.beginMfaEnrollment(actor, 'WorkflowTest2026!');
      await auth.confirmMfaEnrollment(actor, totpCode(enrollment.secret));
      const challenged = await auth.login(actor.email, 'WorkflowTest2026!', true);
      const currentCode = totpCode(enrollment.secret);

      const outcomes = await Promise.allSettled([
        auth.completeMfaChallenge(challenged.challengeToken, currentCode),
        auth.completeMfaChallenge(challenged.challengeToken, currentCode),
      ]);

      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(await admin.refreshSession.count({ where: { userId: actor.userId } })).toBe(1);
      expect(await admin.auditEvent.count({ where: { userId: actor.userId, action: 'MFA_VERIFIED' } })).toBe(1);
      await expect(auth.completeMfaChallenge(challenged.challengeToken, currentCode)).rejects.toThrow(/invalid or expired/i);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

  it('serializes failed MFA attempts so the challenge lockout counter cannot undercount', async () => {
    const { tenant, actor } = await fixture('mfa-attempt-concurrency');
    const auth = new AuthService(database);
    try {
      const enrollment = await auth.beginMfaEnrollment(actor, 'WorkflowTest2026!');
      await auth.confirmMfaEnrollment(actor, totpCode(enrollment.secret));
      const challenged = await auth.login(actor.email, 'WorkflowTest2026!', true);

      const outcomes = await Promise.allSettled(Array.from(
        { length: 5 },
        () => auth.completeMfaChallenge(challenged.challengeToken, 'not-a-code'),
      ));

      expect(outcomes.every(({ status }) => status === 'rejected')).toBe(true);
      const persisted = await admin.mfaChallenge.findFirstOrThrow({
        where: { userId: actor.userId, purpose: 'LOGIN' },
        orderBy: { createdAt: 'desc' },
      });
      expect(persisted).toMatchObject({ attempts: 5 });
      expect(persisted.consumedAt).toBeInstanceOf(Date);
      expect(await admin.refreshSession.count({ where: { userId: actor.userId } })).toBe(0);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

  it('atomically consumes one recovery code across concurrent login challenges', async () => {
    const { tenant, actor } = await fixture('mfa-recovery-challenge-concurrency');
    const auth = new AuthService(database);
    try {
      const enrollment = await auth.beginMfaEnrollment(actor, 'WorkflowTest2026!');
      await auth.confirmMfaEnrollment(actor, totpCode(enrollment.secret));
      const [firstChallenge, secondChallenge] = await Promise.all([
        auth.login(actor.email, 'WorkflowTest2026!', true),
        auth.login(actor.email, 'WorkflowTest2026!', true),
      ]);

      const outcomes = await Promise.allSettled([
        auth.completeMfaChallenge(firstChallenge.challengeToken, undefined, enrollment.recoveryCodes[0]),
        auth.completeMfaChallenge(secondChallenge.challengeToken, undefined, enrollment.recoveryCodes[0]),
      ]);

      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const persisted = await admin.user.findUniqueOrThrow({ where: { id: actor.userId } });
      expect(persisted.mfaRecoveryHashes).toHaveLength(enrollment.recoveryCodes.length - 1);
      expect(await admin.refreshSession.count({ where: { userId: actor.userId } })).toBe(1);
      expect(await admin.auditEvent.count({ where: { userId: actor.userId, action: 'MFA_VERIFIED' } })).toBe(1);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

  it('atomically consumes one recovery code across concurrent step-up requests', async () => {
    const { tenant, actor } = await fixture('mfa-recovery-step-up-concurrency');
    const auth = new AuthService(database);
    try {
      const enrollment = await auth.beginMfaEnrollment(actor, 'WorkflowTest2026!');
      await auth.confirmMfaEnrollment(actor, totpCode(enrollment.secret));

      const outcomes = await Promise.allSettled([
        auth.stepUp(actor, 'WorkflowTest2026!', undefined, enrollment.recoveryCodes[0]),
        auth.stepUp(actor, 'WorkflowTest2026!', undefined, enrollment.recoveryCodes[0]),
      ]);

      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const persisted = await admin.user.findUniqueOrThrow({ where: { id: actor.userId } });
      expect(persisted.mfaRecoveryHashes).toHaveLength(enrollment.recoveryCodes.length - 1);
      expect(await admin.auditEvent.count({ where: { userId: actor.userId, action: 'STEP_UP_SUCCEEDED' } })).toBe(1);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

  it('throttles repeated login failures by both account and IP without account enumeration', async () => {
    const { tenant, user } = await fixture('login-throttle');
    const auth = new AuthService(database);
    const context = { ipAddress: `192.0.2.${Number(tenant.id % 200n) + 20}` };
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(auth.login(user.email, 'definitely-wrong', true, context)).rejects.toThrow('Invalid email or password');
      }
      await expect(auth.login(user.email, 'WorkflowTest2026!', true, context)).rejects.toThrow('Invalid email or password');
      await expect(auth.login(`missing-${tenant.id}@odin.test`, 'definitely-wrong', true, { ipAddress: '198.51.100.77' })).rejects.toThrow('Invalid email or password');
    } finally {
      await admin.authThrottle.deleteMany();
      await cleanup(tenant.id);
    }
  });

  it('redacts customer credit fields and blocks credit edits without the granular permission', async () => {
    const { tenant, branch, actor } = await fixture('credit-permission');
    const limitedActor = {
      ...actor,
      permissions: ['sales.customer.create', 'sales.customer.view', 'sales.customer.edit'],
      legacyPermissions: [],
      dataScopes: [{ resource: 'customer', scope: 'BRANCH' as const }],
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
      await expect(erp.updateCustomer(limitedActor, BigInt(customer.id), { creditLimit: '1000.00' })).rejects.toThrow(/read-only/i);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('applies owner data scope in the backend query instead of returning other users records', async () => {
    const { tenant, branch, user, actor } = await fixture('owner-scope');
    try {
      const otherRole = await admin.role.create({ data: { tenantId: tenant.id, name: 'Other sales role', permissions: [] } });
      const otherUser = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: otherRole.id,
        email: `other-${tenant.id}@odin.test`,
        name: 'Other Salesperson',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      await admin.customer.createMany({ data: [
        { tenantId: tenant.id, code: 'OWN-001', name: 'Owned customer', city: 'Cairo', defaultBranchId: branch.id, ownerUserId: user.id },
        { tenantId: tenant.id, code: 'OTHER-001', name: 'Other customer', city: 'Cairo', defaultBranchId: branch.id, ownerUserId: otherUser.id },
      ] });
      const scopedActor: Actor = {
        ...actor,
        permissions: ['sales.customer.view'],
        legacyPermissions: [],
        dataScopes: [{ resource: 'customer', scope: 'OWN' }],
        fieldPermissions: [{ resource: 'customer', field: 'balanceMinor', access: 'VIEW' }],
      };
      const result: any = await erp.listCustomers(scopedActor, { status: 'ALL' });
      expect(result.rows.map((customer: any) => customer.code)).toEqual(['OWN-001']);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('resolves team data scope from shared role membership without widening to the branch', async () => {
    const { tenant, branch, role, user, actor } = await fixture('team-scope');
    try {
      const outsideRole = await admin.role.create({ data: { tenantId: tenant.id, name: 'Outside team role', permissions: [] } });
      const teammate = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `teammate-${tenant.id}@odin.test`,
        name: 'Sales Teammate',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      const outsider = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: outsideRole.id,
        email: `outsider-${tenant.id}@odin.test`,
        name: 'Branch Outsider',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      await admin.customer.createMany({ data: [
        { tenantId: tenant.id, code: 'TEAM-OWN', name: 'Own team customer', city: 'Cairo', defaultBranchId: branch.id, ownerUserId: user.id },
        { tenantId: tenant.id, code: 'TEAM-MATE', name: 'Teammate customer', city: 'Cairo', defaultBranchId: branch.id, ownerUserId: teammate.id },
        { tenantId: tenant.id, code: 'TEAM-OUT', name: 'Outside team customer', city: 'Cairo', defaultBranchId: branch.id, ownerUserId: outsider.id },
      ] });
      const scopedActor: Actor = {
        ...actor,
        permissions: ['sales.customer.view'],
        legacyPermissions: [],
        dataScopes: [{ resource: 'customer', scope: 'TEAM' }],
        fieldPermissions: [],
      };
      const result: any = await erp.listCustomers(scopedActor, { status: 'ALL' });
      expect(result.rows.map((customer: any) => customer.code).sort()).toEqual(['TEAM-MATE', 'TEAM-OWN']);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('enforces negative document access for every supported data scope', async () => {
    const { tenant, branch, role, user, actor } = await fixture('scope-matrix');
    try {
      const otherBranch = await admin.branch.create({ data: { tenantId: tenant.id, code: 'OUT', name: 'Outside branch' } });
      const [assignedWarehouse, otherWarehouse, outsideWarehouse] = await Promise.all([
        admin.warehouse.create({ data: { tenantId: tenant.id, branchId: branch.id, code: 'ASSIGNED', name: 'Assigned warehouse' } }),
        admin.warehouse.create({ data: { tenantId: tenant.id, branchId: branch.id, code: 'OTHER', name: 'Other warehouse' } }),
        admin.warehouse.create({ data: { tenantId: tenant.id, branchId: otherBranch.id, code: 'OUTSIDE', name: 'Outside warehouse' } }),
      ]);
      const [salesDepartment, outsideDepartment] = await Promise.all([
        admin.department.create({ data: { tenantId: tenant.id, code: 'SALES', name: 'Sales' } }),
        admin.department.create({ data: { tenantId: tenant.id, code: 'OPS', name: 'Operations' } }),
      ]);
      const outsideRole = await admin.role.create({ data: { tenantId: tenant.id, name: 'Outside scope role', permissions: [] } });
      const teammate = await admin.user.create({ data: {
        tenantId: tenant.id, roleId: role.id, email: `scope-teammate-${tenant.id}@odin.test`, name: 'Scope Teammate',
        passwordHash: await hash('WorkflowTest2026!', 4), branchIds: [branch.id.toString()], warehouseIds: [otherWarehouse.id.toString()],
      } });
      const outsider = await admin.user.create({ data: {
        tenantId: tenant.id, roleId: outsideRole.id, email: `scope-outsider-${tenant.id}@odin.test`, name: 'Scope Outsider',
        passwordHash: await hash('WorkflowTest2026!', 4), branchIds: [branch.id.toString(), otherBranch.id.toString()], warehouseIds: [assignedWarehouse.id.toString(), outsideWarehouse.id.toString()],
      } });
      const [employee, teammateEmployee, outsiderEmployee] = await Promise.all([
        admin.employee.create({ data: { tenantId: tenant.id, departmentId: salesDepartment.id, userId: user.id, code: 'EMP-OWN', name: 'Own employee', salesEligible: true, branchIds: [branch.id.toString()] } }),
        admin.employee.create({ data: { tenantId: tenant.id, departmentId: salesDepartment.id, userId: teammate.id, code: 'EMP-TEAM', name: 'Team employee', salesEligible: true, branchIds: [branch.id.toString()] } }),
        admin.employee.create({ data: { tenantId: tenant.id, departmentId: outsideDepartment.id, userId: outsider.id, code: 'EMP-OUT', name: 'Outside employee', salesEligible: true, branchIds: [branch.id.toString(), otherBranch.id.toString()] } }),
      ]);
      await admin.document.createMany({ data: [
        { tenantId: tenant.id, type: 'SALES_ORDER', number: 'SCOPE-OWN', branchId: branch.id, warehouseId: assignedWarehouse.id, documentDate: new Date('2026-08-01'), createdById: user.id, salespersonId: employee.id },
        { tenantId: tenant.id, type: 'SALES_ORDER', number: 'SCOPE-TEAM', branchId: branch.id, warehouseId: otherWarehouse.id, documentDate: new Date('2026-08-01'), createdById: teammate.id, salespersonId: teammateEmployee.id },
        { tenantId: tenant.id, type: 'SALES_ORDER', number: 'SCOPE-BRANCH', branchId: branch.id, warehouseId: assignedWarehouse.id, documentDate: new Date('2026-08-01'), createdById: outsider.id, salespersonId: outsiderEmployee.id },
        { tenantId: tenant.id, type: 'SALES_ORDER', number: 'SCOPE-OUTSIDE', branchId: otherBranch.id, warehouseId: outsideWarehouse.id, documentDate: new Date('2026-08-01'), createdById: outsider.id, salespersonId: outsiderEmployee.id },
      ] });
      const expected: Record<string, string[]> = {
        NONE: [],
        OWN: ['SCOPE-OWN'],
        ASSIGNED: ['SCOPE-OWN'],
        TEAM: ['SCOPE-OWN', 'SCOPE-TEAM'],
        BRANCH: ['SCOPE-BRANCH', 'SCOPE-OWN', 'SCOPE-TEAM'],
        WAREHOUSE: ['SCOPE-BRANCH', 'SCOPE-OWN'],
        DEPARTMENT: ['SCOPE-OWN', 'SCOPE-TEAM'],
        ALL: ['SCOPE-BRANCH', 'SCOPE-OWN', 'SCOPE-TEAM'],
      };
      for (const [scope, visibleNumbers] of Object.entries(expected)) {
        const scopedActor: Actor = {
          ...actor,
          permissions: ['sales.order.view'],
          legacyPermissions: [],
          employeeId: employee.id.toString(),
          departmentId: salesDepartment.id.toString(),
          warehouseIds: [assignedWarehouse.id.toString()],
          dataScopes: [{ resource: 'order', scope: scope as Actor['dataScopes'][number]['scope'] }],
          fieldPermissions: [],
        };
        const rows: any[] = await erp.listDocuments(scopedActor, 'SALES_ORDER');
        expect(rows.map((document) => document.number).sort()).toEqual(visibleNumbers);
      }
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('defaults financial resources to none and rejects unassigned bank or GL accounts', async () => {
    const { tenant, branch, actor } = await fixture('financial-scope');
    try {
      const [bankGl, otherBankGl, expense, otherExpense] = await Promise.all([
        admin.account.create({ data: { tenantId: tenant.id, code: '1010', name: 'Assigned bank GL', type: 'ASSET' } }),
        admin.account.create({ data: { tenantId: tenant.id, code: '1020', name: 'Other bank GL', type: 'ASSET' } }),
        admin.account.create({ data: { tenantId: tenant.id, code: '6100', name: 'Assigned expense', type: 'EXPENSE' } }),
        admin.account.create({ data: { tenantId: tenant.id, code: '6200', name: 'Other expense', type: 'EXPENSE' } }),
      ]);
      const [assignedBank, otherBank] = await Promise.all([
        admin.bankAccount.create({ data: { tenantId: tenant.id, code: 'BANK-A', name: 'Assigned bank', type: 'BANK', glAccountId: bankGl.id } }),
        admin.bankAccount.create({ data: { tenantId: tenant.id, code: 'BANK-B', name: 'Other bank', type: 'BANK', glAccountId: otherBankGl.id } }),
      ]);
      const permissions = ['banking.account.view', 'banking.transaction.view', 'banking.transaction.create'];
      const noScopeActor: Actor = { ...actor, permissions, legacyPermissions: [], dataScopes: [], fieldPermissions: [] };
      expect((await erp.banking(noScopeActor)).accounts).toEqual([]);
      await expect(erp.createBankTransaction(noScopeActor, {
        branchId: branch.id.toString(), bankAccountId: assignedBank.id.toString(), counterpartyAccountId: expense.id.toString(), kind: 'PAYMENT', amount: '1.00', postingDate: '2026-08-01',
      })).rejects.toThrow(/outside your access scope/i);

      const assignedActor: Actor = {
        ...noScopeActor,
        dataScopes: [
          { resource: 'bank_account', scope: 'ASSIGNED', config: { resourceIds: [assignedBank.id.toString()] } },
          { resource: 'account', scope: 'ASSIGNED', config: { resourceIds: [expense.id.toString()] } },
        ],
      };
      expect((await erp.banking(assignedActor)).accounts.map((account: any) => account.code)).toEqual(['BANK-A']);
      await expect(erp.createBankTransaction(assignedActor, {
        branchId: branch.id.toString(), bankAccountId: otherBank.id.toString(), counterpartyAccountId: expense.id.toString(), kind: 'PAYMENT', amount: '1.00', postingDate: '2026-08-01',
      })).rejects.toThrow(/outside your access scope/i);
      await expect(erp.createBankTransaction(assignedActor, {
        branchId: branch.id.toString(), bankAccountId: assignedBank.id.toString(), counterpartyAccountId: otherExpense.id.toString(), kind: 'PAYMENT', amount: '1.00', postingDate: '2026-08-01',
      })).rejects.toThrow(/outside your access scope/i);
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('enforces role approval limits before changing a submitted document', async () => {
    const { tenant, branch, user, actor } = await fixture('approval-limit');
    try {
      const makerRole = await admin.role.create({ data: { tenantId: tenant.id, name: 'Maker role', permissions: [] } });
      const maker = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: makerRole.id,
        email: `maker-${tenant.id}@odin.test`,
        name: 'Quotation Maker',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      const document = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'SALES_ORDER',
        number: `SO-LIMIT-${tenant.id}`,
        status: 'SUBMITTED',
        branchId: branch.id,
        documentDate: new Date('2026-07-31T00:00:00.000Z'),
        totalMinor: 10_001n,
        createdById: maker.id,
        submittedById: maker.id,
        submittedAt: new Date(),
      } });
      const approver: Actor = {
        ...actor,
        userId: user.id,
        permissions: ['sales.order.approve'],
        legacyPermissions: [],
        dataScopes: [{ resource: 'order', scope: 'BRANCH' }],
        limits: { 'sales.credit_amount_minor': 10_000, 'sales.discount_percent': 15 },
      };
      await expect(erp.workflow(approver, document.id, 'approve', { comment: 'Within policy review' })).rejects.toThrow(/approval limit/i);
      expect((await admin.document.findUniqueOrThrow({ where: { id: document.id } })).status).toBe('SUBMITTED');
      const discounted = await admin.document.create({ data: {
        tenantId: tenant.id,
        type: 'SALES_ORDER',
        number: `SO-DISCOUNT-${tenant.id}`,
        status: 'SUBMITTED',
        branchId: branch.id,
        documentDate: new Date('2026-07-31T00:00:00.000Z'),
        subtotalMinor: 10_000n,
        discountMinor: 2_000n,
        totalMinor: 8_000n,
        createdById: maker.id,
        submittedById: maker.id,
        submittedAt: new Date(),
      } });
      await expect(erp.workflow(approver, discounted.id, 'approve', { comment: 'Discount review' })).rejects.toThrow(/discount.*approval limit/i);
      expect((await admin.document.findUniqueOrThrow({ where: { id: discounted.id } })).status).toBe('SUBMITTED');
    } finally {
      await cleanup(tenant.id);
    }
  });

  it('evaluates sales authority against posted, committed, and proposed base-currency exposure', async () => {
    const { tenant, company, branch, user, actor } = await fixture('credit-exposure');
    try {
      const makerRole = await admin.role.create({ data: { tenantId: tenant.id, name: 'Exposure maker', permissions: [] } });
      const maker = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: makerRole.id,
        email: `exposure-maker-${tenant.id}@odin.test`,
        name: 'Exposure Maker',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      const customer = await admin.customer.create({ data: {
        tenantId: tenant.id,
        code: `EXPOSURE-${tenant.id}`,
        name: 'Exposure customer',
        city: 'Cairo',
        defaultBranchId: branch.id,
        defaultCurrency: 'EGP',
      } });
      await admin.document.createMany({ data: [
        {
          tenantId: tenant.id, type: 'SALES_INVOICE', number: `INV-EXPOSURE-${tenant.id}`, status: 'POSTED',
          branchId: branch.id, customerId: customer.id, documentDate: new Date('2026-08-01'),
          currency: 'EGP', exchangeRateMicros: 1_000_000n, totalMinor: 10_000n, paidMinor: 2_000n, createdById: maker.id,
        },
        {
          tenantId: tenant.id, type: 'SALES_ORDER', number: `SO-COMMITTED-${tenant.id}`, status: 'APPROVED',
          branchId: branch.id, customerId: customer.id, documentDate: new Date('2026-08-02'),
          currency: 'USD', exchangeRateMicros: 2_000_000n, totalMinor: 1_500n, createdById: maker.id,
        },
        {
          tenantId: tenant.id, type: 'SALES_ORDER', number: `SO-DRAFT-IGNORED-${tenant.id}`, status: 'DRAFT',
          branchId: branch.id, customerId: customer.id, documentDate: new Date('2026-08-02'),
          currency: 'EGP', exchangeRateMicros: 1_000_000n, totalMinor: 99_000n, createdById: maker.id,
        },
      ] });
      const proposed = await admin.document.create({ data: {
        tenantId: tenant.id, type: 'SALES_ORDER', number: `SO-PROPOSED-${tenant.id}`, status: 'SUBMITTED',
        branchId: branch.id, customerId: customer.id, documentDate: new Date('2026-08-03'),
        currency: 'USD', exchangeRateMicros: 2_000_000n, totalMinor: 2_000n,
        createdById: maker.id, submittedById: maker.id, submittedAt: new Date(),
      } });
      const approver: Actor = {
        ...actor,
        userId: user.id,
        permissions: ['sales.order.approve'],
        legacyPermissions: [],
        dataScopes: [{ resource: 'order', scope: 'BRANCH' }],
        limits: { 'sales.credit_amount_minor': 100_000, 'sales.discount_percent': 100 },
      };
      governance.enforceAuthorityLimit.mockClear();

      await erp.workflow(approver, proposed.id, 'approve', { comment: 'Exposure policy review' });

      expect(governance.enforceAuthorityLimit).toHaveBeenCalledWith(expect.anything(), approver, expect.objectContaining({
        companyId: company.id,
        branchId: branch.id,
        key: 'sales.credit_exposure_amount_minor',
        currency: 'EGP',
        amountMinor: 15_000n,
        documentType: 'SALES_ORDER',
      }));
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
        branchId: branch.id,
        kind: 'RECEIPT',
        status: 'POSTED',
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

  it('serializes duplicate document submits and competing approve/reject decisions', async () => {
    const { tenant, branch, role, user, actor } = await fixture('document-transition-concurrency');
    try {
      const maker = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `document-transition-maker-${tenant.id}@odin.test`,
        name: 'Document Transition Maker',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
      } });
      const [draft, submitted] = await Promise.all([
        admin.document.create({ data: {
          tenantId: tenant.id,
          type: 'PURCHASE_REQUEST',
          number: `PR-DUPLICATE-SUBMIT-${tenant.id}`,
          status: WorkflowStatus.DRAFT,
          branchId: branch.id,
          documentDate: new Date('2026-08-10T00:00:00.000Z'),
          subtotalMinor: 1_000n,
          totalMinor: 1_000n,
          createdById: user.id,
        } }),
        admin.document.create({ data: {
          tenantId: tenant.id,
          type: 'PURCHASE_REQUEST',
          number: `PR-COMPETING-DECISION-${tenant.id}`,
          status: WorkflowStatus.SUBMITTED,
          branchId: branch.id,
          documentDate: new Date('2026-08-10T00:00:00.000Z'),
          subtotalMinor: 2_000n,
          totalMinor: 2_000n,
          createdById: maker.id,
          submittedById: maker.id,
          submittedAt: new Date(),
        } }),
      ]);

      const submitOutcomes = await Promise.allSettled(Array.from(
        { length: 4 },
        (_, index) => erp.workflow(actor, draft.id, 'submit', { comment: `Duplicate submit ${index + 1}` }),
      ));
      expect(submitOutcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(submitOutcomes.filter(({ status }) => status === 'rejected')).toHaveLength(3);
      expect(await admin.approvalEvent.count({ where: { entityType: 'DOCUMENT', entityId: draft.id, action: 'SUBMIT' } })).toBe(1);
      expect(await admin.auditEvent.count({ where: { entityType: 'DOCUMENT', entityId: draft.id.toString(), action: 'SUBMIT' } })).toBe(1);

      const decisionOutcomes = await Promise.allSettled([
        erp.workflow(actor, submitted.id, 'approve', { comment: 'Concurrent approval' }),
        erp.workflow(actor, submitted.id, 'reject', { comment: 'Concurrent rejection' }),
      ]);
      expect(decisionOutcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(decisionOutcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const decided = await admin.document.findUniqueOrThrow({ where: { id: submitted.id } });
      const expectedAction = decided.status === WorkflowStatus.APPROVED ? 'APPROVE' : 'REJECT';
      expect([WorkflowStatus.APPROVED, WorkflowStatus.REJECTED]).toContain(decided.status);
      expect(await admin.approvalEvent.findMany({
        where: { entityType: 'DOCUMENT', entityId: submitted.id, action: { in: ['APPROVE', 'REJECT'] } },
        select: { action: true },
      })).toEqual([{ action: expectedAction }]);
      expect(await admin.auditEvent.findMany({
        where: { entityType: 'DOCUMENT', entityId: submitted.id.toString(), action: { in: ['APPROVE', 'REJECT'] } },
        select: { action: true },
      })).toEqual([{ action: expectedAction }]);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

  it('serializes duplicate journal submits/posts and competing approve/reject decisions', async () => {
    const { tenant, branch, role, user, actor } = await fixture('journal-transition-concurrency');
    try {
      const maker = await admin.user.create({ data: {
        tenantId: tenant.id,
        roleId: role.id,
        email: `journal-transition-maker-${tenant.id}@odin.test`,
        name: 'Journal Transition Maker',
        passwordHash: await hash('WorkflowTest2026!', 4),
        branchIds: [branch.id.toString()],
        warehouseIds: [],
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
      const [debitAccount, creditAccount] = await Promise.all([
        admin.account.create({ data: { tenantId: tenant.id, code: 'TRANSITION-DR', name: 'Transition debit', type: 'ASSET' } }),
        admin.account.create({ data: { tenantId: tenant.id, code: 'TRANSITION-CR', name: 'Transition credit', type: 'REVENUE' } }),
      ]);
      const createJournal = (status: JournalStatus, suffix: string) => {
        const controlled = status !== JournalStatus.DRAFT;
        const approved = status === JournalStatus.APPROVED;
        return admin.journalEntry.create({ data: {
          tenantId: tenant.id,
          branchId: branch.id,
          number: `JE-${suffix}-${tenant.id}`,
          postingDate: new Date('2026-08-10T00:00:00.000Z'),
          description: `${suffix} transition journal`,
          status,
          sourceModule: 'TRANSITION_TEST',
          sourceType: `TRANSITION_${suffix}`,
          sourceId: BigInt(100 + suffix.length),
          sourceNumber: `TRANSITION-${suffix}-${tenant.id}`,
          createdById: maker.id,
          submittedById: controlled ? maker.id : null,
          submittedAt: controlled ? new Date() : null,
          approvedById: approved ? user.id : null,
          approvedAt: approved ? new Date() : null,
          lines: { create: [
            { tenantId: tenant.id, accountId: debitAccount.id, description: 'Debit', debitMinor: 1_000n, creditMinor: 0n },
            { tenantId: tenant.id, accountId: creditAccount.id, description: 'Credit', debitMinor: 0n, creditMinor: 1_000n },
          ] },
        } });
      };
      const [draft, submitted, approved] = await Promise.all([
        createJournal(JournalStatus.DRAFT, 'DUPLICATE-SUBMIT'),
        createJournal(JournalStatus.SUBMITTED, 'COMPETING-DECISION'),
        createJournal(JournalStatus.APPROVED, 'DUPLICATE-POST'),
      ]);

      const submitOutcomes = await Promise.allSettled(Array.from(
        { length: 4 },
        (_, index) => erp.journalWorkflow(actor, draft.id, 'submit', { comment: `Duplicate submit ${index + 1}` }),
      ));
      expect(submitOutcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(submitOutcomes.filter(({ status }) => status === 'rejected')).toHaveLength(3);
      expect(await admin.approvalEvent.count({ where: { entityType: 'JOURNAL', entityId: draft.id, action: 'SUBMIT' } })).toBe(1);
      expect(await admin.auditEvent.count({ where: { entityType: 'JOURNAL', entityId: draft.id.toString(), action: 'SUBMIT' } })).toBe(1);

      const decisionOutcomes = await Promise.allSettled([
        erp.journalWorkflow(actor, submitted.id, 'approve', { comment: 'Concurrent approval' }),
        erp.journalWorkflow(actor, submitted.id, 'reject', { comment: 'Concurrent rejection' }),
      ]);
      expect(decisionOutcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(decisionOutcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      const decided = await admin.journalEntry.findUniqueOrThrow({ where: { id: submitted.id } });
      const expectedAction = decided.status === JournalStatus.APPROVED ? 'APPROVE' : 'REJECT';
      expect([JournalStatus.APPROVED, JournalStatus.REJECTED]).toContain(decided.status);
      expect(await admin.approvalEvent.findMany({
        where: { entityType: 'JOURNAL', entityId: submitted.id, action: { in: ['APPROVE', 'REJECT'] } },
        select: { action: true },
      })).toEqual([{ action: expectedAction }]);
      expect(await admin.auditEvent.findMany({
        where: { entityType: 'JOURNAL', entityId: submitted.id.toString(), action: { in: ['APPROVE', 'REJECT'] } },
        select: { action: true },
      })).toEqual([{ action: expectedAction }]);

      const postOutcomes = await Promise.allSettled(Array.from(
        { length: 4 },
        () => erp.journalWorkflow(actor, approved.id, 'post'),
      ));
      expect(postOutcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(postOutcomes.filter(({ status }) => status === 'rejected')).toHaveLength(3);
      expect(await admin.journalEntry.findUniqueOrThrow({ where: { id: approved.id } })).toMatchObject({ status: JournalStatus.POSTED });
      expect(await admin.auditEvent.count({ where: { entityType: 'JOURNAL', entityId: approved.id.toString(), action: 'POST' } })).toBe(1);
    } finally {
      await cleanup(tenant.id);
    }
  }, 30_000);

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
      roleIds: [submitter.role.id.toString()],
      permissions: ['system.super_admin'],
      deniedPermissions: [],
      legacyPermissions: ['*'],
      dataScopes: [],
      fieldPermissions: [],
      limits: {},
      branchIds: submitter.branchIds as string[],
      warehouseIds: submitter.warehouseIds as string[],
      companyIds: [],
      companyAdminIds: [],
      companyBranchIds: {},
      companyScopedPermissions: {},
      companyResourceAssignments: {},
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
