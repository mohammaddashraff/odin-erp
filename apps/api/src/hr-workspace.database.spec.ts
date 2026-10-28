import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { Actor } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { PrismaService } from './prisma.service';
import { ErpService } from './erp.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
describe('HR profiles and leave transactions in PostgreSQL', () => {
  let admin: PrismaClient;
  let db: PrismaService;
  let erp: ErpService;
  let maker: Actor;
  let checker: Actor;
  let employee: any;
  let tenantId: bigint;
  let otherTenantId: bigint;
  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    db = new PrismaService();
    erp = new ErpService(db, {} as any);
    const tenant = await admin.tenant.create({ data: { name: `HR profile test ${Date.now()}` } });
    tenantId = tenant.id;
    otherTenantId = (await admin.tenant.create({ data: { name: `HR other tenant ${Date.now()}` } })).id;
    const company = await admin.company.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'DEFAULT' } } });
    const branch = await admin.branch.create({ data: { tenantId, code: 'HR', name: 'HR test branch' } });
    const role = await admin.role.create({ data: { tenantId, name: 'HR tests', permissions: ['*'] } });
    const makeActor = async (name: string): Promise<Actor> => {
      const user = await admin.user.create({ data: { tenantId, roleId: role.id, name, email: `${name}-${tenantId}@odin.test`, passwordHash: 'service-test-only', branchIds: [String(branch.id)], warehouseIds: [] } });
      return { userId: user.id, tenantId, name, email: user.email, role: role.name, roleIds: [String(role.id)], permissions: ['system.super_admin'], deniedPermissions: [], legacyPermissions: [], dataScopes: [], fieldPermissions: [], limits: {}, branchIds: [String(branch.id)], warehouseIds: [], companyIds: [String(company.id)], companyAdminIds: [String(company.id)], companyBranchIds: { [String(company.id)]: [String(branch.id)] }, companyScopedPermissions: {}, companyResourceAssignments: {} };
    };
    maker = await makeActor('Maker'); checker = await makeActor('Checker');
    const department: any = await erp.saveHrDepartment(maker, { code: 'HR', name: 'HR department' });
    employee = await erp.saveHrEmployee(maker, { code: 'HR-1', name: 'Profile', nameAr: 'ملف تجريبي', departmentId: department.id, branchIds: [String(branch.id)], salary: '1000.25', annualLeaveDays: 3, workDays: [0,1,2,3,4] });
    await erp.saveHrRecord(maker, 'payroll', { employeeId: employee.id, month: '2026-10' });
  });
  afterAll(async () => {
    if (admin) await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      for (const id of [tenantId, otherTenantId].filter(Boolean)) {
        await tx.hrRecord.deleteMany({ where: { tenantId: id } });
        await tx.tenant.delete({ where: { id } });
      }
    });
    await db?.onModuleDestroy(); await admin?.$disconnect();
  });
  it('hides salary fields and the whole salary history when salary access is hidden', async () => {
    const viewer: Actor = { ...maker, permissions: ['hr.employee.view','hr.leave.view','hr.attendance.view','hr.payroll.view'], dataScopes: [{ resource: 'employee', scope: 'ALL' }], fieldPermissions: [] };
    const profile: any = await erp.hrProfile(viewer, BigInt(employee.id), '2026');
    expect(profile.employee.salaryMinor).toBeUndefined();
    expect(profile.visibleSections).not.toContain('payroll');
    expect(profile.records.some((row: any) => row.kind === 'payroll')).toBe(false);
  });
  it('enforces tenant isolation in the service, RLS and the employee foreign key', async () => {
    await expect(erp.hrProfile({ ...maker, tenantId: otherTenantId }, BigInt(employee.id), '2026')).rejects.toThrow(/not found/);
    expect(await db.tenant(otherTenantId, (tx) => tx.hrRecord.findMany({ where: { employeeId: BigInt(employee.id) } }))).toHaveLength(0);
    await expect(admin.hrRecord.create({ data: { tenantId: otherTenantId, employeeId: BigInt(employee.id), createdBy: maker.userId, kind: 'attendance', recordKey: '2026-10-02', status: 'RECORDED', data: {} } })).rejects.toMatchObject({ code: 'P2003' });
  });
  it('prevents moving an employee outside a department-scoped editor’s access', async () => {
    const other = await admin.department.create({ data: { tenantId, code: 'OTHER', name: 'Other' } });
    const editor: Actor = { ...maker, permissions: ['hr.employee.view','hr.employee.edit'], departmentId: employee.departmentId, dataScopes: [{ resource: 'employee', scope: 'DEPARTMENT' }] };
    await expect(erp.saveHrEmployee(editor, { ...employee, departmentId: String(other.id) }, BigInt(employee.id))).rejects.toThrow(/access scope/);
    expect((await admin.employee.findUniqueOrThrow({ where: { id: BigInt(employee.id) } })).departmentId.toString()).toBe(employee.departmentId);
  });
  it('serializes concurrent reservations and restores the balance after cancellation', async () => {
    const result = await Promise.allSettled([
      erp.saveHrRecord(maker, 'leave', { employeeId: employee.id, startDate: '2026-10-05', endDate: '2026-10-06' }),
      erp.saveHrRecord(maker, 'leave', { employeeId: employee.id, startDate: '2026-10-07', endDate: '2026-10-08' }),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row: any = (result.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<unknown>).value;
    expect((await erp.hrProfile(maker, BigInt(employee.id), '2026') as any).leaveBalance.available).toBe(1);
    await expect(erp.reviewHrRecord(maker, BigInt(row.id), { status: 'APPROVED' })).rejects.toThrow(/another authorized user/i);
    await erp.reviewHrRecord(checker, BigInt(row.id), { status: 'APPROVED' });
    await erp.cancelHrLeave(checker, BigInt(row.id), { reason: 'Change of dates' });
    expect((await erp.hrProfile(maker, BigInt(employee.id), '2026') as any).leaveBalance.available).toBe(3);
    await expect(erp.saveHrRecord(maker, 'leave', { employeeId: employee.id, ...(row.data as object) }, BigInt(row.id))).rejects.toThrow(/cannot be changed/);
  });
});
