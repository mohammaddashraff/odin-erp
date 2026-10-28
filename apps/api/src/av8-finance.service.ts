import { createHash, randomUUID } from 'node:crypto';
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Actor } from './auth';
import { PrismaService } from './prisma.service';
import { Av8Service } from './av8.service';
import { application, atBranch, audit, approval, once, requireAv8, Av8Tx, av8Scope } from './av8-access';
import { calendarDate, cairoCalendarDate, fail, failField, planPreview, positiveId, positiveMoney, text } from './av8-domain';
import { parseFixed, roundDiv, serialize } from './money';
import { assertMagicBytes, attachmentMaximumBytes, filenameForContentType, normalizeContentType } from './private-attachments.service';

@Injectable()
export class Av8FinanceService {
  constructor(private db:PrismaService, private av8:Av8Service) {}
  async fund(tx:Av8Tx,a:Actor,id:bigint,permission:string) {
    const fund=await tx.av8Fund.findFirst({where:{id,tenantId:a.tenantId}});if(!fund)throw new NotFoundException('Financial record not found');
    atBranch(a,permission,fund.branchId);
    if(fund.applicationId)await application(tx,a,fund.applicationId,permission);
    else {const scope=av8Scope(a,'application',permission);if(scope.id===0n||scope.ownerId)throw new ForbiddenException('Batch finance requires branch scope');}
    return fund;
  }
  private async ensureAgencyAccount(tx:Av8Tx,a:Actor,branchId:bigint) {
    const link=await tx.companyBranch.findFirst({where:{tenantId:a.tenantId,branchId,active:true,company:{active:true}},include:{company:true}});
    if(!link)fail('The selected branch is not linked to an active company');
    const existing=await tx.financialResource.findFirst({where:{tenantId:a.tenantId,companyId:link!.companyId,type:'GL_ACCOUNT',code:'AV8_STUDENT_COLLECTIONS'},include:{linkedAccount:true}});
    if(existing?.active&&existing.linkedAccount?.active&&existing.linkedAccount.postingAllowed&&existing.linkedAccount.type==='LIABILITY')return existing.linkedAccount;

    const legacy=await tx.av8Policy.findMany({where:{tenantId:a.tenantId,kind:'ACCOUNTING',key:'AGENCY'},orderBy:{version:'desc'},select:{data:true}});
    const legacyCodes=legacy.map(row=>String((row.data as any)?.agencyAccountCode||'')).filter(Boolean);
    let account=legacyCodes.length?await tx.account.findFirst({where:{tenantId:a.tenantId,code:{in:legacyCodes},type:'LIABILITY',active:true,postingAllowed:true},orderBy:{id:'asc'}}):null;
    if(!account)account=await tx.account.findFirst({where:{tenantId:a.tenantId,type:'LIABILITY',active:true,postingAllowed:true,controlType:'AV8_STUDENT_COLLECTIONS'}});
    if(!account){
      const companyCode=link!.company.code.toUpperCase().replace(/[^A-Z0-9_-]/g,'_');
      const code=`AV8_${companyCode}_COLL`.slice(0,40);
      account=await tx.account.upsert({
        where:{tenantId_code:{tenantId:a.tenantId,code}},
        update:{},
        create:{tenantId:a.tenantId,code,name:'AV8 student collections',type:'LIABILITY',postingAllowed:true,controlType:'AV8_STUDENT_COLLECTIONS',active:true},
      });
      if(account.type!=='LIABILITY'||!account.active||!account.postingAllowed)fail('The reserved AV8 collections account code is already used by an incompatible account');
    }
    const resource=await tx.financialResource.upsert({
      where:{tenantId_companyId_type_code:{tenantId:a.tenantId,companyId:link!.companyId,type:'GL_ACCOUNT',code:'AV8_STUDENT_COLLECTIONS'}},
      update:{linkedAccountId:account.id,name:'AV8 student collections',active:true,metadata:{purpose:'AV8_STUDENT_COLLECTIONS',managedBy:'AV8'}},
      create:{tenantId:a.tenantId,companyId:link!.companyId,type:'GL_ACCOUNT',code:'AV8_STUDENT_COLLECTIONS',name:'AV8 student collections',linkedAccountId:account.id,metadata:{purpose:'AV8_STUDENT_COLLECTIONS',managedBy:'AV8'}},
    });
    await audit(tx,a,'ACCOUNTING_MAPPING_READY','ACCOUNT',account.id,branchId,{companyId:String(link!.companyId),resourceId:resource.id,accountCode:account.code});
    return account;
  }
  private positiveAmount(value:unknown) {
    try{return positiveMoney(value);}catch(error:any){failField('amount',error?.message||'Enter a valid positive amount','أدخل مبلغاً صحيحاً أكبر من صفر.');}
  }
  private positiveRate(value:unknown) {
    try{const rate=parseFixed(value,6,'USD exchange rate');if(rate<=0n)throw new Error();return rate;}catch{failField('usdToBaseRate','Enter a positive USD exchange rate with at most 6 decimal places','أدخل سعر الدولار رقماً موجباً بحد أقصى 6 أرقام عشرية.');}
  }
  private async receiptRates(tx:Av8Tx,a:Actor,currency:string,paymentDate:string,manualValue:unknown) {
    const tenant=await tx.tenant.findUniqueOrThrow({where:{id:a.tenantId}});const base=tenant.baseCurrency.toUpperCase();
    const date=new Date(paymentDate);const dated=async(target:string)=>tx.currencyRate.findFirst({where:{tenantId:a.tenantId,baseCurrency:base,targetCurrency:target,rateDate:{lte:date},rateMicros:{gt:0}},orderBy:{rateDate:'desc'}});
    if(base==='USD') {
      if(currency==='USD')return {usdRateMicros:1000000n,baseRateMicros:1000000n,source:'BASE_CURRENCY',rateDates:[]};
      const original=await dated(currency);if(!original)failField('bankAccountId',`No ${currency}/USD rate is saved on or before ${paymentDate}`,`لا يوجد سعر صرف محفوظ لعملة ${currency} في تاريخ الدفعة أو قبله.`);
      return {usdRateMicros:original!.rateMicros,baseRateMicros:original!.rateMicros,source:original!.source,rateDates:[original!.rateDate]};
    }
    let usdBase=await dated('USD');
    if(!usdBase&&String(manualValue??'').trim())usdBase={rateMicros:this.positiveRate(manualValue),rateDate:date,source:'TRANSACTION_INPUT'} as any;
    if(!usdBase)failField('usdToBaseRate',`No USD/${base} rate is saved on or before ${paymentDate}; enter this transaction's rate`, `لا يوجد سعر دولار محفوظ في تاريخ الدفعة. أدخل سعر هذه العملية: 1 USD = X ${base}.`);
    if(currency==='USD')return {usdRateMicros:1000000n,baseRateMicros:usdBase!.rateMicros,source:usdBase!.source,rateDates:[usdBase!.rateDate]};
    if(currency===base)return {usdRateMicros:roundDiv(1000000000000n,usdBase!.rateMicros),baseRateMicros:1000000n,source:usdBase!.source,rateDates:[usdBase!.rateDate]};
    const original=await dated(currency);if(!original)failField('bankAccountId',`No ${currency}/${base} rate is saved on or before ${paymentDate}`,`لا يوجد سعر صرف محفوظ لعملة ${currency} في تاريخ الدفعة أو قبله.`);
    return {usdRateMicros:roundDiv(original!.rateMicros*1000000n,usdBase!.rateMicros),baseRateMicros:original!.rateMicros,source:`${original!.source}+${usdBase!.source}`,rateDates:[original!.rateDate,usdBase!.rateDate]};
  }
  receipt(a:Actor,applicationId:bigint,b:any,key:string,file?:{buffer:Buffer;originalname:string;mimetype:string}) {
    requireAv8(a,'av8.finance.create');
    let preparedFile:{buffer:Buffer;filename:string;contentType:string;sha256:string}|undefined;
    if(file?.buffer?.length){
      if(file.buffer.length>Math.min(4*1024*1024,attachmentMaximumBytes()))failField('attachment','Choose a file within the 4 MB attachment limit','اختر ملفاً لا يتجاوز 4 ميجابايت.');
      let contentType:string;try{contentType=normalizeContentType(file.mimetype);assertMagicBytes(contentType,file.buffer);}catch{failField('attachment','Use a valid PDF, PNG, JPEG or WebP file','اختر ملفاً صالحاً بصيغة PDF أو PNG أو JPEG أو WebP.');}
      if(contentType==='application/pdf'&&/(?:\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction))\b/i.test(file.buffer.toString('latin1')))failField('attachment','Active PDF content is not allowed','ملف PDF يحتوي على محتوى تنفيذي غير مسموح.');
      preparedFile={buffer:file.buffer,filename:filenameForContentType(file.originalname,contentType),contentType,sha256:createHash('sha256').update(file.buffer).digest('hex')};
    }
    const requestBody={...b,attachment:preparedFile?{filename:preparedFile.filename,contentType:preparedFile.contentType,sha256:preparedFile.sha256}:null};
    return once(this.db,a,`receipt.${applicationId}`,key,requestBody,async tx=>{
      const app=await application(tx,a,applicationId,'av8.finance.create');atBranch(a,'av8.finance.create',app.branchId);
      let paymentDate:string;try{paymentDate=calendarDate(b.paymentDate||b.postingDate);}catch{failField('paymentDate','Choose a valid payment date','اختر تاريخ دفع صحيحاً.');}
      if(paymentDate>cairoCalendarDate())failField('paymentDate','Payment date cannot be in the future','لا يمكن أن يكون تاريخ الدفع في المستقبل.');
      let bankAccountId:bigint;try{bankAccountId=positiveId(b.bankAccountId);}catch{failField('bankAccountId','Select the receiving bank or cash account','اختر حساب البنك أو الخزينة المستلم.');}
      const bank=await tx.bankAccount.findFirst({where:{tenantId:a.tenantId,id:bankAccountId!,active:true,financialResources:{some:{company:{branchLinks:{some:{branchId:app.branchId,active:true}}},active:true}}}});
      if(!bank)failField('bankAccountId','Select a receiving bank or cash account available to this company','اختر حساب بنك أو خزينة متاحاً لهذه الشركة.');
      const currency=String(b.currency||bank!.currency).toUpperCase();if(currency!==bank!.currency)failField('currency','Payment currency must match the receiving account currency','عملة الدفعة يجب أن تطابق عملة حساب الاستلام.');
      const amountMinor=this.positiveAmount(b.amount);const rates=await this.receiptRates(tx,a,currency,paymentDate,b.usdToBaseRate);
      const usdMinor=roundDiv(amountMinor*rates.usdRateMicros,1000000n);if(usdMinor<=0n)failField('amount','Converted amount rounds to zero','المبلغ بعد التحويل يساوي صفراً؛ راجع المبلغ وسعر الصرف.');
      const schedule=await this.av8.financeSummary(tx,a,app.id);const open=schedule.schedule.filter((row:any)=>BigInt(row.remainingMinor)>0n);
      let chargeId:bigint;try{chargeId=b.chargeId?positiveId(b.chargeId):open.length===1?BigInt(open[0].id):0n;}catch{failField('chargeId','Select the fee or installment being paid','اختر الرسم أو القسط الذي يتم سداده.');}
      if(!chargeId)failField('chargeId','Select the fee or installment being paid','اختر الرسم أو القسط الذي يتم سداده.');
      const charge=open.find((row:any)=>BigInt(row.id)===chargeId);if(!charge)failField('chargeId','The selected fee is not outstanding for this student','البند المختار غير مستحق على هذا الطالب.');
      if(usdMinor>BigInt(charge.remainingMinor))failField('amount','Payment exceeds the selected fee or installment balance','المبلغ أكبر من الرصيد المتبقي للبند المختار.');
      const method=String(b.method||(bank!.type==='CASH'?'CASH':'BANK'));if(!['BANK','CASH','CARD'].includes(method))failField('method','Select a valid payment method','اختر طريقة دفع صحيحة.');
      let reference:string,notes:string,payer:string;try{reference=text(b.reference,'Reference',false,200);}catch{failField('reference','Reference must be at most 200 characters','يجب ألا يزيد مرجع الدفع عن 200 حرف.');}try{notes=text(b.notes,'Notes',false,2000);}catch{failField('notes','Notes must be at most 2,000 characters','يجب ألا تزيد الملاحظات عن 2000 حرف.');}try{payer=text(b.payer||app.customer.name,'Payer',true,200);}catch{failField('payer','Payer name is required and must be at most 200 characters','اسم الدافع مطلوب وبحد أقصى 200 حرف.');}
      let evidenceId:string|null=null;
      if(preparedFile){
        const record=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:app.id,kind:'finance_evidence',key:`receipt-${createHash('sha256').update(key).digest('hex').slice(0,24)}`,status:'RECORDED',data:{title:'Receipt attachment',reason:notes||reference||'Student receipt',sensitivity:'finance',automatic:true},createdById:a.userId}});
        const attachment=await tx.av8Attachment.create({data:{tenantId:a.tenantId,applicationId:app.id,recordId:record.id,category:'finance_evidence',filename:preparedFile.filename,contentType:preparedFile.contentType,sizeBytes:preparedFile.buffer.length,sha256:preparedFile.sha256,content:new Uint8Array(preparedFile.buffer),uploadedById:a.userId},select:{id:true}});evidenceId=attachment.id;
      }
      const agency=await this.ensureAgencyAccount(tx,a,app.branchId);
      const fund=await tx.av8Fund.create({data:{tenantId:a.tenantId,branchId:app.branchId,applicationId:app.id,kind:'RECEIPT',amountMinor,currency,usdMinor,usdRateMicros:rates.usdRateMicros,baseRateMicros:rates.baseRateMicros,rateDate:new Date(paymentDate),postingDate:new Date(paymentDate),bankAccountId:bank!.id,method,reference,payer,notes,evidenceId,createdById:a.userId}});
      const bankTransaction=await this.av8.erp.postAv8Cash(tx,a,fund,agency.id,'av8.finance.create');
      const cleared=await tx.av8Fund.update({where:{id:fund.id},data:{status:'CLEARED',clearedAt:new Date(),bankTransactionId:bankTransaction.id}});
      const allocation=await this.allocateTx(tx,a,cleared,{chargeId,amount:`${usdMinor/100n}.${String(usdMinor%100n).padStart(2,'0')}`},notes||reference||'Student receipt');
      const remaining=BigInt(charge.remainingMinor)-usdMinor;
      await audit(tx,a,'RECEIPT_RECORDED','FUND',fund.id,app.branchId,{applicationId:String(app.id),chargeId:String(chargeId),allocationId:String(allocation.id),amountMinor:String(amountMinor),currency,usdMinor:String(usdMinor),baseRateMicros:String(rates.baseRateMicros),rateSource:rates.source,rateDates:rates.rateDates.map((date:Date)=>date.toISOString().slice(0,10)),bankTransactionId:String(bankTransaction.id),number:bankTransaction.number});
      return {ok:true,fundId:String(fund.id),allocationId:String(allocation.id),number:bankTransaction.number,allocatedUsdMinor:String(usdMinor),remainingUsdMinor:String(remaining),status:'CLEARED'};
    });
  }
  async list(a:Actor,q:any={}) {
    requireAv8(a,'av8.finance.view');return this.av8.read(a,async tx=>{
      const scope=av8Scope(a,'application','av8.finance.view');const apps=await tx.av8Application.findMany({where:scope,select:{id:true,reference:true,branchId:true,academyId:true,customer:{select:{name:true}}}});
      const branchIds=[...new Set(apps.map(x=>String(x.branchId)))].map(BigInt);const page=Math.max(1,Number(q.page)||1),size=25;
      const where:any={tenantId:a.tenantId,OR:[{applicationId:{in:apps.map(x=>x.id)}},...(!scope.ownerId&&scope.id!==0n?[{applicationId:null,branchId:{in:branchIds}}]:[])],...(q.status?{status:q.status}:{})};
      const rows=await tx.av8Fund.findMany({where,include:{bankTransaction:{select:{number:true}},allocations:true},skip:(page-1)*size,take:size,orderBy:{id:'desc'}});
      const obligations=await tx.av8Obligation.findMany({where:{tenantId:a.tenantId,applicationId:{in:apps.map(x=>x.id)}},include:{allocations:{include:{fund:{select:{status:true}}}}},orderBy:{id:'asc'}});
      const evidence=await tx.av8Attachment.findMany({where:{tenantId:a.tenantId,applicationId:{in:apps.map(x=>x.id)},category:{in:['finance','finance_evidence','refund']}},select:{id:true,filename:true,applicationId:true},take:200,orderBy:{createdAt:'desc'}});
      return {rows,total:await tx.av8Fund.count({where}),page,size,applications:apps,evidence,obligations:obligations.map(o=>({...o,allocations:undefined,remainingMinor:o.amountMinor-o.allocations.filter(x=>x.fund.status==='CLEARED').reduce((n,x)=>n+x.amountMinor,0n),reference:apps.find(x=>x.id===o.applicationId)?.reference}))};
    });
  }
  create(a:Actor,b:any,key:string) {
    requireAv8(a,'av8.finance.create');return once(this.db,a,'fund.create',key,b,async tx=>{
      const kind=String(b.kind);if(!['RECEIPT','REMITTANCE','REFUND'].includes(kind))fail('Invalid cash record kind');
      const app=b.applicationId?await application(tx,a,positiveId(b.applicationId),'av8.finance.create'):null;
      if(!app&&kind!=='REMITTANCE')fail('Receipt/refund needs a student application');
      const branchId=app?.branchId||positiveId(b.branchId);atBranch(a,'av8.finance.create',branchId);
      if(!app){const scope=av8Scope(a,'application','av8.finance.create');if(scope.ownerId||scope.id===0n)throw new ForbiddenException('Batch remittance requires branch scope');}
      const bank=await tx.bankAccount.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.bankAccountId),active:true,financialResources:{some:{company:{branchLinks:{some:{branchId,active:true}}},active:true}}}});if(!bank)fail('Bank account is outside this branch/company');
      const currency=String(b.currency||bank!.currency);if(currency!==bank!.currency)fail('Receipt/remittance currency must match bank account currency');
      const amountMinor=positiveMoney(b.amount);const tenant=await tx.tenant.findUniqueOrThrow({where:{id:a.tenantId}});
      const usdRateMicros=currency==='USD'?1000000n:parseFixed(b.usdRate,6,'USD per original currency unit');
      const baseRateMicros=currency===tenant.baseCurrency?1000000n:parseFixed(b.baseRate,6,'Base currency per original currency unit');
      if(usdRateMicros<=0n||baseRateMicros<=0n)fail('Provide positive historical exchange rates');
      const usdMinor=roundDiv(amountMinor*usdRateMicros,1000000n);if(usdMinor<=0n)fail('Converted amount rounds to zero');
      const academyId=kind==='REMITTANCE'?app?.academyId||positiveId(b.academyId):null;
      if(academyId&&!await tx.supplier.findFirst({where:{tenantId:a.tenantId,id:academyId,active:true,company:{branchLinks:{some:{branchId,active:true}}}}}))fail('Academy is outside this company');
      const method=String(b.method||'BANK');if(!['BANK','CASH','CARD'].includes(method))fail('Invalid payment method');
      let refundCaseId:bigint|null=null;
      if(kind==='REFUND') {
        refundCaseId=positiveId(b.refundCaseId);const record=await tx.av8Record.findFirst({where:{id:refundCaseId,tenantId:a.tenantId,applicationId:app!.id,kind:'refund',status:'APPROVED'}});if(!record)fail('An approved unpaid refund case is required');
        const f=await this.av8.financeSummary(tx,a,app!.id);const fee=f.schedule.find(c=>c.key==='APPLICATION')!;const approved=BigInt((record!.data as any).approvedMinor);
        if(usdMinor>approved||usdMinor>fee.paidMinor||usdMinor>200000n)fail('Refund cannot exceed approved, received and unrefunded application fees');
        if(usdMinor!==approved)fail('Record the approved refund amount; revise approval before changing it');
        const sources=await tx.av8Allocation.findMany({where:{tenantId:a.tenantId,chargeId:fee.id,amountMinor:{gt:0},fund:{kind:'RECEIPT',status:'CLEARED'}},include:{fund:true}});
        if(sources.some(s=>s.fund.currency!==currency||s.fund.usdRateMicros!==usdRateMicros||s.fund.baseRateMicros!==baseRateMicros))fail('Refund currency/rate differences require an approved exceptional accounting decision; use the original receipt rates');
      }
      let evidenceId:string|null=null;
      if(b.evidenceId){const evidence=await tx.av8Attachment.findFirst({where:{tenantId:a.tenantId,id:String(b.evidenceId)}});if(!evidence)fail('Evidence not found');await application(tx,a,evidence!.applicationId,'av8.finance.create');evidenceId=evidence!.id;}
      const fund=await tx.av8Fund.create({data:{tenantId:a.tenantId,branchId,applicationId:app?.id,academyId,kind,amountMinor,currency,usdMinor,usdRateMicros,baseRateMicros,rateDate:new Date(calendarDate(b.rateDate)),postingDate:new Date(calendarDate(b.postingDate)),bankAccountId:bank!.id,method,reference:text(b.reference,'Reference'),payer:text(b.payer,'Payer / counterparty'),notes:text(b.notes,'Notes',false),evidenceId,refundCaseId,createdById:a.userId}});
      await audit(tx,a,'CASH_REQUESTED','FUND',fund.id,branchId,{kind,usdMinor:String(usdMinor),applicationId:app?String(app.id):null});
      await approval(tx,a,'FUND',fund.id,'REQUEST',text(b.reason||'Cash entry requested','Reason'));return fund;
    });
  }
  approveRefund(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.finance.approve');return once(this.db,a,`refund.${id}`,key,b,async tx=>{
      const record=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,id,kind:'refund',status:'REQUESTED'}});if(!record?.applicationId)fail('Requested refund not found');
      const app=await application(tx,a,record!.applicationId!,'av8.finance.approve');if(record!.createdById===a.userId)throw new ForbiddenException('Refund requester cannot approve their own case');
      const reason=text(b.reason,'Refund approval reason');const f=await this.av8.financeSummary(tx,a,app.id);const fee=f.schedule.find(c=>c.key==='APPLICATION')!;
      const amount=positiveMoney(b.amount);if(amount>fee.paidMinor||amount>200000n)fail('Refund exceeds cleared application payments not already refunded');
      if(app.medical!=='FAILED')fail('Non-medical refunds require an authorized exceptional policy');
      await tx.av8Record.update({where:{id},data:{status:'APPROVED',data:{...(record!.data as any),approvedMinor:String(amount),approvedBy:String(a.userId),approvedAt:new Date().toISOString(),reason}}});
      await approval(tx,a,'REFUND',id,'APPROVE',reason);await audit(tx,a,'REFUND_APPROVED','APPLICATION',app.id,app.branchId,{recordId:String(id),amountMinor:String(amount),reason});return {ok:true};
    });
  }
  action(a:Actor,id:bigint,b:any,key:string) {
    const permission=b.action==='approve'?'av8.finance.approve':'av8.finance.confirm';requireAv8(a,permission);
    return once(this.db,a,`fund.${id}.${b.action}`,key,b,async tx=>{
      const fund=await this.fund(tx,a,id,permission);const reason=text(b.reason,'Reason');
      if(b.action==='approve') {
        if(fund.status!=='PENDING')fail('Only pending records can be approved');if(fund.createdById===a.userId)throw new ForbiddenException('Maker-checker: use a different authorized approver');
        await tx.av8Fund.update({where:{id},data:{status:'APPROVED',approvedById:a.userId,approvedAt:new Date()}});await approval(tx,a,'FUND',id,'APPROVE',reason);return {ok:true};
      }
      if(b.action!=='confirm')fail('Unknown financial action');
      if(fund.status==='CLEARED')return {ok:true,alreadyCleared:true};
      if(fund.kind==='RECEIPT'&&!['PENDING','APPROVED'].includes(fund.status)||fund.kind!=='RECEIPT'&&fund.status!=='APPROVED')fail('Approve outgoing cash before confirmation');
      if(fund.kind!=='RECEIPT'&&!fund.evidenceId)fail('Outgoing confirmation requires uploaded transfer/refund evidence');
      const agency=await this.ensureAgencyAccount(tx,a,fund.branchId);
      // Validate allocations before any journal creation; all operations share a serializable transaction.
      const splits=Array.isArray(b.allocations)?b.allocations:[];
      if(fund.kind==='REMITTANCE'&&splits.reduce((s:any,x:any)=>s+positiveMoney(x.amount),0n)!==fund.usdMinor)fail('Allocate the full confirmed remittance across its academy obligations');
      const bank=await this.av8.erp.postAv8Cash(tx,a,fund,agency.id);
      await tx.av8Fund.update({where:{id},data:{status:'CLEARED',clearedAt:new Date(),bankTransactionId:bank.id}});
      if(fund.kind==='REFUND') {
        const f=await this.av8.financeSummary(tx,a,fund.applicationId!);const fee=f.schedule.find(c=>c.key==='APPLICATION')!;
        if(fund.usdMinor>fee.paidMinor)fail('Application fee was already refunded or reallocated');
        await tx.av8Allocation.create({data:{tenantId:a.tenantId,fundId:id,chargeId:fee.id,amountMinor:-fund.usdMinor,reason}});
        await tx.av8Charge.update({where:{id:fee.id},data:{creditMinor:{increment:fund.usdMinor}}});
        const record=await tx.av8Record.findUniqueOrThrow({where:{id:fund.refundCaseId!}});
        if(record.status!=='APPROVED')fail('Refund case is not approved and unpaid');
        await audit(tx,a,'REFUND_CREDIT_POSTED','APPLICATION',fund.applicationId!,fund.branchId,{fundId:String(id),creditMinor:String(fund.usdMinor),journalEntryId:String(bank.journalEntryId)});
        await approval(tx,a,'REFUND',record.id,'CREDIT_POSTED',reason);
        await tx.av8Record.update({where:{id:record.id},data:{status:'PAID',data:{...(record.data as any),paidAt:new Date().toISOString(),fundId:String(id),creditMinor:String(fund.usdMinor),journalEntryId:String(bank.journalEntryId)}}});
      } else for(const split of splits)await this.allocateTx(tx,a,{...fund,status:'CLEARED'},split,reason);
      await approval(tx,a,'FUND',id,'CONFIRM',reason);await audit(tx,a,'CASH_CLEARED','FUND',id,fund.branchId,{reason,bankTransactionId:String(bank.id),number:bank.number,applicationId:String(fund.applicationId||'')});return {ok:true,number:bank.number};
    });
  }
  async allocateTx(tx:Av8Tx,a:Actor,fund:any,b:any,reason:string) {
    if(fund.status!=='CLEARED')fail('Only cleared cash can be allocated');
    const amount=positiveMoney(b.amount);const used=(await tx.av8Allocation.aggregate({where:{tenantId:a.tenantId,fundId:fund.id},_sum:{amountMinor:true}}))._sum.amountMinor||0n;
    if(used+amount>fund.usdMinor)fail('Allocation exceeds unapplied cleared cash');
    if(fund.kind==='RECEIPT') {
      const charge=await tx.av8Charge.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.chargeId),applicationId:fund.applicationId}});if(!charge)fail('Charge is not in this student application');
      const paid=(await tx.av8Allocation.aggregate({where:{tenantId:a.tenantId,chargeId:charge!.id,fund:{status:'CLEARED'}},_sum:{amountMinor:true}}))._sum.amountMinor||0n;
      if(paid+amount>charge!.amountMinor-charge!.creditMinor)fail('Allocation exceeds remaining charge');
      const row=await tx.av8Allocation.create({data:{tenantId:a.tenantId,fundId:fund.id,chargeId:charge!.id,amountMinor:amount,reason}});
      if(charge!.deferred)await this.av8.obligation(tx,a,charge!.applicationId,`DEFERRED:${row.id}`,amount,false,{allocationId:String(row.id),chargeId:String(charge!.id),rule:'100% of deferred collection forwarded, including early payments'});
      if(charge!.key==='APPLICATION'&&paid+amount>=charge!.amountMinor-charge!.creditMinor)await tx.av8Application.updateMany({where:{id:charge!.applicationId,admissions:'FEE_PENDING'},data:{admissions:'FEE_RECEIVED',version:{increment:1}}});
      return row;
    }
    if(fund.kind!=='REMITTANCE')fail('Refund allocations are controlled by the refund case');
    const obligation=await tx.av8Obligation.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.obligationId)}});if(!obligation)fail('Obligation not found');
    const app=await application(tx,a,obligation!.applicationId,'av8.finance.create');
    if(app.academyId!==fund.academyId||app.branchId!==fund.branchId||(fund.applicationId&&fund.applicationId!==app.id))fail('Batch allocations must be for the same academy and branch');
    const paid=(await tx.av8Allocation.aggregate({where:{tenantId:a.tenantId,obligationId:obligation!.id,fund:{status:'CLEARED'}},_sum:{amountMinor:true}}))._sum.amountMinor||0n;
    if(paid+amount>obligation!.amountMinor)fail('Remittance exceeds outstanding obligation');
    return tx.av8Allocation.create({data:{tenantId:a.tenantId,fundId:fund.id,obligationId:obligation!.id,amountMinor:amount,reason}});
  }
  allocate(a:Actor,id:bigint,b:any,key:string) {requireAv8(a,'av8.finance.create');return once(this.db,a,`allocate.${id}`,key,b,async tx=>{const fund=await this.fund(tx,a,id,'av8.finance.create');const row=await this.allocateTx(tx,a,fund,b,text(b.reason,'Allocation reason'));await audit(tx,a,'ALLOCATED','FUND',id,fund.branchId,{allocationId:String(row.id)});return row;});}
  correctAllocation(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.finance.adjust');return once(this.db,a,`allocation.correct.${id}`,key,b,async tx=>{
      const row=await tx.av8Allocation.findFirst({where:{tenantId:a.tenantId,id},include:{charge:true,fund:true}});if(!row?.charge||row.amountMinor<=0n||row.fund.kind!=='RECEIPT')fail('Only positive student receipt allocations can be corrected here');
      await this.fund(tx,a,row!.fundId,'av8.finance.adjust');const reason=text(b.reason,'Correction reason');
      if(row!.charge!.key==='APPLICATION'){const app=await application(tx,a,row!.charge!.applicationId,'av8.finance.adjust');if(app.medical!=='PENDING')fail('Application allocation supports a completed medical decision; record an authorized exception before correction');}
      if(row!.charge!.deferred)fail('Deferred allocation corrections need an academy reconciliation exception; its forwarding obligation must remain traceable');
      if(await tx.av8Allocation.findFirst({where:{reversedId:id}}))fail('Allocation already corrected');
      await tx.av8Allocation.create({data:{tenantId:a.tenantId,fundId:row!.fundId,chargeId:row!.chargeId,amountMinor:-row!.amountMinor,reversedId:id,reason}});
      if(b.chargeId)await this.allocateTx(tx,a,row!.fund,{chargeId:b.chargeId,amount:String(row!.amountMinor/100n)+'.'+String(row!.amountMinor%100n).padStart(2,'0')},reason);
      await approval(tx,a,'ALLOCATION',id,'CORRECT',reason);await audit(tx,a,'ALLOCATION_CORRECTED','FUND',row!.fundId,row!.fund.branchId,{allocationId:String(id),reason});return {ok:true};
    });
  }
  amendment(a:Actor,id:bigint,b:any,key:string) {
    requireAv8(a,'av8.finance.adjust');return once(this.db,a,`amendment.${id}`,key,b,async tx=>{
      const app=await application(tx,a,id,'av8.finance.adjust');const reason=text(b.reason,'Amendment reason');
      if(b.action!=='approve'&&!b.planId&&(!Array.isArray(b.schedule)||!b.schedule.length||b.schedule.length>50))fail('Choose an approved replacement plan or an explicit date schedule');
      const contract=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,kind:'contract',status:'SIGNED'}});if(!contract)fail('A signed agreement is required');
      if(b.action!=='approve') {
        let snapshot:any={reason,schedule:b.schedule||[],contractId:String(contract.id)};
        if(b.planId){const plan=await tx.av8Policy.findFirst({where:{tenantId:a.tenantId,id:positiveId(b.planId),kind:'PLAN'}});if(!plan)fail('Select a replacement payment plan');const settlementCandidate=await this.av8.policy(tx,a,'SETTLEMENT',plan.key==='CASH'?'CASH':'INSTALLMENT');let settlement:any=null;try{if(settlementCandidate){this.av8.validatePolicy(settlementCandidate.kind,settlementCandidate.key,settlementCandidate.data);settlement=settlementCandidate;}}catch{/* Incomplete academy terms do not block a student schedule change. */}const anchor=(plan.data as any).anchor;const custom=await tx.av8Record.findFirst({where:{applicationId:id,kind:'anchor',key:'CUSTOM'}});const anchorDate=anchor==='CONTRACT'?(contract.data as any).signedDate:anchor==='DEPARTURE'?app.departedAt?.toISOString().slice(0,10):(custom?.data as any)?.date;snapshot={...snapshot,plan,settlement,preview:planPreview(plan.key,plan.data,anchorDate,true)};}
        const r=await tx.av8Record.create({data:{tenantId:a.tenantId,applicationId:id,kind:'amendment',key:randomUUID(),status:'REQUESTED',data:serialize(snapshot) as any,createdById:a.userId}});return r;
      }
      requireAv8(a,'av8.finance.approve');const request=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,applicationId:id,id:positiveId(b.recordId),kind:'amendment',status:'REQUESTED'}});if(!request)fail('Requested amendment not found');if(request!.createdById===a.userId)throw new ForbiddenException('Amendment maker cannot approve it');
      const snapshot:any=request!.data;
      if(snapshot.plan){
        if(!await tx.av8Attachment.count({where:{tenantId:a.tenantId,applicationId:id,recordId:request!.id}}))fail('Upload the signed amendment before approval');
        const summary=await this.av8.financeSummary(tx,a,id);
        const previous=summary.schedule.filter(c=>c.key!=='APPLICATION');
        const carry={upfront:previous.filter(c=>!c.deferred).reduce((n,c)=>n+c.paidMinor,0n),deferred:previous.filter(c=>c.deferred).reduce((n,c)=>n+c.paidMinor,0n)};
        for(const deferred of [false,true]){const total=snapshot.preview.items.filter((i:any)=>i.key!=='APPLICATION'&&i.deferred===deferred).reduce((n:bigint,i:any)=>n+BigInt(i.amountMinor),0n);if(total<carry[deferred?'deferred':'upfront'])fail('Replacement reduces a category below collected money; approve its exceptional refund/academy reconciliation first');}
        const existingCash=await tx.av8Obligation.findFirst({where:{applicationId:id,key:'CASH_BALANCE'}});if(existingCash&&(snapshot.plan.key!=='CASH'||!snapshot.settlement||existingCash.amountMinor!==BigInt(snapshot.settlement.data.totalAcademyMinor)-600000n))fail('Reconcile the existing cash academy obligation through an authorized exception before changing its entitlement');
        const changes:any[]=[];
        for(const c of previous)if(c.remainingMinor>0n){await tx.av8Charge.update({where:{id:c.id},data:{creditMinor:{increment:c.remainingMinor}}});changes.push({oldChargeId:String(c.id),creditMinor:String(c.remainingMinor),preservedPaidMinor:String(c.paidMinor)});}
        const reallocation:any[]=[];
        for(const item of snapshot.preview.items.filter((i:any)=>i.key!=='APPLICATION')){const category=item.deferred?'deferred':'upfront';const amount=BigInt(item.amountMinor),carried=carry[category]>amount?amount:carry[category];carry[category]-=carried;reallocation.push({item:item.key,carriedPaidMinor:String(carried),classification:category});if(amount>carried)await tx.av8Charge.create({data:{tenantId:a.tenantId,applicationId:id,key:`AMEND_${request!.id}:${item.key}`,label:item.label,amountMinor:amount-carried,milestone:item.milestone,predeparture:item.predeparture,deferred:item.deferred,dueDate:item.dueDate?new Date(item.dueDate):null,contractId:contract.id}});}
        if(snapshot.plan.key==='CASH'&&snapshot.settlement)await this.av8.obligation(tx,a,id,'CASH_BALANCE',BigInt(snapshot.settlement.data.totalAcademyMinor)-600000n,snapshot.settlement.data.additionalMilestone==='BEFORE_DEPARTURE',{amendmentId:String(request!.id),settingsId:String(snapshot.settlement.id)});
        await tx.av8Record.update({where:{id:request!.id},data:{status:'APPROVED',data:serialize({...snapshot,changes,reallocation,approvedBy:String(a.userId),approvedAt:new Date().toISOString()})}});
        await approval(tx,a,'AMENDMENT',request!.id,'APPROVE',reason);await audit(tx,a,'PLAN_AMENDED','APPLICATION',id,app.branchId,{reason,amendmentId:String(request!.id),changes,reallocation});return {ok:true};
      }
      const changes:any[]=snapshot.schedule;
      for(const change of changes){const c=await tx.av8Charge.findFirst({where:{tenantId:a.tenantId,applicationId:id,id:positiveId(change.chargeId)}});if(!c)fail('Schedule item not found');if(c!.key==='APPLICATION')fail('Application fee cannot be regenerated');
        if(change.amount||change.amountMinor||change.creditMinor)fail('Amount-changing amendments require an explicit accounting adjustment decision; this action reschedules dates only');
        await tx.av8Charge.update({where:{id:c!.id},data:{dueDate:new Date(calendarDate(change.dueDate))}});
      }
      await tx.av8Record.update({where:{id:request!.id},data:{status:'APPROVED',data:{...(request!.data as any),approvedBy:String(a.userId),approvedAt:new Date().toISOString()}}});await approval(tx,a,'AMENDMENT',request!.id,'APPROVE',reason);await audit(tx,a,'SCHEDULE_AMENDED','APPLICATION',id,app.branchId,{reason,amendmentId:String(request!.id)});return {ok:true};
    });
  }
}
