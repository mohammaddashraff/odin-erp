import { assertAv8Isolation } from '../src/av8-isolation';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { normalizeDatabaseUrl } from '../src/database-url';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const databaseUrl = process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.DATABASE_ADMIN_URL
  || process.env.DATABASE_URL;

if (!databaseUrl) throw new Error('A PostgreSQL connection URL is required to provision an administrator');
const bootstrapUrl: string = normalizeDatabaseUrl(databaseUrl);

async function main() {
  assertAv8Isolation();
  const email = required('ODIN_INITIAL_ADMIN_EMAIL').toLowerCase();
  const password = required('ODIN_INITIAL_ADMIN_PASSWORD');
  const name = process.env.ODIN_INITIAL_ADMIN_NAME?.trim() || 'Odin Administrator';
  if (!/^\S+@\S+\.\S+$/.test(email) || email.endsWith('@odin.demo')) {
    throw new Error('ODIN_INITIAL_ADMIN_EMAIL must be a non-demo email address');
  }
  if (password.length < 16) throw new Error('ODIN_INITIAL_ADMIN_PASSWORD must be at least 16 characters');

  const db = new PrismaClient({ adapter: new PrismaPg(bootstrapUrl) });
  try {
    const tenants = await db.tenant.findMany({ select: { id: true } });
    if (tenants.length !== 1) throw new Error('Administrator bootstrap requires exactly one tenant');
    const tenantId = tenants[0].id;
    const [role, branches, warehouses] = await Promise.all([
      db.role.findFirst({ where: { tenantId, key: 'super_admin', active: true, archivedAt: null }, select: { id: true } }),
      db.branch.findMany({ where: { tenantId }, select: { id: true } }),
      db.warehouse.findMany({ where: { tenantId, active: true }, select: { id: true } }),
    ]);
    if (!role) throw new Error('An active Super Admin role is required');
    if (!branches.length || !warehouses.length) throw new Error('At least one branch and warehouse are required');

    const passwordHash = await hash(password, 12);
    const result = await db.$transaction(async (tx) => {
      const [activeSuperAdminCount, existing] = await Promise.all([
        tx.user.count({ where: {
          tenantId,
          active: true,
          OR: [
            { role: { key: 'super_admin', active: true, archivedAt: null } },
            { additionalRoles: { some: { role: { key: 'super_admin', active: true, archivedAt: null } } } },
          ],
        } }),
        tx.user.findUnique({ where: { tenantId_email: { tenantId, email } }, select: { id: true } }),
      ]);
      if (activeSuperAdminCount > 0) throw new Error('An active Super Admin already exists; refusing bootstrap');
      if (existing) throw new Error('The requested administrator email already exists; refusing bootstrap');

      const user = await tx.user.create({ data: {
        tenantId,
        roleId: role.id,
        email,
        name,
        passwordHash,
        branchIds: branches.map(({ id }) => id.toString()),
        warehouseIds: warehouses.map(({ id }) => id.toString()),
        mfaRequired: true,
      } });
      await tx.accessAuditLog.create({ data: {
        tenantId,
        subjectUserId: user.id,
        subjectRoleId: role.id,
        action: 'INITIAL_SUPER_ADMIN_PROVISIONED',
        newValue: { email, mfaRequired: true, source: 'ODIN_INITIAL_ADMIN' },
      } });
      return user;
    });
    console.log(`Provisioned MFA-required Super Admin ${result.email} (${result.id.toString()}).`);
  } finally {
    await db.$disconnect();
  }
}

void main();
