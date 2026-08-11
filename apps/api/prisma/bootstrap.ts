import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { normalizeDatabaseUrl } from '../src/database-url';
import { seed } from './seed';
import { PERMISSION_REGISTRY } from '../src/permissions';

const adminUrl = process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.DATABASE_ADMIN_URL
  || process.env.DATABASE_URL;

if (!adminUrl) throw new Error('A PostgreSQL connection URL is required to bootstrap the database');
const bootstrapUrl: string = normalizeDatabaseUrl(adminUrl);

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg(bootstrapUrl) });
  const tenants = await db.tenant.findMany({ select: { id: true } });
  const tenantCount = tenants.length;

  for (const tenant of tenants) {
    for (const permission of PERMISSION_REGISTRY) {
      await db.permission.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: permission.key } },
        update: { module: permission.module, resource: permission.resource, action: permission.action, description: permission.description, active: true },
        create: { tenantId: tenant.id, ...permission },
      });
    }
  }
  await db.$disconnect();

  if (tenantCount > 0) {
    console.log(`Database already contains ${tenantCount} tenant(s); skipping demo seed.`);
    return;
  }

  await seed('INITIAL_DEPLOY');
}

void main();
