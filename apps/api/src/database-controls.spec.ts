import { config } from 'dotenv';
import { resolve } from 'node:path';
import { normalizeDatabaseUrl } from './database-url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('PostgreSQL accounting controls', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    app = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_URL!)) });
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
      await tx.tenant.deleteMany({ where: { name: { startsWith: 'Access isolation ' } } });
    });
  });

  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  it('returns no tenant rows to the runtime role without a tenant scope', async () => {
    expect(await app.tenant.count()).toBe(0);
    expect(await app.role.count()).toBe(0);
    expect(await app.permission.count()).toBe(0);
    expect(await app.accessAuditLog.count()).toBe(0);
  });

  it('enforces tenant row-level security for explicit tenant scopes', async () => {
    const visible = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '1', true)`;
      return tx.tenant.count();
    });
    const foreign = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '999999', true)`;
      return tx.tenant.count();
    });
    expect(visible).toBe(1);
    expect(foreign).toBe(0);
  });

  it('isolates roles, permissions, user assignments, and access audit logs between tenants', async () => {
    const primaryTenant = await admin.tenant.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const foreignTenant = await admin.tenant.create({ data: { name: `Access isolation ${Date.now()}` } });
    try {
      const foreignRole = await admin.role.create({ data: { tenantId: foreignTenant.id, name: 'Foreign role', permissions: [] } });
      const foreignPermission = await admin.permission.create({ data: {
        tenantId: foreignTenant.id,
        key: 'foreign.resource.view',
        module: 'foreign',
        resource: 'resource',
        action: 'view',
      } });
      await admin.rolePermission.create({ data: { tenantId: foreignTenant.id, roleId: foreignRole.id, permissionId: foreignPermission.id } });
      await admin.accessAuditLog.create({ data: { tenantId: foreignTenant.id, action: 'FOREIGN_SECURITY_EVENT' } });

      const primary = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${primaryTenant.id.toString()}, true)`;
        return {
          foreignRole: await tx.role.count({ where: { id: foreignRole.id } }),
          foreignPermission: await tx.permission.count({ where: { id: foreignPermission.id } }),
          foreignAssignment: await tx.rolePermission.count({ where: { roleId: foreignRole.id } }),
          foreignAudit: await tx.accessAuditLog.count({ where: { action: 'FOREIGN_SECURITY_EVENT' } }),
        };
      });
      expect(primary).toEqual({ foreignRole: 0, foreignPermission: 0, foreignAssignment: 0, foreignAudit: 0 });

      const foreign = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${foreignTenant.id.toString()}, true)`;
        return {
          roles: await tx.role.count(),
          permissions: await tx.permission.count(),
          assignments: await tx.rolePermission.count(),
          audit: await tx.accessAuditLog.count(),
        };
      });
      expect(foreign).toEqual({ roles: 1, permissions: 1, assignments: 1, audit: 1 });
    } finally {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.tenant.delete({ where: { id: foreignTenant.id } });
      });
    }
  });

  it('keeps every posted journal and the complete ledger balanced', async () => {
    const rows = await admin.$queryRaw<Array<{ id: bigint; debit: bigint; credit: bigint }>>`
      SELECT je.id, sum(jl.debit_minor)::bigint debit, sum(jl.credit_minor)::bigint credit
      FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id
      WHERE je.status = 'POSTED' GROUP BY je.id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.debit).toBe(row.credit);
  });

  it('reconciles inventory value to its GL control account', async () => {
    const [ledger] = await admin.$queryRaw<Array<{ value: bigint }>>`
      SELECT coalesce(sum(jl.debit_minor-jl.credit_minor),0)::bigint value
      FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id WHERE je.status='POSTED' AND a.code='1200'`;
    const stock = await admin.stockBalance.aggregate({ _sum: { valueMinor: true } });
    expect(ledger.value).toBe(stock._sum.valueMinor);
  });

  it('reconciles AR and AP control accounts after allocations and returns', async () => {
    const [controls] = await admin.$queryRaw<Array<{ ar_ledger: bigint; ap_ledger: bigint }>>`
      SELECT
        coalesce(sum(CASE WHEN a.code='1100' THEN jl.debit_minor-jl.credit_minor ELSE 0 END),0)::bigint ar_ledger,
        coalesce(sum(CASE WHEN a.code='2000' THEN jl.credit_minor-jl.debit_minor ELSE 0 END),0)::bigint ap_ledger
      FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
      WHERE je.status='POSTED'`;
    const [subledgers] = await admin.$queryRaw<Array<{ ar_subledger: bigint; ap_subledger: bigint }>>`
      SELECT
        coalesce(sum(CASE
          WHEN d.type='SALES_INVOICE' THEN
            round(d.total_minor*d.exchange_rate_micros/1000000.0)::bigint
            - round(d.paid_minor*d.exchange_rate_micros/1000000.0)::bigint
          WHEN d.type IN ('SALES_RETURN','CREDIT_NOTE') THEN
            -round(d.total_minor*d.exchange_rate_micros/1000000.0)::bigint
          ELSE 0 END),0)::bigint ar_subledger,
        coalesce(sum(CASE
          WHEN d.type='PURCHASE_BILL' THEN d.total_minor-d.paid_minor
          WHEN d.type='PURCHASE_RETURN' AND source.type='PURCHASE_BILL' THEN -d.total_minor
          ELSE 0 END),0)::bigint ap_subledger
      FROM documents d
      LEFT JOIN documents source ON source.id=d.source_document_id
      WHERE d.status='POSTED'`;
    expect(controls.ar_ledger).toBe(subledgers.ar_subledger);
    expect(controls.ap_ledger).toBe(subledgers.ap_subledger);
  });

  it('rejects mutation of posted journals and append-only audit events', async () => {
    await expect(app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '1', true)`;
      const journal = await tx.journalEntry.findFirstOrThrow({ where: { status: 'POSTED' } });
      await tx.journalEntry.update({ where: { id: journal.id }, data: { description: 'forbidden mutation' } });
    })).rejects.toThrow(/immutable/i);
    await expect(app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '1', true)`;
      const event = await tx.auditEvent.findFirstOrThrow();
      await tx.auditEvent.update({ where: { id: event.id }, data: { action: 'forbidden mutation' } });
    })).rejects.toThrow(/append-only/i);
    await admin.accessAuditLog.create({ data: { tenantId: 1n, action: 'APPEND_ONLY_TEST' } });
    try {
      await expect(app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '1', true)`;
        const event = await tx.accessAuditLog.findFirstOrThrow({ where: { action: 'APPEND_ONLY_TEST' } });
        await tx.accessAuditLog.delete({ where: { id: event.id } });
      })).rejects.toThrow(/append-only/i);
    } finally {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`;
        await tx.accessAuditLog.deleteMany({ where: { tenantId: 1n, action: 'APPEND_ONLY_TEST' } });
      });
    }
  });
});
