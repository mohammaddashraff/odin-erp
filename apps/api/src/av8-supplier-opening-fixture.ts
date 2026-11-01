import { randomUUID } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth';
import { Av8Service } from './av8.service';
import { Av8OpeningService } from './av8-opening.service';
import { ErpService } from './erp.service';

/** Explicit synthetic acceptance fixture only; never seeds client/production balances. */
export async function supplierOpeningFixture(db:PrismaService,auth:AuthService,av8:Av8Service,opening:Av8OpeningService,erp:ErpService){
  if(!['dev','test'].includes(process.env.AV8_ENV||'')||!process.env.DATABASE_URL?.includes('/av8_'))throw new Error('Isolated dev/test synthetic fixture required');
  const actor=async(email:string)=>auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email},include:auth.userInclude}));
  const admin=await actor('admin@av8.local');let checker=await actor('finance@av8.local');const refs:any=await av8.refs(admin),branchId=BigInt(refs.branches[0].id),token=randomUUID();
  const {bank,control,supplier}=await db.tenant(admin.tenantId,async tx=>{
    const asset=await tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-SUP-BANK-${token}`,name:`Synthetic supplier cash ${token}`,type:'ASSET'}});
    const control=await tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-SUP-CTRL-${token}`,name:`Synthetic supplier opening control ${token}`,type:'LIABILITY'}});
    const bank=await tx.bankAccount.create({data:{tenantId:admin.tenantId,code:`SYN-SUP-${token}`,name:`Synthetic supplier opening EGP ${token}`,type:'BANK',currency:'EGP',glAccountId:asset.id}});
    const supplier=await tx.supplier.create({data:{tenantId:admin.tenantId,code:`SYN-SUP-${token}`,name:`SYNTHETIC opening supplier ${token}`,city:'Controlled test'}});
    const resources=await tx.financialResource.findMany({where:{tenantId:admin.tenantId,OR:[{linkedBankAccountId:bank.id},{linkedAccountId:{in:[asset.id,control.id]}}]}});
    for(const resource of resources)await tx.financialResourceAssignment.create({data:{tenantId:admin.tenantId,userId:checker.userId,resourceId:resource.id,grantedById:admin.userId,reason:'Explicit synthetic supplier approval fixture'}});
    await tx.roleFieldPermission.upsert({where:{tenantId_roleId_resource_field:{tenantId:admin.tenantId,roleId:BigInt(checker.roleIds[0]),resource:'journal',field:'lines'}},create:{tenantId:admin.tenantId,roleId:BigInt(checker.roleIds[0]),resource:'journal',field:'lines',access:'EDIT'},update:{access:'EDIT'}});
    return{bank,control,supplier};
  });checker=await actor('finance@av8.local');
  const postJournal=async(amount:string,date:string,outgoing:boolean)=>{
    const journal:any=await erp.createJournal(admin,{branchId:String(branchId),postingDate:date,description:`SYNTHETIC supplier ${outgoing?'payment':'opening'} ${token}`,lines:[{accountId:String(bank.glAccountId),debit:outgoing?'0':amount,credit:outgoing?amount:'0'},{accountId:String(control.id),debit:outgoing?amount:'0',credit:outgoing?'0':amount}]});
    await erp.journalWorkflow(admin,BigInt(journal.id),'submit');await erp.journalWorkflow(checker,BigInt(journal.id),'approve');await erp.journalWorkflow(checker,BigInt(journal.id),'post');return journal;
  };
  const original=await postJournal('1000','2026-01-01',false),manifest={version:1,sourceSystem:`SYNTHETIC-SUPPLIER-${token}`,cutoverDate:'2026-01-01',openingJournalId:String(original.id),resources:[{bankAccountId:String(bank.id),currency:'EGP',openingMinor:'100000',baseMinor:'100000',baseRateMicros:'1000000',rateProvenance:'Synthetic EGP identity'}],customerLiabilities:[],supplierBalances:[{supplierId:String(supplier.id),accountId:String(control.id),currency:'EGP',amountMinor:'100000',baseMinor:'100000',baseRateMicros:'1000000',rateProvenance:'Synthetic original payable control'}],expectedTotals:{studentContractMinor:'10000',studentPaidMinor:'0',studentOutstandingMinor:'10000',academyEntitlementMinor:'0',academyTransferredMinor:'0'},applications:[{sourceId:'application',personSourceId:'person',reference:`SYNTHETIC-SUP-${token}`,name:`SYNTHETIC supplier cutover student ${token}`,phone:`+201${Date.now()}`,branchId:String(branchId),ownerId:String(admin.userId),academyId:refs.academies[0].id,program:'Original synthetic source programme',schedule:[{sourceId:'original-charge',label:'Actual source obligation',currency:'USD',amountMinor:'10000',paidMinor:'0'}],receipts:[],remittances:[],academyObligations:[]}]};
  const preview=await opening.preview(admin,manifest);if(!preview.valid)throw new Error(preview.errors.map(e=>e.message).join('; '));const imported=await opening.commit(admin,{manifest,previewHash:preview.previewHash,reason:'Explicit synthetic supplier cutover verification'},randomUUID());
  const movement:any=await erp.createBankTransaction(admin,{branchId:String(branchId),bankAccountId:String(bank.id),counterpartyAccountId:String(control.id),kind:'PAYMENT',amount:'400',postingDate:'2026-02-01',reference:`SYNTHETIC supplier payment ${token}`,description:'SYNTHETIC actual supplier payment evidence'});
  return{admin,checker,bank,control,supplier,branchId,postJournal,manifest,imported,movement,body:{sourceSystem:manifest.sourceSystem,batchSourceId:`${manifest.cutoverDate}:${manifest.openingJournalId}`,balanceIndex:0,bankTransactionId:String(movement.id),evidenceReference:'Synthetic approved bank payment and supplier acknowledgement',reason:'Synthetic supplier opening settlement'}};
}
