import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import request from 'supertest';
import { AccessGovernanceService } from './access-governance.service';
import { canAtCompany } from './access-governance';
import { AppModule } from './app.module';
import { Actor, AuthService } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

const PASSWORD = 'CompanyGovernanceTest2026!';

describe('Company governance PostgreSQL integration', () => {
  let admin: PrismaClient;
  let app: INestApplication;
  let database: PrismaService;
  let auth: AuthService;
  let governance: AccessGovernanceService;
  let erp: ErpService;
  let tenantId: bigint;
  let companyA: { id: bigint };
  let companyB: { id: bigint };
  let branchA: { id: bigint };
  let branchB: { id: bigint };
  let userA: { id: bigint };
  let userB: { id: bigint };
  let actorA: Actor;
  let actorB: Actor;
  let documentA: { id: bigint };
  let documentB: { id: bigint };
  let accountA: { id: bigint };
  let bankA: { id: bigint };
  let warehouseA: { id: bigint };
  let warehouseB: { id: bigint };
  let accessToken: string;

  const loadActor = async (userId: bigint) => {
    const user = await admin.user.findUniqueOrThrow({ where: { id: userId }, include: auth.userInclude });
    return auth.actorFor(user);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ODIN_REQUIRE_PRIVILEGED_MFA = 'false';
    process.env.ODIN_TOKEN_SECRET ||= 'odin-company-governance-test-secret-at-least-32-characters';
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService();
    auth = new AuthService(database);
    governance = new AccessGovernanceService(database, auth);
    erp = new ErpService(database, governance);

    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Company governance test ' } } });
    });

    const tenant = await admin.tenant.create({ data: { name: `Company governance test ${Date.now()}`, baseCurrency: 'EGP' } });
    tenantId = tenant.id;
    companyA = await admin.company.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'DEFAULT' } }, select: { id: true } });
    branchA = await admin.branch.create({ data: { tenantId, code: 'A', name: 'Company A branch' }, select: { id: true } });
    companyB = await admin.company.create({ data: { tenantId, code: 'COMPANY_B', name: 'Company B', baseCurrency: 'EGP' }, select: { id: true } });
    branchB = await admin.branch.create({ data: { tenantId, code: 'B', name: 'Company B branch' }, select: { id: true } });
    await admin.companyBranch.update({ where: { branchId: branchB.id }, data: { companyId: companyB.id } });

    await admin.permission.create({ data: {
      tenantId,
      key: 'sales.order.view',
      module: 'sales',
      resource: 'order',
      action: 'view',
      description: 'View sales orders',
    } });
    const role = await admin.role.create({ data: { tenantId, key: 'company_operator', name: 'Company operator', permissions: [] } });
    await admin.roleDataScope.create({ data: { tenantId, roleId: role.id, resource: 'order', scope: 'ALL' } });
    const grantorRole = await admin.role.create({ data: {
      tenantId,
      key: 'super_admin',
      name: 'Governance test super admin',
      permissions: ['system.super_admin'],
    } });
    const passwordHash = await hash(PASSWORD, 4);
    userA = await admin.user.create({ data: {
      tenantId, roleId: role.id, email: `company-a-${tenantId}@odin.test`, name: 'Company A administrator', passwordHash,
      branchIds: [branchA.id.toString(), branchB.id.toString()], warehouseIds: [],
    }, select: { id: true } });
    userB = await admin.user.create({ data: {
      tenantId, roleId: role.id, email: `company-b-${tenantId}@odin.test`, name: 'Company B administrator', passwordHash: 'not-used',
      branchIds: [branchA.id.toString(), branchB.id.toString()], warehouseIds: [],
    }, select: { id: true } });
    const grantor = await admin.user.create({ data: {
      tenantId,
      roleId: grantorRole.id,
      email: `governance-grantor-${tenantId}@odin.test`,
      name: 'Governance grantor',
      passwordHash,
      branchIds: [branchA.id.toString(), branchB.id.toString()],
      warehouseIds: [],
    }, select: { id: true } });
    await admin.companyMembership.update({ where: { tenantId_companyId_userId: { tenantId, companyId: companyA.id, userId: userA.id } }, data: { role: 'ADMINISTRATOR' } });
    await admin.companyMembership.createMany({ data: [
      { tenantId, companyId: companyB.id, userId: userA.id, role: 'MEMBER' },
      { tenantId, companyId: companyB.id, userId: userB.id, role: 'ADMINISTRATOR' },
    ] });
    // The compatibility trigger gives every new user a default-company
    // membership. This fixture intentionally models a Company-B-only admin.
    await admin.companyMembership.delete({
      where: { tenantId_companyId_userId: { tenantId, companyId: companyA.id, userId: userB.id } },
    });

    warehouseA = await admin.warehouse.create({ data: { tenantId, branchId: branchA.id, code: 'WH-A', name: 'Warehouse A' }, select: { id: true } });
    warehouseB = await admin.warehouse.create({ data: { tenantId, branchId: branchB.id, code: 'WH-B', name: 'Warehouse B' }, select: { id: true } });
    const customerA = await admin.customer.create({ data: { tenantId, companyId: companyA.id, code: 'CUS-A', name: 'Customer A', city: 'Cairo', defaultBranchId: branchA.id } });
    const customerB = await admin.customer.create({ data: { tenantId, companyId: companyB.id, code: 'CUS-B', name: 'Customer B', city: 'Cairo', defaultBranchId: branchB.id } });
    documentA = await admin.document.create({ data: { tenantId, type: 'SALES_ORDER', number: 'SEARCH-SCOPE-A', branchId: branchA.id, warehouseId: warehouseA.id, customerId: customerA.id, documentDate: new Date('2026-08-01'), createdById: userA.id }, select: { id: true } });
    documentB = await admin.document.create({ data: { tenantId, type: 'SALES_ORDER', number: 'SEARCH-SCOPE-B', branchId: branchB.id, warehouseId: warehouseB.id, customerId: customerB.id, documentDate: new Date('2026-08-01'), createdById: userB.id }, select: { id: true } });

    accountA = await admin.account.create({ data: { tenantId, code: 'BANK-A-GL', name: 'Company A bank GL', type: 'ASSET' }, select: { id: true } });
    bankA = await admin.bankAccount.create({ data: { tenantId, code: 'BANK-A', name: 'Company A bank', type: 'BANK', glAccountId: accountA.id }, select: { id: true } });

    const grantorActor = await loadActor(grantor.id);
    await governance.createTemporaryGrant(grantorActor, {
      companyId: companyA.id.toString(),
      userId: userA.id.toString(),
      permissionKeys: ['sales.order.view'],
      reason: 'Exercise company-scoped HTTP sales authorization',
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    }, { requestId: 'company-governance-test-grant' });
    actorA = await loadActor(userA.id);
    actorB = await loadActor(userB.id);

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('User-Agent', 'company-governance-database-test')
      .send({ email: `company-a-${tenantId}@odin.test`, password: PASSWORD, rememberMe: false })
      .expect(201);
    accessToken = login.body.accessToken;
    expect(accessToken).toEqual(expect.any(String));
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: tenantId } });
      });
    }
    await database.onModuleDestroy();
    await admin.$disconnect();
  });

  it('bounds a Company Administrator to only the administered company and its metadata', async () => {
    const persisted = await admin.companyMembership.findMany({ where: { userId: userA.id }, orderBy: { companyId: 'asc' } });
    expect(persisted.map(({ companyId, role, active }) => ({ companyId: companyId.toString(), role, active }))).toEqual([
      { companyId: companyA.id.toString(), role: 'ADMINISTRATOR', active: true },
      { companyId: companyB.id.toString(), role: 'MEMBER', active: true },
    ]);
    const loaded = await admin.user.findUniqueOrThrow({ where: { id: userA.id }, include: auth.userInclude });
    expect(loaded.companyMemberships.map(({ companyId, role }) => ({ companyId: companyId.toString(), role }))).toEqual([
      { companyId: companyA.id.toString(), role: 'ADMINISTRATOR' },
      { companyId: companyB.id.toString(), role: 'MEMBER' },
    ]);
    expect(loaded.companyMemberships.map(({ validFrom, validUntil, active, company }) => ({
      active,
      companyActive: company.active,
      validNow: validFrom <= new Date() && (!validUntil || validUntil > new Date()),
    }))).toEqual([
      { active: true, companyActive: true, validNow: true },
      { active: true, companyActive: true, validNow: true },
    ]);
    expect(actorA.companyAdminIds).toContain(companyA.id.toString());
    expect(canAtCompany(actorA, 'settings.users_access.manage', companyA.id)).toBe(true);
    expect(canAtCompany(actorA, 'settings.users_access.manage', companyB.id)).toBe(false);
    const companies = await governance.companies(actorA);
    expect(companies.map((company) => company.id)).toEqual([companyA.id.toString()]);
    expect(JSON.stringify(companies)).not.toContain(`company-b-${tenantId}@odin.test`);
    await expect(governance.upsertMembership(actorA, companyB.id, userA.id, { role: 'ADMINISTRATOR' }, {}))
      .rejects.toThrow(/Company Administrator/i);
  });

  it('cannot move an existing private bank wrapper into another company', async () => {
    const before = await admin.financialResource.findUniqueOrThrow({ where: { linkedBankAccountId: bankA.id } });
    expect(before.companyId).toBe(companyA.id);
    await expect(governance.createFinancialResource(actorB, companyB.id, {
      type: 'BANK_ACCOUNT', code: 'TAKEOVER', name: 'Attempted takeover', linkedBankAccountId: bankA.id.toString(),
    }, {})).rejects.toThrow(/cannot be moved between companies/i);
    const after = await admin.financialResource.findUniqueOrThrow({ where: { linkedBankAccountId: bankA.id } });
    expect(after.companyId).toBe(companyA.id);
  });

  it('keeps a searched sales list inside the company-scoped permission branch', async () => {
    expect(actorA.companyScopedPermissions[companyA.id.toString()]).toContain('sales.order.view');
    expect(actorA.companyScopedPermissions[companyB.id.toString()] || []).not.toContain('sales.order.view');
    const result: any = await erp.salesDocuments(actorA, { search: 'SEARCH-SCOPE', pageSize: 100 });
    expect(result.rows.map((row: any) => row.number)).toEqual(['SEARCH-SCOPE-A']);
    expect(result.rows.map((row: any) => row.number)).not.toContain('SEARCH-SCOPE-B');
  });

  it('keeps the searched sales route company-scoped through login and the real HTTP guards', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/sales/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ search: 'SEARCH-SCOPE', pageSize: 100 })
      .expect(200);
    expect(response.body.rows.map((row: any) => row.number)).toEqual(['SEARCH-SCOPE-A']);
    expect(response.body.rows.map((row: any) => row.number)).not.toContain('SEARCH-SCOPE-B');
  });

  it('rejects cross-company party, warehouse, source-document, and source-line identifiers at the database boundary', async () => {
    await expect(admin.customer.create({ data: {
      tenantId, companyId: companyA.id, code: 'BAD-BRANCH', name: 'Bad branch customer', city: 'Cairo', defaultBranchId: branchB.id,
    } })).rejects.toThrow(/default branch must belong/i);

    const customerA = await admin.customer.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'CUS-A' } } });
    await expect(admin.document.create({ data: {
      tenantId, type: 'SALES_ORDER', number: 'BAD-CUSTOMER', branchId: branchB.id, customerId: customerA.id,
      documentDate: new Date('2026-08-02'), createdById: userB.id,
    } })).rejects.toThrow(/customer belongs to another company/i);
    await expect(admin.document.create({ data: {
      tenantId, type: 'SALES_ORDER', number: 'BAD-WAREHOUSE', branchId: branchA.id, warehouseId: warehouseB.id,
      documentDate: new Date('2026-08-02'), createdById: userA.id,
    } })).rejects.toThrow(/warehouse must belong to its branch/i);
    await expect(admin.document.create({ data: {
      tenantId, type: 'DELIVERY_NOTE', number: 'BAD-SOURCE', branchId: branchB.id, sourceDocumentId: documentA.id,
      documentDate: new Date('2026-08-02'), createdById: userB.id,
    } })).rejects.toThrow(/source belongs to another company/i);

    const category = await admin.itemCategory.create({ data: { tenantId, code: 'CAT', name: 'Category' } });
    const uom = await admin.unitOfMeasure.create({ data: { tenantId, code: 'EA', name: 'Each' } });
    const item = await admin.item.create({ data: { tenantId, categoryId: category.id, uomId: uom.id, sku: 'ITEM', barcode: 'ITEM', name: 'Item', nameAr: 'Item', purchasePriceMinor: 100n, salePriceMinor: 100n } });
    const sourceLine = await admin.documentLine.create({ data: { tenantId, documentId: documentA.id, itemId: item.id, uomId: uom.id, quantityMilli: 1000n, unitPriceMinor: 100n, taxableMinor: 100n, taxMinor: 0n, totalMinor: 100n } });
    await expect(admin.documentLine.create({ data: { tenantId, documentId: documentB.id, itemId: item.id, uomId: uom.id, sourceLineId: sourceLine.id, quantityMilli: 1000n, unitPriceMinor: 100n, taxableMinor: 100n, taxMinor: 0n, totalMinor: 100n } }))
      .rejects.toThrow(/source line belongs to another company/i);
  });

  it('rejects cross-company bank and GL facts even through the administrator connection', async () => {
    const journalB = await admin.journalEntry.create({ data: {
      tenantId, branchId: branchB.id, number: 'J-B', postingDate: new Date('2026-08-03'), description: 'Company B journal',
      sourceModule: 'TEST', sourceType: 'TEST', sourceId: 1n, sourceNumber: 'J-B', createdById: userB.id,
    } });
    await expect(admin.journalLine.create({ data: { tenantId, journalEntryId: journalB.id, accountId: accountA.id, description: 'Cross-company GL', debitMinor: 100n, creditMinor: 0n } }))
      .rejects.toThrow(/GL account is not enabled for the company/i);
    await expect(admin.bankTransaction.create({ data: {
      tenantId, branchId: branchB.id, bankAccountId: bankA.id, counterpartyAccountId: accountA.id, kind: 'PAYMENT', number: 'BANK-BAD',
      postingDate: new Date('2026-08-03'), amountMinor: 100n, description: 'Cross-company bank', journalEntryId: journalB.id, createdById: userB.id,
    } })).rejects.toThrow(/account belongs to another company/i);
  });

  it('applies RLS to every new company-governance table', async () => {
    const unscoped = await database.app.$queryRaw<Array<{ companies: number; memberships: number; resources: number }>>`
      SELECT
        (SELECT count(*)::int FROM companies) AS companies,
        (SELECT count(*)::int FROM company_memberships) AS memberships,
        (SELECT count(*)::int FROM financial_resources) AS resources
    `;
    expect(unscoped[0]).toEqual({ companies: 0, memberships: 0, resources: 0 });
    const scoped = await database.tenant(tenantId, (tx) => tx.company.count());
    expect(scoped).toBe(2);
  });
});
