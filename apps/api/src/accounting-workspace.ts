import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccountType } from '@prisma/client';

export const accountingReportNames = new Set(['trial-balance', 'general-ledger', 'account-ledger', 'income-statement', 'balance-sheet']);
export type AccountingFilters = { from: string; to: string; companyId: string; branchId: string; accountId: string; costCenter: string; search: string; page: number; pageSize: number; includeZero: boolean };
export type LedgerAccount = { id: bigint; code: string; name: string; type: AccountType; parentId?: bigint | null; postingAllowed?: boolean; controlType?: string | null; active?: boolean };
export type PostedLine = { id: bigint; accountId: bigint; description: string; debitMinor: bigint; creditMinor: bigint; costCenter: string | null; account: LedgerAccount; journalEntry: { id: bigint; number: string; postingDate: Date; branchId: bigint; sourceNumber: string; sourceModule: string; sourceType: string; sourceId: bigint } };
const dateText = (value: unknown, label: string) => {
  if (!value) return '';
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00.000Z`).valueOf()) || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) throw new BadRequestException(`${label} must be a valid date (YYYY-MM-DD).`);
  return text;
};
export function accountingFilters(query: any = {}): AccountingFilters {
  const from = dateText(query.from, 'Start date'), to = dateText(query.to, 'End date');
  if (from && to && from > to) throw new BadRequestException('Start date must not be after end date.');
  const identifier = (value: unknown, label: string) => {
    if (!value) return '';
    if (!/^[1-9]\d*$/.test(String(value))) throw new BadRequestException(`${label} is invalid.`);
    return String(value);
  };
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new BadRequestException('Page must be positive and page size must be between 1 and 500.');
  return { from, to, companyId: identifier(query.companyId, 'Company'), branchId: identifier(query.branchId, 'Branch'), accountId: identifier(query.accountId, 'Account'), costCenter: String(query.costCenter || '').trim().slice(0, 100), search: String(query.search || '').trim().slice(0, 200), page, pageSize, includeZero: query.includeZero === 'true' || query.includeZero === true };
}
export function selectedAccountIds(accounts: LedgerAccount[], selected: string) {
  if (!selected) return new Set(accounts.map((account) => account.id.toString()));
  if (!accounts.some((account) => account.id.toString() === selected)) throw new ForbiddenException('Account is outside your access scope.');
  const result = new Set([selected]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const account of accounts) if (account.parentId && result.has(account.parentId.toString()) && !result.has(account.id.toString())) { result.add(account.id.toString()); changed = true; }
  }
  return result;
}
const sum = <T>(rows: T[], amount: (row: T) => bigint) => rows.reduce((value, row) => value + amount(row), 0n);
const side = (value: bigint) => ({ debitMinor: value > 0n ? value : 0n, creditMinor: value < 0n ? -value : 0n });
const incomeTypes = new Set<AccountType>([AccountType.REVENUE, AccountType.OTHER_INCOME, AccountType.COGS, AccountType.EXPENSE, AccountType.OTHER_EXPENSE]);
export function buildAccountingReport(name: string, accounts: LedgerAccount[], input: PostedLine[], filters: AccountingFilters, currency: string, paginate = false) {
  const selected = selectedAccountIds(accounts, filters.accountId);
  const scoped = input.filter((line) => selected.has(line.accountId.toString()) && (!filters.branchId || line.journalEntry.branchId.toString() === filters.branchId) && (!filters.costCenter || line.costCenter === filters.costCenter) && (!filters.to || line.journalEntry.postingDate.toISOString().slice(0, 10) <= filters.to));
  scoped.sort((a, b) => a.journalEntry.postingDate.valueOf() - b.journalEntry.postingDate.valueOf() || (a.journalEntry.id < b.journalEntry.id ? -1 : a.journalEntry.id > b.journalEntry.id ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const opening = scoped.filter((line) => filters.from && line.journalEntry.postingDate.toISOString().slice(0, 10) < filters.from);
  const movements = scoped.filter((line) => !filters.from || line.journalEntry.postingDate.toISOString().slice(0, 10) >= filters.from);
  const openingBalanceMinor = sum(opening, (line) => line.debitMinor - line.creditMinor);
  const debitMinor = sum(movements, (line) => line.debitMinor), creditMinor = sum(movements, (line) => line.creditMinor);
  const base = { name: ({ 'trial-balance': 'Trial balance', 'general-ledger': 'General ledger', 'account-ledger': 'Account ledger', 'income-statement': 'Income statement', 'balance-sheet': 'Balance sheet' } as Record<string, string>)[name], currency, filters, generatedAt: new Date().toISOString(), basis: 'POSTED' };
  if (name === 'general-ledger' || name === 'account-ledger') {
    let runningBalanceMinor = openingBalanceMinor;
    const allRows = movements.map((line) => {
      runningBalanceMinor += line.debitMinor - line.creditMinor;
      return { id: line.id, journalId: line.journalEntry.id, journal: line.journalEntry.number, date: line.journalEntry.postingDate.toISOString().slice(0, 10), accountId: line.accountId, code: line.account.code, account: line.account.name, description: line.description, debitMinor: line.debitMinor, creditMinor: line.creditMinor, runningBalanceMinor, source: line.journalEntry.sourceNumber, sourceModule: line.journalEntry.sourceModule, sourceType: line.journalEntry.sourceType, sourceId: line.journalEntry.sourceId, branchId: line.journalEntry.branchId, costCenter: line.costCenter || '' };
    });
    const rows = allRows.filter((row) => !filters.search || [row.journal, row.source, row.code, row.account, row.description, row.costCenter].join(' ').toLowerCase().includes(filters.search.toLowerCase()));
    return { ...base, rows: paginate ? rows.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize) : rows, totals: { openingBalanceMinor, debitMinor, creditMinor, closingBalanceMinor: openingBalanceMinor + debitMinor - creditMinor }, pagination: { page: filters.page, pageSize: paginate ? filters.pageSize : rows.length, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / (paginate ? filters.pageSize : Math.max(1, rows.length)))) }, searchAffectsBalances: false };
  }
  const buckets = new Map<string, { openingMinor: bigint; movementDebitMinor: bigint; movementCreditMinor: bigint }>();
  for (const account of accounts) if (selected.has(account.id.toString())) buckets.set(account.id.toString(), { openingMinor: 0n, movementDebitMinor: 0n, movementCreditMinor: 0n });
  for (const line of scoped) {
    const bucket = buckets.get(line.accountId.toString());
    if (!bucket) continue;
    if (filters.from && line.journalEntry.postingDate.toISOString().slice(0, 10) < filters.from) bucket.openingMinor += line.debitMinor - line.creditMinor;
    else { bucket.movementDebitMinor += line.debitMinor; bucket.movementCreditMinor += line.creditMinor; }
  }
  const byAccount = accounts.filter((account) => selected.has(account.id.toString())).map((account) => {
    const bucket = buckets.get(account.id.toString())!;
    const closingMinor = bucket.openingMinor + bucket.movementDebitMinor - bucket.movementCreditMinor;
    return { id: account.id, code: account.code, name: account.name, type: account.type, parentId: account.parentId || null, postingAllowed: account.postingAllowed !== false, openingDebitMinor: side(bucket.openingMinor).debitMinor, openingCreditMinor: side(bucket.openingMinor).creditMinor, ...bucket, closingDebitMinor: side(closingMinor).debitMinor, closingCreditMinor: side(closingMinor).creditMinor, debitMinor: bucket.movementDebitMinor, creditMinor: bucket.movementCreditMinor, balanceMinor: closingMinor };
  });
  if (name === 'trial-balance') {
    const rows = byAccount.filter((row) => filters.includeZero || row.openingMinor || row.movementDebitMinor || row.movementCreditMinor).map((row) => ({ ...row, debitMinor: row.closingDebitMinor, creditMinor: row.closingCreditMinor }));
    return { ...base, rows, totals: { openingDebitMinor: sum(rows, (r) => r.openingDebitMinor), openingCreditMinor: sum(rows, (r) => r.openingCreditMinor), movementDebitMinor: sum(rows, (r) => r.movementDebitMinor), movementCreditMinor: sum(rows, (r) => r.movementCreditMinor), closingDebitMinor: sum(rows, (r) => r.closingDebitMinor), closingCreditMinor: sum(rows, (r) => r.closingCreditMinor), debitMinor: sum(rows, (r) => r.closingDebitMinor), creditMinor: sum(rows, (r) => r.closingCreditMinor), differenceMinor: sum(rows, (r) => r.balanceMinor) } };
  }
  if (name === 'income-statement') {
    const rows = byAccount.filter((row) => incomeTypes.has(row.type) && (filters.includeZero || row.movementDebitMinor || row.movementCreditMinor)).map((row) => ({ ...row, balanceMinor: row.movementDebitMinor - row.movementCreditMinor, amountMinor: [AccountType.REVENUE, AccountType.OTHER_INCOME].includes(row.type as any) ? row.movementCreditMinor - row.movementDebitMinor : row.movementDebitMinor - row.movementCreditMinor }));
    const group = (type: AccountType) => sum(rows.filter((row) => row.type === type), (row) => row.amountMinor);
    const revenueMinor = group(AccountType.REVENUE), costOfSalesMinor = group(AccountType.COGS), operatingExpenseMinor = group(AccountType.EXPENSE), otherIncomeMinor = group(AccountType.OTHER_INCOME), otherExpenseMinor = group(AccountType.OTHER_EXPENSE);
    return { ...base, rows, totals: { revenueMinor, costOfSalesMinor, grossProfitMinor: revenueMinor - costOfSalesMinor, operatingExpenseMinor, operatingProfitMinor: revenueMinor - costOfSalesMinor - operatingExpenseMinor, otherIncomeMinor, otherExpenseMinor, profitMinor: -sum(rows, (row) => row.balanceMinor) } };
  }
  if (name === 'balance-sheet') {
    const rows = byAccount.filter((row) => !incomeTypes.has(row.type) && (filters.includeZero || row.balanceMinor)).map((row) => ({ ...row, amountMinor: row.type === AccountType.ASSET ? row.balanceMinor : -row.balanceMinor }));
    const assetsMinor = sum(rows.filter((row) => row.type === AccountType.ASSET), (row) => row.amountMinor), liabilitiesMinor = sum(rows.filter((row) => row.type === AccountType.LIABILITY), (row) => row.amountMinor), equityMinor = sum(rows.filter((row) => row.type === AccountType.EQUITY), (row) => row.amountMinor), currentEarningsMinor = -sum(byAccount.filter((row) => incomeTypes.has(row.type)), (row) => row.balanceMinor);
    return { ...base, rows, totals: { assetsMinor, liabilitiesMinor, equityMinor, currentEarningsMinor, equityIncludingEarningsMinor: equityMinor + currentEarningsMinor, liabilitiesAndEquityMinor: liabilitiesMinor + equityMinor + currentEarningsMinor, differenceMinor: assetsMinor - liabilitiesMinor - equityMinor - currentEarningsMinor }, asOf: filters.to || null };
  }
  throw new BadRequestException('Accounting report is invalid.');
}
