import { Injectable } from '@nestjs/common';
import { contactKeys, contactMatches } from './contact-normalization';
import { createHash } from 'node:crypto';
import { Actor, can } from './auth';
import { PrismaService } from './prisma.service';
import { assignedUser, atBranch, audit, once, requireAv8, Av8Tx } from './av8-access';
import { calendarDate, fail, positiveId, text } from './av8-domain';
import { convertMinor, currencyAmount, parseFixed, roundDiv, serialize } from './money';
import { supplierOpeningBalances } from './av8-opening-supplier';
import { openingHash, openingList, openingMinor, validateOpeningManifest } from './av8-opening';
import { assertMagicBytes, filenameForContentType, normalizeContentType } from './private-attachments.service';

@Injectable()
export class Av8OpeningService {
  constructor(private readonly db: PrismaService) {}
  private resourceAllowed(a:Actor,companyId:bigint,kind:string,id:bigint){
    if(can(a,'system.super_admin'))return;
    const scope=a.dataScopes.find(s=>s.resource===kind),configured=(scope?.config as any)?.resourceIds||[],assigned=a.companyResourceAssignments[String(companyId)]?.[kind]||[];
    if(scope?.scope==='ALL'&&a.companyIds.includes(String(companyId)))return;
    if(scope?.scope==='ASSIGNED'&&[...configured,...assigned].map(String).includes(String(id)))return;
    fail('Opening financial resource is outside the assigned access scope');
  }
  private async source(tx: Av8Tx, a: Actor, system: string, kind: string, id: string) {
    const rows: any[] = await tx.$queryRaw`SELECT checksum, data FROM av8_opening_sources WHERE tenant_id=${a.tenantId} AND source_system=${system} AND kind=${kind} AND source_id=${id}`;
    return rows[0];
  }
  private async saveSource(tx: Av8Tx, a: Actor, system: string, kind: string, id: string, checksum: string, data: any) {
    await tx.$executeRaw`INSERT INTO av8_opening_sources (tenant_id,source_system,kind,source_id,checksum,data,created_by_id) VALUES (${a.tenantId},${system},${kind},${id},${checksum},${JSON.stringify(serialize(data))}::jsonb,${a.userId})`;
  }
  private async inspect(tx: Av8Tx, a: Actor, manifest: any) {
    const currencies = await tx.currency.findMany({ where: { tenantId: a.tenantId, active: true } });
    const precisions = Object.fromEntries(currencies.map(c => [c.code,c.precision]));
    const result = validateOpeningManifest(manifest, precisions), errors = [...result.errors], existingRows: any[] = [];
    const add = async (path: string, fn: () => Promise<void>) => { try { await fn(); } catch(error:any) { errors.push({ path, message: error?.message || 'Reference validation failed' }); } };
    let journal: any = null;
    await add('openingJournalId', async () => {
      journal = await tx.journalEntry.findFirst({ where: { tenantId: a.tenantId, id: positiveId(manifest.openingJournalId), status: 'POSTED', sourceType: 'MANUAL' }, include: { lines: true } });
      if (!journal || !journal.approvedById || journal.approvedById === journal.createdById || journal.postingDate.toISOString().slice(0,10) !== result.cutoff) fail('Select a separately approved, posted manual opening journal at the cutover date; prepare and approve it in Accounting first');
      atBranch(a, 'accounting.journal.post', journal.branchId);
      if(!await tx.fiscalPeriod.findFirst({where:{tenantId:a.tenantId,status:'OPEN',startDate:{lte:journal.postingDate},endDate:{gte:journal.postingDate}}}))fail('Cutover date must remain in an open fiscal period; historical payments are non-posting source evidence');
      if (await tx.journalEntry.findFirst({ where: { tenantId: a.tenantId, reversesEntryId: journal.id, status: 'POSTED' } })) fail('Opening journal has been reversed');
    });
    const resources = openingList(manifest.resources || [], 'Opening resources', 200), seenResources = new Set<string>(), resourceAccounts = new Set<string>();
    const priorBatches:any[]=await tx.$queryRaw`SELECT source_system,source_id,data FROM av8_opening_sources WHERE tenant_id=${a.tenantId} AND kind='BATCH'`;
    for (let i=0; i<resources.length; i++) await add(`resources[${i}]`, async () => {
      const resource = resources[i], bank = await tx.bankAccount.findFirst({ where: { tenantId: a.tenantId, id: positiveId(resource.bankAccountId), active: true }, include: { financialResources: true } });
      if (!bank) fail('Opening cashbox/bank/wallet does not exist');
      const journalCompany=journal?await tx.companyBranch.findFirst({where:{tenantId:a.tenantId,branchId:journal.branchId,active:true}}):null;
      if(!journalCompany || !bank.financialResources.some((r:any)=>r.active && r.companyId===journalCompany.companyId))fail('Opening resource must be active and available to this journal branch');
      this.resourceAllowed(a,journalCompany.companyId,'bank_account',bank.id);this.resourceAllowed(a,journalCompany.companyId,'account',bank.glAccountId);
      if(resourceAccounts.has(String(bank.glAccountId)))fail('Opening resources must have separate GL control accounts so source balances cannot be counted twice');resourceAccounts.add(String(bank.glAccountId));
      if(priorBatches.some((b:any)=>(b.source_system!==result.sourceSystem||b.source_id!==`${result.cutoff}:${manifest.openingJournalId}`)&&(b.data.resources||[]).some((r:any)=>String(r.bankAccountId)===String(bank.id))))fail('Resource already has an imported opening baseline; use a reviewed correction instead of stacking another opening balance');
      if (seenResources.has(String(bank.id))) fail('Opening resource is repeated'); seenResources.add(String(bank.id));
      const original = openingMinor(resource.openingMinor, 'Original resource opening', true), base = openingMinor(resource.baseMinor,'Book-currency opening',true);
      if (resource.currency !== bank.currency) fail('Resource opening currency does not match the account');
      if (!journal) fail('Opening journal prerequisite must be resolved');
      const actual = journal.lines.filter((l:any) => l.accountId === bank.glAccountId).reduce((sum:bigint,l:any) => sum+l.debitMinor-l.creditMinor,0n);
      if (actual !== base) fail('Resource source balance differs from its approved opening-journal GL line');
      const rate = openingMinor(resource.baseRateMicros,'Historical opening conversion rate'); if(rate<=0n)fail('Opening conversion rate must be positive'); text(resource.rateProvenance,'Opening rate provenance');
      const basePrecision = precisions[journal.currency]; if(basePrecision===undefined||convertMinor(original,precisions[bank.currency],basePrecision,rate)!==base)fail('Original resource balance and documented rate do not reconcile to the approved journal');
    });
    for (let i=0; i<result.applications.length; i++) await add(`applications[${i}].references`, async () => {
      const row=result.applications[i], branchId=positiveId(row.branchId); atBranch(a,'av8.finance.adjust',branchId); await assignedUser(tx,a,positiveId(row.ownerId),branchId);
      if(journal&&journal.branchId!==branchId)fail('Use a separate branch import batch and approved opening journal');
      const link=await tx.companyBranch.findFirst({where:{tenantId:a.tenantId,branchId,active:true,company:{active:true}}});if(!link)fail('Application branch must belong to an active company');
      if(!await tx.supplier.findFirst({where:{tenantId:a.tenantId,id:positiveId(row.academyId),companyId:link.companyId,active:true}}))fail('Academy must be an active partner in the same company');
      const person=await this.source(tx,a,result.sourceSystem,'PERSON',String(row.personSourceId)),identity={name:row.name,phone:row.phone,email:row.email||null,companyId:String(link.companyId)};
      if(person&&person.checksum!==openingHash(identity))fail('Person source identity changed; review before importing repeat applications');
      const prior=await this.source(tx,a,result.sourceSystem,'APPLICATION',String(row.sourceId));
      if(prior){if(prior.checksum!==openingHash(row))fail('Source application ID already imported with different content; use an explicit reviewed correction');existingRows.push({sourceId:row.sourceId,...prior.data});}
      else if(await tx.av8Application.findFirst({where:{tenantId:a.tenantId,reference:row.reference}}))fail('Application reference already exists; do not duplicate or silently merge');
      if(row.customerId&&!await tx.customer.findFirst({where:{id:positiveId(row.customerId),tenantId:a.tenantId,companyId:link.companyId}}))fail('Existing contact is outside this company');
      if(!row.customerId&&!await this.source(tx,a,result.sourceSystem,'PERSON',String(row.personSourceId))){const duplicate=await tx.customer.findFirst({where:{tenantId:a.tenantId,companyId:link.companyId,OR:contactMatches(row)}});if(duplicate&&row.duplicateReviewed!==true)fail('Review possible duplicate contact; explicitly link customerId or keep separate person after review');}
      for(const fund of [...(row.receipts||[]),...(row.remittances||[])]){
        const bank=await tx.bankAccount.findFirst({where:{tenantId:a.tenantId,id:positiveId(fund.bankAccountId),currency:fund.currency,financialResources:{some:{companyId:link.companyId,active:true}}}});if(!bank)fail('Historical payment resource is outside the company or has a different currency');
        if(!resources.some((r:any)=>String(r.bankAccountId)===String(bank.id)))fail('Every historical fund resource needs its approved source opening balance');
        const oldFund=await this.source(tx,a,result.sourceSystem,'FUND',String(fund.sourceId));if(oldFund&&(oldFund.checksum!==openingHash(fund)||oldFund.data.applicationSourceId!==row.sourceId))fail('Historical fund source ID already belongs to different imported evidence');
        if((row.receipts||[]).includes(fund)&&!(manifest.customerLiabilities||[]).some((l:any)=>String(l.accountId)===String(fund.liabilityAccountId)))fail('Historical receipt must identify its approved opening customer-liability control account');
      }
      if(row.contract?.document)this.document(row.contract.document);
    });
    const liabilityTotals = new Map<string,bigint>(),supplierKeys=new Set<string>();
    for (const [kind,balances] of [['supplierBalances',openingList(manifest.supplierBalances||[],'Supplier balances',200)],['customerLiabilities',openingList(manifest.customerLiabilities||[],'Customer liability controls',200)]] as const) for(let i=0;i<balances.length;i++) await add(`${kind}[${i}]`,async()=>{
      const row=balances[i];
      if(kind==='supplierBalances'){const key=`${row.supplierId}:${row.currency}`;if(supplierKeys.has(key))fail('Use one opening supplier/currency balance per branch');supplierKeys.add(key);if(priorBatches.some((b:any)=>(b.source_system!==result.sourceSystem||b.source_id!==`${result.cutoff}:${manifest.openingJournalId}`)&&b.data.branchId===String(journal?.branchId)&&(b.data.supplierBalances||[]).some((v:any)=>String(v.supplierId)===String(row.supplierId)&&v.currency===row.currency)))fail('This supplier currency already has an opening balance in the branch; use an authorized correction');}
      if(!journal)fail('Liability controls require an approved opening journal');
      const company=await tx.companyBranch.findFirstOrThrow({where:{tenantId:a.tenantId,branchId:journal.branchId,active:true}});
      if(kind==='supplierBalances'&&!await tx.supplier.findFirst({where:{tenantId:a.tenantId,id:positiveId(row.supplierId),companyId:company.companyId,active:true}}))fail('Supplier opening partner not found in this company');
      const account=await tx.account.findFirst({where:{tenantId:a.tenantId,id:positiveId(row.accountId),type:'LIABILITY',active:true}}); if(!account)fail('Opening liability control must be an active liability account');this.resourceAllowed(a,company.companyId,'account',account.id);
      if(!await tx.financialResource.findFirst({where:{tenantId:a.tenantId,companyId:company.companyId,linkedAccountId:account.id,active:true}}))fail('Opening liability account is outside this company');
      const amount=openingMinor(row.amountMinor,'Original liability amount',true),base=openingMinor(row.baseMinor,'Book liability amount',true),rate=openingMinor(row.baseRateMicros,'Liability conversion rate');
      if(precisions[row.currency]===undefined||rate<=0n||convertMinor(amount,precisions[row.currency],precisions[journal.currency],rate)!==base)fail('Liability original amount and documented rate do not reconcile');
      text(row.rateProvenance,'Liability rate provenance');const id=String(account.id);liabilityTotals.set(id,(liabilityTotals.get(id)||0n)+base);
    });
    for(const [accountId,total]of liabilityTotals)await add(`liabilityControls.${accountId}`,async()=>{const actual=journal.lines.filter((l:any)=>String(l.accountId)===accountId).reduce((sum:bigint,l:any)=>sum+l.creditMinor-l.debitMinor,0n);if(total!==actual)fail('Supplier/customer liability source balances differ from the approved opening-journal control total');});
    return {...result,errors,valid:errors.length===0,existingRows,resources,precisions,journal};
  }
  async history(a:Actor){
    requireAv8(a,'av8.finance.view');return this.db.tenant(a.tenantId,async tx=>{
      const rows:any[]=await tx.$queryRaw`SELECT source_system,source_id,data,created_at FROM av8_opening_sources WHERE tenant_id=${a.tenantId} AND kind='BATCH' ORDER BY created_at DESC LIMIT 100`;
      const scoped=rows.filter(row=>{try{atBranch(a,'av8.finance.view',BigInt(row.data.branchId));return true;}catch{return false;}}),balances=await supplierOpeningBalances(tx,a.tenantId,scoped);
      return scoped.map(row=>({...row,supplierBalances:balances.filter((b:any)=>b.sourceSystem===row.source_system&&b.batchSourceId===row.source_id)}));
    });
  }
  supplierSettlement(a:Actor,body:any,key:string){
    requireAv8(a,'av8.finance.confirm');return once(this.db,a,'opening.supplier-settlement',key,body,async tx=>{
      const sourceSystem=text(body.sourceSystem,'Source system'),batchSourceId=text(body.batchSourceId,'Opening batch source ID');
      const source=await this.source(tx,a,sourceSystem,'BATCH',batchSourceId);if(!source)fail('Opening batch not found');
      const branchId=positiveId(source.data.branchId);atBranch(a,'av8.finance.confirm',branchId);const company=await tx.companyBranch.findFirstOrThrow({where:{tenantId:a.tenantId,branchId}});
      const index=Number(body.balanceIndex);if(!Number.isSafeInteger(index)||index<0)fail('Select an original supplier opening row');
      const original=source.data.supplierBalances?.[index];if(!original)fail('Supplier opening row not found');
      if(!await tx.supplier.findFirst({where:{tenantId:a.tenantId,id:positiveId(original.supplierId),companyId:company.companyId}}))fail('Supplier opening is outside this company');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-opening:${a.tenantId}:${sourceSystem}:${batchSourceId}:${index}`},0))`;
      const projection=await supplierOpeningBalances(tx,a.tenantId,[{source_system:sourceSystem,source_id:batchSourceId,data:source.data}]);const balance:any=projection.find((row:any)=>row.balanceIndex===index);
      if(!balance||BigInt(balance.remainingMinor)===0n)fail('Supplier opening balance is already settled');
      const sign=BigInt(original.amountMinor)>0n?1n:-1n,kind=sign>0n?'PAYMENT':'RECEIPT';
      let movement:any=null,journal:any,bank:any,originalAmount:bigint,reference:string,rateProvenance:string,actualBaseRateMicros:bigint|null=null;
      if(body.sourceKind==='JOURNAL'){
        journal=await tx.journalEntry.findFirst({where:{tenantId:a.tenantId,id:positiveId(body.journalEntryId),branchId,status:'POSTED',sourceType:'MANUAL'},include:{lines:true}});
        if(!journal||!journal.approvedById||journal.approvedById===journal.createdById)fail('Select an independently approved posted manual actual-payment journal');
        bank=await tx.bankAccount.findFirst({where:{tenantId:a.tenantId,id:positiveId(body.bankAccountId),currency:original.currency,financialResources:{some:{companyId:company.companyId,active:true}}}});if(!bank)fail('Select an authorized payment resource in the original supplier currency');
        originalAmount=currencyAmount(body.amount,balance.precision);reference=journal.number;rateProvenance=text(body.rateProvenance,'Actual payment rate provenance');
      }else{
        movement=await tx.bankTransaction.findFirst({where:{tenantId:a.tenantId,id:positiveId(body.bankTransactionId),branchId,kind,counterpartyAccountId:positiveId(original.accountId),journalEntry:{status:'POSTED'}},include:{bankAccount:true,journalEntry:{include:{lines:true}}}});
        if(!movement||movement.bankAccount.currency!==original.currency)fail(`Select a posted actual ${kind.toLowerCase()} to this supplier opening control account in its original currency`);
        journal=movement.journalEntry;bank=movement.bankAccount;originalAmount=movement.amountMinor;reference=movement.number;rateProvenance='Actual original amount and posted bank journal; source opening basis preserved';
      }
      this.resourceAllowed(a,company.companyId,'bank_account',bank.id);this.resourceAllowed(a,company.companyId,'account',BigInt(original.accountId));
      if(originalAmount<=0n||originalAmount>(BigInt(balance.remainingMinor)*sign))fail('Actual payment exceeds the remaining original supplier opening balance');
      if(journal.postingDate.toISOString().slice(0,10)<=source.data.cutoverDate)fail('Opening settlement must be an actual movement after cutover');
      if(journal.currency!==balance.baseCurrency)fail('Payment journal book currency must match the opening control');
      if(await tx.journalEntry.findFirst({where:{tenantId:a.tenantId,reversesEntryId:journal.id,status:'POSTED'}}))fail('Actual payment journal was reversed');
      if(await tx.av8Record.findFirst({where:{tenantId:a.tenantId,kind:'supplier-opening-settlement',data:{path:['journalEntryId'],equals:String(journal.id)}}}))fail('This actual cash source is already used by an opening settlement');
      if(await tx.av8Fund.findFirst({where:{tenantId:a.tenantId,bankTransaction:{journalEntryId:journal.id}}})||await tx.payment.findFirst({where:{tenantId:a.tenantId,journalEntryId:journal.id}}))fail('This cash source already belongs to a student, academy, refund, fee or document payment; do not count it twice');
      const signedAmount=sign*originalAmount,remaining=BigInt(balance.remainingMinor),book=originalAmount===remaining*sign?BigInt(balance.remainingBaseMinor):roundDiv(BigInt(original.baseMinor)*originalAmount,BigInt(original.amountMinor)*sign);
      const accountNet=(accountId:bigint)=>(journal.lines as any[]).filter(l=>l.accountId===accountId).reduce((n,l)=>n+l.debitMinor-l.creditMinor,0n);
      if(accountNet(BigInt(original.accountId))!==book)fail('Actual supplier control posting does not equal the original liability basis being settled; obtain a separately reviewed source/FX correction');
      const cashBook=-sign*accountNet(bank.glAccountId);if(cashBook<=0n)fail('Payment journal does not contain the actual cash movement in the selected direction');
      if(body.sourceKind==='JOURNAL'){
        const rate=body.baseRate!==undefined?parseFixed(body.baseRate,6,'Book currency per original unit'):openingMinor(body.baseRateMicros,'Actual payment rate');
        actualBaseRateMicros=rate;
        if(rate<=0n||convertMinor(originalAmount,balance.precision,balance.basePrecision,rate)!==cashBook)fail('Original payment amount and documented rate must reconcile to the actual bank GL movement');
      }
      if(cashBook!==book*sign)fail('Actual cash differs from historical supplier liability basis; this settlement needs an explicit approved FX policy/mapping before linking');
      const reason=text(body.reason,'Settlement reason'),evidenceReference=text(body.evidenceReference,'Actual supplier/payment evidence reference');
      const record=await tx.av8Record.create({data:{tenantId:a.tenantId,kind:'supplier-opening-settlement',key:String(journal.id),status:'RECORDED',data:serialize({sourceSystem,batchSourceId,balanceIndex:index,supplierId:String(original.supplierId),companyId:String(company.companyId),branchId:String(branchId),bankTransactionId:movement?String(movement.id):null,journalEntryId:String(journal.id),bankAccountId:String(bank.id),amountMinor:String(signedAmount),currency:original.currency,baseMinor:String(book),baseCurrency:balance.baseCurrency,cashOriginalMinor:String(originalAmount),cashBookMinor:String(cashBook),date:journal.postingDate.toISOString().slice(0,10),reference,evidenceReference,rateProvenance,actualBaseRateMicros:actualBaseRateMicros?String(actualBaseRateMicros):null,reason,actorId:String(a.userId)}),createdById:a.userId}});
      await audit(tx,a,'SUPPLIER_OPENING_SETTLED','SUPPLIER',BigInt(original.supplierId),branchId,{settlementId:String(record.id),sourceSystem,batchSourceId,balanceIndex:index,journalEntryId:String(journal.id),amountMinor:String(signedAmount),baseMinor:String(book),noNewCashPosting:true,reason});return record;
    });
  }
  private document(input:any){const content=Buffer.from(text(input.base64,'Original signed document',true,6*1024*1024),'base64');if(!content.length||content.length>4*1024*1024)fail('Original signed document must be at most 4 MB');const contentType=normalizeContentType(input.contentType||input.mimeType||'application/pdf');assertMagicBytes(contentType,content);if(contentType==='application/pdf'&&/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/i.test(content.toString('latin1')))fail('Active signed-document content is not accepted');const sha256=createHash('sha256').update(content).digest('hex');if(input.sha256&&input.sha256!==sha256)fail('Signed-document checksum differs from source');return{content,contentType,sha256,filename:filenameForContentType(input.filename||input.fileName,contentType)};}
  async preview(a:Actor,manifest:any){requireAv8(a,'av8.finance.adjust');return this.db.tenant(a.tenantId,async tx=>{const result=await this.inspect(tx,a,manifest);return{valid:result.valid,errors:result.errors,counts:result.counts,totals:result.totals,previewHash:result.previewHash,existingRows:result.existingRows,applicationCount:result.applications.length,resourceCount:result.resources.length,dateBasis:'source cutover and original historical dates',createsCashTransactions:false};});}
  commit(a:Actor,body:any,key:string){requireAv8(a,'av8.finance.adjust');requireAv8(a,'accounting.journal.post');const manifest=body.manifest,reason=text(body.reason,'Cutover approval reason');if(body.previewHash!==openingHash(manifest))fail('Manifest changed since preview; run dry run again');return once(this.db,a,'opening.commit',key,body,async tx=>{
    const result=await this.inspect(tx,a,manifest);if(!result.valid)fail(`Opening import blocked: ${result.errors.map(e=>`${e.path}: ${e.message}`).join('; ')}`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av8-opening:${a.tenantId}:${result.sourceSystem}`},0))`;
    const batchId=`${result.cutoff}:${manifest.openingJournalId}`,oldBatch=await this.source(tx,a,result.sourceSystem,'BATCH',batchId);if(oldBatch){if(oldBatch.checksum!==result.previewHash)fail('This cutover batch was already imported with different source data');return oldBatch.data;}
    const mapped:any[]=[];
    for(const row of result.applications){
      const old=await this.source(tx,a,result.sourceSystem,'APPLICATION',row.sourceId);if(old){mapped.push(old.data);continue;}
      const branchId=positiveId(row.branchId),link=await tx.companyBranch.findFirstOrThrow({where:{tenantId:a.tenantId,branchId,active:true}});
      let person=await this.source(tx,a,result.sourceSystem,'PERSON',row.personSourceId),customerId:bigint;
      const identity={name:row.name,phone:row.phone,email:row.email||null,companyId:String(link.companyId)};
      if(person){if(person.checksum!==openingHash(identity))fail('Person source ID maps to different identity; review the source before importing repeat applications');customerId=BigInt(person.data.customerId);}
      else{customerId=row.customerId?positiveId(row.customerId):(await tx.customer.create({data:{tenantId:a.tenantId,companyId:link.companyId,defaultBranchId:branchId,ownerUserId:positiveId(row.ownerId),code:`IMPORT-${openingHash([result.sourceSystem,row.personSourceId]).slice(0,20)}`,name:row.name,phone:row.phone,email:row.email||null,...contactKeys(row),city:row.city||'',customerType:'INDIVIDUAL',defaultCurrency:'USD'}})).id;await this.saveSource(tx,a,result.sourceSystem,'PERSON',row.personSourceId,openingHash(identity),{customerId:String(customerId)});}
      const lead=await tx.av8Lead.create({data:{tenantId:a.tenantId,branchId,ownerId:positiveId(row.ownerId),customerId,source:`Historical import: ${result.sourceSystem}`,program:row.program||'Original signed programme',phones:[row.phone],inquiryAt:new Date(`${row.inquiryDate||result.cutoff}T00:00:00Z`),status:'CONVERTED',notes:'Imported source history; original enquiry date unavailable unless supplied'}});
      const app=await tx.av8Application.create({data:{tenantId:a.tenantId,branchId,ownerId:positiveId(row.ownerId),customerId,leadId:lead.id,academyId:positiveId(row.academyId),reference:row.reference,program:row.program||'Original signed programme',admissions:row.admissions||'IMPORTED_REVIEW_REQUIRED',medical:row.medical||'PENDING',visa:row.visa||'PREPARING',travel:row.travel||'PREPARING',departedAt:row.departedAt?new Date(row.departedAt):null,guardian:row.guardian||{}}});
      let contract:any=null;
      if(row.contract){const data:any={imported:true,originalReference:row.contract.reference,signedDate:row.contract.signedDate,settlement:row.contract.settlement||null,originalPolicySnapshot:row.contract.originalPolicySnapshot||null,plan:{key:row.contract.planKey,data:{rulesVersion:'IMPORTED_SIGNED',sourceSystem:result.sourceSystem,actualAgreedSchedule:row.schedule}},schedule:{totalMinor:String(row.schedule.reduce((sum:bigint,c:any)=>sum+BigInt(c.amountMinor),0n)),items:row.schedule},legalPolicyReference:row.contract.policyReference||'Original signed agreement controls; review conflicts explicitly'};contract=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'contract',key:'main',status:'SIGNED',data,createdById:a.userId}});const file=this.document(row.contract.document);await tx.av8Attachment.create({data:{tenantId:a.tenantId,applicationId:app.id,recordId:contract.id,category:'contract',filename:file.filename,contentType:file.contentType,sizeBytes:file.content.length,sha256:file.sha256,content:new Uint8Array(file.content),uploadedById:a.userId}});}
      const charges=new Map<string,bigint>(),obligations=new Map<string,bigint>(),funds=new Map<string,any>();
      for(const c of row.schedule){const charge=await tx.av8Charge.create({data:{tenantId:a.tenantId,applicationId:app.id,key:c.key||c.sourceId,label:text(c.label,'Original charge label'),currency:'USD',amountMinor:BigInt(c.amountMinor),creditMinor:BigInt(c.creditMinor||'0'),dueDate:c.dueDate?new Date(c.dueDate):null,milestone:c.milestone||'ORIGINAL_AGREEMENT',predeparture:c.predeparture===true,deferred:c.deferred===true,contractId:contract?.id}});charges.set(c.sourceId,charge.id);}
      for(const o of row.academyObligations||[]){const obligation=await tx.av8Obligation.create({data:{tenantId:a.tenantId,applicationId:app.id,key:o.key||`IMPORTED:${o.sourceId}`,amountMinor:BigInt(o.amountMinor),dueDate:o.dueDate?new Date(o.dueDate):null,predeparture:o.predeparture===true,evidence:{imported:true,sourceSystem:result.sourceSystem,sourceId:o.sourceId,cutoverDate:result.cutoff,originalEvidenceReference:o.evidenceReference||null}}});obligations.set(o.sourceId,obligation.id);}
      for(const [kind,rows]of [['RECEIPT',row.receipts||[]],['REMITTANCE',row.remittances||[]]]as const)for(const f of rows){const originalPrecision=result.precisions[f.currency];const fund=await tx.av8Fund.create({data:{tenantId:a.tenantId,applicationId:app.id,branchId,academyId:kind==='REMITTANCE'?app.academyId:null,kind,status:'CLEARED',amountMinor:BigInt(f.amountMinor),currency:f.currency,usdMinor:BigInt(f.usdMinor),usdRateMicros:BigInt(f.usdRateMicros),baseRateMicros:BigInt(f.baseRateMicros),rateDate:new Date(f.rateDate),postingDate:new Date(f.date),bankAccountId:positiveId(f.bankAccountId),method:f.method,reference:text(f.reference,'Original payment reference'),payer:text(f.payer||row.name,'Original payer'),notes:'Imported historical payment; cash is represented by the approved opening journal, not a new collection',metadata:{importKind:'OPENING_HISTORY',sourceSystem:result.sourceSystem,sourceId:f.sourceId,openingJournalId:String(manifest.openingJournalId),liabilityAccountId:kind==='RECEIPT'?String(f.liabilityAccountId):undefined,cutoverDate:result.cutoff,originalPrecision,basePrecision:result.precisions[result.journal.currency],rateProvenance:text(f.rateProvenance,'Original rate provenance')},createdById:a.userId,clearedAt:new Date(`${f.date}T00:00:00Z`)}});funds.set(f.sourceId,fund);await this.saveSource(tx,a,result.sourceSystem,'FUND',f.sourceId,openingHash(f),{fundId:String(fund.id),applicationSourceId:row.sourceId});for(const allocation of f.allocations||[])await tx.av8Allocation.create({data:{tenantId:a.tenantId,fundId:fund.id,chargeId:kind==='RECEIPT'?charges.get(allocation.sourceId):undefined,obligationId:kind==='REMITTANCE'?obligations.get(allocation.sourceId):undefined,amountMinor:BigInt(allocation.amountMinor),reason:'Original source allocation; no new remittance obligation generated'}});}
      for(const service of row.services||[]){const base={imported:true,sourceSystem:result.sourceSystem,sourceId:service.sourceId,serviceKey:`IMPORTED:${service.sourceId}`,type:service.type,provider:text(service.provider,'Original service provider'),period:service.period,startDate:service.startDate||service.period+'-01',endDate:service.ongoing===true?(service.endDate||null):(service.endDate||new Date(Date.UTC(Number(service.period.slice(0,4)),Number(service.period.slice(5,7)),0)).toISOString().slice(0,10)),amountMinor:service.amountMinor,currency:service.currency,precision:result.precisions[service.currency],collectionParty:service.collectionParty,version:1,frequency:'MONTHLY'};const agreement=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'service',key:base.serviceKey,status:'ACTIVE',data:base,createdById:a.userId}});const charge=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'service-charge',key:`${base.serviceKey}:${service.period}`,status:'DUE',data:{...base,serviceId:String(agreement.id)},createdById:a.userId}});if(BigInt(service.paidMinor||'0')>0n){const fund=service.collectionParty==='AV8'?funds.get(service.receiptSourceId):null;if(service.collectionParty==='AV8'&&(!fund||fund.kind!=='RECEIPT'||fund.currency!==service.currency))fail('Imported service receipt reference or currency is invalid');const usdMinor=fund?convertMinor(BigInt(service.paidMinor),result.precisions[service.currency],2,fund.usdRateMicros):null;await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'service-payment',key:`${base.serviceKey}:paid`,status:'RECORDED',data:{...base,chargeId:String(charge.id),amountMinor:service.paidMinor,fundId:fund?String(fund.id):null,usdMinor:usdMinor?String(usdMinor):null,evidenceReference:text(service.evidenceReference,'Historical service payment evidence')},createdById:a.userId}});}}
      for(const refund of row.pendingRefunds||[])await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'refund',key:`IMPORTED:${refund.sourceId}`,status:'DECISION_REQUIRED',data:{caseType:'IMPORTED_PENDING',sourceSystem:result.sourceSystem,sourceId:refund.sourceId,requestedMinor:refund.amountMinor,currency:'USD',terminationDate:refund.terminationDate,deadline:refund.deadline,policyReference:refund.policyReference,reason:refund.reason||'Imported original pending refund; reconcile signed policy and prior payouts before approving new money',originalApprovalReference:refund.approvalReference||null,noAutomaticPayout:true},createdById:a.userId}});
      const mapping={sourceId:row.sourceId,applicationId:String(app.id),customerId:String(customerId),contractId:contract?String(contract.id):null,charges:Object.fromEntries([...charges].map(([source,id])=>[source,String(id)])),obligations:Object.fromEntries([...obligations].map(([source,id])=>[source,String(id)])),funds:Object.fromEntries([...funds].map(([source,fund])=>[source,String(fund.id)]))};mapped.push(mapping);await this.saveSource(tx,a,result.sourceSystem,'APPLICATION',row.sourceId,openingHash(row),mapping);
      await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'opening-source',key:row.sourceId,status:'IMPORTED',data:{sourceSystem:result.sourceSystem,sourceHash:openingHash(row),cutoverDate:result.cutoff,openingJournalId:String(manifest.openingJournalId),reason},createdById:a.userId}});
      await audit(tx,a,'OPENING_HISTORY_IMPORTED','APPLICATION',app.id,branchId,{...mapping,sourceSystem:result.sourceSystem,cutoverDate:result.cutoff,openingJournalId:String(manifest.openingJournalId),sourceHash:openingHash(row),noNewCashPosting:true});
    }
    const response={branchId:String(result.journal.branchId),applications:mapped,counts:result.counts,totals:result.totals,sourceSystem:result.sourceSystem,cutoverDate:result.cutoff,openingJournalId:String(manifest.openingJournalId),resources:result.resources,baseCurrency:result.journal.currency,basePrecision:result.precisions[result.journal.currency],supplierBalances:(manifest.supplierBalances||[]).map((row:any)=>({...row,precision:result.precisions[row.currency]})),customerLiabilities:manifest.customerLiabilities||[],createdCashTransactions:0,createdJournals:0,previewHash:result.previewHash};await this.saveSource(tx,a,result.sourceSystem,'BATCH',batchId,result.previewHash,response);return response;
  });}
}
