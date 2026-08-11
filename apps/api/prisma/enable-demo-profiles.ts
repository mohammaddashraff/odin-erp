import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { normalizeDatabaseUrl } from '../src/database-url';

const profiles = new Map([
  ['admin@odin.demo', 'super_admin'],
  ['cfo@odin.demo', 'finance_manager'],
  ['finance@odin.demo', 'finance_manager'],
  ['accountant@odin.demo', 'accountant'],
  ['auditor@odin.demo', 'auditor'],
  ['sales@odin.demo', 'sales_manager'],
  ['sales.employee@odin.demo', 'sales_employee'],
  ['purchasing@odin.demo', 'purchasing_manager'],
  ['warehouse@odin.demo', 'warehouse_keeper'],
  ['cashier@odin.demo', 'pos_cashier'],
  ['hr@odin.demo', 'hr_manager'],
  ['branch@odin.demo', 'branch_manager'],
]);

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
    const users = await db.user.findMany({
      where: { tenantId, email: { in: [...profiles.keys()] } },
      select: { id: true, email: true, active: true, mfaEnabled: true, role: { select: { key: true } } },
    });
    if (users.length !== profiles.size) {
      const found = new Set(users.map(({ email }) => email));
      const missing = [...profiles.keys()].filter((email) => !found.has(email));
      throw new Error(`Expected all 12 seeded demo profiles; missing: ${missing.join(', ')}`);
    }
    for (const user of users) {
      const expectedRole = profiles.get(user.email);
      if (user.role.key !== expectedRole) {
        throw new Error(`${user.email} has role ${user.role.key}; expected ${expectedRole}`);
      }
    }

    const passwordHash = await hash('password', 12);
    const now = new Date();
    await db.$transaction(async (tx) => {
      for (const user of users) {
        await tx.refreshSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.mfaChallenge.deleteMany({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: {
            active: true,
            passwordHash,
            authVersion: { increment: 1 },
            mfaEnabled: false,
            mfaRequired: false,
            mfaSecretEncrypted: null,
            mfaRecoveryHashes: [],
            mfaEnrolledAt: null,
          },
        });
        await tx.accessAuditLog.create({
          data: {
            tenantId,
            subjectUserId: user.id,
            action: 'DEMO_PROFILE_ENABLED',
            previousValue: { active: user.active, mfaEnabled: user.mfaEnabled },
            newValue: { active: true, mfaEnabled: false, source: 'ODIN_ENABLE_DEMO_PROFILES' },
          },
        });
      }
    }, { maxWait: 10_000, timeout: 30_000 });

    console.log(`Enabled ${profiles.size} role-based demo profiles for tenant ${tenantId.toString()}.`);
  } finally {
    await db.$disconnect();
  }
}

void main();
