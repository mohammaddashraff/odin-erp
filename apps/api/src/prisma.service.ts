import { assertAv8Isolation } from './av8-isolation';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { normalizeDatabaseUrl } from './database-url';

@Injectable()
export class PrismaService implements OnModuleDestroy, OnModuleInit {
  readonly admin: PrismaClient;
  readonly app: PrismaClient;

  constructor() {
    assertAv8Isolation();
    const adminUrl = process.env.DATABASE_URL_UNPOOLED
      || process.env.POSTGRES_URL_NON_POOLING
      || process.env.DATABASE_ADMIN_URL
      || process.env.DATABASE_URL;
    const appUrl = process.env.DATABASE_URL || adminUrl;
    if (!adminUrl || !appUrl) throw new Error('DATABASE_ADMIN_URL and DATABASE_URL are required');
    const options={max:4,idleTimeoutMillis:5000,connectionTimeoutMillis:15000};
    this.admin = new PrismaClient({ adapter: new PrismaPg({connectionString:normalizeDatabaseUrl(adminUrl),...options}) });
    this.app = new PrismaClient({ adapter: new PrismaPg({connectionString:normalizeDatabaseUrl(appUrl),...options}) });
  }

  async onModuleInit() {
    if(process.env.AV8_ENV!=='production')return;
    const identity:any=await this.admin.$queryRaw`SELECT resource FROM av8_guard.av8_environment_identity`;
    if(identity.length!==1||identity[0].resource!=='av8-erp-production:cool-meadow-67774901')throw new Error('Hosted AV8 database marker mismatch');
    const runtime:any=await this.app.$queryRaw`SELECT current_user AS name, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user`;
    if(runtime[0]?.name!=='av8_runtime'||runtime[0].rolbypassrls||runtime[0].rolsuper)throw new Error('Hosted AV8 runtime role must enforce RLS');
  }

  async tenant<T>(tenantId: bigint, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.app.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId.toString()}, true)`;
          return work(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
      } catch (error: any) {
        const retryable = error?.code === 'P2034'
          || (error?.code === 'P2010' && String(error?.meta?.code) === '40001')
          || /could not serialize access/i.test(String(error?.message || ''));
        if (!retryable || attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
    throw new Error('Tenant transaction retry limit reached');
  }

  async healthCheck() {
    await this.admin.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    await Promise.all([this.admin.$disconnect(), this.app.$disconnect()]);
  }
}
