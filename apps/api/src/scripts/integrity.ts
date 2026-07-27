import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

config({ path: resolve(process.cwd(), '../../.env') });
const db = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_ADMIN_URL!) });

async function main() {
  const journalRows = await db.$queryRaw<Array<{ id: bigint; number: string; debit: bigint; credit: bigint }>>`
    SELECT je.id, je.number, sum(jl.debit_minor)::bigint debit, sum(jl.credit_minor)::bigint credit
    FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.status='POSTED' GROUP BY je.id,je.number ORDER BY je.id`;
  const totals = journalRows.reduce((result, row) => ({ debit: result.debit + row.debit, credit: result.credit + row.credit }), { debit: 0n, credit: 0n });
  const negativeStock = await db.stockBalance.count({ where: { OR: [{ quantityMilli: { lt: 0n } }, { valueMinor: { lt: 0n } }] } });
  const [inventoryLedger] = await db.$queryRaw<Array<{ value: bigint }>>`
    SELECT coalesce(sum(jl.debit_minor-jl.credit_minor),0)::bigint value FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
    WHERE je.status='POSTED' AND a.code='1200'`;
  const inventory = await db.stockBalance.aggregate({ _sum: { valueMinor: true } });
  const [arLedger] = await db.$queryRaw<Array<{ value: bigint }>>`
    SELECT coalesce(sum(jl.debit_minor-jl.credit_minor),0)::bigint value FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
    WHERE je.status='POSTED' AND a.code='1100'`;
  const ar = await db.document.aggregate({ where: { type: 'SALES_INVOICE', status: 'POSTED' }, _sum: { totalMinor: true, paidMinor: true } });
  const arCredits = await db.document.aggregate({ where: { type: { in: ['SALES_RETURN', 'CREDIT_NOTE'] }, status: 'POSTED' }, _sum: { totalMinor: true } });
  const [apLedger] = await db.$queryRaw<Array<{ value: bigint }>>`
    SELECT coalesce(sum(jl.credit_minor-jl.debit_minor),0)::bigint value FROM journal_lines jl
    JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
    WHERE je.status='POSTED' AND a.code='2000'`;
  const ap = await db.document.aggregate({ where: { type: 'PURCHASE_BILL', status: 'POSTED' }, _sum: { totalMinor: true, paidMinor: true } });
  const apCredits = await db.document.aggregate({ where: { type: 'PURCHASE_RETURN', status: 'POSTED', sourceDocument: { type: 'PURCHASE_BILL' } }, _sum: { totalMinor: true } });
  const checks = {
    postedJournalsBalanced: journalRows.every((row) => row.debit === row.credit),
    ledgerDifferenceMinor: (totals.debit - totals.credit).toString(),
    negativeStockRows: negativeStock,
    inventoryDifferenceMinor: (inventoryLedger.value - (inventory._sum.valueMinor || 0n)).toString(),
    arDifferenceMinor: (arLedger.value - ((ar._sum.totalMinor || 0n) - (ar._sum.paidMinor || 0n) - (arCredits._sum.totalMinor || 0n))).toString(),
    apDifferenceMinor: (apLedger.value - ((ap._sum.totalMinor || 0n) - (ap._sum.paidMinor || 0n) - (apCredits._sum.totalMinor || 0n))).toString(),
    postedJournalCount: journalRows.length,
    totalDebitsMinor: totals.debit.toString(), totalCreditsMinor: totals.credit.toString(),
  };
  console.log(JSON.stringify(checks, null, 2));
  if (!checks.postedJournalsBalanced || checks.ledgerDifferenceMinor !== '0' || checks.negativeStockRows || checks.inventoryDifferenceMinor !== '0' || checks.arDifferenceMinor !== '0' || checks.apDifferenceMinor !== '0') process.exitCode = 1;
}

main().finally(() => db.$disconnect());
