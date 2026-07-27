import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(process.cwd(), '../../.env') });

describe('PostgreSQL accounting controls', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  beforeAll(() => {
    admin = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_ADMIN_URL!) });
    app = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
  });

  afterAll(async () => { await admin.$disconnect(); await app.$disconnect(); });

  it('returns no tenant rows to the runtime role without a tenant scope', async () => {
    expect(await app.tenant.count()).toBe(0);
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
          WHEN d.type='SALES_INVOICE' THEN d.total_minor-d.paid_minor
          WHEN d.type IN ('SALES_RETURN','CREDIT_NOTE') THEN -d.total_minor
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
  });
});
