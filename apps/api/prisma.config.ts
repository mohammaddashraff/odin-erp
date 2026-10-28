import { assertAv8Isolation } from './src/av8-isolation';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';
import { normalizeDatabaseUrl } from './src/database-url';


assertAv8Isolation();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: normalizeDatabaseUrl(process.env.DATABASE_URL_UNPOOLED
      ?? process.env.POSTGRES_URL_NON_POOLING
      ?? process.env.DATABASE_ADMIN_URL
      ?? process.env.DATABASE_URL
      ?? ''),
  },
});
