// Creates an uncommitted opening-import file and independently approved source journal.
// Only the verified local synthetic dev/test installations are accepted.
require('reflect-metadata');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const PDFDocument = require('pdfkit');
const { AppModule } = require('../../.av8/api/src/app.module');
const { PrismaService } = require('../../.av8/api/src/prisma.service');
const { AuthService } = require('../../.av8/api/src/auth');
const { Av8Service } = require('../../.av8/api/src/av8.service');
const { Av8OpeningService } = require('../../.av8/api/src/av8-opening.service');
const { ErpService } = require('../../.av8/api/src/erp.service');
const stringify = value => JSON.stringify(value, (_name,item) => typeof item === 'bigint' ? String(item) : item, 2);
async function main() {
  const environment = process.env.AV8_ENV;
  if (!['dev','test'].includes(environment) || process.env.AV8_HOSTING || process.env.AV8_OUTBOUND !== 'disabled' || process.env.AV8_JOBS !== 'disabled') throw new Error('Only the verified local AV8 dev/test wrapper is permitted');
  for (const [name,role] of [['DATABASE_URL','av8_runtime'],['DATABASE_ADMIN_URL','av8_owner'],['DATABASE_URL_UNPOOLED','av8_owner'],['POSTGRES_URL_NON_POOLING','av8_owner']]) {
    if (!process.env[name] && ['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(name)) continue;
    const url = new URL(process.env[name] || 'postgresql://invalid/invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== (environment === 'dev' ? '5548' : '5549') || url.pathname !== `/av8_${environment}` || url.username !== role) throw new Error('Opening browser fixture database identity mismatch');
  }
  if (['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED'].some(flag => process.env[flag] === 'true')) throw new Error('Disable provider and workers before preparing synthetic opening evidence');
  globalThis.fetch = async () => { throw new Error('No external requests permitted by opening fixture'); };
  const app = await NestFactory.createApplicationContext(AppModule,{logger:false});
  try {
    const db = app.get(PrismaService),auth = app.get(AuthService),av8 = app.get(Av8Service),opening = app.get(Av8OpeningService),erp = app.get(ErpService);
    for (const client of [db.admin,db.app]) {
      const identity = await client.$queryRaw`SELECT current_database() AS database, resource FROM av8_guard.av8_environment_identity`;
      if (identity.length !== 1 || identity[0].database !== `av8_${environment}` || identity[0].resource !== `av8-erp-${environment}`) throw new Error('Opening browser fixture marker mismatch');
    }
    const actor = async email => auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email},include:auth.userInclude}));
    const admin = await actor('admin@av8.local'); let checker = await actor('finance@av8.local');
    const refs = await av8.refs(admin),branchId = BigInt(refs.branches[0].id),token = randomUUID(),stamp = token.slice(0,8);
    const {bank,liability} = await db.tenant(admin.tenantId,async tx => {
      const asset = await tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-OPEN-UAT-${token}`,name:`Synthetic opening browser asset ${stamp}`,type:'ASSET'}});
      const liability = await tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-OPEN-LIAB-${token}`,name:`Synthetic original student liability ${stamp}`,type:'LIABILITY'}});
      const bank = await tx.bankAccount.create({data:{tenantId:admin.tenantId,code:`SYN-OPEN-UAT-${token}`,name:`Synthetic opening browser USD ${stamp}`,type:'BANK',currency:'USD',glAccountId:asset.id}});
      const resources = await tx.financialResource.findMany({where:{tenantId:admin.tenantId,OR:[{linkedBankAccountId:bank.id},{linkedAccountId:{in:[asset.id,liability.id]}}]}});
      for (const resource of resources) await tx.financialResourceAssignment.create({data:{tenantId:admin.tenantId,userId:checker.userId,resourceId:resource.id,grantedById:admin.userId,reason:'Explicit synthetic opening browser maker/checker and import resource assignment'}});
      return {bank,liability};
    });
    checker = await actor('finance@av8.local');
    const journal = await erp.createJournal(admin,{branchId:String(branchId),postingDate:'2026-01-01',description:`SYNTHETIC independently reviewed opening source ${stamp}`,lines:[{accountId:String(bank.glAccountId),debit:'50000',credit:'0'},{accountId:String(liability.id),debit:'0',credit:'50000'}]});
    await erp.journalWorkflow(admin,BigInt(journal.id),'submit');
    await erp.journalWorkflow(checker,BigInt(journal.id),'approve');
    await erp.journalWorkflow(checker,BigInt(journal.id),'post');
    const posted = await db.admin.journalEntry.findUniqueOrThrow({where:{id:BigInt(journal.id)}});
    if (posted.status !== 'POSTED' || posted.createdById === posted.approvedById || posted.approvedById !== checker.userId) throw new Error('Source opening journal must be posted by an independent checker');
    const pdf = new PDFDocument({size:'A4'}),chunks=[];
    const bytes = new Promise((resolve,reject) => {pdf.on('data',chunk=>chunks.push(chunk));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
    pdf.fontSize(19).text('SYNTHETIC ORIGINAL SIGNED SOURCE').moveDown().fontSize(12).text(`Original source reference ${stamp}; signed 1 December 2025.`).text('Agreed tuition USD 2,000; USD 1,000 allocated; USD 1,000 outstanding.').text('Original receipt USD 1,500; original academy transfer USD 500.').text('Historical closing bank USD 1,000 at the documented EGP 50 rate.').moveDown().text('Synthetic source-signature evidence for browser acceptance only. No real signature, student or cash movement.'); pdf.end();
    const buffer = await bytes,originalSignedPdfPath = path.resolve('.av8/opening-uat-original-signed.pdf'); await fs.writeFile(originalSignedPdfPath,buffer,{mode:0o600});
    const expectedTotals = {studentContractMinor:'200000',studentPaidMinor:'100000',studentOutstandingMinor:'100000',academyEntitlementMinor:'50000',academyTransferredMinor:'50000'};
    const manifest = {version:1,sourceSystem:`SYNTHETIC-OPENING-UAT-${token}`,cutoverDate:'2026-01-01',openingJournalId:String(journal.id),
      resources:[{bankAccountId:String(bank.id),currency:'USD',openingMinor:'100000',baseMinor:'5000000',baseRateMicros:'50000000',rateProvenance:'Synthetic original closing balance at documented 50 EGP per USD'}],
      customerLiabilities:[{accountId:String(liability.id),currency:'USD',amountMinor:'100000',baseMinor:'5000000',baseRateMicros:'50000000',rateProvenance:'Synthetic original liability after the historical academy transfer'}],supplierBalances:[],expectedTotals,
      applications:[{sourceId:'application-1',personSourceId:'person-1',reference:`SYNTHETIC-OPENING-UAT-${stamp}`,name:`SYNTHETIC original opening student ${stamp}`,phone:`+201${Date.now()}`,email:`opening-${stamp}@av8.invalid`,duplicateReviewed:true,branchId:String(branchId),ownerId:String(checker.userId),academyId:String(refs.academies[0].id),program:'Original synthetic signed programme',
        contract:{planKey:'A',reference:`SYNTHETIC original signed source ${stamp}`,signedDate:'2025-12-01',document:{fileName:'synthetic-original-signed.pdf',mimeType:'application/pdf',base64:buffer.toString('base64')}},
        schedule:[{sourceId:'charge-1',key:'TUITION',label:'Original agreed tuition',currency:'USD',amountMinor:'200000',paidMinor:'100000',dueDate:'2026-06-01'}],
        academyObligations:[{sourceId:'academy-1',amountMinor:'50000',paidMinor:'50000',dueDate:'2025-12-15'}],
        receipts:[{sourceId:'receipt-1',confirmed:true,reference:`SYNTHETIC original receipt ${stamp}`,date:'2025-12-10',rateDate:'2025-12-10',method:'BANK',bankAccountId:String(bank.id),liabilityAccountId:String(liability.id),amountMinor:'150000',currency:'USD',usdMinor:'150000',usdRateMicros:'1000000',baseRateMicros:'50000000',rateProvenance:'Original synthetic USD identity and EGP 50 rate',allocations:[{sourceId:'charge-1',amountMinor:'100000'}]}],
        remittances:[{sourceId:'transfer-1',confirmed:true,reference:`SYNTHETIC original academy transfer ${stamp}`,date:'2025-12-15',rateDate:'2025-12-15',method:'BANK',bankAccountId:String(bank.id),amountMinor:'50000',currency:'USD',usdMinor:'50000',usdRateMicros:'1000000',baseRateMicros:'50000000',rateProvenance:'Original synthetic transfer at EGP 50 per USD',allocations:[{sourceId:'academy-1',amountMinor:'50000'}]}],
        services:[{sourceId:'service-1',type:'TRANSPORT',provider:'Synthetic original provider',collectionParty:'PROVIDER',period:'2025-12',amountMinor:'5000',paidMinor:'0',currency:'USD'}],
        pendingRefunds:[{sourceId:'refund-1',amountMinor:'10000',terminationDate:'2025-12-20',deadline:'2026-02-03',policyReference:'Original synthetic signed source policy',approvalReference:'Original unresolved synthetic refund case; requires explicit review'}]}]};
    const before = {journals:await db.admin.journalEntry.count({where:{tenantId:admin.tenantId}}),cash:await db.admin.bankTransaction.count({where:{tenantId:admin.tenantId}}),applications:await db.admin.av8Application.count({where:{tenantId:admin.tenantId}})};
    const preview = await opening.preview(checker,manifest);
    if (!preview.valid) throw new Error(`Synthetic opening preview blockers: ${preview.errors.map(row=>`${row.path}: ${row.message}`).join('; ')}`);
    const history = await opening.history(checker);
    if (history.some(row=>row.source_system===manifest.sourceSystem) || await db.admin.av8Application.count({where:{tenantId:admin.tenantId,reference:manifest.applications[0].reference}})) throw new Error('Browser setup must leave source import uncommitted');
    if (await db.admin.bankTransaction.count({where:{tenantId:admin.tenantId}})!==before.cash || await db.admin.journalEntry.count({where:{tenantId:admin.tenantId}})!==before.journals) throw new Error('Preview unexpectedly posted a cash transaction or journal');
    const manifestPath = path.resolve('.av8/opening-uat-manifest.json'); await fs.writeFile(manifestPath,stringify(manifest)+'\n',{mode:0o600});
    const fixture = {synthetic:true,environment,createdAt:new Date().toISOString(),manifestPath,originalSignedPdfPath,bankAccountId:String(bank.id),bankName:bank.name,openingJournalId:String(journal.id),sourceSystem:manifest.sourceSystem,applicationReference:manifest.applications[0].reference,expectedTotals,expectedCounts:{applications:1,receipts:1,remittances:1,charges:1,obligations:1,services:1,pendingRefunds:1,attachments:1,createdCashTransactions:0,createdJournals:0},expectedBalances:{originalMinor:'100000',bookMinor:'5000000',unallocatedReceiptMinor:'50000',serviceOutstandingMinor:'5000'},before};
    await fs.writeFile(path.resolve('.av8/opening-uat-fixture.json'),stringify(fixture)+'\n',{mode:0o600}); console.log(stringify(fixture));
  } finally {await app.close();}
}
main().catch(error=>{console.error(error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[redacted database URL]'));process.exitCode=1;});
