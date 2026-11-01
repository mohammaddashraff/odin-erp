import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Synthetic browser setup only. The verified local dev/test wrappers are the
// only supported targets; each invocation creates new auditable cases.
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const environment=process.env.AV8_ENV,port=environment==='dev'?'5548':'5549';
if(!['dev','test'].includes(environment)||process.env.AV8_HOSTING||process.env.AV8_OUTBOUND!=='disabled'||process.env.AV8_JOBS!=='disabled')throw new Error('Use the verified local dev/test wrapper only; hosted fixture seeding is prohibited');
for(const [key,role] of [['DATABASE_URL','av8_runtime'],['DATABASE_ADMIN_URL','av8_owner'],['DATABASE_URL_UNPOOLED','av8_owner'],['POSTGRES_URL_NON_POOLING','av8_owner']]){
  if(!process.env[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
  const target=new URL(process.env[key]||'');
  if(target.hostname!=='127.0.0.1'||target.port!==port||target.pathname!==`/av8_${environment}`||target.username!==role)throw new Error('Finance browser fixture database identity mismatch');
}
if(['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED'].some(flag=>process.env[flag]==='true'))throw new Error('Disable external academic delivery and background workers before preparing local finance browser fixtures');
const require=createRequire(import.meta.url);require('reflect-metadata');
const compiled=path.join(root,'.av8/api/src');
if(!fs.existsSync(path.join(compiled,'app.module.js')))throw new Error('Build the current API into .av8/api before preparing browser fixtures');
const {NestFactory}=require('@nestjs/core'),PDFDocument=require('pdfkit');
const {AppModule}=require(path.join(compiled,'app.module.js')),{PrismaService}=require(path.join(compiled,'prisma.service.js')),{AuthService}=require(path.join(compiled,'auth.js')),{Av8Service}=require(path.join(compiled,'av8.service.js')),{Av8FinanceService}=require(path.join(compiled,'av8-finance.service.js'));
const {cairoCalendarDate}=require(path.join(compiled,'av8-domain.js'));
const key=()=>randomUUID(),stamp=key().slice(0,8),date=cairoCalendarDate();
const application=await NestFactory.createApplicationContext(AppModule,{logger:false});
try{
  const db=application.get(PrismaService),auth=application.get(AuthService),av8=application.get(Av8Service),fin=application.get(Av8FinanceService);
  for(const client of [db.admin,db.app]){
    const identity=await client.$queryRaw`SELECT current_database() AS database, resource FROM av8_guard.av8_environment_identity`;
    if(identity.length!==1||identity[0].database!==`av8_${environment}`||identity[0].resource!==`av8-erp-${environment}`)throw new Error('Finance browser fixture resource marker mismatch');
  }
  const actor=async email=>auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email},include:auth.userInclude}));
  const admin=await actor('admin@av8.local');let manager=await actor('management@av8.local'),finance=await actor('finance@av8.local');
  const refs=await av8.refs(admin),branchId=refs.branches.find(branch=>branch.code==='CAI')?.id||refs.branches[0].id;
  const bank=await db.admin.bankAccount.findUniqueOrThrow({where:{tenantId_code:{tenantId:admin.tenantId,code:'AV8-USD'}}});
  if(bank.type!=='BANK'||bank.currency!=='USD'||!bank.active)throw new Error('Explicit synthetic USD bank is not available');
  const academy=await db.admin.supplier.findUniqueOrThrow({where:{tenantId_code:{tenantId:admin.tenantId,code:'AV8-SYNTHETIC-ACADEMY'}}});
  const doc=new PDFDocument({size:'A4'}),chunks=[];
  const evidenceBytes=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  doc.fontSize(20).text('SYNTHETIC LOCAL FINANCE ACCEPTANCE');doc.moveDown().fontSize(12).text(`Fixture ${stamp} / ${date}`).text('This is test evidence only. It is not a bank confirmation, signed client agreement or real payment.').moveDown().text(`Used only in the isolated AV8 ${environment} database to test controlled UI workflow and evidence handling.`);doc.end();
  const buffer=await evidenceBytes,evidencePath=path.join(root,'.av8/finance-uat-evidence.pdf');fs.writeFileSync(evidencePath,buffer,{mode:0o600});
  const file={buffer,mimetype:'application/pdf',originalname:'synthetic-finance-acceptance.pdf'};
  const reason='SYNTHETIC isolated browser acceptance only; no external bank action';
  const configure=async(kind,code,data,approve=true)=>{const current=(await av8.policies(admin)).find(policy=>policy.kind===kind&&policy.key===code);if(!current)throw new Error(`Synthetic policy template ${kind}/${code} is missing`);const draft=await av8.savePolicy(admin,{id:current.id,data:{...current.data,...data},reason},key());return approve&&draft.status==='DRAFT'?av8.savePolicy(manager,{id:draft.id,action:'approve',reason:'Independent '+reason},key()):draft;};
  const expense=await db.admin.account.upsert({where:{tenantId_code:{tenantId:admin.tenantId,code:'SYN-UAT-FEE-EXP'}},update:{},create:{tenantId:admin.tenantId,code:'SYN-UAT-FEE-EXP',name:'Synthetic browser bank-fee expense and FX',type:'EXPENSE',postingAllowed:true}});
  const receivable=await db.admin.account.upsert({where:{tenantId_code:{tenantId:admin.tenantId,code:'SYN-UAT-FEE-RCV'}},update:{},create:{tenantId:admin.tenantId,code:'SYN-UAT-FEE-RCV',name:'Synthetic browser exact fee receivable',type:'ASSET',postingAllowed:true}});
  await db.tenant(admin.tenantId,async tx=>{const resources=await tx.financialResource.findMany({where:{tenantId:admin.tenantId,linkedAccountId:{in:[expense.id,receivable.id]},active:true}});for(const user of [finance,manager])for(const resource of resources)if(!await tx.financialResourceAssignment.findFirst({where:{tenantId:admin.tenantId,userId:user.userId,resourceId:resource.id,revokedAt:null}}))await tx.financialResourceAssignment.create({data:{tenantId:admin.tenantId,userId:user.userId,resourceId:resource.id,grantedById:admin.userId,reason:'Explicit synthetic browser fee/FX account authorization'}});});
  finance=await actor('finance@av8.local');manager=await actor('management@av8.local');
  for(const user of [finance,manager])if(!(await av8.refs(user)).banks.some(resource=>resource.id===String(bank.id)))throw new Error('The chosen bank must already be assigned to both ordinary finance and management actors');
  await configure('SETTLEMENT','INSTALLMENT',{});
  await configure('SETTLEMENT','CASH',{});
  const plan=await configure('PLAN','A',{interpretation:'EACH',anchor:'CONTRACT',offsetMonths:3,frequencyMonths:3,firstMilestone:'CONTRACT'});
  const cashPlan=await configure('PLAN','CASH',{collectionMilestone:'CONTRACT',collectionDate:null});
  const refundPolicy=await configure('REFUND','TERMINATION',{refundConversion:'ORIGINAL_RECEIPT_RATE',unpaidObligations:'CANCEL_REMAINING',legacyConflictTreatment:'REQUIRE_CASE_REVIEW',fxDifferenceAccountCode:expense.code});
  const chequePolicy=await configure('CHEQUE','COLLECTION',{creditEvent:'CLEARANCE',fxEvent:'CLEARANCE',travelGate:'CLEARED'});
  const feePolicy=await configure('BANK_FEE','REMITTANCE',{treatment:'EXPENSE_AND_RECEIVABLE',expenseAccountCode:expense.code,receivableAccountCode:receivable.code,reimbursementOffsetAccountCode:expense.code,fxDifferenceAccountCode:expense.code});
  const detail=async id=>av8.detail(admin,BigInt(id));
  async function newStudent(label){
    const name=`SYNTHETIC browser ${label} ${stamp}`;
    const lead=await av8.createLead(admin,{name,phone:`+209${String(Date.now()).slice(-9)}${String(Math.floor(Math.random()*1000)).padStart(3,'0')}`,email:`synthetic-${label}-${stamp}@example.test`,source:'Website',program:'Flight training',branchId,ownerId:String(admin.userId),duplicateReviewed:true,inquiryAt:new Date(Date.now()-3600000).toISOString()},key());
    let current=await av8.leadDetail(admin,BigInt(lead.id));const when=new Date(Date.now()-600000).toISOString();await av8.leadAction(admin,BigInt(lead.id),{version:current.version,action:'appointment',status:'SCHEDULED',plannedAt:when,reason},key());
    current=await av8.leadDetail(admin,BigInt(lead.id));await av8.leadAction(admin,BigInt(lead.id),{version:current.version,action:'appointment',recordId:current.records.find(record=>record.kind==='appointment').id,status:'ATTENDED',actualAt:when,reason},key());
    const student=await av8.convert(admin,BigInt(lead.id),{academyId:String(academy.id),reason},key());let state=await detail(student.id);
    await av8.record(admin,BigInt(student.id),{version:state.version,kind:'finance_evidence',title:`SYNTHETIC finance browser evidence ${stamp}`,reason},key());state=await detail(student.id);const record=state.records.find(row=>row.kind==='finance_evidence');const attachment=await av8.upload(admin,BigInt(student.id),BigInt(record.id),file);
    return{...student,name,evidenceId:attachment.id,chargeId:state.finance.schedule.find(charge=>charge.key==='APPLICATION').id};
  }
  async function collect(student,chargeId,amount){return fin.receipt(admin,BigInt(student.id),{amount,currency:'USD',bankAccountId:String(bank.id),method:'BANK',chargeId,paymentDate:date,usdToBaseRate:'50',reference:`SYNTHETIC-${stamp}-${key()}`,payer:'Synthetic student',notes:reason},key(),file);}
  async function medicallyPassed(student){await collect(student,student.chargeId,'2000');let state=await detail(student.id);await av8.medical(admin,BigInt(student.id),{version:state.version,date,outcome:'PASSED',provider:'Synthetic medical provider',reason},key());state=await detail(student.id);await av8.upload(admin,BigInt(student.id),BigInt(state.records.find(row=>row.kind==='medical').id),file);}
  async function signed(student){await medicallyPassed(student);await av8.contract(admin,BigInt(student.id),{planId:plan.id},key());const state=await detail(student.id);await av8.upload(admin,BigInt(student.id),BigInt(state.records.find(row=>row.kind==='contract').id),file);await av8.contract(admin,BigInt(student.id),{action:'sign',signedDate:date},key());}
  async function remit(student,feeAmount){const state=await detail(student.id),obligation=state.finance.academy.find(row=>row.key==='MEDICAL_PASS');const fund=await fin.create(admin,{kind:'REMITTANCE',applicationId:student.id,amount:'1500',currency:'USD',baseRate:'50',rateDate:date,postingDate:date,bankAccountId:String(bank.id),payer:'Synthetic academy',reference:`SYNTHETIC-${stamp}-${key()}`,evidenceId:student.evidenceId,...(feeAmount?{feeAmount,feePolicyId:feePolicy.id}:{})},key());await fin.action(manager,BigInt(fund.id),{action:'approve',reason:'Independent '+reason},key());await fin.action(finance,BigInt(fund.id),{action:'confirm',reason,allocations:[{obligationId:obligation.id,amount:'1500'}]},key());return fund;}
  const refund=await newStudent('refund');await signed(refund);let state=await detail(refund.id);await collect(refund,state.finance.schedule.find(charge=>charge.key==='CONTRACT').id,'6000');const originalRemittance=await remit(refund);
  const cheque=await newStudent('cheque');
  const fee=await newStudent('fee');await signed(fee);const feeRemittance=await remit(fee,'20');state=await detail(fee.id);const bankFee=state.records.find(row=>row.kind==='bank-fee'&&row.data.fundId===feeRemittance.id);
  if(!bankFee||bankFee.status!=='OPEN'||bankFee.data.remainingUsdMinor!=='2000')throw new Error('Synthetic fee source did not produce the exact open receivable');
  const draftPolicy=await configure('PLAN','B',{interpretation:'EACH',anchor:'CONTRACT',offsetMonths:3,frequencyMonths:3,firstMilestone:'CONTRACT'},false);
  const contractB=await newStudent('contract-b'),contractCash=await newStudent('contract-cash');
  await medicallyPassed(contractB);await medicallyPassed(contractCash);
  const common=student=>({applicationId:String(student.id),reference:student.reference,name:student.name,evidenceId:student.evidenceId});
  const output={synthetic:true,environment,createdAt:new Date().toISOString(),fixtureId:stamp,date,baseRate:'50',usdRate:'1',currency:'USD',bankAccountId:String(bank.id),bankName:bank.name,evidencePath,actors:{maker:'finance@av8.local',approver:'management@av8.local'},refund:{...common(refund),policyId:refundPolicy.id,originalRemittanceId:originalRemittance.id,expectedEntitlementMinor:'800000',expectedInitialLocalMinor:'650000',partialPayoutAmount:'500',recoveryAmount:'1500',expectedRecoveryCapMinor:'150000',expectedFinalPayoutAmount:'7500'},cheque:{...common(cheque),policyId:chequePolicy.id,chargeId:cheque.chargeId,amount:'1000',expectedClearedMinor:'100000',expectedReturnedMinor:'0',expectedReplacementPaidMinor:'100000',chequeNumber:`SYNTHETIC-${stamp}`,replacementNumber:`SYNTHETIC-REPLACEMENT-${stamp}`},fee:{...common(fee),bankFeeId:bankFee.id,originalRemittanceId:feeRemittance.id,policyId:feePolicy.id,amount:'20',expectedFeeMinor:'2000',expectedTuitionPaidMinor:'200000',expectedAcademyRemittedMinor:'150000'},policyApproval:{id:draftPolicy.id,kind:draftPolicy.kind,key:draftPolicy.key,version:draftPolicy.version,status:draftPolicy.status,reason:'SYNTHETIC quarterly offset 3 months for isolated browser approval only'}};
  output.contracts={planA:{...common(fee),policyId:plan.id,expectedRows:8,expectedTotalMinor:'6400000',status:'SIGNED'},planB:{...common(contractB),policyId:draftPolicy.id,expectedRows:8,expectedTotalMinor:'6400000',status:'UNPREPARED'},cash:{...common(contractCash),policyId:cashPlan.id,expectedRows:2,expectedTotalMinor:'5400000',expectedAcademyMinor:'5400000',academyDueOffsetMonths:3,status:'UNPREPARED'}};
  const outputPath=path.join(root,'.av8/finance-uat-fixture.json');fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({synthetic:true,environment,fixturePath:outputPath,applicationIds:[refund.id,cheque.id,fee.id,contractB.id,contractCash.id],draftPolicyId:draftPolicy.id}));
}finally{await application.close();}
