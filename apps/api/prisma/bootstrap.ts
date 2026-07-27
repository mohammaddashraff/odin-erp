import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seed } from './seed';

const adminUrl = process.env.DATABASE_URL_UNPOOLED
  || process.env.POSTGRES_URL_NON_POOLING
  || process.env.DATABASE_ADMIN_URL
  || process.env.DATABASE_URL;

if (!adminUrl) throw new Error('A PostgreSQL connection URL is required to bootstrap the database');

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg(adminUrl) });
  const tenantCount = await db.tenant.count();
  await db.$disconnect();

  if (tenantCount > 0) {
    console.log(`Database already contains ${tenantCount} tenant(s); skipping demo seed.`);
    return;
  }

  await seed('INITIAL_DEPLOY');
}

void main();
