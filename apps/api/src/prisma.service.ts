import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { enforceTlsVerification } from './database-url';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly admin: PrismaClient;
  readonly app: PrismaClient;

  constructor() {
    const adminUrl = process.env.DATABASE_URL_UNPOOLED
      || process.env.POSTGRES_URL_NON_POOLING
      || process.env.DATABASE_ADMIN_URL
      || process.env.DATABASE_URL;
    const appUrl = process.env.DATABASE_URL || adminUrl;
    if (!adminUrl || !appUrl) throw new Error('DATABASE_ADMIN_URL and DATABASE_URL are required');
    this.admin = new PrismaClient({ adapter: new PrismaPg(enforceTlsVerification(adminUrl)) });
    this.app = new PrismaClient({ adapter: new PrismaPg(enforceTlsVerification(appUrl)) });
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

  async onModuleDestroy() {
    await Promise.all([this.admin.$disconnect(), this.app.$disconnect()]);
  }
}
