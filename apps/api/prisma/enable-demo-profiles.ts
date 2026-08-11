import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { normalizeDatabaseUrl } from '../src/database-url';

const profiles = [
  { email: 'admin@odin.demo', name: 'Odin Administrator', roleKey: 'super_admin' },
  { email: 'cfo@odin.demo', name: 'Mariam Nassar', roleKey: 'finance_manager' },
  { email: 'finance@odin.demo', name: 'Omar Selim', roleKey: 'finance_manager' },
  { email: 'accountant@odin.demo', name: 'Nour Adel', roleKey: 'accountant' },
  { email: 'auditor@odin.demo', name: 'Karim Fawzy', roleKey: 'auditor' },
  { email: 'sales@odin.demo', name: 'Salma Hafez', roleKey: 'sales_manager' },
  { email: 'sales.employee@odin.demo', name: 'Ahmed Hassan', roleKey: 'sales_employee' },
  { email: 'purchasing@odin.demo', name: 'Hassan Youssef', roleKey: 'purchasing_manager' },
  { email: 'warehouse@odin.demo', name: 'Tarek Mansour', roleKey: 'warehouse_keeper' },
  { email: 'cashier@odin.demo', name: 'Dina Samir', roleKey: 'pos_cashier' },
  { email: 'hr@odin.demo', name: 'Mona El-Sayed', roleKey: 'hr_manager' },
  { email: 'branch@odin.demo', name: 'Youssef Hamdy', roleKey: 'branch_manager' },
] as const;

const databaseUrl = process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.DATABASE_ADMIN_URL
  || process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('A PostgreSQL connection URL is required to enable demo profiles');
if (String(process.env.ODIN_ALLOW_SHARED_DEMO_LOGINS).toLowerCase() !== 'true') {
  throw new Error('ODIN_ALLOW_SHARED_DEMO_LOGINS=true is required to enable shared demo profiles');
}
if (String(process.env.ODIN_ENABLE_DEMO_PROFILES).toLowerCase() !== 'true') {
  throw new Error('ODIN_ENABLE_DEMO_PROFILES=true is required for this one-time operation');
}

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(databaseUrl!)) });
  try {
    const tenants = await db.tenant.findMany({ select: { id: true } });
    if (tenants.length !== 1) throw new Error('Demo profile enablement requires exactly one tenant');
    const tenantId = tenants[0].id;
    const [users, roles, branches, warehouses] = await Promise.all([
      db.user.findMany({
      where: { tenantId, email: { in: profiles.map(({ email }) => email) } },
      select: { id: true, email: true, active: true, mfaEnabled: true, role: { select: { key: true } } },
      }),
      db.role.findMany({
        where: { tenantId, key: { in: [...new Set(profiles.map(({ roleKey }) => roleKey))] }, active: true, archivedAt: null },
        select: { id: true, key: true },
      }),
      db.branch.findMany({ where: { tenantId, code: { in: ['CAI', 'ALX'] } }, select: { id: true, code: true } }),
      db.warehouse.findMany({ where: { tenantId, code: { in: ['CAI-MAIN', 'CAI-RTL', 'ALX-MAIN'] }, active: true }, select: { id: true, code: true } }),
    ]);
    const roleByKey = new Map(roles.map((role) => [role.key, role]));
    const branchByCode = new Map(branches.map((branch) => [branch.code, branch]));
    const warehouseByCode = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse]));
    const requiredRoleKeys = new Set(profiles.map(({ roleKey }) => roleKey));
    const missingRoleKeys = [...requiredRoleKeys].filter((roleKey) => !roleByKey.has(roleKey));
    if (missingRoleKeys.length) throw new Error(`Missing active demo roles: ${missingRoleKeys.join(', ')}`);
    if (!branchByCode.has('CAI') || !branchByCode.has('ALX')) throw new Error('The CAI and ALX demo branches are required');
    if (!warehouseByCode.has('CAI-MAIN') || !warehouseByCode.has('CAI-RTL') || !warehouseByCode.has('ALX-MAIN')) {
      throw new Error('The CAI-MAIN, CAI-RTL, and ALX-MAIN demo warehouses are required');
    }
    const userByEmail = new Map(users.map((user) => [user.email, user]));
    for (const user of users) {
      const expectedRole = profiles.find(({ email }) => email === user.email)?.roleKey;
      if (!expectedRole || user.role.key !== expectedRole) {
        throw new Error(`${user.email} has role ${user.role.key}; expected ${expectedRole || 'a whitelisted demo role'}`);
      }
    }

    const passwordHash = await hash('password', 12);
    const now = new Date();
    await db.$transaction(async (tx) => {
      const activatedUserIds = new Map<string, bigint>();
      for (const profile of profiles) {
        const existing = userByEmail.get(profile.email);
        const cairoRestricted = ['branch_manager', 'purchasing_manager', 'warehouse_keeper', 'pos_cashier'].includes(profile.roleKey);
        const branchIds = (cairoRestricted ? ['CAI'] : ['CAI', 'ALX'])
          .map((code) => branchByCode.get(code)!.id.toString());
        const warehouseCodes = profile.roleKey === 'pos_cashier'
          ? ['CAI-RTL']
          : cairoRestricted ? ['CAI-MAIN', 'CAI-RTL'] : ['CAI-MAIN', 'CAI-RTL', 'ALX-MAIN'];
        const warehouseIds = warehouseCodes.map((code) => warehouseByCode.get(code)!.id.toString());
        const user = await tx.user.upsert({
          where: { tenantId_email: { tenantId, email: profile.email } },
          create: {
            tenantId,
            roleId: roleByKey.get(profile.roleKey)!.id,
            email: profile.email,
            name: profile.name,
            passwordHash,
            branchIds,
            warehouseIds,
            active: true,
            mfaEnabled: false,
            mfaRequired: false,
          },
          update: {
            name: profile.name,
            passwordHash,
            branchIds,
            warehouseIds,
            active: true,
            authVersion: { increment: 1 },
            mfaEnabled: false,
            mfaRequired: false,
            mfaSecretEncrypted: null,
            mfaRecoveryHashes: [],
            mfaEnrolledAt: null,
          },
          select: { id: true },
        });
        activatedUserIds.set(profile.email, user.id);
        await tx.refreshSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
        await tx.accessAuditLog.create({
          data: {
            tenantId,
            subjectUserId: user.id,
            action: 'DEMO_PROFILE_ENABLED',
            previousValue: existing ? { active: existing.active, mfaEnabled: existing.mfaEnabled } : undefined,
            newValue: { active: true, created: !existing, mfaEnabled: false, source: 'ODIN_ENABLE_DEMO_PROFILES' },
          },
        });
      }

      const salesManagerRole = roleByKey.get('sales_manager')!;
      await tx.roleDataScope.updateMany({
        where: { tenantId, roleId: salesManagerRole.id },
        data: { config: { userIds: [activatedUserIds.get('sales@odin.demo')!.toString(), activatedUserIds.get('sales.employee@odin.demo')!.toString()] } },
      });
      await tx.employee.updateMany({
        where: { tenantId, code: 'EMP-0015' },
        data: { userId: activatedUserIds.get('sales.employee@odin.demo')! },
      });
      await tx.employee.updateMany({
        where: { tenantId, code: 'EMP-0032' },
        data: { userId: activatedUserIds.get('hr@odin.demo')! },
      });
      await tx.customer.updateMany({
        where: { tenantId, code: { in: ['CUS-000001', 'CUS-000003'] } },
        data: { ownerUserId: activatedUserIds.get('sales.employee@odin.demo')! },
      });
    }, { maxWait: 10_000, timeout: 30_000 });

    console.log(`Enabled ${profiles.length} role-based demo profiles for tenant ${tenantId.toString()}.`);
  } finally {
    await db.$disconnect();
  }
}

void main();
