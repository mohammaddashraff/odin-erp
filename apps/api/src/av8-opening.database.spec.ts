import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { Actor, AuthService } from './auth';
import { Av8Service } from './av8.service';
import { Av8OpeningService } from './av8-opening.service';
import { ErpService } from './erp.service';

jest.setTimeout(120000);
describe('AV8 cutover preserves original history without cash reposting',()=>{
  let server:any,db:PrismaService,opening:Av8OpeningService,av8:Av8Service,erp:ErpService,admin:Actor,finance:Actor,telesales:Actor,manifest:any,result:any;
  const key=()=>randomUUID();
  beforeAll(async()=>{
    if(process.env.AV8_ENV!=='test'||!process.env.DATABASE_URL?.includes('/av8_test'))throw new Error('Isolated test database required');
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();server=module.createNestApplication({logger:false});await server.init();db=module.get(PrismaService);opening=module.get(Av8OpeningService);av8=module.get(Av8Service);erp=module.get(ErpService);const auth=module.get(AuthService);
    const actor=async(email:string)=>auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email},include:auth.userInclude}));
    admin=await actor('admin@av8.local');finance=await actor('finance@av8.local');telesales=await actor('telesales@av8.local');
    const refs:any=await av8.refs(admin),branchId=refs.branches[0].id;
    // A dedicated synthetic resource avoids interference with unrelated test cutovers.
    const {bank,liability}=await db.tenant(admin.tenantId,async tx=>{
      const asset=await tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-OPEN-${key()}`,name:'Synthetic opening asset',type:'ASSET'}});
      const bank=await tx.bankAccount.create({data:{tenantId:admin.tenantId,code:`SYN-OPEN-${key()}`,name:'Synthetic opening USD resource',type:'BANK',currency:'USD',glAccountId:asset.id}});
      const liability=await tx.account.findFirstOrThrow({where:{tenantId:admin.tenantId,code:'2100'}});return{bank,liability};
    });
    const journal:any=await erp.createJournal(admin,{branchId,postingDate:'2026-01-01',description:'SYNTHETIC approved source opening balance',lines:[{accountId:String(bank.glAccountId),debit:'50000',credit:'0'},{accountId:String(liability.id),debit:'0',credit:'50000'}]});
    await erp.journalWorkflow(admin,BigInt(journal.id),'submit');
    // Checker has existing assigned accounts; synthetic bank resource is assigned for this test.
    await db.tenant(admin.tenantId,async tx=>{const resources=await tx.financialResource.findMany({where:{tenantId:admin.tenantId,OR:[{linkedBankAccountId:bank.id},{linkedAccountId:bank.glAccountId}]}});for(const resource of resources)await tx.financialResourceAssignment.create({data:{tenantId:admin.tenantId,userId:finance.userId,resourceId:resource.id,grantedById:admin.userId,reason:'Synthetic opening approval fixture'}});});
    await db.tenant(admin.tenantId,tx=>tx.roleFieldPermission.upsert({where:{tenantId_roleId_resource_field:{tenantId:admin.tenantId,roleId:BigInt(finance.roleIds[0]),resource:'journal',field:'lines'}},create:{tenantId:admin.tenantId,roleId:BigInt(finance.roleIds[0]),resource:'journal',field:'lines',access:'EDIT'},update:{access:'EDIT'}}));
    finance=await actor('finance@av8.local');await erp.journalWorkflow(finance,BigInt(journal.id),'approve');await erp.journalWorkflow(finance,BigInt(journal.id),'post');
    manifest={version:1,sourceSystem:`SYNTHETIC-${key()}`,cutoverDate:'2026-01-01',openingJournalId:journal.id,
      resources:[{bankAccountId:String(bank.id),currency:'USD',openingMinor:'100000',baseMinor:'5000000',baseRateMicros:'50000000',rateProvenance:'Synthetic approved opening 50 EGP per USD'}],
      customerLiabilities:[{accountId:String(liability.id),currency:'USD',amountMinor:'100000',baseMinor:'5000000',baseRateMicros:'50000000',rateProvenance:'Synthetic approved source liability control'}],
      expectedTotals:{studentContractMinor:'200000',studentPaidMinor:'100000',studentOutstandingMinor:'100000',academyEntitlementMinor:'50000',academyTransferredMinor:'50000'},
      applications:[{sourceId:'application-1',personSourceId:'person-1',reference:`SYNTHETIC-OPEN-${key()}`,name:`Synthetic original student ${key()}`,phone:`+201${Date.now()}`,email:`opening-${key()}@av8.invalid`,branchId,ownerId:String(admin.userId),academyId:refs.academies[0].id,program:'Original programme',
        contract:{planKey:'A',reference:'Original signed source 1',signedDate:'2025-12-01',document:{fileName:'synthetic-original.pdf',mimeType:'application/pdf',base64:Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF').toString('base64')}},
        schedule:[{sourceId:'charge-1',key:'TUITION',label:'Original agreed tuition',currency:'USD',amountMinor:'200000',paidMinor:'100000',dueDate:'2026-06-01'}],
        academyObligations:[{sourceId:'academy-1',amountMinor:'50000',paidMinor:'50000',dueDate:'2025-12-15'}],
        receipts:[{sourceId:'receipt-1',confirmed:true,reference:'Original receipt 1',date:'2025-12-10',rateDate:'2025-12-10',method:'BANK',bankAccountId:String(bank.id),liabilityAccountId:String(liability.id),amountMinor:'200000',currency:'USD',usdMinor:'200000',usdRateMicros:'1000000',baseRateMicros:'50000000',rateProvenance:'Original historical USD identity and base 50',allocations:[{sourceId:'charge-1',amountMinor:'100000'}]}],
        remittances:[{sourceId:'transfer-1',confirmed:true,reference:'Original transfer 1',date:'2025-12-15',rateDate:'2025-12-15',method:'BANK',bankAccountId:String(bank.id),amountMinor:'50000',currency:'USD',usdMinor:'50000',usdRateMicros:'1000000',baseRateMicros:'50000000',rateProvenance:'Original historical transfer',allocations:[{sourceId:'academy-1',amountMinor:'50000'}]}],
        services:[{sourceId:'service-1',type:'TRANSPORT',provider:'Original provider',collectionParty:'AV8',period:'2025-12',amountMinor:'5000',paidMinor:'5000',currency:'USD',receiptSourceId:'receipt-1',evidenceReference:'Original service receipt 1'}],
        pendingRefunds:[{sourceId:'refund-1',amountMinor:'10000',terminationDate:'2025-12-20',deadline:'2026-12-20',policyReference:'Original signed source policy',approvalReference:'Unsettled original case'}]}]};
  });
  afterAll(async()=>{if(server)await server.close();});
  it('produces row blockers and exact control totals without writes',async()=>{
    const before=await db.admin.av8Application.count();const invalid=structuredClone(manifest);invalid.expectedTotals.studentPaidMinor='99999';invalid.applications[0].receipts[0].usdMinor='1';invalid.openingJournalId='999999999';
    const preview=await opening.preview(admin,invalid);expect(preview.valid).toBe(false);expect(preview.errors.some((e:any)=>e.path==='openingJournalId')).toBe(true);expect(preview.errors.some((e:any)=>e.path==='applications[0]')).toBe(true);expect(await db.admin.av8Application.count()).toBe(before);
    const valid=await opening.preview(admin,manifest);expect(valid.errors).toEqual([]);expect(valid.valid).toBe(true);expect(valid.totals.studentOutstandingMinor).toBe('100000');expect(valid.createsCashTransactions).toBe(false);
  });
  it('imports exact signed schedules, original payments and allocations without new cash or obligations',async()=>{
    const preview=await opening.preview(admin,manifest),before={journals:await db.admin.journalEntry.count(),cash:await db.admin.bankTransaction.count()};
    result=await opening.commit(admin,{manifest,previewHash:preview.previewHash,reason:'Synthetic verified cutover'},key());
    expect(result.createdJournals).toBe(0);expect(result.createdCashTransactions).toBe(0);expect(await db.admin.journalEntry.count()).toBe(before.journals);expect(await db.admin.bankTransaction.count()).toBe(before.cash);
    const app:any=await av8.detail(admin,BigInt(result.applications[0].applicationId));expect(app.reference).toBe(manifest.applications[0].reference);expect(app.finance.totalMinor).toBeDefined();
    const facts=await db.tenant(admin.tenantId,async tx=>({funds:await tx.av8Fund.findMany({where:{applicationId:BigInt(app.id)}}),obligations:await tx.av8Obligation.findMany({where:{applicationId:BigInt(app.id)}}),records:await tx.av8Record.findMany({where:{applicationId:BigInt(app.id)}})}));
    const originalBank=await db.admin.bankAccount.findUniqueOrThrow({where:{id:BigInt(manifest.resources[0].bankAccountId)}});const bankRows:any=await erp.listBankResources(admin,{search:originalBank.code});const bank=bankRows.rows.find((r:any)=>String(r.id)===manifest.resources[0].bankAccountId);expect(bank.originalBalanceMinor).toBe('100000');expect(bank.bookBalanceMinor).toBe('5000000');expect(bank.cutoverDate).toBe('2026-01-01');
    expect(facts.funds).toHaveLength(2);expect(facts.funds.every(f=>f.bankTransactionId===null&&f.status==='CLEARED')).toBe(true);expect(facts.obligations).toHaveLength(1);expect(facts.records.find(r=>r.kind==='contract')?.status).toBe('SIGNED');expect(facts.records.find(r=>r.kind==='refund')?.status).toBe('DECISION_REQUIRED');
  });
  it('repeats idempotently and rejects changed source identities or changed preview',async()=>{
    const preview=await opening.preview(admin,manifest),before=await db.admin.av8Fund.count();const repeat=await opening.commit(admin,{manifest,previewHash:preview.previewHash,reason:'Synthetic repeated file'},key());expect(repeat.applications).toEqual(result.applications);expect(await db.admin.av8Fund.count()).toBe(before);
    const overlapping=structuredClone(manifest);overlapping.sourceSystem='ANOTHER-'+key();expect((await opening.preview(admin,overlapping)).errors.some((e:any)=>e.message.includes('opening baseline'))).toBe(true);
    const changed=structuredClone(manifest);changed.applications[0].name='Different source identity';expect((await opening.preview(admin,changed)).valid).toBe(false);
    expect(()=>opening.commit(admin,{manifest:changed,previewHash:preview.previewHash,reason:'Changed after preview'},key())).toThrow('changed');
  });
  it('enforces role and source evidence immutability at database level',async()=>{
    await expect(opening.preview(telesales,manifest)).rejects.toThrow('Permission');
    expect(()=>opening.commit(telesales,{manifest,previewHash:'bad',reason:'Unauthorized'},key())).toThrow('Permission');
    await expect(db.tenant(admin.tenantId,tx=>tx.$executeRaw`UPDATE av8_opening_sources SET checksum=${'0'.repeat(64)} WHERE tenant_id=${admin.tenantId} AND source_system=${manifest.sourceSystem}`)).rejects.toThrow();
    const fund=await db.admin.av8Fund.findFirstOrThrow({where:{applicationId:BigInt(result.applications[0].applicationId)}});
    await expect(db.tenant(admin.tenantId,tx=>tx.av8Fund.update({where:{id:fund.id},data:{reference:'Mutated historical evidence'}}))).rejects.toThrow();
  });
});
