import { contactKeys, contactMatches, normalizedName, normalizedPhone } from './contact-normalization';
import { av8DatabaseOrder, orderAv8Rows } from './av8-list-order';
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { Actor, can } from './auth';
import { companyForBranch } from './access-governance';
import { PrismaService } from './prisma.service';
import { ErpService } from './erp.service';
import { serialize } from './money';
import { av8ActorAtBranch, application, assignedUser, atBranch, audit, approval, av8Scope, once, permits, requireAv8, version, Av8Tx } from './av8-access';
import { CONFIRMED_RULES_VERSION, calendarDate, cairoCalendarDate, csvRows, decimal, documentChecklist, fail, instant, leadInput, missingDocuments, monthsAfter, planPreview, positiveId, text, transition, transitions } from './av8-domain';
import { assertMagicBytes, attachmentMaximumBytes, filenameForContentType, normalizeContentType } from './private-attachments.service';
import { Av8OperationsService } from './av8-operations.service';
import { academicAddress, academicEmailConfiguration } from './av8-academic-email';

@Injectable()
export class Av8Service {
  constructor(readonly db:PrismaService, readonly erp:ErpService, readonly operations:Av8OperationsService) {}
  async read<T>(a:Actor, fn:(tx:Av8Tx)=>Promise<T>) {return serialize(await this.db.tenant(a.tenantId,fn));}
  async policy(tx:Av8Tx,a:Actor,kind:string,key:string,approved=false) {
    return tx.av8Policy.findFirst({where:{tenantId:a.tenantId,kind,key,...(approved?{status:'APPROVED'}:{})},orderBy:{version:'desc'}});
  }
  private policyUsable(policy:any) {try{this.validatePolicy(policy.kind,policy.key,policy.data);return policy.kind!=='ACCOUNTING'&&(!['PLAN','REFUND','CHEQUE','BANK_FEE'].includes(policy.kind)||policy.status==='APPROVED');}catch{return false;}}
  private latestPolicies(rows:any[]) {const seen=new Set<string>();return rows.filter(row=>{const key=`${row.kind}:${row.key}`;if(seen.has(key))return false;seen.add(key);return true;});}
  async refs(a:Actor) {
    requireAv8(a,'av8.workspace.view');
    return this.read(a,async tx=>{
      const branchIds=can(a,'system.super_admin')?undefined:a.branchIds.map(BigInt);
      const branches=await tx.branch.findMany({where:{tenantId:a.tenantId,id:branchIds?{in:branchIds}:undefined,companyLinks:{some:{active:true,company:{active:true}}}},orderBy:{id:'asc'}});
      const users=await tx.user.findMany({where:{tenantId:a.tenantId,active:true},select:{id:true,name:true,branchIds:true}});
      const eligibleBranches=branches.filter(branch=>users.some(user=>(user.branchIds as string[]).includes(String(branch.id))));
      const policies=this.latestPolicies(await tx.av8Policy.findMany({where:{tenantId:a.tenantId},orderBy:[{kind:'asc'},{key:'asc'},{version:'desc'}]}));
      return {branches:eligibleBranches,users:users.filter(u=>(u.branchIds as string[]).some(b=>eligibleBranches.some(x=>String(x.id)===String(b)))),
        academies:await tx.supplier.findMany({where:{tenantId:a.tenantId,active:true,companyId:can(a,'system.super_admin')?undefined:{in:a.companyIds.map(BigInt)}},select:{id:true,name:true}}),
        policies:policies.filter(p=>(p.kind!=='ACCOUNTING'||permits(a,'av8.finance.view')&&p.status==='APPROVED')&&(permits(a,'av8.policies.view')||permits(a,'av8.finance.view')||p.kind==='PLAN'&&permits(a,'av8.applications.view'))).map(p=>({...p,usable:this.policyUsable(p)})),
        banks:permits(a,'av8.finance.view')?await tx.bankAccount.findMany({where:{tenantId:a.tenantId,active:true,financialResources:{some:{companyId:{in:a.companyIds.map(BigInt)},active:true}}},select:{id:true,name:true,currency:true,type:true}}):[],
        baseCurrency:(await tx.tenant.findUniqueOrThrow({where:{id:a.tenantId}})).baseCurrency,outbound:academicEmailConfiguration().emailMode,timezone:'Africa/Cairo'};
    });
  }
  async leads(a:Actor,q:any={}) {
    const page=Math.max(1,Math.min(100000,Number(q.page)||1));const size=25;
    return this.read(a,async tx=>{
      const planning:any=(await this.policy(tx,a,'PLANNING','DEFAULT'))?.data||{};
      const where:any={AND:[av8Scope(a,'lead','av8.leads.view'),...(q.search?[{customer:{OR:[{normalizedName:{contains:normalizedName(String(q.search).slice(0,100))}},...(normalizedPhone(String(q.search))?[{normalizedPhone:{contains:normalizedPhone(String(q.search).slice(0,100))}}]:[]),{normalizedEmail:{contains:String(q.search).slice(0,100).trim().toLowerCase()}}]}}]:[])]};
      if(q.status)where.status=String(q.status);
      if(q.queue==='uncontacted')where.firstContactAt=null;
      if(q.queue==='overdue')where.nextFollowUp={lt:new Date()};
      if(q.ownerId)where.ownerId=positiveId(q.ownerId);
      const [rows,total]=await Promise.all([tx.av8Lead.findMany({where,include:{customer:true},orderBy:av8DatabaseOrder('leads',q),skip:(page-1)*size,take:size}),tx.av8Lead.count({where})]);
      return {rows:rows.map(r=>({...r,responseOverdue:!r.firstContactAt&&Date.now()-r.inquiryAt.valueOf()>(planning.responseMinutes||60)*60000})),total,page,size};
    });
  }
  async leadDetail(a:Actor,id:bigint) {
    return this.read(a,async tx=>{
      const lead=await tx.av8Lead.findFirst({where:{AND:[{id},av8Scope(a,'lead','av8.leads.view')]},include:{customer:true,records:{orderBy:{createdAt:'desc'}},applications:{select:{id:true,reference:true,admissions:true}}}});
      if(!lead)throw new NotFoundException('Lead not found');
      const timeline=await tx.auditEvent.findMany({where:{tenantId:a.tenantId,entityType:'AV8_LEAD',entityId:String(id)},include:{user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100});
      return {...lead,timeline,records:lead.records.map(r=>({...r,allowedStatuses:[r.status,...(transitions[r.kind]?.[r.status]||[])].filter((status,index,all)=>all.indexOf(status)===index)}))};
    });
  }
  async createLeadTx(tx:Av8Tx,a:Actor,body:any) {
    const value=leadInput(body),branchId=positiveId(body.branchId),ownerId=positiveId(body.ownerId||a.userId);
    atBranch(a,'av8.leads.create',branchId);await assignedUser(tx,a,ownerId,branchId);
    const branch=await tx.branch.findFirst({where:{id:branchId,tenantId:a.tenantId}});if(!branch)fail('Branch not found');
    const company=await tx.companyBranch.findFirst({where:{tenantId:a.tenantId,branchId,active:true,company:{active:true}}});if(!company)fail('Select an active branch linked to a company');
    const duplicate=await tx.customer.findMany({where:{tenantId:a.tenantId,companyId:company.companyId,OR:contactMatches(value)},select:{id:true,name:true}});
    if(duplicate.length&&!body.duplicateReviewed&&!body.customerId)fail('Potential duplicate: review the matching contact or explicitly keep separate people sharing a phone');
    let customer=body.customerId?await tx.customer.findFirst({where:{id:positiveId(body.customerId),tenantId:a.tenantId,companyId:company.companyId,defaultBranchId:branchId}}):null;
    if(body.customerId&&!customer)fail('Contact is outside the selected branch');
    if(!customer)customer=await tx.customer.create({data:{tenantId:a.tenantId,companyId:company.companyId,code:await this.erp.av8Number(tx,a,branchId,'CONTACT'),name:value.name,phone:value.phone,email:value.email||null,city:text(body.city,'City',false,100),customerType:'INDIVIDUAL',defaultBranchId:branchId,ownerUserId:ownerId,defaultCurrency:'USD'}});
    const extraPhones=Array.isArray(body.otherPhones)?body.otherPhones.map((p:any)=>leadInput({...body,phone:p}).phone).slice(0,5):[];
    const lead=await tx.av8Lead.create({data:{tenantId:a.tenantId,branchId,ownerId,customerId:customer.id,source:value.source,campaign:value.campaign||null,program:value.program,phones:[value.phone,...extraPhones],inquiryAt:value.inquiryAt,nextFollowUp:value.nextFollowUp,notes:value.notes}});
    await audit(tx,a,'CAPTURED','LEAD',lead.id,branchId,{source:value.source,duplicateReview:duplicate.length?{keptSeparate:!body.customerId,candidates:duplicate.map(x=>String(x.id))}:null});return lead;
  }
  createLead(a:Actor,b:any,key:string) {requireAv8(a,'av8.leads.create');return once(this.db,a,'lead.create',key,b,tx=>this.createLeadTx(tx,a,b));}
  async importPreview(a:Actor,b:any) {
    requireAv8(a,'av8.leads.import');
    const rows=csvRows(text(b.csv,'CSV',true,512000));const header=rows.shift()?.map(x=>x.trim())||[];
    if(!['name','phone','source'].every(k=>header.includes(k)))fail('CSV needs name, phone and source columns');
    return this.read(a,async tx=>{
      const seen=new Map<string,number>();const results=[];
      for(const [i,cells] of rows.entries()) {
        const data=Object.fromEntries(header.map((h,j)=>[h,cells[j]||'']));let error='';let keys:any=null;
        try{keys=contactKeys(leadInput(data));}catch(e:any){error=e.message;}
        const matches=keys?await tx.av8Lead.findMany({where:{AND:[av8Scope(a,'lead','av8.leads.view'),{customer:{OR:contactMatches(data as any)}}]},select:{customer:{select:{id:true,name:true}}},take:20}):[];
        const duplicates=matches.map(r=>({customerId:String(r.customer.id),name:r.customer.name}));
        const earlier=keys?[keys.normalizedPhone,keys.normalizedName,keys.normalizedEmail].filter(Boolean).map(k=>seen.get(k)).find(Boolean):null;
        if(keys)for(const key of [keys.normalizedPhone,keys.normalizedName,keys.normalizedEmail].filter(Boolean))seen.set(key,i+2);
        results.push({row:i+2,data,error,duplicates,duplicateInFile:earlier||null});
      }
      return {rows:results};
    });
  }
  importCommit(a:Actor,b:any,key:string) {
    requireAv8(a,'av8.leads.import');
    if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>500)fail('Choose 1–500 validated rows');
    return once(this.db,a,'lead.import',key,b,async tx=>{const rows=[];for(const row of b.rows)rows.push(await this.createLeadTx(tx,a,{...row,branchId:b.branchId,ownerId:b.ownerId}));return {count:rows.length,rows};});
  }
  leadAction(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.leads.edit');return once(this.db,a,`lead.${id}`,key,b,async tx=>{
      const lead=await tx.av8Lead.findFirst({where:{AND:[{id},av8Scope(a,'lead','av8.leads.edit')]}});if(!lead)throw new NotFoundException('Lead not found');version(b.version,lead.version);
      const reason=text(b.reason,'Reason');const data:any={version:{increment:1}};
      if(b.action==='assign') {data.ownerId=positiveId(b.ownerId);await assignedUser(tx,a,data.ownerId,lead.branchId);}
      else if(b.action==='status') {transition('crm',lead.status,b.status);data.status=b.status;if(b.status==='CONTACTED'&&!lead.firstContactAt)data.firstContactAt=b.actualAt?instant(b.actualAt):new Date();}
      else if(b.action==='consultation') {
        if(lead.status!=='ATTENDED')fail('Record appointment attendance before the consultation outcome');
        if(!['PROCEEDING','FOLLOWUP','DEFERRED','DECLINED'].includes(b.outcome))fail('Select a consultation outcome');
        data.status=b.outcome==='DECLINED'?'NOT_PROCEEDING':b.outcome==='DEFERRED'?'DEFERRED':b.outcome==='FOLLOWUP'?'NURTURING':'ATTENDED';
        await tx.av8Record.create({data:{tenantId:a.tenantId,leadId:id,kind:'consultation',key:randomUUID(),status:b.outcome,data:{reason,actualAt:instant(b.actualAt).toISOString()},createdById:a.userId}});
      } else if(b.action==='appointment') {
        const actualStatus=b.status||'SCHEDULED';
        const old=b.recordId?await tx.av8Record.findFirst({where:{id:positiveId(b.recordId),tenantId:a.tenantId,leadId:id,kind:'appointment'}}):null;
        if(b.recordId&&!old)fail('Appointment not found');if(old&&old.status!==actualStatus)transition('appointment',old.status,actualStatus);else if(!old&&actualStatus!=='SCHEDULED')fail('New appointments start scheduled');
        const plannedAt=b.plannedAt?instant(b.plannedAt).toISOString():(old?.data as any)?.plannedAt;if(!plannedAt)fail('Appointment date/time is required');
        const payload={...(old?.data as any||{}),plannedAt,reason,actualAt:b.actualAt===undefined?(old?.data as any)?.actualAt||null:b.actualAt?instant(b.actualAt).toISOString():null,location:text(b.location===undefined?(old?.data as any)?.location||'Office':b.location,'Location',true,160)};
        if(actualStatus==='ATTENDED'&&!payload.actualAt)fail('Attendance needs an actual time');
        if(old)await tx.av8Record.update({where:{id:old.id},data:{status:actualStatus,data:payload}});else await tx.av8Record.create({data:{tenantId:a.tenantId,leadId:id,kind:'appointment',key:randomUUID(),status:actualStatus,data:payload,createdById:a.userId}});
        if(actualStatus==='ATTENDED')data.status='ATTENDED';else if(['SCHEDULED','CONFIRMED','RESCHEDULED'].includes(actualStatus))data.status='APPOINTMENT_BOOKED';else if(['NO_SHOW','CANCELLED'].includes(actualStatus))data.status='NURTURING';
      } else if(b.action!=='note')fail('Unknown lead action');
      if(data.firstContactAt && (data.firstContactAt < lead.inquiryAt || data.firstContactAt > new Date()))fail('First contact must be between inquiry and now');
      if(b.nextFollowUp!==undefined)data.nextFollowUp=b.nextFollowUp?instant(b.nextFollowUp):null;
      await tx.av8Lead.update({where:{id},data});await audit(tx,a,String(b.action).toUpperCase(),'LEAD',id,lead.branchId,{reason,...serialize(data)},serialize(lead));return {ok:true};
    });
  }
  convert(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.leads.convert');return once(this.db,a,`convert.${id}`,key,b,async tx=>{
      const lead=await tx.av8Lead.findFirst({where:{AND:[{id},av8Scope(a,'lead','av8.leads.convert')]}});if(!lead)throw new NotFoundException('Lead not found');
      if(!['ATTENDED','CONVERTED'].includes(lead.status))fail('Complete the attended consultation before opening an application');
      const academyId=positiveId(b.academyId);const link=await tx.companyBranch.findFirstOrThrow({where:{tenantId:a.tenantId,branchId:lead.branchId}});
      if(!await tx.supplier.findFirst({where:{id:academyId,tenantId:a.tenantId,companyId:link.companyId,active:true}}))fail('Academy must be an active partner in this company');
      const program=await this.policy(tx,a,'PROGRAM','DEFAULT');const applicationFeeMinor=/^\d+$/.test(String((program?.data as any)?.applicationFeeMinor||''))?BigInt(String((program!.data as any).applicationFeeMinor)):200000n;
      const app=await tx.av8Application.create({data:{tenantId:a.tenantId,branchId:lead.branchId,ownerId:lead.ownerId,customerId:lead.customerId,leadId:id,academyId,reference:await this.erp.av8Number(tx,a,lead.branchId,'AV8'),program:lead.program}});
      await tx.av8Charge.create({data:{tenantId:a.tenantId,applicationId:app.id,key:'APPLICATION',label:'Application fee',amountMinor:applicationFeeMinor,milestone:'APPLICATION',predeparture:true,dueDate:new Date(cairoCalendarDate())}});
      const checklist:any=(await this.policy(tx,a,'DOCUMENTS','CHECKLIST'))?.data;
      for(const item of checklist?.requirements||documentChecklist)await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'document',key:item.key,status:'REQUESTED',data:{...item,requestedAt:new Date().toISOString(),policySource:'Client operational checklist'},createdById:a.userId}});
      for(const [kind,status] of [['english','ASSESSMENT_PENDING'],['visa','PREPARING'],['travel','PREPARING']])await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind,key:'main',status,data:{},createdById:a.userId}});
      await tx.av8Lead.update({where:{id},data:{status:'CONVERTED',version:{increment:1}}});
      await audit(tx,a,'CONVERTED','LEAD',id,lead.branchId,{applicationId:String(app.id),reason:text(b.reason||'Proceeding applicant','Reason')});
      await audit(tx,a,'OPENED','APPLICATION',app.id,app.branchId,{leadId:String(id)});return app;
    });
  }
  async applications(a:Actor,q:any={}) {
    return this.read(a,async tx=>{
      const page=Math.max(1,Math.min(100000,Number(q.page)||1)),size=25;
      const where:any={AND:[av8Scope(a),...(q.search?[{OR:[{reference:{contains:String(q.search).slice(0,100),mode:'insensitive'}},{customer:{name:{contains:String(q.search).slice(0,100),mode:'insensitive'}}}]}]:[])]};
      for(const k of ['admissions','visa','travel'])if(q[k])where[k]=String(q[k]);
      const [rows,total]=await Promise.all([tx.av8Application.findMany({where,include:{customer:{select:{name:true,phone:true}},academy:{select:{name:true}}},skip:(page-1)*size,take:size,orderBy:av8DatabaseOrder('applications',q)}),tx.av8Application.count({where})]);
      return {rows:rows.map(r=>({...r,guardian:undefined,medical:permits(av8ActorAtBranch(a,r.branchId),'av8.medical.view')?r.medical:undefined})),total,page,size};
    });
  }
  async financeSummary(tx:Av8Tx,a:Actor,id:bigint) {
    const charges=await tx.av8Charge.findMany({where:{tenantId:a.tenantId,applicationId:id},include:{allocations:{include:{fund:true}}},orderBy:{id:'asc'}});
    const obligations=await tx.av8Obligation.findMany({where:{tenantId:a.tenantId,applicationId:id},include:{allocations:{include:{fund:true}}},orderBy:{id:'asc'}});
    const storedFunds=await tx.av8Fund.findMany({where:{tenantId:a.tenantId,applicationId:id},include:{allocations:true,bankTransaction:{select:{number:true,journalEntryId:true}}},orderBy:{id:'desc'}});
    const financialRecords=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:{in:['cheque','obligation-adjustment','academy-funding-exposure','obligation-funding-restored','refund','bank-fee']}}});
    const refundReserved=(id:bigint)=>storedFunds.filter(f=>f.kind==='REFUND'&&['PENDING','APPROVED','CLEARED'].includes(f.status)).flatMap(f=>(f.metadata as any).originalReceiptAllocations||[]).filter((x:any)=>String(x.fundId)===String(id)&&!x.chargeId).reduce((n:bigint,x:any)=>n+BigInt(x.usdMinor),0n);
    const funds=storedFunds.map(f=>({...f,reservedRefundUsdMinor:f.kind==='RECEIPT'?refundReserved(f.id):0n,...(financialRecords.some(r=>r.kind==='cheque'&&r.status==='RETURNED'&&String((r.data as any).fundId)===String(f.id))?{status:'RETURNED'}:{})}));
    const servicePayments=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'service-payment',status:'RECORDED'}});
    const serviceUsed=(fundId:bigint)=>servicePayments.filter(r=>(r.data as any).collectionParty==='AV8'&&String((r.data as any).fundId)===String(fundId)).reduce((n,r)=>n+BigInt((r.data as any).usdMinor||0),0n);
    const today=cairoCalendarDate(),soon=cairoCalendarDate(new Date(Date.now()+30*86400000));
    const schedule=charges.map(c=>{const paid=c.allocations.filter(x=>x.fund.status==='CLEARED').reduce((s,x)=>s+x.amountMinor,0n);const remaining=c.amountMinor-c.creditMinor-paid;return {...c,allocations:c.allocations.map(x=>({...x,fund:undefined})),paidMinor:paid,remainingMinor:remaining,status:remaining<=0n?'PAID':c.dueDate&&c.dueDate.toISOString().slice(0,10)<today?'OVERDUE':c.dueDate&&c.dueDate.toISOString().slice(0,10)===today?'DUE':paid>0n?'PARTIALLY_PAID':c.dueDate&&c.dueDate.toISOString().slice(0,10)<=soon?'DUE_SOON':'PENDING'};});
    const academy=obligations.map(o=>{const adjustment=financialRecords.filter(r=>r.kind==='obligation-adjustment'&&String((r.data as any).obligationId)===String(o.id)).reduce((n,r)=>n+BigInt((r.data as any).amountMinor),0n);const effectiveAmount=o.amountMinor+adjustment;const paid=o.allocations.filter(x=>x.fund.status==='CLEARED').reduce((s,x)=>s+x.amountMinor,0n);return {...o,originalAmountMinor:o.amountMinor,amountMinor:effectiveAmount,adjustmentMinor:adjustment,allocations:o.allocations.map(x=>({...x,fund:undefined})),paidMinor:paid,remainingMinor:effectiveAmount-paid,status:effectiveAmount<=paid?'PAID':!o.dueDate||o.dueDate.toISOString().slice(0,10)<=today?'DUE':'UPCOMING'};});
    const receipts=funds.filter(f=>f.kind==='RECEIPT'&&f.status==='CLEARED');const refunds=funds.filter(f=>f.kind==='REFUND'&&f.status==='CLEARED').reduce((s,f)=>s+f.usdMinor,0n);
    const bankFees=financialRecords.filter(r=>r.kind==='bank-fee');const feePaid=bankFees.reduce((n,r)=>n+BigInt((r.data as any).usdMinor),0n),feeReimbursed=funds.filter(f=>f.kind==='FEE_REIMBURSEMENT'&&f.status==='CLEARED').reduce((n,f)=>n+f.usdMinor,0n),academyRecovered=funds.filter(f=>f.kind==='ACADEMY_RECOVERY'&&f.status==='CLEARED').reduce((n,f)=>n+f.usdMinor,0n);
    return {schedule,academy,funds:funds.map(f=>({...f,availableUsdMinor:f.kind==='RECEIPT'&&f.status==='CLEARED'?f.usdMinor-f.allocations.reduce((n,x)=>n+x.amountMinor,0n)-serviceUsed(f.id)-f.reservedRefundUsdMinor:0n})),bankFees,bankFeePaidMinor:feePaid,bankFeeReimbursedMinor:feeReimbursed,bankFeeOutstandingMinor:feePaid-feeReimbursed,totalMinor:schedule.reduce((s,c)=>s+c.amountMinor-c.creditMinor,0n),paidMinor:schedule.reduce((s,c)=>s+c.paidMinor,0n),remainingMinor:schedule.reduce((s,c)=>s+c.remainingMinor,0n),overdueMinor:schedule.filter(c=>c.status==='OVERDUE').reduce((s,c)=>s+c.remainingMinor,0n),refundedMinor:refunds,
      unappliedMinor:receipts.reduce((s,f)=>s+f.usdMinor-f.allocations.reduce((n,x)=>n+x.amountMinor,0n)-serviceUsed(f.id)-f.reservedRefundUsdMinor,0n),
      academyFundingExposureMinor:financialRecords.filter(r=>r.kind==='academy-funding-exposure').reduce((n,r)=>n+BigInt((r.data as any).amountMinor),0n)-financialRecords.filter(r=>r.kind==='obligation-funding-restored').reduce((n,r)=>n+BigInt((r.data as any).amountMinor),0n),academyExpectedMinor:academy.reduce((s,o)=>s+o.amountMinor,0n),academyDueMinor:academy.filter(o=>o.status==='DUE').reduce((s,o)=>s+o.remainingMinor,0n),academyFundingAvailableMinor:receipts.reduce((s,f)=>s+f.usdMinor,0n)-refunds-academy.reduce((s,o)=>s+o.paidMinor,0n)-servicePayments.filter(r=>(r.data as any).collectionParty==='AV8').reduce((n,r)=>n+BigInt((r.data as any).usdMinor||0),0n),academyAwaitingMinor:academy.reduce((s,o)=>s+o.remainingMinor,0n),deferredAwaitingMinor:academy.filter(o=>o.key.startsWith('DEFERRED:')).reduce((s,o)=>s+o.remainingMinor,0n),
      netCashRetainedMinor:receipts.reduce((s,f)=>s+f.usdMinor,0n)-refunds-academy.reduce((s,o)=>s+o.paidMinor,0n)+academyRecovered-feePaid+feeReimbursed,profitBasis:'Cash retained is not posted accounting profit'};
  }
  async readiness(tx:Av8Tx,a:Actor,app:any) {
    const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:app.id}});const finance=await this.financeSummary(tx,a,app.id);const issues:string[]=[];
    if(app.medical!=='PASSED')issues.push('Medical pass');
    if(!records.some(r=>r.kind==='admission'&&r.status==='APPROVED'))issues.push('Approved admission');
    const contract=records.find(r=>r.kind==='contract'&&r.status==='SIGNED');if(!contract)issues.push('Signed agreement');
    issues.push(...missingDocuments(records).map(x=>`Document: ${x}`));
    if(app.visa!=='ISSUED')issues.push('Issued visa');
    if(contract&&(contract.data as any).plan.key!=='CASH'&&app.medical==='PASSED'&&!finance.academy.some(o=>o.key==='MEDICAL_PASS'))issues.push('Medical milestone obligation');
    if(contract&&(contract.data as any).plan.key!=='CASH'&&app.visa==='ISSUED'&&!finance.academy.some(o=>o.key==='VISA_ISSUED'))issues.push('Visa milestone obligation');
    for(const c of finance.schedule.filter(c=>c.predeparture&&c.remainingMinor>0n))issues.push(`Student payment: ${c.label} (USD ${decimal(c.remainingMinor)})`);
    for(const o of finance.academy.filter(o=>o.predeparture&&o.remainingMinor>0n))issues.push(`Academy transfer: ${o.key} (USD ${decimal(o.remainingMinor)})`);
    const planning:any=(await this.policy(tx,a,'PLANNING','DEFAULT'))?.data;
    if(planning?.englishRequired&&!records.some(r=>r.kind==='english'&&r.status==='COMPLETED'))issues.push('English completion required by settings');
    return {ready:issues.length===0,issues:permits(a,'av8.finance.view')?issues:issues.map(issue=>issue.replace(/ \(USD [^)]*\)/g,''))};
  }
  async detail(a:Actor,id:bigint) {
    return this.read(a,async tx=>{
      const app=await application(tx,a,id);a=av8ActorAtBranch(a,app.branchId);const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id},orderBy:{id:'asc'}});
      const people=await tx.user.findMany({where:{tenantId:a.tenantId,id:{in:[app.ownerId,...records.flatMap(r=>['reviewerId','ownerId'].flatMap(key=>/^\d+$/.test(String((r.data as any)?.[key]||''))?[BigInt((r.data as any)[key])]:[]))]}},select:{id:true,name:true}});
      const person=(id:unknown)=>people.find(p=>String(p.id)===String(id))?.name||null;
      const lead=await tx.av8Lead.findFirst({where:{tenantId:a.tenantId,id:app.leadId},select:{nextFollowUp:true}});
      const visible=records.filter(r=>this.recordVisible(a,r)).map(r=>({...r,reviewerName:person((r.data as any)?.reviewerId),ownerName:person((r.data as any)?.ownerId),allowedStatuses:[r.status,...(transitions[r.kind]?.[r.status]||[])].filter((status,index,all)=>all.indexOf(status)===index&&(status!=='NOT_APPLICABLE'||!(r.data as any)?.mandatory))}));
      const attachments=await tx.av8Attachment.findMany({where:{tenantId:a.tenantId,applicationId:id,recordId:{in:visible.filter(r=>this.attachmentAllowed(a,(r.data as any)?.sensitivity||r.kind,'view')).map(r=>r.id)}},select:{id:true,recordId:true,filename:true,contentType:true,sizeBytes:true,createdAt:true,category:true}});
      const history=await tx.auditEvent.findMany({where:{tenantId:a.tenantId,entityType:'AV8_APPLICATION',entityId:String(id)},include:{user:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100});
      return {...app,ownerName:person(app.ownerId),nextFollowUp:lead?.nextFollowUp,guardian:permits(a,'av8.guardian.view')?app.guardian:undefined,medical:permits(a,'av8.medical.view')?app.medical:undefined,
        records:visible.map(r=>{const data:any=r.data;if(r.kind==='document'&&!this.attachmentAllowed(a,data.sensitivity,'view'))return {...r,data:{label:data.label,arabic:data.arabic,mandatory:data.mandatory,owner:data.owner,sensitivity:data.sensitivity,restricted:true}};if(r.kind==='contract'&&!permits(a,'av8.finance.view'))return {...r,data:{...data,settlement:undefined}};return r;}),attachments,
        timeline:history.filter(h=>!h.action.includes('MEDICAL')||permits(a,'av8.medical.view')).map(h=>{const values:any=h.newValues;const owner=records.find(r=>String(r.id)===values?.recordId);if(owner&&!this.attachmentAllowed(a,(owner.data as any).sensitivity||owner.kind,'view'))return {...h,previousValues:undefined,newValues:{reason:'Restricted record updated'}};return h;}),
        readiness:await this.readiness(tx,a,app),finance:permits(a,'av8.finance.view')?await this.financeSummary(tx,a,id):undefined};
    });
  }
  recordVisible(a:Actor,r:any) {return !(r.kind==='medical'&&!permits(a,'av8.medical.view'))&& !(['opening-source','receipt-signature','remittance-basis','bank-fee','allocation-correction','cheque','cheque-event','obligation-adjustment','academy-funding-exposure','obligation-funding-restored','refund-approval','refund','settlement','adjustment','finance_evidence','expense','service-charge','service-payment'].includes(r.kind)&&!permits(a,'av8.finance.view'))&&!(r.kind==='guardian'&&!permits(a,'av8.guardian.view'))&& !(['financial-hold','progress','report-version','academic-dispatch','training','graduation','eligibility','admission','service'].includes(r.kind)&&!permits(a,'av8.affairs.view')) && !(r.kind==='academic-dispatch'&&!permits(a,'av8.guardian.view'));}
  attachmentAllowed(a:Actor,category:string,action:'view'|'edit') {return permits(a,['medical','passport','bank','criminal'].includes(category)?`av8.${category}.${action}`:['finance','opening-source','receipt-signature','remittance-basis','bank-fee','allocation-correction','cheque','cheque-event','obligation-adjustment','academy-funding-exposure','obligation-funding-restored','refund-approval','refund','settlement','finance_evidence','amendment','expense','service-charge','service-payment'].includes(category)?`av8.finance.${action==='edit'?'create':'view'}`:category==='contract'?`av8.applications.${action}`:`av8.affairs.${action}`);}
  async obligation(tx:Av8Tx,a:Actor,id:bigint,key:string,amount:bigint,predeparture:boolean,evidence:any,dueDate?:string) {
    return tx.av8Obligation.upsert({where:{applicationId_key:{applicationId:id,key}},update:{},create:{tenantId:a.tenantId,applicationId:id,key,amountMinor:amount,predeparture,evidence:serialize(evidence),dueDate:dueDate?new Date(calendarDate(dueDate)):null}});
  }
  async initialAcademyMilestone(tx:Av8Tx,a:Actor,id:bigint,key:string,amount:bigint,date:string) {
    const contract=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,kind:'contract',status:'SIGNED'}});
    if(!contract)return;const terms:any=contract.data;if(terms.plan.data.rulesVersion==='IMPORTED_SIGNED')return;
    if(terms.plan.key==='CASH'&&terms.plan.data.rulesVersion===CONFIRMED_RULES_VERSION)return;
    await this.obligation(tx,a,id,key,amount,true,{date,actorId:String(a.userId),contractId:String(contract.id)},date);
  }
  async contractSettlement(tx:Av8Tx,a:Actor,app:any,terms:any) {
    if(terms.plan.data.rulesVersion==='IMPORTED_SIGNED')return;
    if(terms.plan.data.rulesVersion!==CONFIRMED_RULES_VERSION){if(terms.plan.key==='CASH'&&terms.settlement){const p=terms.settlement.data;await this.obligation(tx,a,app.id,'CASH_BALANCE',BigInt(p.totalAcademyMinor)-600000n,p.additionalMilestone==='BEFORE_DEPARTURE',{policyId:String(terms.settlement.id)});}return;}
    if(terms.plan.key==='CASH'){
      const existing=await tx.av8Obligation.findMany({where:{tenantId:a.tenantId,applicationId:app.id,key:{in:['MEDICAL_PASS','VISA_ISSUED']}}});
      const carried=existing.reduce((n,o)=>n+o.amountMinor,0n);if(carried>5400000n)fail('Existing academy obligations require reconciliation');
      await this.obligation(tx,a,app.id,'CASH_FULL_20261031',5400000n-carried,false,{rulesVersion:CONFIRMED_RULES_VERSION,totalEntitlementMinor:'5400000',carriedObligations:existing.map(o=>String(o.id)),commissionMinor:null,contractSignedDate:terms.signedDate},monthsAfter(terms.signedDate,3));
    }else{
      const medical=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:app.id,kind:'medical',status:'PASSED'},orderBy:{id:'desc'}});
      if(app.medical==='PASSED')await this.obligation(tx,a,app.id,'MEDICAL_PASS',150000n,true,{rulesVersion:CONFIRMED_RULES_VERSION,withinInitialAcademyMinor:'600000'},(medical?.data as any)?.date||terms.signedDate);
      const visa=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:app.id,kind:'visa',status:'ISSUED'}});
      if(app.visa==='ISSUED')await this.obligation(tx,a,app.id,'VISA_ISSUED',450000n,true,{rulesVersion:CONFIRMED_RULES_VERSION,withinInitialAcademyMinor:'600000'},(visa?.data as any)?.decisionDate||terms.signedDate);
    }
  }
  medical(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.medical.edit');return once(this.db,a,`medical.${id}`,key,b,async tx=>{
      const app=await application(tx,a,id,'av8.medical.edit');version(b.version,app.version);
      if(app.medical==='FAILED'||app.medical==='PASSED')fail('Final medical outcomes require an authorized exception to correct');
      const finance=await this.financeSummary(tx,a,id);const fee=finance.schedule.find(c=>c.key==='APPLICATION');
      if(!fee||fee.paidMinor<fee.amountMinor-fee.creditMinor)fail('Record the cleared application-fee receipt before the standard medical workflow');
      if(!['PENDING','INCONCLUSIVE','PASSED','FAILED'].includes(b.outcome))fail('Invalid medical outcome');
      const date=calendarDate(b.date);if(date>cairoCalendarDate())fail('Medical result cannot be future dated');const reason=text(b.reason,'Medical result notes');
      const data={date,outcome:b.outcome,provider:text(b.provider,'Provider',false,160),reviewer:a.name,reason,sensitivity:'medical'};
      await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'medical',key:randomUUID(),status:b.outcome==='INCONCLUSIVE'?'PENDING':b.outcome,data,createdById:a.userId}});
      const outcome=b.outcome==='INCONCLUSIVE'?'PENDING':b.outcome;
      await tx.av8Application.update({where:{id},data:{medical:outcome,admissions:outcome==='PASSED'?'CONTRACT_PENDING':outcome==='FAILED'?'MEDICAL_FAILED':'MEDICAL_PENDING',version:{increment:1}}});
      if(outcome==='PASSED')await this.initialAcademyMilestone(tx,a,id,'MEDICAL_PASS',150000n,date);
      if(outcome==='FAILED')await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'refund',key:'MEDICAL_FAILURE',status:'REQUESTED',data:{reason:'Medical failure',requestedMinor:String(fee.paidMinor<fee.amountMinor?fee.paidMinor:fee.amountMinor),currency:'USD',requestedBy:String(a.userId)},createdById:a.userId}});
      await audit(tx,a,'MEDICAL_RESULT','APPLICATION',id,app.branchId,data);return {ok:true};
    });
  }
  contract(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.applications.edit');return once(this.db,a,`contract.${id}`,key,b,async tx=>{
      const app=await application(tx,a,id,'av8.applications.edit');if(app.medical!=='PASSED')fail('A medical pass is required for contracting');
      const old=await tx.av8Record.findFirst({where:{applicationId:id,tenantId:a.tenantId,kind:'contract',key:'main'}});
      if(b.action==='sign') {
        if(!old||old.status!=='DRAFT')fail('Prepare an agreement draft first');
        const signedDate=calendarDate(b.signedDate);if(signedDate>cairoCalendarDate())fail('Actual contract signature cannot be future dated');
        const attachment=await tx.av8Attachment.findFirst({where:{tenantId:a.tenantId,applicationId:id,recordId:old.id}});if(!attachment)fail('Upload the signed agreement before recording signature');
        const terms:any=old.data;const preview=planPreview(terms.plan.key,terms.plan.data,terms.plan.data.rulesVersion===CONFIRMED_RULES_VERSION||terms.plan.data.anchor==='CONTRACT'?signedDate:undefined,true);
        const originalApplicationCharge=await tx.av8Charge.findFirstOrThrow({where:{tenantId:a.tenantId,applicationId:id,key:'APPLICATION'}});preview.items[0].dueDate=originalApplicationCharge.dueDate?.toISOString().slice(0,10)||null;
        for(const item of preview.items.filter(x=>x.key!=='APPLICATION'))await tx.av8Charge.create({data:{tenantId:a.tenantId,applicationId:id,key:item.key,label:item.label,amountMinor:BigInt(item.amountMinor),milestone:item.milestone,predeparture:item.predeparture,deferred:item.deferred,dueDate:item.dueDate?new Date(item.dueDate):item.milestone==='CONTRACT'?new Date(signedDate):null,contractId:old.id}});
        await tx.av8Record.update({where:{id:old.id},data:{status:'SIGNED',data:{...terms,signedDate,signedAttachmentId:attachment.id,signedBy:String(a.userId),schedule:preview}}});
        await this.contractSettlement(tx,a,app,{...terms,signedDate});
        await tx.av8Application.update({where:{id},data:{admissions:'CONTRACT_SIGNED',version:{increment:1}}});
        await audit(tx,a,'CONTRACT_SIGNED','APPLICATION',id,app.branchId,{number:terms.number,signedDate,totalMinor:preview.totalMinor});return {ok:true};
      }
      if(old)fail('An agreement already exists; use an approved amendment instead of regenerating its schedule');
      const sourcePlan=await tx.av8Policy.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.planId),kind:'PLAN'}});if(!sourcePlan||sourcePlan.status!=='APPROVED'||(sourcePlan.data as any)?.rulesVersion!==CONFIRMED_RULES_VERSION)fail('Select an explicitly approved current payment plan; legacy signed terms remain unchanged');
      const applicationCharge=await tx.av8Charge.findFirstOrThrow({where:{tenantId:a.tenantId,applicationId:id,key:'APPLICATION'}});const program=await this.policy(tx,a,'PROGRAM','DEFAULT');
      const plan={...sourcePlan,data:{...(sourcePlan.data as any),applicationFeeMinor:String(applicationCharge.amountMinor),...(sourcePlan.key==='CASH'&&/^\d+$/.test(String((program?.data as any)?.cashStudentTotalMinor||''))?{cashStudentTotalMinor:String((program!.data as any).cashStudentTotalMinor)}:{})}};
      const preview=planPreview(plan.key,plan.data,undefined,true);
      const settlementCandidate=await this.policy(tx,a,'SETTLEMENT',plan.key==='CASH'?'CASH':'INSTALLMENT');let settlement:any=null;try{if(settlementCandidate){this.validatePolicy(settlementCandidate.kind,settlementCandidate.key,settlementCandidate.data);settlement=settlementCandidate;}}catch{/* Incomplete academy terms do not block the student contract. */}
      const record=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'contract',key:'main',status:'DRAFT',data:serialize({number:await this.erp.av8Number(tx,a,app.branchId,'CONTRACT'),version:1,plan,settlement,schedule:preview,wording:text(b.wording||'Operational agreement draft. Review the legal wording before signature.','Draft wording',true,20000),disclaimer:'Editable operational draft; no electronic-signature service'}) as any,createdById:a.userId}});
      await audit(tx,a,'CONTRACT_DRAFTED','APPLICATION',id,app.branchId,{recordId:String(record.id)});return record;
    });
  }
  record(a:Actor,id:bigint,b:any,key:string) {
    const kind=String(b.kind);const permission=['assignment','contact'].includes(kind)?'av8.applications.edit':kind==='finance_evidence'?'av8.finance.create':kind==='guardian'?'av8.guardian.edit':kind==='settlement'?'av8.finance.create':kind==='exception'&&b.status&&b.status!=='DECISION_REQUIRED'?'av8.exceptions.approve':'av8.affairs.edit';
    requireAv8(a,permission);return once(this.db,a,`record.${id}`,key,b,async tx=>{
      const app=await application(tx,a,id,permission);a=av8ActorAtBranch(a,app.branchId);version(b.version,app.version);const reason=text(b.reason,'Reason');
      const recordKey=String(b.key||'main');
      let old=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,kind,key:recordKey}});
      let data:any={...(old?.data as any||{}),reason};let status=String(b.status||old?.status||(kind==='exception'?'DECISION_REQUIRED':'OPEN'));
      if(kind==='contact'){
        const value=leadInput({...b,source:'Contact correction'});
        const duplicate=await tx.customer.findFirst({where:{tenantId:a.tenantId,companyId:app.customer.companyId,id:{not:app.customerId},OR:contactMatches(value)},select:{id:true}});
        if(duplicate&&b.duplicateReviewed!==true)fail('Potential duplicate name, phone or email: review before correcting student details; shared family contacts may remain separate');
        data={reason,before:{name:app.customer.name,phone:app.customer.phone,email:app.customer.email},after:{name:value.name,phone:value.phone,email:value.email}};
        await tx.customer.update({where:{id:app.customerId},data:{name:value.name,phone:value.phone,email:value.email||null}});status='RECORDED';
      } else if(kind==='assignment'){const ownerId=positiveId(b.ownerId);await assignedUser(tx,a,ownerId,app.branchId);await tx.av8Application.update({where:{id},data:{ownerId}});data={reason,oldOwnerId:String(app.ownerId),ownerId:String(ownerId)};status='RECORDED';
      } else if(kind==='finance_evidence') { data={title:text(b.title||'Financial evidence','Title'),reason,sensitivity:'finance'};status='RECORDED';
      } else if(kind==='document') {
        if(!old)fail('Checklist item not found');
        if(!this.attachmentAllowed(a,data.sensitivity,'edit'))throw new ForbiddenException('This document needs its own sensitive-document permission');
        if(old!.status!==status)transition('document',old!.status,status);
        if(status==='NOT_APPLICABLE'&&data.mandatory)fail('A mandatory requirement cannot be marked inapplicable');
        if(['RECEIVED','UNDER_REVIEW','ACCEPTED'].includes(status)&&!await tx.av8Attachment.count({where:{tenantId:a.tenantId,recordId:old!.id}}))fail('Upload document evidence before review');
        for(const field of ['issueDate','expiry','requestedDate','receivedDate'])if(b[field])data[field]=calendarDate(b[field]);
        if(b.required!==undefined){if(typeof b.required!=='boolean')fail('Required status must be explicit');if(data.mandatory&&b.required===false)fail('Mandatory checklist requirements require an approved policy change');data.required=b.required;data.requirementReason=reason;}
        if(status==='RECEIVED')data.receivedAt=new Date().toISOString();
        if(['ACCEPTED','REJECTED','NOT_APPLICABLE'].includes(status)){data.reviewedAt=new Date().toISOString();data.reviewerId=String(a.userId);}
        if(status==='ACCEPTED') {const files=await tx.av8Attachment.findMany({where:{tenantId:a.tenantId,recordId:old!.id},orderBy:{createdAt:'desc'},take:1});data.verifiedEvidenceIds=files.map(file=>file.id);if(data.expiry&&data.expiry<cairoCalendarDate())fail('An expired document cannot be verified as current');}
        data.history=[...((old?.data as any)?.history||[]),{status:old!.status,data:{...(old!.data as any),history:undefined},changedAt:new Date().toISOString(),changedById:String(a.userId),reason}];
        if(recordKey==='bank'&&status!=='NOT_APPLICABLE'){data.statementOwner=text(b.statementOwner||data.statementOwner,'Bank statement owner');data.relationship=text(b.relationship||data.relationship,'Owner relationship');}
      } else if(kind==='english') {
        if(!old)fail('English track not found');if(old!.status!==status)transition('english',old!.status,status);
        for(const f of ['level','result','provider','course'])if(b[f]!==undefined)data[f]=text(b[f],f,false,200);
        for(const f of ['assessmentDate','startDate','completionDate'])if(b[f])data[f]=calendarDate(b[f]);
        if(status==='ASSESSMENT_COMPLETED'&&(!data.assessmentDate||!data.result))fail('Record the assessment date and result');
        if(data.completionDate&&data.startDate&&data.completionDate<data.startDate)fail('Course completion must be on or after its start date');
        if(data.assessmentDate&&data.assessmentDate>cairoCalendarDate())fail('An actual English assessment cannot be future dated');
      } else if(kind==='visa') {
        if(status!==app.visa)transition('visa',app.visa,status);
        if(app.visa==='ISSUED'&&b.decisionDate&&b.decisionDate!==data.decisionDate)fail('An issued visa decision date requires an authorized correction');
        for(const f of ['reference','additionalDocuments','owner','notes'])if(b[f]!==undefined)data[f]=text(b[f],f,false);
        for(const f of ['submissionDate','followUpDate','issueDate','expiryDate','decisionDate'])if(b[f])data[f]=calendarDate(b[f]);
        if(b.appointmentAt)data.appointmentAt=instant(b.appointmentAt).toISOString();
        if(['READY','SUBMITTED'].includes(status)) {
          const documents=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'document'}});
          const missing=missingDocuments(documents);if(missing.length)fail(`Required documents: ${missing.join(', ')}`);
        }
        if(status==='SUBMITTED') {
          if(!data.submissionDate)fail('Record the actual visa submission date');
          if(!data.followUpDate){const p:any=(await this.policy(tx,a,'PLANNING','DEFAULT'))?.data||{};data.followUpDate=new Date(Date.parse(data.submissionDate)+(p.visaFollowupDays||60)*86400000).toISOString().slice(0,10);}
        }
        if(status==='ISSUED') {
          if(!data.decisionDate)fail('Record the actual visa decision date');
          await this.initialAcademyMilestone(tx,a,id,'VISA_ISSUED',450000n,data.decisionDate);
          await tx.av8Charge.updateMany({where:{tenantId:a.tenantId,applicationId:id,milestone:'VISA',dueDate:null},data:{dueDate:new Date(data.decisionDate)}});
        }
        if(status!==app.visa&&['REFUSED','WITHDRAWN'].includes(status))await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'exception',key:randomUUID(),status:'DECISION_REQUIRED',data:{reason:`Visa ${status}: ${reason}`,financialPolicy:'No automatic refund or cancellation'},createdById:a.userId}});
        await tx.av8Application.update({where:{id},data:{visa:status}});
      } else if(kind==='travel') {
        if(status!==app.travel)transition('travel',app.travel,status);
        if(app.departedAt&&b.actualDeparture&&instant(b.actualDeparture).valueOf()!==app.departedAt.valueOf())fail('Actual departure is already recorded; request an authorized correction');
        for(const f of ['destination','flight','contacts','trainingLocation'])if(b[f]!==undefined)data[f]=text(b[f],f,false);
        if(b.plannedDeparture)data.plannedDeparture=instant(b.plannedDeparture).toISOString();
        for(const f of ['accommodation','transport'])if(b[f]) {
          const cost=b[f];if(cost.amount&&!/^\d+(\.\d{1,2})?$/.test(String(cost.amount)))fail('Separate cost must be an exact decimal');
          data[f]={amount:String(cost.amount||''),currency:text(cost.currency||'USD','Currency',true,3),frequency:text(cost.frequency,'Frequency',false,100),provider:text(cost.provider,'Provider',false,160),notes:text(cost.notes,'Notes',false),paidBy:'STUDENT_SEPARATELY'};
        }
        if(['READY','BOOKED','DEPARTED'].includes(status)) {
          const ready=await this.readiness(tx,a,app);
          if(!ready.ready) {
            if(status!=='DEPARTED'||!b.exception)fail(`Readiness incomplete: ${ready.issues.join('; ')}`);
            atBranch(a,'av8.exceptions.approve',app.branchId);
            await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'exception',key:randomUUID(),status:'APPROVED',data:{reason,actualDeparture:true,outstanding:ready.issues,approvedBy:String(a.userId),approvedAt:new Date().toISOString()},createdById:a.userId}});
            for(const issue of ready.issues)await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'task',key:randomUUID(),status:'OPEN',data:{title:issue,reason:'Outstanding at actual departure',ownerId:String(app.ownerId)},createdById:a.userId}});
          }
        }
        if(status==='DEPARTED') {
          const actual=instant(b.actualDeparture);if(actual>new Date())fail('Actual departure cannot be in the future');data.actualDeparture=actual.toISOString();
          await tx.av8Application.update({where:{id},data:{departedAt:actual}});
          await this.anchor(tx,a,id,'DEPARTURE',cairoCalendarDate(actual));
          await this.progressPeriods(tx,a,id,cairoCalendarDate(actual));
        }
        if(status==='ARRIVAL_CONFIRMED')data.arrivalAt=instant(b.arrivalAt).toISOString();
        await tx.av8Application.update({where:{id},data:{travel:status}});
      } else if(kind==='progress') {
        if(!old)fail('Expected report period not found');
        const protectedFields=['source','examResults','trainingProgress','trainingPercent','issues','flightHours','studyHours','examRows','qualifications','evidenceIds'];
        if(b.correction===true){if(!['REVIEWED','FOLLOWUP_PENDING','FOLLOWUP_COMPLETED'].includes(old!.status))fail('Only a reviewed report requires a corrected version');status='RECEIVED';data.revision=Number(data.revision||1)+1;data.evidenceIds=[];data.correctionReason=reason;}
        else {if(['REVIEWED','FOLLOWUP_PENDING','FOLLOWUP_COMPLETED'].includes(old!.status)&&protectedFields.some(field=>b[field]!==undefined&&JSON.stringify(b[field])!==JSON.stringify(data[field])))fail('Reviewed academic content requires a new corrected report version');if(status!==old!.status)transition('progress',old!.status,status);}
        for(const f of ['source','examResults','trainingProgress','issues','studentFollowup','guardianFollowup'])if(b[f]!==undefined)data[f]=text(b[f],f,false);
        for(const f of ['flightHours','studyHours'])if(b[f]!==undefined&&b[f]!==''){const hours=Number(b[f]);if(!Number.isFinite(hours)||hours<0||hours>100000)fail('Study and flight hours must be nonnegative supplied values');data[f]=hours;}
        for(const f of ['examRows','qualifications'])if(b[f]!==undefined){if(!Array.isArray(b[f])||b[f].length>100)fail('Provide at most 100 structured academic entries');data[f]=b[f].map((value:any)=>typeof value==='string'?text(value,f,true,500):{name:text(value.name,'Exam or qualification'),result:text(value.result,'Result',false,500),date:value.date?calendarDate(value.date):null});}
        if(b.evidenceIds!==undefined){if(!Array.isArray(b.evidenceIds)||b.evidenceIds.length>10)fail('Select at most ten academic source attachments');data.evidenceIds=b.evidenceIds.map(String);}
        if(b.receivedDate){data.receivedDate=calendarDate(b.receivedDate);if(data.receivedDate>cairoCalendarDate())fail('Report receipt date cannot be future dated');}
        if(b.trainingPercent!==undefined&&b.trainingPercent!==''){const percent=Number(b.trainingPercent);if(!Number.isFinite(percent)||percent<0||percent>100)fail('Training completion must be between 0 and 100 percent');data.trainingPercent=percent;}
        if(b.guardianFollowup&&!(app.guardian as any)?.sharingScope?.includes('PROGRESS'))fail('Guardian progress sharing permission is required');
        if(status==='RECEIVED')data.receivedAt=new Date().toISOString();
        if(status==='REVIEWED'){data.reviewedAt=new Date().toISOString();data.reviewerId=String(a.userId);await this.operations.reviewedReport(tx,a,app,old,data);}
        if(status==='FOLLOWUP_COMPLETED')data.followupAt=new Date().toISOString();
      } else if(kind==='task') {
        if(!['OPEN','COMPLETED'].includes(status))fail('Invalid task state');
        data.title=text(b.title||data.title,'Task');data.ownerId=String(positiveId(b.ownerId||app.ownerId));await assignedUser(tx,a,BigInt(data.ownerId),app.branchId);if(b.dueDate)data.dueDate=calendarDate(b.dueDate);
      } else if(kind==='guardian') {
        const sharingScope=Array.isArray(b.sharingScope)?b.sharingScope:[];if(sharingScope.some((s:string)=>!['PROGRESS','FINANCE','TRAVEL'].includes(s)))fail('Invalid guardian sharing scope');
        data={name:text(b.name,'Guardian name'),relationship:text(b.relationship,'Relationship'),phone:text(b.phone,'Guardian phone'),email:b.email?academicAddress(b.email):null,sharingScope,consentDate:calendarDate(b.consentDate),reason,history:[...((old?.data as any)?.history||[]),...(old?[{...old.data as any,history:undefined,changedAt:new Date().toISOString(),changedById:String(a.userId)}]:[])]};status='RECORDED';
        await tx.av8Application.update({where:{id},data:{guardian:data}});
      } else if(kind==='settlement') {
        if(old)fail('Settlement snapshot already attached; use an authorized exception for changes');
        const contract=await tx.av8Record.findFirst({where:{applicationId:id,kind:'contract',status:'SIGNED'}});if(!contract)fail('Sign the student agreement first');
        const terms:any=contract.data;const policy=await tx.av8Policy.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.policyId),kind:'SETTLEMENT',key:terms.plan.key==='CASH'?'CASH':'INSTALLMENT'}});if(!policy)fail('Select the relevant academy terms');this.validatePolicy(policy!.kind,policy!.key,policy!.data);
        data=serialize({policy,recordedBy:String(a.userId),reason});status='RECORDED';
        if(policy.key==='CASH')await this.contractSettlement(tx,a,app,{...terms,settlement:policy});
      } else if(kind==='exception') {
        if(!['DECISION_REQUIRED','APPROVED','REJECTED'].includes(status))fail('Invalid exception decision');
        if(status!=='DECISION_REQUIRED')atBranch(a,'av8.exceptions.approve',app.branchId);
        if(old&&old.status!=='DECISION_REQUIRED'&&old.status!==status)fail('A resolved exception requires a new request to change its decision');
        data={...data,decision:text(b.decision,'Decision',status!=='DECISION_REQUIRED'),requestedBy:data.requestedBy||String(a.userId),approvedBy:status==='DECISION_REQUIRED'?null:String(a.userId),decidedAt:status==='DECISION_REQUIRED'?null:new Date().toISOString(),noAutomaticFinancialPosting:true};
        await approval(tx,a,'EXCEPTION',id,status,reason);
      } else fail('Unknown case record type');
      if(old)await tx.av8Record.update({where:{id:old.id},data:{status,data:serialize(data)}});else old=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind,key:recordKey,status,data:serialize(data),createdById:a.userId}});
      await tx.av8Application.update({where:{id},data:{version:{increment:1}}});
      await audit(tx,a,`${kind.toUpperCase()}_${status}`,'APPLICATION',id,app.branchId,{recordId:String(old!.id),reason,...(kind==='contact'?{after:data.after}:{})},kind==='contact'?data.before:undefined);return {ok:true,recordId:String(old!.id)};
    });
  }
  async anchor(tx:Av8Tx,a:Actor,id:bigint,kind:string,date:string) {
    const contract=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,kind:'contract',status:'SIGNED'}});if(!contract)return;
    const amendments=await tx.av8Record.findMany({where:{applicationId:id,kind:'amendment',status:'APPROVED'},orderBy:{id:'desc'}});
    const latest=amendments.find(r=>(r.data as any)?.plan);
    const p:any=(latest?.data as any)?.plan?latest!.data:contract.data;if([CONFIRMED_RULES_VERSION,'IMPORTED_SIGNED'].includes(p.plan.data.rulesVersion)||p.plan.data.anchor!==kind)return;
    const recorded=await tx.av8Record.findFirst({where:{applicationId:id,kind:'anchor',key:kind}});if(recorded&&(recorded.data as any).date!==date)fail('Anchor already recorded; use an approved schedule amendment');
    const preview=planPreview(p.plan.key,p.plan.data,date,true);
    for(const item of preview.items.filter(x=>x.deferred&&x.dueDate))await tx.av8Charge.updateMany({where:{applicationId:id,key:latest&&(latest.data as any)?.plan?`AMEND_${latest.id}:${item.key}`:item.key,dueDate:null},data:{dueDate:new Date(item.dueDate!)}});
    await tx.av8Record.upsert({where:{applicationId_kind_key:{applicationId:id,kind:'anchor',key:kind}},update:{},create:{tenantId:a.tenantId,applicationId:id,kind:'anchor',key:kind,status:'RECORDED',data:{date,actorId:String(a.userId)},createdById:a.userId}});
  }
  async progressPeriods(tx:Av8Tx,a:Actor,id:bigint,date:string) {
    const now=new Date(),months=Math.max(12,(now.getUTCFullYear()-Number(date.slice(0,4)))*12+now.getUTCMonth()+1-Number(date.slice(5,7))+2);
    for(let i=1;i<=Math.min(months,120);i++) {const due=monthsAfter(date,i),key=due.slice(0,7);await tx.av8Record.upsert({where:{applicationId_kind_key:{applicationId:id,kind:'progress',key}},update:{},create:{tenantId:a.tenantId,applicationId:id,kind:'progress',key,status:'EXPECTED',data:{period:key,dueDate:due,examResults:null,trainingProgress:null},createdById:a.userId}});}
  }
  customAnchor(a:Actor,id:bigint,b:any,key:string) {return once(this.db,a,`anchor.${id}`,key,b,async tx=>{const app=await application(tx,a,id,'av8.applications.edit');await this.anchor(tx,a,id,'CUSTOM',calendarDate(b.date));await audit(tx,a,'ANCHOR_RECORDED','APPLICATION',id,app.branchId,{date:b.date,reason:text(b.reason,'Reason')});return {ok:true};});}
  async policies(a:Actor) {requireAv8(a,'av8.policies.view');return this.read(a,async tx=>{const rows=this.latestPolicies(await tx.av8Policy.findMany({where:{tenantId:a.tenantId},orderBy:[{kind:'asc'},{key:'asc'},{version:'desc'}]}));return rows.filter(p=>p.kind!=='ACCOUNTING'||permits(a,'av8.policies.manage')&&permits(a,'av8.finance.view')).map(p=>({...p,usable:this.policyUsable(p),previews:p.kind==='PLAN'?p.key==='CASH'?[planPreview(p.key,p.data)]:(p.data as any).rulesVersion===CONFIRMED_RULES_VERSION?[planPreview(p.key,p.data)]:['EACH','TOTAL'].map(interpretation=>({interpretation,...planPreview(p.key,{...(p.data as any),interpretation})})):undefined}));});}
  savePolicy(a:Actor,b:any,key:string) {
    requireAv8(a,'av8.policies.manage');return once(this.db,a,'policy.save',key,b,async tx=>{
      const old=await tx.av8Policy.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.id)}});if(!old)fail('Business setting not found');if(old.kind==='ACCOUNTING')requireAv8(a,'av8.policies.approve');const reason=text(b.reason||'Business setting updated','Notes',true);
      if(b.action==='approve') {
        requireAv8(a,'av8.policies.approve');if(old!.status!=='DRAFT')fail('Only drafts may be approved');this.validatePolicy(old!.kind,old!.key,old!.data);
        const result=await tx.av8Policy.update({where:{id:old!.id},data:{status:'APPROVED',approvedById:a.userId,approvedAt:new Date()}});await approval(tx,a,'POLICY',old!.id,'APPROVE',reason);await audit(tx,a,'POLICY_APPROVED','POLICY',old!.id,null,{reason});return result;
      }
      const next=await tx.av8Policy.findFirst({where:{tenantId:a.tenantId,kind:old!.kind,key:old!.key},orderBy:{version:'desc'}});
      if(!b.data||typeof b.data!=='object'||Array.isArray(b.data))fail('Setting values must be complete');this.validatePolicy(old.kind,old.key,b.data);
      const created=await tx.av8Policy.create({data:{tenantId:a.tenantId,kind:old!.kind,key:old!.key,version:next!.version+1,data:b.data,status:['PLAN','REFUND','ACCOUNTING','CHEQUE','BANK_FEE'].includes(old.kind)?'DRAFT':'ACTIVE'}});
      await audit(tx,a,'SETTING_SAVED','POLICY',created.id,null,{reason,previousId:String(old!.id),kind:old.kind,key:old.key});return created;
    });
  }
  validatePolicy(kind:string,key:string,data:any) {
    if(kind==='PROGRAM') {if(!text(data.name,'Program name',true,160)||data.currency!=='USD'||String(data.applicationFeeMinor)!=='200000'||String(data.cashStudentTotalMinor)!=='5400000')fail('Confirmed program prices are USD 2,000 application and USD 54,000 pay-in-full total');}
    else if(kind==='PLAN'){if(data.rulesVersion!==CONFIRMED_RULES_VERSION)fail('New plans must use the confirmed 31 October 2026 rules');planPreview(key,data,undefined,true);}
    else if(kind==='SETTLEMENT') {
      if(key==='CASH') {
        if(data.rulesVersion!==CONFIRMED_RULES_VERSION||String(data.totalAcademyMinor)!=='5400000'||data.commissionMinor!=null||data.dueOffsetMonths!==3||data.anchor!=='CONTRACT')fail('Pay-in-full academy settlement is USD 54,000 at contract +3 calendar months; a separate commission remains unconfigured');
      } else if(String(data.medicalMinor)!=='150000'||String(data.visaMinor)!=='450000'||String(data.commissionMinor)!=='1000000'||data.deferredPassThrough!==true)fail('Confirmed instalment allocations are USD 1,500 + 4,500 academy, USD 10,000 AV8 and full later-payment pass-through');
    } else if(kind==='BANK_FEE'){if(data.rulesVersion!==CONFIRMED_RULES_VERSION||data.treatment!=='EXPENSE_AND_RECEIVABLE'||!data.expenseAccountCode||!data.receivableAccountCode||!data.reimbursementOffsetAccountCode)fail('Explicitly approve the reimbursable fee accounting treatment and expense, receivable and reimbursement-offset accounts');
    } else if(kind==='CHEQUE'){if(data.rulesVersion!==CONFIRMED_RULES_VERSION||data.creditEvent!=='CLEARANCE'||!['RECEIPT','CLEARANCE'].includes(data.fxEvent)||data.travelGate!=='CLEARED')fail('Explicitly approve clearance-based student credit, the receipt/clearance FX event and cleared-funds travel gate (D04)');
    } else if(kind==='REFUND'){if(data.rulesVersion!==CONFIRMED_RULES_VERSION||data.formula!=='CONFIRMED_PAID_MINUS_ELIGIBLE_ACTUAL_EXPENSES'||data.deadlineDays!==45||!['ORIGINAL_RECEIPT_RATE','APPROVED_PAYOUT_RATE'].includes(data.refundConversion)||!['CANCEL_REMAINING','RETAIN_REMAINING','EXPLICIT_PER_CHARGE'].includes(data.unpaidObligations)||!['REQUIRE_CASE_REVIEW'].includes(data.legacyConflictTreatment))fail('Select refund conversion, termination balance treatment and legacy-contract case review (D05/D06)');if(data.refundConversion==='APPROVED_PAYOUT_RATE'&&!text(data.fxDifferenceAccountCode,'Approved FX difference account',false,40))fail('Select the approved FX difference account for payout-rate conversion');
    } else if(kind==='ACCOUNTING') {if(!data.agencyAccountCode)fail('Choose a valid student-collections liability account');if(data.walletStudentCollection!==undefined&&typeof data.walletStudentCollection!=='boolean')fail('Wallet student collection must be explicitly enabled or disabled');}
    else if(kind==='PLANNING') {for(const f of ['responseMinutes','visaFollowupDays','departureEstimateDays','reviewDays'])if(!Number.isInteger(data[f])||data[f]<1||data[f]>10000)fail('Planning estimates must be positive integers');if(typeof data.englishRequired!=='boolean')fail('English prerequisite must be explicit');}
    else if(kind==='DOCUMENTS') {if(!Array.isArray(data.requirements)||!data.requirements.length||data.requirements.length>50)fail('Supply 1–50 document requirements');const keys=new Set();for(const d of data.requirements){if(!/^[a-z0-9_]+$/.test(d.key)||keys.has(d.key)||!d.label||typeof d.mandatory!=='boolean'||!['AV8','STUDENT'].includes(d.owner)||!['ordinary','passport','bank','criminal','medical'].includes(d.sensitivity))fail('Invalid checklist configuration');keys.add(d.key);}}
    else fail('Unknown policy kind');
  }
  async upload(a:Actor,id:bigint,recordId:bigint,file:{buffer:Buffer;originalname:string;mimetype:string}) {
    if(!file?.buffer?.length||file.buffer.length>Math.min(4*1024*1024,attachmentMaximumBytes()))fail('Choose a file within the 4 MB attachment limit');
    const contentType=normalizeContentType(file.mimetype);assertMagicBytes(contentType,file.buffer);
    // PDFs with executable actions are not accepted. No malware scanner is configured.
    if(contentType==='application/pdf'&&/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/i.test(file.buffer.toString('latin1')))fail('Active PDF content is not allowed');
    return this.read(a,async tx=>{
      const app=await application(tx,a,id);a=av8ActorAtBranch(a,app.branchId);const r=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,id:recordId,applicationId:id}});if(!r)throw new NotFoundException('Record not found');
      const category=(r.data as any)?.sensitivity||r.kind;if(!this.attachmentAllowed(a,category,'edit'))throw new ForbiddenException('Sensitive attachment permission required');
      const attachment=await tx.av8Attachment.create({data:{tenantId:a.tenantId,applicationId:id,recordId,category,filename:filenameForContentType(file.originalname,contentType),contentType,sizeBytes:file.buffer.length,sha256:createHash('sha256').update(file.buffer).digest('hex'),content:new Uint8Array(file.buffer),uploadedById:a.userId},select:{id:true,filename:true,sizeBytes:true,createdAt:true}});
      await audit(tx,a,'ATTACHMENT_UPLOADED','APPLICATION',id,app.branchId,{attachmentId:attachment.id,recordId:String(recordId),category});return attachment;
    });
  }
  async download(a:Actor,id:string) {
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))fail('Invalid attachment identifier');
    return this.db.tenant(a.tenantId,async tx=>{const file=await tx.av8Attachment.findFirst({where:{id,tenantId:a.tenantId}});if(!file)throw new NotFoundException('Attachment not found');
      const app=await application(tx,a,file.applicationId);a=av8ActorAtBranch(a,app.branchId);if(!this.attachmentAllowed(a,file.category,'view'))throw new ForbiddenException('Sensitive attachment permission required');
      const content=Buffer.from(file.content);if(createHash('sha256').update(content).digest('hex')!==file.sha256)fail('Attachment integrity failed');assertMagicBytes(file.contentType,content);
      await audit(tx,a,'ATTACHMENT_DOWNLOADED','APPLICATION',app.id,app.branchId,{attachmentId:id,category:file.category});return {...file,content};});
  }
  async appointments(a:Actor,q:any={}) {
    const page=Math.max(1,Number(q.page)||1),size=25;
    return this.read(a,async tx=>{const leads=await tx.av8Lead.findMany({where:av8Scope(a,'lead','av8.leads.view'),select:{id:true,customer:{select:{name:true}}}});const map=new Map(leads.map(l=>[String(l.id),l.customer.name]));
      const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,kind:'appointment',leadId:{in:leads.map(l=>l.id)}}});
      const rows=records.map(r=>({...r,name:map.get(String(r.leadId)),plannedAt:(r.data as any).plannedAt,location:(r.data as any).location})).filter(r=>(!q.date||cairoCalendarDate(new Date(r.plannedAt))===q.date)&&(!q.search||[r.name,r.location].join(' ').toLowerCase().includes(String(q.search).toLowerCase()))).sort((a,b)=>String(a.plannedAt).localeCompare(String(b.plannedAt)));
      return {rows:orderAv8Rows(rows,q).slice((page-1)*size,page*size),total:rows.length,page,size};});
  }
  planReports(a:Actor,id:bigint,b:any,key:string) {return once(this.db,a,`progress.plan.${id}`,key,b,async tx=>{const app=await application(tx,a,id,'av8.affairs.edit');if(!app.departedAt)fail('Actual departure is required');await this.progressPeriods(tx,a,id,cairoCalendarDate(app.departedAt));return {ok:true};});}
  async queues(a:Actor,q:any={}) {
    requireAv8(a,'av8.workspace.view');
    return this.read(a,async tx=>{
      const today=cairoCalendarDate();const page=Math.max(1,Number(q.page)||1),size=25;
      const permittedApps=permits(a,'av8.applications.view');const rows=permittedApps?await tx.av8Application.findMany({where:av8Scope(a),include:{customer:{select:{name:true}},records:true},orderBy:{id:'desc'}}):[];
      const results:any[]=[];
      for(const app of rows){
        const scoped=av8ActorAtBranch(a,app.branchId);
        const visa=app.records.find(r=>r.kind==='visa');const v:any=visa?.data||{};
        if(['SUBMITTED','ADDITIONAL_INFORMATION'].includes(app.visa)&&v.followUpDate&&v.followUpDate<today)results.push({kind:'visa',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:'Visa follow-up due; decision remains pending',date:v.followUpDate,ageDays:Math.floor((Date.now()-Date.parse(v.submissionDate))/86400000)});
        if(permits(scoped,'av8.affairs.view')) {
          for(const r of app.records.filter(r=>r.kind==='document')){const d:any=r.data;const expired=d.expiry&&d.expiry<today;if((r.status!=='ACCEPTED'&&r.status!=='NOT_APPLICABLE')||expired)results.push({kind:'documents',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:d.label,status:expired?'EXPIRED':r.status,date:this.attachmentAllowed(scoped,d.sensitivity,'view')?d.expiry||'':''});}
          for(const r of app.records.filter(r=>r.kind==='progress')){const d:any=r.data;if((r.status==='EXPECTED'&&d.dueDate<today)||r.status==='RECEIVED'||r.status==='FOLLOWUP_PENDING')results.push({kind:'progress',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:`${r.key}: ${r.status}`,date:d.dueDate});}
          const travel:any=app.records.find(r=>r.kind==='travel')?.data||{};if(!app.departedAt&&travel.plannedDeparture)results.push({kind:'departures',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:app.travel,date:travel.plannedDeparture});
        }
        if(permits(scoped,'av8.finance.view')){const finance=await this.financeSummary(tx,a,app.id);if(finance.overdueMinor>0n)results.push({kind:'arrears',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:'Overdue student balance',amountMinor:finance.overdueMinor});if(finance.academyAwaitingMinor>0n)results.push({kind:'academy',applicationId:app.id,reference:app.reference,name:app.customer.name,issue:'Academy obligations outstanding',amountMinor:finance.academyAwaitingMinor});}
      }
      const filtered=results.filter(r=>(!q.kind||r.kind===q.kind)&&(!q.search||[r.name,r.reference,r.issue].join(' ').toLowerCase().includes(String(q.search).toLowerCase())));const counts=Object.fromEntries(['visa','documents','progress','departures','arrears','academy'].map(k=>[k,results.filter(r=>r.kind===k).length]));
      const leads=permits(a,'av8.leads.view')?await tx.av8Lead.count({where:{...av8Scope(a,'lead','av8.leads.view'),firstContactAt:null}}):null;
      return {rows:orderAv8Rows(filtered,q).slice((page-1)*size,page*size),total:filtered.length,page,size,counts:{...counts,uncontacted:leads,applications:rows.length},outbound:'disabled'};
    });
  }
  async report(a:Actor,kind:string,q:any={}) {
    if(['services','insurance','academic-delivery','training','graduation'].includes(kind))return this.operations.report(a,kind,q);
    requireAv8(a,'av8.reports.view');
    if(['student-balances','collections','academy','commission','refunds','cheques','bank-fees'].includes(kind))requireAv8(a,'av8.finance.view');
    if(kind==='medical')requireAv8(a,'av8.medical.view');
    if(['documents','visa','departures','progress','arrears'].includes(kind)){requireAv8(a,kind==='arrears'?'av8.finance.view':'av8.affairs.view');return this.queues(a,{...q,kind});}
    if(!['leads','response','source-performance','owner-performance','applications','medical','student-balances','collections','academy','commission','refunds','cheques','bank-fees'].includes(kind))fail('Unknown report');
    return this.read(a,async tx=>{
      const page=Math.max(1,Number(q.page)||1),size=50;let rows:any[]=[];
      if(['leads','response','source-performance','owner-performance'].includes(kind)){
        const leads=await tx.av8Lead.findMany({where:av8Scope(a,'lead','av8.leads.view'),include:{customer:{select:{name:true}},applications:{select:{id:true}}},orderBy:{id:'desc'}});
        rows=leads.map(l=>({id:String(l.id),name:l.customer.name,source:l.source,owner:String(l.ownerId),status:l.status,inquiryAt:l.inquiryAt,firstContactAt:l.firstContactAt,responseMinutes:l.firstContactAt?Math.round((l.firstContactAt.valueOf()-l.inquiryAt.valueOf())/60000):null,nextFollowUp:l.nextFollowUp,overdue:!!l.nextFollowUp&&l.nextFollowUp<new Date()}));
        if(kind.endsWith('-performance')){
          const users=await tx.user.findMany({where:{tenantId:a.tenantId,id:{in:leads.map(l=>l.ownerId)}},select:{id:true,name:true}});
          const groups=new Map<string,typeof leads>();for(const lead of leads){const group=kind==='source-performance'?lead.source:String(lead.ownerId);groups.set(group,[...(groups.get(group)||[]),lead]);}
          rows=[...groups].map(([group,list])=>{const contacted=list.filter(l=>l.firstContactAt),converted=list.filter(l=>l.applications.length);return {group:kind==='owner-performance'?users.find(u=>String(u.id)===group)?.name||group:group,totalLeads:list.length,converted:converted.length,conversionPercent:(100*converted.length/list.length).toFixed(2),contacted:contacted.length,averageResponseMinutes:contacted.length?Math.round(contacted.reduce((n,l)=>n+(l.firstContactAt!.valueOf()-l.inquiryAt.valueOf())/60000,0)/contacted.length):null,followUpsOverdue:list.filter(l=>l.nextFollowUp&&l.nextFollowUp<new Date()).length};});
        }
      } else {
        const apps=await tx.av8Application.findMany({where:av8Scope(a),include:{customer:{select:{name:true}},academy:{select:{name:true}},records:true},orderBy:{id:'desc'}});
        // A collections report needs recorded funds only; do not recalculate every student's
        // schedule, refund and academy balances for each row of this read-only report.
        const collectionFunds=new Map<string,any[]>();
        if(kind==='collections')for(const fund of await tx.av8Fund.findMany({where:{tenantId:a.tenantId,applicationId:{in:apps.map(app=>app.id)}},orderBy:{id:'desc'}})){
          const key=String(fund.applicationId);const list=collectionFunds.get(key)||[];list.push(fund);collectionFunds.set(key,list);
        }
        for(const app of apps){const scoped=av8ActorAtBranch(a,app.branchId);if(!permits(scoped,'av8.reports.view')||(kind==='medical'&&!permits(scoped,'av8.medical.view'))||(['student-balances','academy','collections','commission','refunds','cheques','bank-fees'].includes(kind)&&!permits(scoped,'av8.finance.view')))continue;const base={applicationId:String(app.id),reference:app.reference,name:app.customer.name,academy:app.academy.name,branchId:String(app.branchId)};
          if(kind==='applications')rows.push({...base,admissions:app.admissions,visa:app.visa,travel:app.travel});
          else if(kind==='medical')rows.push({...base,medical:app.medical,refund:app.records.find(r=>r.kind==='refund')?.status||null});
          else if(['student-balances','academy','collections','commission','refunds','cheques','bank-fees'].includes(kind)){
            const f:any=kind==='collections'?{funds:collectionFunds.get(String(app.id))||[]}:await this.financeSummary(tx,a,app.id);
            if(kind==='student-balances')rows.push({...base,totalMinor:f.totalMinor,paidMinor:f.paidMinor,remainingMinor:f.remainingMinor,overdueMinor:f.overdueMinor,unappliedMinor:f.unappliedMinor,refundedMinor:f.refundedMinor});
            if(kind==='academy')for(const o of f.academy)rows.push({...base,obligationId:String(o.id),key:o.key,obligationMinor:o.amountMinor,remittedMinor:o.paidMinor,remainingMinor:o.remainingMinor,predeparture:o.predeparture,dueDate:o.dueDate?.toISOString().slice(0,10)||null,status:o.status,availableFundingMinor:f.academyFundingAvailableMinor});
            if(kind==='collections')for(const fund of f.funds)rows.push({...base,id:String(fund.id),kind:fund.kind,status:fund.status,amountMinor:fund.amountMinor,currency:fund.currency,usdMinor:fund.usdMinor,postingDate:fund.postingDate,externalReference:fund.reference,method:fund.method,bankAccountId:String(fund.bankAccountId),resourceBranchId:(fund.metadata as any)?.resourceBranchId||null,collectionBranchId:(fund.metadata as any)?.collectionBranchId||null,originalPrecision:(fund.metadata as any)?.originalPrecision??2,feeOriginalMinor:(fund.metadata as any)?.feeOriginalMinor||'0'});
            if(kind==='bank-fees')for(const r of app.records.filter(r=>r.kind==='bank-fee')){const d:any=r.data;rows.push({...base,id:String(r.id),status:r.status,fundId:d.fundId,currency:d.currency,originalPrecision:d.originalPrecision,feeOriginalMinor:d.feeOriginalMinor,usdMinor:d.usdMinor,cashReimbursedUsdMinor:d.cashReimbursedUsdMinor,remainingUsdMinor:d.remainingUsdMinor,receivableBaseMinor:d.receivableBaseMinor,postingDate:d.postingDate,policyId:d.policy.id});}
            if(kind==='cheques')for(const r of app.records.filter(r=>r.kind==='cheque')){const d:any=r.data;rows.push({...base,id:String(r.id),status:r.status,chequeNumber:d.chequeNumber,amountMinor:d.amountMinor,currency:d.currency,originalPrecision:d.originalPrecision,receivedDate:d.receivedDate,dueDate:d.dueDate,clearedDate:d.clearedDate||null,returnedDate:d.returnedDate||null,fundId:d.fundId||null});}
            if(kind==='refunds')for(const r of app.records.filter(r=>r.kind==='refund')){const d:any=r.data;rows.push({...base,id:String(r.id),status:r.status,terminationDate:d.terminationDate||null,deadline:d.deadline||null,deadlineBreached:!!d.deadline&&d.deadline<cairoCalendarDate()&&r.status!=='PAID',requestedMinor:d.requestedMinor,approvedMinor:d.approvedMinor||null,paidMinor:d.paidMinor||'0',remainingMinor:d.remainingMinor||d.approvedMinor||null,recoveryStatus:d.recovery?.status||null,recoveredMinor:d.recovery?.receivedMinor||'0'});}
            if(kind==='commission') {const c:any=app.records.filter(r=>r.kind==='amendment'&&r.status==='APPROVED'&&(r.data as any).plan).sort((a,b)=>Number(b.id-a.id))[0]?.data||app.records.find(r=>r.kind==='contract'&&r.status==='SIGNED')?.data;const settlement:any=c?.settlement||((app.records.find(r=>r.kind==='settlement')?.data as any)?.policy);rows.push({...base,contractualCommissionMinor:settlement?.data?.commissionMinor||null,basis:settlement?`Signed terms snapshot ${settlement.key} v${settlement.version}`:'No academy terms recorded',netCashRetainedMinor:f.netCashRetainedMinor,academyHeldDeferredMinor:f.deferredAwaitingMinor,accountingProfit:'See posted ERP income statement; retained cash is not profit'});}
          }
        }
      }
      if(q.branchId)rows=rows.filter(r=>r.branchId===String(q.branchId));if(q.collectionBranchId)rows=rows.filter(r=>r.collectionBranchId===String(q.collectionBranchId));if(q.resourceBranchId)rows=rows.filter(r=>r.resourceBranchId===String(q.resourceBranchId));if(q.status)rows=rows.filter(r=>r.status===String(q.status));if(q.currency)rows=rows.filter(r=>r.currency===String(q.currency));if(q.method)rows=rows.filter(r=>r.method===String(q.method));if(q.bankAccountId)rows=rows.filter(r=>r.bankAccountId===String(q.bankAccountId));if(q.from)rows=rows.filter(r=>String(r.postingDate instanceof Date?r.postingDate.toISOString():r.postingDate||r.receivedDate||r.terminationDate||r.dueDate||'').slice(0,10)>=calendarDate(q.from));if(q.to)rows=rows.filter(r=>String(r.postingDate instanceof Date?r.postingDate.toISOString():r.postingDate||r.receivedDate||r.terminationDate||r.dueDate||'').slice(0,10)<=calendarDate(q.to));
      if(q.search)rows=rows.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(String(q.search).toLowerCase())));
      return {kind,rows:orderAv8Rows(rows,q).slice((page-1)*size,page*size),total:rows.length,page,size,currency:'USD'};
    });
  }
  async statement(a:Actor,id:bigint,kind:string) {
    requireAv8(a,'av8.reports.print');
    return this.read(a,async tx=>{const app=await application(tx,a,id);atBranch(a,'av8.reports.print',app.branchId);a=av8ActorAtBranch(a,app.branchId);const base={reference:app.reference,name:app.customer.name,program:app.program};
      if(kind==='student'){requireAv8(a,'av8.finance.view');const f=await this.financeSummary(tx,a,id);return {...base,title:'Student statement — USD',rows:f.schedule.map(c=>({label:c.label,dueDate:c.dueDate?.toISOString().slice(0,10)||null,charge:decimal(c.amountMinor-c.creditMinor),paid:decimal(c.paidMinor),remaining:decimal(c.remainingMinor),status:c.status})),unappliedCredit:decimal(f.unappliedMinor),refunded:decimal(f.refundedMinor)};}
      if(kind==='checklist'){requireAv8(a,'av8.affairs.view');const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'document'}});return {...base,title:'Client operational checklist',rows:records.map(r=>({label:(r.data as any).label,status:r.status,owner:(r.data as any).owner,mandatory:(r.data as any).mandatory,expiry:this.attachmentAllowed(a,(r.data as any).sensitivity,'view')?(r.data as any).expiry||null:'Restricted'}))};}
      if(kind==='progress'){requireAv8(a,'av8.affairs.view');const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'progress'}});return {...base,title:'Student progress summary',guardianSharingPermitted:(app.guardian as any)?.sharingScope?.includes('PROGRESS')||false,disclaimer:records.length?undefined:'No study progress reports have been recorded for this student yet.',rows:records.map(r=>({period:r.key,status:r.status,examResults:(r.data as any).examResults??'Unknown',trainingProgress:(r.data as any).trainingProgress??'Unknown',trainingPercent:(r.data as any).trainingPercent??null}))};}
      if(kind==='academy'){requireAv8(a,'av8.finance.view');const f=await this.financeSummary(tx,a,id);return {...base,title:'Academy settlement statement — USD',rows:f.academy.map(o=>({label:o.key,dueDate:o.dueDate?.toISOString().slice(0,10)||null,charge:decimal(o.amountMinor),paid:decimal(o.paidMinor),remaining:decimal(o.remainingMinor),status:o.status}))};}
      if(kind==='refunds'){requireAv8(a,'av8.finance.view');const records=await tx.av8Record.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'refund'}});return {...base,title:'Refund cases — USD',rows:records.map(r=>{const d:any=r.data;return {reference:String(r.id),status:r.status,terminationDate:d.terminationDate||null,deadline:d.deadline||null,approved:decimal(d.approvedMinor||0),paid:decimal(d.paidMinor||0),remaining:decimal(d.remainingMinor||d.approvedMinor||0),recoveryStatus:d.recovery?.status||null};})};}
      if(kind==='contract'){const c=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,kind:'contract'}});if(!c)fail('No contract prepared');const d:any=c!.data;return {...base,title:`Agreement ${d.number} — ${c!.status}`,wording:d.wording,rows:d.schedule.items.map((i:any)=>({label:i.label,amount:decimal(i.amountMinor),currency:'USD',milestone:i.milestone,dueDate:i.dueDate||null})),inclusions:d.plan.data.inclusions,disclaimer:'Operational wording pending AV8 approval; signed evidence stored separately'};}
      fail('Unknown printable statement');
    });
  }
}
