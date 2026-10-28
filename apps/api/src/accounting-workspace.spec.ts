import { AccountType } from '@prisma/client';
import { accountingFilters, buildAccountingReport, type PostedLine } from './accounting-workspace';

const accounts = [
  { id: 1n, code: '1', name: 'Cash', type: AccountType.ASSET },
  { id: 2n, code: '2', name: 'Capital', type: AccountType.EQUITY },
  { id: 3n, code: '3', name: 'Revenue', type: AccountType.REVENUE },
];
const line = (id: bigint, accountId: bigint, date: string, debit: bigint, credit: bigint): PostedLine => ({ id, accountId, description: 'Transaction', debitMinor: debit, creditMinor: credit, costCenter: null, account: accounts.find((a) => a.id === accountId)!, journalEntry: { id, number: `JE-${id}`, postingDate: new Date(date), branchId: 1n, sourceNumber: `SRC-${id}`, sourceModule: 'GENERAL_LEDGER', sourceType: 'MANUAL', sourceId: id } });
describe('Exact accounting workspace calculations', () => {
  it('validates calendar dates, ranges, IDs, and pagination without rounding', () => {
    for (const query of [{ from: '2026-02-30' }, { from: '2026-02-02', to: '2026-02-01' }, { accountId: '-1' }, { pageSize: 501 }]) expect(() => accountingFilters(query)).toThrow();
  });
  it('preserves arbitrary precision in opening, movement and running balances across pages', () => {
    const huge = 9007199254740993n;
    const report: any = buildAccountingReport('general-ledger', accounts, [line(1n, 1n, '2026-01-01', huge, 0n), line(2n, 1n, '2026-02-02', 101n, 0n), line(3n, 1n, '2026-02-03', 0n, 1n)], accountingFilters({ from: '2026-02-01', to: '2026-02-28', accountId: '1', page: 2, pageSize: 1 }), 'EGP', true);
    expect(report.totals).toEqual({ openingBalanceMinor: huge, debitMinor: 101n, creditMinor: 1n, closingBalanceMinor: huge + 100n });
    expect(report.rows[0].runningBalanceMinor).toBe(huge + 100n);
    expect(report.pagination.total).toBe(2);
  });
  it('separates period profit from cumulative earnings and reconciles the balance sheet', () => {
    const lines = [line(1n, 1n, '2026-01-01', 10000n, 0n), line(2n, 2n, '2026-01-01', 0n, 10000n), line(3n, 1n, '2026-02-01', 3000n, 0n), line(4n, 3n, '2026-02-01', 0n, 3000n)];
    const pnl: any = buildAccountingReport('income-statement', accounts, lines, accountingFilters({ from: '2026-02-01', to: '2026-02-28' }), 'EGP');
    const bs: any = buildAccountingReport('balance-sheet', accounts, lines, accountingFilters({ from: '2026-02-20', to: '2026-02-28' }), 'EGP');
    expect(pnl.totals.profitMinor).toBe(3000n);
    expect(bs.totals).toMatchObject({ assetsMinor: 13000n, equityMinor: 10000n, currentEarningsMinor: 3000n, differenceMinor: 0n });
  });
  it('rolls up an existing posting parent with its child without doubling trial-balance amounts', () => {
    const child = { id: 4n, code: '1.001', name: 'Petty cash', type: AccountType.ASSET, parentId: 1n, postingAllowed: true };
    const tree = [{ ...accounts[0], postingAllowed: true }, ...accounts.slice(1), child];
    const own = line(1n, 1n, '2026-01-02', 100n, 0n);
    const childMovement = { ...line(2n, 1n, '2026-01-03', 30n, 0n), accountId: child.id, account: child };
    const ledger: any = buildAccountingReport('account-ledger', tree, [own, childMovement], accountingFilters({ accountId: '1' }), 'EGP');
    expect(ledger.totals.closingBalanceMinor).toBe(130n);
    const trial: any = buildAccountingReport('trial-balance', tree, [own, childMovement], accountingFilters(), 'EGP');
    expect(trial.rows.find((row: any) => row.id === 1n).debitMinor).toBe(100n);
    expect(trial.rows.find((row: any) => row.id === 4n).debitMinor).toBe(30n);
    expect(trial.totals.debitMinor).toBe(130n);
  });
  it('uses real parent relationships for group selection, and does not reset running balances for text search', () => {
    const tree = [...accounts, { id: 4n, code: 'GROUP', name: 'Asset group', type: AccountType.ASSET, postingAllowed: false }].map((a) => a.id === 1n ? { ...a, parentId: 4n } : a);
    const report: any = buildAccountingReport('general-ledger', tree, [line(1n, 1n, '2026-01-01', 100n, 0n), line(2n, 1n, '2026-01-02', 20n, 0n)], accountingFilters({ accountId: '4', search: 'JE-2' }), 'EGP');
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].runningBalanceMinor).toBe(120n);
    expect(report.totals.debitMinor).toBe(120n);
    expect(() => buildAccountingReport('trial-balance', tree, [], accountingFilters({ accountId: '999' }), 'EGP')).toThrow('outside your access scope');
  });
});
