import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { Actor } from './auth';
import { normalizeDatabaseUrl } from './database-url';
import { ErpService } from './erp.service';
import { PrismaService } from './prisma.service';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('Accounting workspace PostgreSQL controls', () => {
  let admin: PrismaClient, database: PrismaService, erp: ErpService;
  let tenantId: bigint, companyId: bigint, branchId: bigint, otherBranchId: bigint;
  let maker: Actor, checker: Actor;
  let group: any, asset: any, revenue: any, equity: any, expense: any;
  let postedJournal: any;
  const governance = { enforceAuthorityLimit: jest.fn().mockResolvedValue(undefined) };
  const journal = async (date: string, debitAccount: any, creditAccount: any, amount: string, branch = branchId, description = 'Workspace test') => {
    const result: any = await erp.createJournal(maker, { branchId: branch.toString(), postingDate: date, description, lines: [{ accountId: debitAccount.id, debit: amount, credit: '0' }, { accountId: creditAccount.id, debit: '0', credit: amount }] });
    await erp.journalWorkflow(maker, BigInt(result.id), 'submit');
    await erp.journalWorkflow(checker, BigInt(result.id), 'approve');
    await erp.journalWorkflow(checker, BigInt(result.id), 'post');
    return result;
  };
  beforeAll(async () => {
    admin = new PrismaClient({ adapter: new PrismaPg(normalizeDatabaseUrl(process.env.DATABASE_ADMIN_URL!)) });
    database = new PrismaService(); erp = new ErpService(database, governance as any);
    const tenant = await admin.tenant.create({ data: { name: `Accounting workspace ${Date.now()}`, baseCurrency: 'EGP', makerChecker: true, negativeStock: false } }); tenantId = tenant.id;
    const company = await admin.company.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'DEFAULT' } } }); companyId = company.id;
    const branch = await admin.branch.create({ data: { tenantId, code: 'QA', name: 'Accounting QA' } }); branchId = branch.id;
    const other = await admin.branch.create({ data: { tenantId, code: 'OTHER', name: 'Other branch' } }); otherBranchId = other.id;
    const role = await admin.role.create({ data: { tenantId, name: 'Accounting QA role', permissions: ['*'] } });
    const users = await Promise.all(['Maker', 'Checker'].map((name) => admin.user.create({ data: { tenantId, roleId: role.id, name, email: `${name.toLowerCase()}-${tenantId}@odin.test`, passwordHash: 'service-test-only', branchIds: [branchId.toString(), otherBranchId.toString()], warehouseIds: [] } })));
    const actor = (user: typeof users[0]): Actor => ({ userId: user.id, tenantId, email: user.email, name: user.name, role: role.name, roleIds: [role.id.toString()], permissions: ['system.super_admin'], deniedPermissions: [], legacyPermissions: ['*'], dataScopes: [], fieldPermissions: [], limits: {}, branchIds: [branchId.toString(), otherBranchId.toString()], warehouseIds: [], companyIds: [companyId.toString()], companyAdminIds: [companyId.toString()], companyBranchIds: { [companyId.toString()]: [branchId.toString(), otherBranchId.toString()] }, companyScopedPermissions: {}, companyResourceAssignments: {} });
    maker = actor(users[0]); checker = actor(users[1]);
    for (const month of [1, 2]) await admin.fiscalPeriod.create({ data: { tenantId, year: 2026, month, name: `2026-${month}`, startDate: new Date(`2026-0${month}-01`), endDate: new Date(month === 1 ? '2026-01-31' : '2026-02-28'), status: 'OPEN' } });
    group = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'A9000', name: 'Asset group', type: 'ASSET', postingAllowed: false });
    asset = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'A9001', name: 'Operating cash', type: 'ASSET', parentId: group.id });
    revenue = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'R9001', name: 'Income', type: 'REVENUE' });
    equity = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'Q9001', name: 'Capital', type: 'EQUITY' });
    expense = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'E9001', name: 'Expense', type: 'EXPENSE' });
    await journal('2026-01-10', asset, equity, '100.00');
    postedJournal = await journal('2026-02-10', asset, revenue, '30.00');
    await journal('2026-02-15', expense, asset, '10.00');
    await journal('2026-02-20', asset, revenue, '999.00', otherBranchId);
  }, 30000);
  afterAll(async () => {
    if (tenantId) await admin.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.reset_mode', 'on', true)`; await tx.tenant.delete({ where: { id: tenantId } }); });
    if (database) await database.onModuleDestroy(); if (admin) await admin.$disconnect();
  });
  it('persists real hierarchy, prevents cycles and incompatible parent/type/posting changes', async () => {
    const child: any = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'A9100', name: 'Nested asset group', type: 'ASSET', parentId: group.id, postingAllowed: false });
    await expect(erp.saveAccountingAccount(maker, BigInt(group.id), { parentId: child.id })).rejects.toThrow('cycle');
    await expect(erp.saveAccountingAccount(maker, BigInt(revenue.id), { parentId: group.id })).rejects.toThrow('same account type');
    await expect(erp.saveAccountingAccount(maker, BigInt(group.id), { postingAllowed: true })).rejects.toThrow('children');
    const list: any = await erp.accountingAccounts(maker, { includeInactive: 'true' });
    expect(list.rows.find((row: any) => row.id === asset.id)).toMatchObject({ parentId: group.id, hasActivity: true });
  });
  it('protects used codes/types and system mappings, archives only safe zero-balance leaves', async () => {
    await expect(erp.saveAccountingAccount(maker, BigInt(asset.id), { code: 'CHANGED' })).rejects.toThrow('activity or a system mapping');
    await expect(erp.saveAccountingAccount(maker, BigInt(asset.id), { active: false })).rejects.toThrow('non-zero');
    await expect(erp.saveAccountingAccount(maker, BigInt(asset.id), { controlType: 'AR' })).rejects.toThrow('Control account');
    const system: any = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: '4000', name: 'System revenue', type: 'REVENUE' });
    await expect(erp.saveAccountingAccount(maker, BigInt(system.id), { active: false })).rejects.toThrow('system or bank-linked');
    const spare: any = await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: 'A9999', name: 'Unused account', type: 'ASSET' });
    await erp.saveAccountingAccount(maker, BigInt(spare.id), { active: false });
    const active: any = await erp.accountingAccounts(maker); expect(active.rows.some((row: any) => row.id === spare.id)).toBe(false);
    const all: any = await erp.accountingAccounts(maker, { includeInactive: 'true' }); expect(all.rows.find((row: any) => row.id === spare.id).active).toBe(false);
  });
  it('links a new GL definition only to the selected company and blocks editing across unassigned companies', async () => {
    const secondCompany = await admin.company.create({ data: { tenantId, code: 'SECOND', name: 'Second company', baseCurrency: 'EGP' } });
    const second: any = await erp.saveAccountingAccount(maker, null, { companyId: secondCompany.id.toString(), code: 'SECOND-ACCOUNT', name: 'Company-owned definition', type: 'ASSET' });
    const mappings = await admin.financialResource.findMany({ where: { linkedAccountId: BigInt(second.id) } });
    expect(mappings).toHaveLength(1); expect(mappings[0].companyId).toBe(secondCompany.id);
    const scoped: Actor = { ...maker, permissions: ['accounting.account.view', 'accounting.account.edit'], legacyPermissions: [], dataScopes: [{ resource: 'account', scope: 'ALL', config: {} }] };
    await expect(erp.suggestedAccountingAccountCode(scoped, { companyId: secondCompany.id.toString(), type: 'ASSET' })).rejects.toThrow('memberships');
    await expect(erp.saveAccountingAccount(scoped, BigInt(second.id), { name: 'Unauthorized' })).rejects.toThrow('Account not found');
    const firstCompany: any = await erp.accountingAccounts(maker, { companyId: companyId.toString() });
    expect(firstCompany.rows.some((row: any) => row.id === second.id)).toBe(false);
    await admin.financialResource.create({ data: { tenantId, companyId: secondCompany.id, type: 'GL_ACCOUNT', code: 'SHARED-ASSET', name: 'Shared asset', linkedAccountId: BigInt(asset.id) } });
    await expect(erp.saveAccountingAccount(scoped, BigInt(asset.id), { name: 'Would alter another company' })).rejects.toThrow('memberships');
    const otherCompanyLedger: any = await erp.accountingLedger(maker, { companyId: secondCompany.id.toString() }); expect(otherCompanyLedger.rows).toHaveLength(0); expect(otherCompanyLedger.totals.closingBalanceMinor).toBe('0');
    await expect(erp.accountingLedger(maker, { companyId: secondCompany.id.toString(), branchId: branchId.toString() })).rejects.toThrow('selected company');
  });
  it('returns exact opening/movement/closing balances with server paging, group descendants, and export parity', async () => {
    const query = { from: '2026-02-01', to: '2026-02-28', branchId: branchId.toString(), accountId: group.id, page: 2, pageSize: 1 };
    const ledger: any = await erp.accountingLedger(maker, query);
    expect(ledger.totals).toEqual({ openingBalanceMinor: '10000', debitMinor: '3000', creditMinor: '1000', closingBalanceMinor: '12000' });
    expect(ledger.rows).toHaveLength(1); expect(ledger.rows[0].runningBalanceMinor).toBe('12000'); expect(ledger.pagination.total).toBe(2);
    const report: any = await erp.report(maker, 'general-ledger', undefined, query);
    const companyLedger: any = await erp.accountingLedger(maker, { ...query, companyId: companyId.toString() }); expect(companyLedger.totals).toEqual(ledger.totals);
    for (const action of ['print', 'export'] as const) { const output: any = await erp.reportOutput(maker, 'general-ledger', action, query); expect(output.rows).toEqual(report.rows); expect(output.totals).toEqual(report.totals); }
    expect(report.rows).toHaveLength(2); expect(report.rows[0].sourceId).toBeDefined();
    const trial: any = await erp.report(maker, 'trial-balance', undefined, { ...query, accountId: '' });
    expect(trial.totals).toMatchObject({ openingDebitMinor: '10000', openingCreditMinor: '10000', movementDebitMinor: '4000', movementCreditMinor: '4000', closingDebitMinor: '13000', closingCreditMinor: '13000', differenceMinor: '0' });
    const pnl: any = await erp.report(maker, 'income-statement', undefined, { ...query, accountId: '' }); expect(pnl.totals.profitMinor).toBe('2000');
    const bs: any = await erp.report(maker, 'balance-sheet', undefined, { ...query, accountId: '' }); expect(bs.totals).toMatchObject({ assetsMinor: '12000', equityMinor: '10000', currentEarningsMinor: '2000', differenceMinor: '0' });
  });
  it('denies forbidden branches/accounts, hidden journal values and foreign company account creation', async () => {
    const restricted: Actor = { ...maker, permissions: ['accounting.journal.view', 'accounting.account.view', 'accounting.account.create', 'reports.standard.view'], legacyPermissions: [], branchIds: [branchId.toString()], companyAdminIds: [], companyBranchIds: { [companyId.toString()]: [branchId.toString()] }, dataScopes: [{ resource: 'journal', scope: 'BRANCH', config: {} }, { resource: 'report', scope: 'BRANCH', config: {} }, { resource: 'account', scope: 'ASSIGNED', config: { resourceIds: [asset.id] } }], fieldPermissions: [{ resource: 'journal', field: 'lines', access: 'VIEW' }] };
    await expect(erp.accountingLedger(restricted, { branchId: otherBranchId.toString() })).rejects.toThrow('outside your access');
    await expect(erp.accountingLedger(restricted, { accountId: revenue.id })).rejects.toThrow('outside your access');
    const permitted: any = await erp.accountingLedger(restricted, { accountId: asset.id }); expect(permitted.totals.closingBalanceMinor).toBe('12000');
    await expect(erp.accountingLedger({ ...restricted, fieldPermissions: [] })).rejects.toThrow('hidden');
    await expect(erp.saveAccountingAccount({ ...restricted, companyIds: [] }, null, { companyId: companyId.toString(), code: 'FOREIGN', name: 'Forbidden', type: 'ASSET' })).rejects.toThrow('memberships');
  });
  it('edits full manual drafts, validates balances/periods/control accounts and preserves immutable posted entries', async () => {
    const draft: any = await erp.createJournal(maker, { branchId: branchId.toString(), postingDate: '2026-02-11', description: 'Editable draft', lines: [{ accountId: asset.id, debit: '1', credit: '0' }, { accountId: revenue.id, debit: '0', credit: '1' }] });
    const edited: any = await erp.updateJournal(maker, BigInt(draft.id), { description: 'Revised draft', postingDate: '2026-02-12', lines: [{ accountId: expense.id, debit: '2.35', credit: '0' }, { accountId: asset.id, debit: '0', credit: '2.35' }] });
    expect(edited.lines.find((line: any) => line.accountId === expense.id).debitMinor).toBe('235'); expect(edited.postingDate).toContain('2026-02-12');
    await expect(erp.updateJournal(maker, BigInt(draft.id), { lines: [{ accountId: expense.id, debit: '2', credit: '-1' }, { accountId: asset.id, debit: '0', credit: '3' }] })).rejects.toThrow('either debit or credit');
    await expect(erp.updateJournal(maker, BigInt(draft.id), { postingDate: '2026-03-01' })).rejects.toThrow('No fiscal period');
    await expect(erp.updateJournal(maker, BigInt(postedJournal.id), { description: 'Forbidden' })).rejects.toThrow('immutable');
    const detail: any = await erp.journalDetail(maker, BigInt(postedJournal.id)); expect(detail.approvedBy.name).toBe('Checker'); expect(detail.branch.id).toBe(branchId.toString());
    const reversal: any = await erp.reverseJournal(maker, BigInt(postedJournal.id), { postingDate: '2026-02-28', reason: 'Correction' });
    await expect(erp.updateJournal(maker, BigInt(reversal.id), { postingDate: '2026-02-27' })).rejects.toThrow('Linked reversal lines');
  });
  it('creates only valid non-overlapping fiscal periods and retains OPEN/CLOSED/LOCKED controls', async () => {
    const fields = { year: '2028', month: '3', name: 'March 2028', startDate: '2028-03-01', endDate: '2028-03-31' };
    await expect(erp.createPeriod(maker, { ...fields, startDate: '2028-02-30' })).rejects.toThrow('valid date');
    await expect(erp.createPeriod(maker, { ...fields, startDate: '2028-03-31', endDate: '2028-03-01' })).rejects.toThrow('after end date');
    await expect(erp.createPeriod(maker, { ...fields, startDate: '' })).rejects.toThrow('required');
    await expect(erp.createPeriod(maker, { ...fields, startDate: '2026-01-15', endDate: '2026-02-15' })).rejects.toThrow('overlap');
    const created: any = await erp.createPeriod(maker, fields); expect(created.status).toBe('OPEN');
    const locked: any = await erp.updatePeriod(maker, BigInt(created.id), 'LOCKED'); expect(locked.status).toBe('LOCKED');
    await expect(erp.createJournal(maker, { branchId: branchId.toString(), postingDate: '2028-03-10', description: 'Closed period test', lines: [{ accountId: asset.id, debit: '1', credit: '0' }, { accountId: equity.id, debit: '0', credit: '1' }] })).rejects.toThrow('LOCKED');
    await expect(erp.createPeriod(maker, { ...fields, month: '4', startDate: '2028-03-31', endDate: '2028-04-15' })).rejects.toThrow('overlap');
    const reopened: any = await erp.updatePeriod(maker, BigInt(created.id), 'OPEN'); expect(reopened.status).toBe('OPEN');
  });
  it('bootstrap exposes only permitted membership company names for accounting filters', async () => {
    const scoped: Actor = { ...maker, permissions: ['accounting.journal.view'], legacyPermissions: [], companyAdminIds: [] };
    const bootstrap: any = await erp.bootstrap(scoped); expect(bootstrap.companies.map((company: any) => company.id)).toEqual([companyId.toString()]);
    const hidden: any = await erp.bootstrap({ ...scoped, permissions: [] }); expect(hidden.companies).toEqual([]);
  });
  it('retrieves journal results beyond the old 200-row cap with filtering and deterministic paging', async () => {
    await admin.journalEntry.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ tenantId, branchId, number: `QA-PAGING-${index.toString().padStart(3, '0')}`, postingDate: new Date('2026-02-24'), description: 'Paging fixture', status: 'DRAFT', sourceModule: 'GENERAL_LEDGER', sourceType: 'MANUAL', sourceId: BigInt(9000000 + index), sourceNumber: `QA-PAGING-${index}`, createdById: maker.userId })) });
    const page: any = await erp.accountingJournals(maker, { search: 'QA-PAGING', page: 5, pageSize: 50, status: 'DRAFT', branchId: branchId.toString(), from: '2026-02-24', to: '2026-02-24' });
    expect(page.pagination).toEqual({ page: 5, pageSize: 50, total: 205, totalPages: 5 }); expect(page.rows).toHaveLength(5);
  });
  it('assigns unique codes concurrently beneath an existing posting account without changing its ledger', async () => {
    const before: any = await erp.accountingLedger(maker, { accountId: asset.id, branchId: branchId.toString() });
    await erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), code: `${asset.code}.001`, name: 'Occupied child code', type: 'ASSET', parentId: asset.id });
    await admin.financialResource.create({ data: { tenantId, companyId, type: 'GL_ACCOUNT', code: `${asset.code}.002`, name: 'Reserved resource code', linkedAccountId: BigInt(asset.id) } });
    const suggested: any = await erp.suggestedAccountingAccountCode(maker, { companyId: companyId.toString(), type: 'ASSET', parentId: asset.id });
    expect(suggested.code).toBe(`${asset.code}.003`);
    const [first, second]: any[] = await Promise.all([
      erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), name: 'Automatic child one', type: 'ASSET', parentId: asset.id, autoCode: true }),
      erp.saveAccountingAccount(maker, null, { companyId: companyId.toString(), name: 'Automatic child two', type: 'ASSET', parentId: asset.id, autoCode: true }),
    ]);
    expect(new Set([first.code, second.code])).toEqual(new Set([`${asset.code}.003`, `${asset.code}.004`]));
    expect(first.parentId).toBe(asset.id);
    expect(second.parentId).toBe(asset.id);
    const parent = await admin.account.findUniqueOrThrow({ where: { id: BigInt(asset.id) }, include: { _count: { select: { children: true } } } });
    expect(parent.postingAllowed).toBe(true);
    expect(parent._count.children).toBe(3);
    const ledger: any = await erp.accountingLedger(maker, { accountId: asset.id, branchId: branchId.toString() });
    expect(ledger.totals).toEqual(before.totals);
  });
});
