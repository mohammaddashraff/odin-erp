import 'reflect-metadata';
import {Test} from '@nestjs/testing';
import {randomUUID} from 'node:crypto';
import {AppModule} from './app.module';
import {PrismaService} from './prisma.service';
import {AuthService,Actor} from './auth';
import {Av8Service} from './av8.service';
import {ErpService} from './erp.service';
import {seedAv8} from '../prisma/av8-seed';

jest.setTimeout(120000);
describe('final delivery paired treasury and statement import',()=>{
  let app:any,db:PrismaService,erp:ErpService,av8:Av8Service,actor:Actor,branchId:bigint,source:any,destination:any,feeAccount:any;
  beforeAll(async()=>{
    if(process.env.AV8_ENV!=='test')throw new Error('Isolated AV8 test environment required');
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false});await app.init();db=module.get(PrismaService);erp=module.get(ErpService);av8=module.get(Av8Service);const auth=module.get(AuthService);await seedAv8(db);
    actor=auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email:'admin@av8.local'},include:auth.userInclude}));branchId=BigInt(actor.branchIds[0]);
    const suffix=randomUUID().slice(0,8);
    const account=async(code:string,type:any)=>db.admin.account.create({data:{tenantId:actor.tenantId,code:`FD-${suffix}-${code}`,name:`Synthetic ${code}`,type,postingAllowed:true}});
    const a=await account('source','ASSET'),b=await account('destination','ASSET');feeAccount=await account('fees','EXPENSE');
    source=await erp.createBankAccount(actor,{code:`FD-S-${suffix}`,name:'Synthetic transfer source',type:'BANK',currency:'EGP',glAccountId:String(a.id),companyId:actor.companyIds[0]});
    destination=await erp.createBankAccount(actor,{code:`FD-D-${suffix}`,name:'Synthetic transfer wallet',type:'WALLET',currency:'EGP',glAccountId:String(b.id),companyId:actor.companyIds[0]});
  });
  afterAll(async()=>{if(app)await app.close();});
  const body=()=>({branchId:String(branchId),sourceId:String(source.id),destinationId:String(destination.id),sourceAmount:'100.00',destinationAmount:'100.00',feeAmount:'2.00',feeAccountId:String(feeAccount.id),postingDate:'2026-10-31',rateSource:'Synthetic same-currency evidence',reason:'Synthetic paired transfer',reference:randomUUID()});
  it('posts one balanced journal and two resource movements once under retry and concurrency',async()=>{
    const input=body(),key=randomUUID();const results=await Promise.all([erp.transferResources(actor,input,key),erp.transferResources(actor,input,key)]);
    expect(results[0]).toEqual(results[1]);const again=await erp.transferResources(actor,input,key);expect(again).toEqual(results[0]);
    const journal=await db.admin.journalEntry.findUniqueOrThrow({where:{id:BigInt(again.journalId)},include:{lines:true,bankTxns:true}});
    expect(journal.bankTxns).toHaveLength(2);expect(journal.lines.reduce((n,l)=>n+l.debitMinor-l.creditMinor,0n)).toBe(0n);
    expect(journal.lines.some(l=>l.debitMinor===200n&&l.accountId===feeAccount.id)).toBe(true);
    expect(journal.bankTxns.find(t=>t.kind==='TRANSFER_OUT')!.amountMinor).toBe(10200n);expect(journal.bankTxns.find(t=>t.kind==='TRANSFER_IN')!.amountMinor).toBe(10000n);
    await expect(erp.transferResources(actor,{...input,sourceAmount:'200'},key)).rejects.toThrow('different request');
  });
  it('rejects invalid mappings atomically and blocks foreign resource identifiers',async()=>{
    await expect(erp.transferResources(actor,{...body(),postingDate:'2099-01-01'},randomUUID())).rejects.toThrow('future');
    const input={...body(),feeAccountId:'999999999'};const count=await db.admin.bankTransaction.count();await expect(erp.transferResources(actor,input,randomUUID())).rejects.toThrow();expect(await db.admin.bankTransaction.count()).toBe(count);
    await expect(erp.transferResources({...actor,permissions:[],legacyPermissions:[],companyScopedPermissions:{}} as Actor,body(),randomUUID())).rejects.toThrow();
  });
  it('previews mapped CSV, requires exact reconciliation, and imports repeat-safely without cash postings',async()=>{
    const csv='Date,Value,Text,Ref\n2026-10-31,100.00,"Synthetic, receipt",FD-1\n2026-10-31,-20.00,Synthetic withdrawal,FD-2';
    const input={bankAccountId:String(source.id),statementDate:'2026-10-31',opening:'0',closing:'80',csv,mapping:{date:'Date',amount:'Value',description:'Text',reference:'Ref'}};
    expect(await erp.previewStatement(actor,input)).toMatchObject({valid:true,rowCount:2,differenceMinor:'0'});
    const count=await db.admin.bankTransaction.count();const first=await erp.createStatement(actor,input),again=await erp.createStatement(actor,input);expect(first.id).toBe(again.id);expect(again).toMatchObject({alreadyImported:true});expect(first.lines).toHaveLength(2);expect(await db.admin.bankTransaction.count()).toBe(count);
    expect(await erp.previewStatement(actor,{...input,closing:'81'})).toMatchObject({valid:false,differenceMinor:'-100'});
    await expect(erp.createStatement(actor,{...input,closing:'81'})).rejects.toThrow('validation');
    const invalid=await erp.previewStatement(actor,{...input,csv:'Date,Value,Text,Ref\n2026-02-30,100,x,r'});expect(invalid).toMatchObject({valid:false});expect((invalid as any).errors[0].row).toBe(1);
  });
  it('does not match an outgoing movement to a positive statement amount',async()=>{
    const transfer=await erp.transferResources(actor,{...body(),feeAmount:'0'},randomUUID());
    const statement=await erp.createStatement(actor,{bankAccountId:String(source.id),statementDate:'2026-10-31',opening:'0',closing:'100',lines:[{date:'2026-10-31',amount:'100',description:randomUUID(),reference:'positive'}]});
    await expect(erp.matchStatementLine(actor,statement.lines[0].id,BigInt(transfer.outgoing.id))).rejects.toThrow('directions');
    expect(await db.admin.bankStatementLine.findUniqueOrThrow({where:{id:statement.lines[0].id}})).toMatchObject({matched:false});
  });
  it('deactivates resources without losing their movement history',async()=>{
    const before=await db.admin.bankTransaction.count({where:{bankAccountId:destination.id}});
    await erp.updateBankAccount(actor,destination.id,{active:false,reason:'Synthetic deactivation'});
    expect(await db.admin.bankTransaction.count({where:{bankAccountId:destination.id}})).toBe(before);
    await expect(erp.transferResources(actor,body(),randomUUID())).rejects.toThrow();
    await erp.updateBankAccount(actor,destination.id,{active:true,reason:'Synthetic reactivation'});
  });
  it('normalizes persisted contacts and paginated search without merging family identities',async()=>{
    const suffix=randomUUID().slice(0,8),name=`أَحْمَد ${suffix}`;
    const body={name,phone:'+٢٠ (١٢) ٣٤٥٦٧٨٩٠',email:`QA-${suffix}@example.test`,source:'Synthetic normalized contact',branchId:String(branchId),ownerId:String(actor.userId),duplicateReviewed:true};
    const first=await av8.createLead(actor,body,randomUUID());
    await expect(av8.createLead(actor,{...body,name:`احمد ${suffix}`,phone:'+201234567890',duplicateReviewed:false},randomUUID())).rejects.toThrow('Potential duplicate');
    const second=await av8.createLead(actor,{...body,name:`Family ${suffix}`},randomUUID());expect(first.id).not.toBe(second.id);
    const list=await av8.leads(actor,{search:`احمد ${suffix}`});expect(list.rows.map((r:any)=>r.id)).toContain(String(first.id));expect(list.rows.length).toBeLessThanOrEqual(25);
    await expect(av8.importPreview(actor,{csv:'name,phone,source\n'+Array.from({length:501},()=> 'Synthetic,123456,QA').join('\n')})).rejects.toThrow('at most 500');
    const preview=await av8.importPreview(actor,{csv:`name,phone,source\nاحمد ${suffix},+201234567890,QA\nاحمد ${suffix},٠٠٢٠١٢٣٤٥٦٧٨٩٠,QA`});
    expect(preview.rows[0].duplicates.length).toBeGreaterThan(0);expect(preview.rows[1].duplicateInFile).toBe(2);
    const stored=await db.admin.customer.findUniqueOrThrow({where:{id:first.customerId}});expect(stored.phone).toBe(body.phone);expect(stored.normalizedPhone).toBe('201234567890');
  });
  it('reports original resource movements separately from ledger book value',async()=>{
    const result:any=await erp.listBankResources(actor,{search:source.code,status:'ALL'});expect(result.rows).toHaveLength(1);
    const movements=await db.admin.bankTransaction.findMany({where:{bankAccountId:source.id}});
    const sum=movements.reduce((total,row)=>total+(['RECEIPT','TRANSFER_IN'].includes(row.kind)?row.amountMinor:-row.amountMinor),0n);
    expect(result.rows[0].originalBalanceMinor).toBe(String(sum));expect(result.rows[0].baseCurrency).toBe('EGP');
    const banking:any=await erp.banking(actor);expect(banking.accounts.some((row:any)=>row.id===String(source.id))).toBe(true);expect(Array.isArray(banking.statements)).toBe(true);
  });

});
