import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth';
import { Av8Service } from './av8.service';
import { Av8OpeningService } from './av8-opening.service';
import { ErpService } from './erp.service';
import { supplierOpeningFixture } from './av8-supplier-opening-fixture';

jest.setTimeout(120000);
describe('Supplier opening balances remain operational without reposting cash',()=>{
  let server:any,db:PrismaService,opening:Av8OpeningService,erp:ErpService,auth:AuthService,fixture:Awaited<ReturnType<typeof supplierOpeningFixture>>;
  beforeAll(async()=>{if(process.env.AV8_ENV!=='test')throw new Error('Isolated test only');const module=await Test.createTestingModule({imports:[AppModule]}).compile();server=module.createNestApplication({logger:false});await server.init();db=module.get(PrismaService);opening=module.get(Av8OpeningService);erp=module.get(ErpService);auth=module.get(AuthService);fixture=await supplierOpeningFixture(db,auth,module.get(Av8Service),opening,erp);});
  afterAll(async()=>{if(server)await server.close();});
  const balance=async()=>{const history:any[]=await opening.history(fixture.admin);return history.find(b=>b.source_system===fixture.manifest.sourceSystem).supplierBalances[0];};
  it('shows opening payable in the actual supplier statement and links partial existing cash once',async()=>{
    const before=await erp.report(fixture.admin,'supplier-statement');expect(before.rows.filter((r:any)=>r.party===fixture.supplier.name).reduce((n:bigint,r:any)=>n+BigInt(r.debitMinor)-BigInt(r.creditMinor),0n)).toBe(100000n);
    const cash=await db.admin.bankTransaction.count(),journals=await db.admin.journalEntry.count(),key=randomUUID();
    const [first,second]=await Promise.all([opening.supplierSettlement(fixture.admin,fixture.body,key),opening.supplierSettlement(fixture.admin,fixture.body,key)]);expect(first).toEqual(second);
    expect(await db.admin.bankTransaction.count()).toBe(cash);expect(await db.admin.journalEntry.count()).toBe(journals);
    const current=await balance();expect(current.paidMinor).toBe('40000');expect(current.remainingMinor).toBe('60000');expect(current.remainingBaseMinor).toBe('60000');expect(current.settlements).toHaveLength(1);
    const after=await erp.report(fixture.admin,'supplier-statement');expect(after.rows.filter((r:any)=>r.party===fixture.supplier.name).reduce((n:bigint,r:any)=>n+BigInt(r.debitMinor)-BigInt(r.creditMinor),0n)).toBe(60000n);
  });
  it('rejects duplicate source, excessive actual payment, unauthorized actor and immutable rewrite',async()=>{
    await expect(opening.supplierSettlement(fixture.admin,fixture.body,randomUUID())).rejects.toThrow('already used');
    const unauthorized=auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email:'telesales@av8.local'},include:auth.userInclude}));expect(()=>opening.supplierSettlement(unauthorized,fixture.body,randomUUID())).toThrow('Permission');
    const movement:any=await erp.createBankTransaction(fixture.admin,{branchId:String(fixture.branchId),bankAccountId:String(fixture.bank.id),counterpartyAccountId:String(fixture.control.id),kind:'PAYMENT',amount:'700',postingDate:'2026-02-02',reference:'Synthetic excess actual payment',description:'Synthetic overpayment evidence'});
    await expect(opening.supplierSettlement(fixture.admin,{...fixture.body,bankTransactionId:String(movement.id)},randomUUID())).rejects.toThrow('exceeds');
    // The real excess test cash is returned through a separate evidenced movement, not erased.
    await erp.createBankTransaction(fixture.admin,{branchId:String(fixture.branchId),bankAccountId:String(fixture.bank.id),counterpartyAccountId:String(fixture.control.id),kind:'RECEIPT',amount:'700',postingDate:'2026-02-03',reference:'Synthetic return of excess test payment',description:'Synthetic actual return preserves original outgoing evidence'});
    const current=await balance();await expect(db.tenant(fixture.admin.tenantId,tx=>tx.av8Record.update({where:{id:BigInt(current.settlements[0].id)},data:{status:'CANCELLED'}}))).rejects.toThrow();
  });
  it('supports independently approved actual manual payment journal and closes remaining original/book balance',async()=>{
    const journal=await fixture.postJournal('600','2026-03-01',true),cash=await db.admin.bankTransaction.count();
    await opening.supplierSettlement(fixture.admin,{sourceKind:'JOURNAL',sourceSystem:fixture.body.sourceSystem,batchSourceId:fixture.body.batchSourceId,balanceIndex:0,journalEntryId:String(journal.id),bankAccountId:String(fixture.bank.id),amount:'600',baseRate:'1',rateProvenance:'Synthetic original and book currency identity',evidenceReference:'Synthetic approved actual manual payment',reason:'Complete source supplier payable'},randomUUID());
    expect(await db.admin.bankTransaction.count()).toBe(cash);const current=await balance();expect(current.remainingMinor).toBe('0');expect(current.remainingBaseMinor).toBe('0');expect(current.settlements).toHaveLength(2);
    const report=await erp.report(fixture.admin,'supplier-statement');const rows=report.rows.filter((r:any)=>r.party===fixture.supplier.name);expect(rows).toHaveLength(3);expect(rows.reduce((n:bigint,r:any)=>n+BigInt(r.debitMinor)-BigInt(r.creditMinor),0n)).toBe(0n);
    const resources=await erp.listBankResources(fixture.admin,{search:fixture.bank.code});expect(resources.rows).toHaveLength(1);expect(resources.rows[0].originalBalanceMinor).toBe('0');expect(resources.rows[0].bookBalanceMinor).toBe('0');
  });
});
