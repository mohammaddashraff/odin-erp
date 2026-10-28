import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { AuthService,Actor } from './auth';
import { Av8Service } from './av8.service';
import { Av8FinanceService } from './av8-finance.service';
import { seedAv8 } from '../prisma/av8-seed';
import {AccessControlService} from './access-control.service';
import {ErpService} from './erp.service';

jest.setTimeout(120000);
describe('AV8 isolated PostgreSQL vertical workflows',()=>{
 let db:PrismaService,av8:Av8Service,fin:Av8FinanceService,auth:AuthService,server:any;
 let admin:Actor,manager:Actor,telesales:Actor,affairs:Actor,finance:Actor,refs:any,plan:any;
 let failed:any,student:any,cashStudent:any,lead:any,completedJourney:any;
 const key=()=>randomUUID(),date='2026-10-24';
 const evidence={buffer:Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF'),mimetype:'application/pdf',originalname:'synthetic-evidence.pdf'};
 async function detail(id:string):Promise<any>{return av8.detail(admin,BigInt(id));}
 async function configure(kind:string,code:string,data:any){const old=(await av8.policies(admin)).find((p:any)=>p.kind===kind&&p.key===code)!;return av8.savePolicy(admin,{id:old.id,data:{...(old.data as any),...data},reason:'Synthetic test business setting'},key());}
 async function newCase(name:string){
  const l=await av8.createLead(admin,{name:`SYNTHETIC ${name} ${key().slice(0,6)}`,phone:'+201000'+Date.now().toString().slice(-6),source:'Social',program:'Flight training',branchId:refs.branches[0].id,ownerId:String(admin.userId),duplicateReviewed:true},key());
  await av8.leadAction(admin,BigInt(l.id),{version:1,action:'appointment',status:'SCHEDULED',plannedAt:'2026-10-24T10:00:00+03:00',reason:'Synthetic appointment'},key());
  const d=await av8.leadDetail(admin,BigInt(l.id));await av8.leadAction(admin,BigInt(l.id),{version:d.version,action:'appointment',recordId:d.records[0].id,status:'ATTENDED',actualAt:'2026-10-24T10:00:00+03:00',reason:'Synthetic attendance'},key());
  return av8.convert(admin,BigInt(l.id),{academyId:refs.academies[0].id,reason:'Synthetic proceeding'},key());
 }
 async function receive(app:any,amount:string,splits:any[]=[],currency='USD',extra:any={}){
  const fund=await fin.create(admin,{kind:'RECEIPT',applicationId:app.id,amount,currency,bankAccountId:refs.banks.find((b:any)=>b.currency===currency).id,usdRate:currency==='EGP'?'0.02':'1',baseRate:currency==='EGP'?'1':'50',rateDate:date,postingDate:date,reference:'synthetic '+key(),payer:'Synthetic guardian',method:'BANK',...extra},key());
  await fin.action(admin,BigInt(fund.id),{action:'confirm',reason:'Synthetic cleared cash',allocations:splits},key());return fund;
 }
 async function feeAndMedical(app:any,outcome='PASSED'){
  let d=await detail(app.id);await receive(app,'2000',[{chargeId:d.finance.schedule[0].id,amount:'2000'}]);d=await detail(app.id);
  await av8.medical(admin,BigInt(app.id),{version:d.version,date,outcome,provider:'Synthetic provider',reason:'Synthetic outcome'},key());
 }
 async function signed(app:any,policy:any){await av8.contract(admin,BigInt(app.id),{planId:policy.id},key());let d=await detail(app.id);const c=d.records.find((r:any)=>r.kind==='contract');await av8.upload(admin,BigInt(app.id),BigInt(c.id),evidence);await av8.contract(admin,BigInt(app.id),{action:'sign',signedDate:'2026-01-31'},key());}
 async function allDocuments(app:any){let d=await detail(app.id);for(const r of d.records.filter((r:any)=>r.kind==='document')){
  if(r.key==='family'){d=await detail(app.id);await av8.record(admin,BigInt(app.id),{version:d.version,kind:'document',key:r.key,status:'NOT_APPLICABLE',reason:'Conditional family record not requested'},key());continue;}
  await av8.upload(admin,BigInt(app.id),BigInt(r.id),evidence);for(const status of ['RECEIVED','UNDER_REVIEW','ACCEPTED']){d=await detail(app.id);await av8.record(admin,BigInt(app.id),{version:d.version,kind:'document',key:r.key,status,reason:'Synthetic review',statementOwner:'Synthetic parent',relationship:'Parent'},key());}
 }}
 beforeAll(async()=>{
  if(process.env.AV8_ENV!=='test'||!process.env.DATABASE_URL?.includes('/av8_test'))throw new Error('AV8 test database required');
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();server=module.createNestApplication({logger:false});await server.init();db=module.get(PrismaService);av8=module.get(Av8Service);fin=module.get(Av8FinanceService);auth=module.get(AuthService);await seedAv8(db);
  const actors:Record<string,Actor>={};for(const name of ['admin','management','telesales','affairs','finance']){const user=await db.admin.user.findFirstOrThrow({where:{email:`${name}@av8.local`},include:auth.userInclude});actors[name]=auth.actorFor(user);}
  ({admin,management:manager,telesales,affairs,finance}=actors);refs=await av8.refs(admin);
  await configure('SETTLEMENT','INSTALLMENT',{});
  plan=await configure('PLAN','A',{interpretation:'EACH',anchor:'CONTRACT',offsetMonths:3,frequencyMonths:3,firstMilestone:'CONTRACT'});
 });
 afterAll(async()=>{if(server)await server.close();});
 it('opens one application fee and records an idempotent receipt with allocation and dated FX in one operation',async()=>{
  const app=await newCase('one-step receipt');let d=await detail(app.id);
  expect(d.finance.schedule.filter((charge:any)=>charge.key==='APPLICATION')).toHaveLength(1);
  expect(d.finance.funds).toHaveLength(0);
  const charge=d.finance.schedule.find((row:any)=>row.key==='APPLICATION'),egp=refs.banks.find((bank:any)=>bank.currency==='EGP');
  try{await fin.receipt(admin,BigInt(app.id),{amount:'50000',bankAccountId:egp.id,currency:'EGP',paymentDate:'2026-01-10',method:'BANK',chargeId:charge.id},key());throw new Error('Expected a dated-rate validation error');}
  catch(error:any){expect(error.getResponse()).toMatchObject({field:'usdToBaseRate',messageAr:expect.stringContaining('1 USD')});}
  const body={amount:'50000',bankAccountId:egp.id,currency:'EGP',paymentDate:'2026-01-10',method:'BANK',chargeId:charge.id,usdToBaseRate:'50',reference:'one-step-'+key(),notes:'Synthetic receipt'};
  const token=key(),first=await fin.receipt(admin,BigInt(app.id),body,token,evidence),repeat=await fin.receipt(admin,BigInt(app.id),body,token,evidence);expect(repeat).toEqual(first);
  d=await detail(app.id);expect(d.finance.paidMinor).toBe('100000');expect(d.finance.funds).toHaveLength(1);expect(d.finance.funds[0].status).toBe('CLEARED');expect(d.finance.funds[0].allocations).toHaveLength(1);
  const usd=refs.banks.find((bank:any)=>bank.currency==='USD');await fin.receipt(admin,BigInt(app.id),{amount:'1000',bankAccountId:usd.id,currency:'USD',paymentDate:date,method:'BANK',chargeId:charge.id,usdToBaseRate:'50',reference:'balance-'+key()},key());
  d=await detail(app.id);expect(d.admissions).toBe('FEE_RECEIVED');expect(d.finance.remainingMinor).toBe('0');expect(await db.admin.journalEntry.count({where:{tenantId:admin.tenantId,sourceType:'AV8_CASH',sourceId:{in:d.finance.funds.map((fund:any)=>BigInt(fund.id))}}})).toBe(2);
 });
 it('keeps assignment, first contact, a year-away follow-up and conversion history',async()=>{
  lead=await av8.createLead(telesales,{name:'SYNTHETIC long nurture '+key(),phone:'+201222222222',source:'Social',branchId:refs.branches[0].id,ownerId:String(telesales.userId),duplicateReviewed:true},key());
  await av8.leadAction(telesales,BigInt(lead.id),{version:1,action:'status',status:'CONTACTED',reason:'Immediate manual response'},key());
  await av8.leadAction(telesales,BigInt(lead.id),{version:2,action:'status',status:'DEFERRED',nextFollowUp:'2027-10-24T09:00:00+03:00',reason:'Student requests next year'},key());
  const d=await av8.leadDetail(telesales,BigInt(lead.id));expect(d.status).toBe('DEFERRED');expect(d.firstContactAt).toBeTruthy();expect(d.timeline).toHaveLength(3);expect(d.nextFollowUp).toContain('2027-10-24');
  await av8.leadAction(admin,BigInt(lead.id),{version:d.version,action:'assign',ownerId:String(admin.userId),reason:'Sales handoff'},key());await expect(av8.leadDetail(telesales,BigInt(lead.id))).rejects.toThrow('not found');
 });
 it('reschedules and records no-show on the same person, with repeat applications',async()=>{
  let d=await av8.leadDetail(admin,BigInt(lead.id));await av8.leadAction(admin,BigInt(lead.id),{version:d.version,action:'appointment',status:'SCHEDULED',plannedAt:'2026-10-24T10:00:00+03:00',reason:'Office booking'},key());
  d=await av8.leadDetail(admin,BigInt(lead.id));const appointment=d.records[0];await av8.leadAction(admin,BigInt(lead.id),{version:d.version,action:'appointment',recordId:appointment.id,status:'NO_SHOW',reason:'Did not attend'},key());
  d=await av8.leadDetail(admin,BigInt(lead.id));await av8.leadAction(admin,BigInt(lead.id),{version:d.version,action:'appointment',recordId:appointment.id,status:'RESCHEDULED',plannedAt:'2026-10-25T10:00:00+03:00',reason:'Requested new time'},key());
  d=await av8.leadDetail(admin,BigInt(lead.id));await av8.leadAction(admin,BigInt(lead.id),{version:d.version,action:'appointment',recordId:appointment.id,status:'ATTENDED',actualAt:'2026-10-24T10:00:00+03:00',reason:'Attended'},key());
  failed=await av8.convert(admin,BigInt(lead.id),{academyId:refs.academies[0].id},key());const retry=await av8.convert(admin,BigInt(lead.id),{academyId:refs.academies[0].id},key());
  expect(retry.customerId).toBe(failed.customerId);d=await av8.leadDetail(admin,BigInt(lead.id));expect(d.records.filter((r:any)=>r.kind==='appointment')).toHaveLength(1);expect(d.timeline.length).toBeGreaterThan(6);
 });
 it('medical failure creates a request, then separate approval, credit and refund cash posting',async()=>{
  await feeAndMedical(failed,'FAILED');let d=await detail(failed.id);expect(d.finance.academy).toHaveLength(0);const refund=d.records.find((r:any)=>r.kind==='refund');expect(refund.status).toBe('REQUESTED');
  await expect(av8.contract(admin,BigInt(failed.id),{planId:plan.id},key())).rejects.toThrow('medical pass');
  await expect(fin.approveRefund(admin,BigInt(refund.id),{amount:'2000',reason:'Own request'},key())).rejects.toThrow('cannot approve');
  await fin.approveRefund(manager,BigInt(refund.id),{amount:'2000',reason:'Approve received fee refund'},key());const file=await av8.upload(admin,BigInt(failed.id),BigInt(refund.id),evidence);
  const body={kind:'REFUND',applicationId:failed.id,amount:'2000',currency:'USD',baseRate:'50',rateDate:date,postingDate:date,bankAccountId:refs.banks.find((b:any)=>b.currency==='USD').id,payer:'Synthetic student',reference:key(),evidenceId:file.id,refundCaseId:refund.id};
  const fund=await fin.create(admin,body,key());await fin.action(manager,BigInt(fund.id),{action:'approve',reason:'Independent refund approval'},key());await fin.action(finance,BigInt(fund.id),{action:'confirm',reason:'Verified internal refund evidence'},key());
  d=await detail(failed.id);expect(d.finance.refundedMinor).toBe('200000');expect(d.finance.remainingMinor).toBe('0');expect(d.finance.funds.filter((f:any)=>f.kind==='RECEIPT')).toHaveLength(1);expect(d.records.find((r:any)=>r.kind==='refund').status).toBe('PAID');expect(d.finance.academy).toHaveLength(0);
  await expect(fin.create(admin,body,key())).rejects.toThrow();
 });
 it('medical pass creates one obligation; incomplete plans cannot contract; signed terms remain immutable',async()=>{
  student=await newCase('main');await feeAndMedical(student);let d=await detail(student.id);expect(d.finance.academy.map((o:any)=>o.amountMinor)).toEqual(['150000']);
  const current=(await av8.policies(admin)).find((p:any)=>p.kind==='PLAN'&&p.key==='B')!;const incomplete=await db.admin.av8Policy.create({data:{tenantId:admin.tenantId,kind:'PLAN',key:'B',version:current.version+1,status:'DRAFT',data:{...(current.data as any),interpretation:null}}});await expect(av8.contract(admin,BigInt(student.id),{planId:incomplete.id},key())).rejects.toThrow('Choose EACH');
  await signed(student,plan);d=await detail(student.id);expect(d.finance.totalMinor).toBe('6400000');expect(d.finance.schedule.filter((c:any)=>c.key==='APPLICATION')).toHaveLength(1);expect(d.finance.schedule.find((c:any)=>c.key==='DEFERRED_1').dueDate).toContain('2026-04-30');
  await av8.savePolicy(admin,{id:plan.id,data:{...plan.data,interpretation:'TOTAL'},reason:'Later draft edits'},key());expect((await detail(student.id)).records.find((r:any)=>r.kind==='contract').data.schedule.totalMinor).toBe('6400000');
  const contract=d.records.find((r:any)=>r.kind==='contract');await expect(db.admin.av8Record.update({where:{id:BigInt(contract.id)},data:{data:{tampered:true}}})).rejects.toThrow('immutable');
 });
 it('runs English, documents and visa independently; 60 days is a follow-up, not failure',async()=>{
  await allDocuments(student);let d=await detail(student.id);expect(d.records.find((r:any)=>r.kind==='english').status).toBe('ASSESSMENT_PENDING');
  for(const status of ['READY','SUBMITTED']){d=await detail(student.id);await av8.record(admin,BigInt(student.id),{version:d.version,kind:'visa',status,submissionDate:'2026-01-01',followUpDate:'2026-03-02',reason:'Synthetic visa preparation'},key());}
  const queues=await av8.queues(admin,{kind:'visa'});expect(queues.rows.some((r:any)=>r.applicationId===student.id)).toBe(true);d=await detail(student.id);expect(d.visa).toBe('SUBMITTED');
  await av8.record(admin,BigInt(student.id),{version:d.version,kind:'visa',status:'ISSUED',decisionDate:date,reason:'Synthetic decision'},key());d=await detail(student.id);expect(d.finance.academy.filter((o:any)=>o.key==='VISA_ISSUED')).toHaveLength(1);expect(d.records.find((r:any)=>r.kind==='english').status).toBe('ASSESSMENT_PENDING');
 });
 it('reconciles partial and FX payments, early deferred pass-through, and unapplied cash',async()=>{
  let d=await detail(student.id);const contract=d.finance.schedule.find((c:any)=>c.key==='CONTRACT'),visa=d.finance.schedule.find((c:any)=>c.key==='VISA'),deferred=d.finance.schedule.find((c:any)=>c.key==='DEFERRED_1');
  await receive(student,'100000',[{chargeId:contract.id,amount:'2000'}],'EGP');await receive(student,'12100',[{chargeId:contract.id,amount:'4000'},{chargeId:visa.id,amount:'8000'}]);
  await receive(student,'9600',[{chargeId:deferred.id,amount:'9600'}]);d=await detail(student.id);expect(d.finance.unappliedMinor).toBe('10000');const forward=d.finance.academy.find((o:any)=>o.key.startsWith('DEFERRED:'));expect(forward.amountMinor).toBe('960000');expect(forward.paidMinor).toBe('0');expect(d.travel).toBe('PREPARING');
 });
 it('supports partial/batch remittances, maker-checker and idempotent concurrent confirmation',async()=>{
  const second=await newCase('batch');await feeAndMedical(second);let d=await detail(student.id),e=await detail(second.id);
  const r=d.records.find((r:any)=>r.kind==='contract');const file=await av8.upload(admin,BigInt(student.id),BigInt(r.id),evidence);
  const fund=await fin.create(admin,{kind:'REMITTANCE',branchId:student.branchId,academyId:student.academyId,amount:'2000',currency:'USD',baseRate:'50',rateDate:date,postingDate:date,bankAccountId:refs.banks.find((b:any)=>b.currency==='USD').id,payer:'Synthetic academy',reference:key(),evidenceId:file.id},key());
  await expect(fin.action(admin,BigInt(fund.id),{action:'approve',reason:'Own approval'},key())).rejects.toThrow('Maker-checker');await fin.action(manager,BigInt(fund.id),{action:'approve',reason:'Reviewed batch'},key());
  const body={action:'confirm',reason:'Synthetic batch remittance',allocations:[{obligationId:d.finance.academy.find((o:any)=>o.key==='MEDICAL_PASS').id,amount:'1500'},{obligationId:e.finance.academy[0].id,amount:'500'}]},token=key();
  const result=await Promise.all([fin.action(finance,BigInt(fund.id),body,token),fin.action(finance,BigInt(fund.id),body,token)]);expect(result[0]).toEqual(result[1]);
  d=await detail(student.id);e=await detail(second.id);expect(d.finance.academy.find((o:any)=>o.key==='MEDICAL_PASS').remainingMinor).toBe('0');expect(e.finance.academy[0].remainingMinor).toBe('100000');
  expect(await db.admin.journalEntry.count({where:{tenantId:admin.tenantId,sourceType:'AV8_CASH',sourceId:BigInt(fund.id)}})).toBe(1);
 });
 it('blocks over-allocation under concurrency and never equates a receipt with academy payment',async()=>{
  const d=await detail(student.id);const next=d.finance.schedule.find((c:any)=>c.key==='DEFERRED_2');const fund=await receive(student,'10000');
  const results=await Promise.allSettled([fin.allocate(admin,BigInt(fund.id),{chargeId:next.id,amount:'6000',reason:'Concurrent A'},key()),fin.allocate(admin,BigInt(fund.id),{chargeId:next.id,amount:'6000',reason:'Concurrent B'},key())]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const now=await detail(student.id);expect(now.finance.academy.filter((o:any)=>o.key.startsWith('DEFERRED:')).every((o:any)=>o.paidMinor==='0')).toBe(true);
 });
 it('readiness allows future installments, checks upfront transfers and records factual departure exceptions',async()=>{
  let d=await detail(student.id);expect(d.readiness.issues.some((s:string)=>s.includes('VISA_ISSUED'))).toBe(true);expect(d.readiness.issues.some((s:string)=>s.includes('Deferred installment'))).toBe(false);
  await expect(av8.record(affairs,BigInt(student.id),{version:d.version,kind:'travel',status:'DEPARTED',actualDeparture:'2026-04-01T10:00:00+02:00',exception:true,reason:'Unauthorised exception'},key())).rejects.toThrow('permission');
  await av8.record(manager,BigInt(student.id),{version:d.version,kind:'travel',status:'DEPARTED',actualDeparture:'2026-04-01T10:00:00+02:00',exception:true,reason:'Actual event recorded with outstanding tasks'},key());d=await detail(student.id);expect(d.travel).toBe('DEPARTED');expect(d.records.some((r:any)=>r.kind==='exception')).toBe(true);expect(d.records.some((r:any)=>r.kind==='task')).toBe(true);expect(d.finance.remainingMinor!=='0').toBe(true);
  const reports=await av8.queues(admin,{kind:'progress'});expect(reports.rows.some((r:any)=>r.applicationId===student.id)).toBe(true);
 });
 it('cash pricing works independently and does not invent a commission or academy entitlement',async()=>{
  cashStudent=await newCase('cash');await feeAndMedical(cashStudent);const cash=(await av8.policies(admin)).find((p:any)=>p.kind==='PLAN'&&p.key==='CASH'&&p.usable)!;await signed(cashStudent,cash);const d=await detail(cashStudent.id);expect(d.finance.totalMinor).toBe('5400000');expect(d.finance.academy).toHaveLength(1);expect(d.readiness.issues).not.toContain('Approved relevant academy settlement policy');
  const report=await av8.report(admin,'commission',{search:cashStudent.reference});expect(report.rows[0].contractualCommissionMinor).toBeNull();
 });
 it('permits normal departure readiness with future installments outstanding after all upfront transfers',async()=>{
  const app=await newCase('ready');await feeAndMedical(app);
  const approved=await configure('PLAN','B',{interpretation:'EACH',anchor:'DEPARTURE',offsetMonths:3,frequencyMonths:3,firstMilestone:'VISA'});await signed(app,approved);await allDocuments(app);
  for(const status of ['READY','SUBMITTED','ISSUED']){const d=await detail(app.id);await av8.record(admin,BigInt(app.id),{version:d.version,kind:'visa',status,submissionDate:'2026-02-01',decisionDate:date,reason:'Synthetic readiness flow'},key());}
  let d=await detail(app.id);await receive(app,'14000',[{chargeId:d.finance.schedule.find((c:any)=>c.key==='FIRST').id,amount:'14000'}]);
  const record=d.records.find((r:any)=>r.kind==='contract'),file=await av8.upload(admin,BigInt(app.id),BigInt(record.id),evidence);
  const fund=await fin.create(admin,{kind:'REMITTANCE',applicationId:app.id,amount:'6000',currency:'USD',baseRate:'50',rateDate:date,postingDate:date,bankAccountId:refs.banks.find((b:any)=>b.currency==='USD').id,payer:'Synthetic academy',reference:key(),evidenceId:file.id},key());await fin.action(manager,BigInt(fund.id),{action:'approve',reason:'Readiness remittance approval'},key());
  await fin.action(finance,BigInt(fund.id),{action:'confirm',reason:'Confirmed initial academy transfers',allocations:d.finance.academy.map((o:any)=>({obligationId:o.id,amount:o.key==='MEDICAL_PASS'?'1500':'4500'}))},key());
  d=await detail(app.id);expect(d.readiness).toEqual({ready:true,issues:[]});expect(d.finance.remainingMinor).toBe('4800000');expect(d.records.find((r:any)=>r.kind==='english').status).toBe('ASSESSMENT_PENDING');
  for(const status of ['READY','BOOKED','DEPARTED','ARRIVAL_CONFIRMED']){d=await detail(app.id);await av8.record(affairs,BigInt(app.id),{version:d.version,kind:'travel',status,actualDeparture:'2026-10-24T10:00:00+03:00',arrivalAt:'2026-10-24T18:00:00+03:00',reason:'Synthetic fully eligible journey'},key());}
  completedJourney=app;d=await detail(app.id);expect(d.travel).toBe('ARRIVAL_CONFIRMED');expect(d.records.some((r:any)=>r.kind==='exception')).toBe(false);
 });
 it('approves plan amendments without changing signed terms or charging the fee again',async()=>{
  const app=await newCase('amendment');await feeAndMedical(app);await signed(app,plan);const before=await detail(app.id);const replacement=await configure('PLAN','A',{interpretation:'TOTAL',anchor:'DEPARTURE',offsetMonths:3,frequencyMonths:3,firstMilestone:'CONTRACT'});
  const amendment=await fin.amendment(admin,BigInt(app.id),{planId:replacement.id,reason:'Synthetic approved renegotiation'},key());await av8.upload(admin,BigInt(app.id),BigInt(amendment.id),evidence);await fin.amendment(manager,BigInt(app.id),{recordId:amendment.id,action:'approve',reason:'Independent approval of signed amendment'},key());
  const d=await detail(app.id);expect(d.finance.totalMinor).toBe('2560000');expect(d.finance.schedule.filter((c:any)=>c.key==='APPLICATION')).toHaveLength(1);expect(d.records.find((r:any)=>r.kind==='contract').data.schedule.totalMinor).toBe(before.records.find((r:any)=>r.kind==='contract').data.schedule.totalMinor);expect(d.records.find((r:any)=>r.kind==='amendment').data.changes.length).toBeGreaterThan(0);
 });
 it('rejects unauthorized APIs, sensitive evidence, cross-branch records and exports',async()=>{
  const d=await detail(student.id),passport=d.attachments.find((f:any)=>f.category==='passport');
  await expect(av8.download(finance,passport.id)).rejects.toThrow('Sensitive');expect(()=>fin.create(telesales,{},key())).toThrow('Permission');
  const branch=await db.admin.branch.findFirstOrThrow({where:{tenantId:admin.tenantId,id:{not:BigInt(student.branchId)}}});const other={id:String(branch.id)};const scoped={...affairs,branchIds:[other.id],companyBranchIds:Object.fromEntries(Object.keys(affairs.companyBranchIds).map(k=>[k,[other.id]]))};await expect(av8.detail(scoped,BigInt(student.id))).rejects.toThrow('not found');
  await request(server.getHttpServer()).get('/api/av8/applications').expect(401);
  const session=await auth.login('telesales@av8.local',process.env.AV8_BOOTSTRAP_PASSWORD!);await request(server.getHttpServer()).post('/api/av8/funds').set('Authorization',`Bearer ${session.token}`).send({}).expect(403);await request(server.getHttpServer()).get('/api/av8/reports/collections/csv').set('Authorization',`Bearer ${session.token}`).expect(403);
  await expect(av8.upload(admin,BigInt(student.id),BigInt(d.records.find((r:any)=>r.kind==='contract').id),{...evidence,buffer:Buffer.from('<script>evil</script>'),mimetype:'application/pdf'})).rejects.toThrow('content');
 });
 it('preserves appointment and document metadata when only notes or location change',async()=>{
  const app=await newCase('QA edit preservation');
  let l=await av8.leadDetail(admin,BigInt(app.leadId));const appointment:any=l.records.find((r:any)=>r.kind==='appointment');expect(appointment).toBeTruthy();
  await av8.leadAction(admin,BigInt(l.id),{version:l.version,action:'appointment',recordId:appointment.id,status:appointment.status,location:'Updated Cairo office',reason:'Correct location only'},key());
  l=await av8.leadDetail(admin,BigInt(app.leadId));const changed:any=l.records.find((r:any)=>r.id===appointment.id);expect(changed).toBeTruthy();
  expect(changed.data.plannedAt).toBe(appointment.data.plannedAt);expect(changed.data.actualAt).toBe(appointment.data.actualAt);expect(changed.data.location).toBe('Updated Cairo office');
  let d=await detail(app.id);let passport=d.records.find((r:any)=>r.key==='passport');await av8.upload(admin,BigInt(app.id),BigInt(passport.id),evidence);
  for(const status of ['RECEIVED','UNDER_REVIEW']){d=await detail(app.id);await av8.record(admin,BigInt(app.id),{version:d.version,kind:'document',key:'passport',status,expiry:'2028-12-31',reason:'Document review'},key());}
  d=await detail(app.id);passport=d.records.find((r:any)=>r.key==='passport');expect(passport.allowedStatuses).not.toContain('RECEIVED');
  await av8.record(admin,BigInt(app.id),{version:d.version,kind:'document',key:'passport',status:passport.status,reason:'Correct notes only'},key());
  d=await detail(app.id);passport=d.records.find((r:any)=>r.key==='passport');expect(passport.status).toBe('UNDER_REVIEW');expect(passport.data.expiry).toBe('2028-12-31');
 });
 it('creates a default exception request and protects management decisions',async()=>{
  const app=await newCase('QA exception');let d=await detail(app.id);const recordKey=key();
  await av8.record(affairs,BigInt(app.id),{version:d.version,kind:'exception',key:recordKey,decision:'Please review',reason:'Request management decision'},key());
  d=await detail(app.id);let record=d.records.find((r:any)=>r.key===recordKey);expect(record.status).toBe('DECISION_REQUIRED');expect(record.data.approvedBy).toBeNull();
  expect(()=>av8.record(affairs,BigInt(app.id),{version:d.version,kind:'exception',key:recordKey,status:'APPROVED',decision:'Unauthorized',reason:'Attempt approval'},key())).toThrow();
  await av8.record(manager,BigInt(app.id),{version:d.version,kind:'exception',key:recordKey,status:'APPROVED',decision:'Approved operational request',reason:'Management decision'},key());
  d=await detail(app.id);record=d.records.find((r:any)=>r.key===recordKey);expect(record.status).toBe('APPROVED');expect(record.data.approvedBy).toBe(String(manager.userId));
  const rejectedKey=key();await av8.record(affairs,BigInt(app.id),{version:d.version,kind:'exception',key:rejectedKey,reason:'Another decision request'},key());d=await detail(app.id);
  await av8.record(manager,BigInt(app.id),{version:d.version,kind:'exception',key:rejectedKey,status:'REJECTED',decision:'Insufficient evidence',reason:'Management rejection'},key());
  expect(await db.admin.av8Fund.count({where:{applicationId:BigInt(app.id)}})).toBe(0);
 });
 it('corrects student identity with duplicate checks and an audit snapshot',async()=>{
  const app=await newCase('QA contact correction');let d=await detail(app.id);const before=d.customer.name;
  const phone='+2088'+String(app.id).padStart(8,'0');
  await av8.record(admin,BigInt(app.id),{version:d.version,kind:'contact',key:key(),name:'Corrected synthetic student',phone,email:'corrected-'+key()+'@av8.invalid',reason:'Correct transcription'},key());
  d=await detail(app.id);expect(d.customer.name).toBe('Corrected synthetic student');expect(d.customer.phone).toBe(phone);expect(d.customerId).toBe(app.customerId);expect(d.ownerName).toBeTruthy();
  expect(d.records.find((r:any)=>r.kind==='contact').data.before.name).toBe(before);
  expect(d.timeline.find((event:any)=>event.action==='AV8_CONTACT_RECORDED').previousValues.name).toBe(before);
  expect(()=>av8.record(telesales,BigInt(app.id),{version:d.version,kind:'contact',name:'Not permitted',phone,reason:'Unauthorized correction'},key())).toThrow();
 });
 it('records non-empty monthly study reports after departure and honors guardian consent',async()=>{
  const app=completedJourney;const d:any=await detail(app.id);expect(d.departedAt).toBeTruthy();await av8.planReports(affairs,BigInt(app.id),{},key());
  let current:any=await detail(app.id);const report=current.records.find((r:any)=>r.kind==='progress'&&r.status==='EXPECTED');expect(report).toBeTruthy();
  await av8.record(affairs,BigInt(app.id),{version:current.version,kind:'progress',key:report.key,status:'RECEIVED',source:'Synthetic academy',examResults:'Theory 85/100',trainingProgress:'Flight phase 2',trainingPercent:'75',reason:'Monthly academy report'},key());
  current=await detail(app.id);await av8.record(affairs,BigInt(app.id),{version:current.version,kind:'progress',key:report.key,status:'REVIEWED',reason:'Review grades'},key());
  const output:any=await av8.statement(affairs,BigInt(app.id),'progress');expect(output.rows.some((r:any)=>r.examResults==='Theory 85/100')).toBe(true);expect(output.guardianSharingPermitted).toBe(false);
  current=await detail(app.id);await expect(av8.record(affairs,BigInt(app.id),{version:current.version,kind:'progress',key:report.key,status:'FOLLOWUP_PENDING',guardianFollowup:'Unconsented sharing',reason:'Attempt sharing'},key())).rejects.toThrow('permission');
 });
 it('creates a restricted staff login through administration without leaking credentials',async()=>{
  const access=server.get(AccessControlService);const role=await db.admin.role.findFirstOrThrow({where:{tenantId:admin.tenantId,key:'av8_telesales'}});
  const email='qa-user-'+key()+'@av8.invalid',password='Private-QA-'+key();
  const created=await access.createUser(admin,{name:'Synthetic staff',email,password,roleId:String(role.id),branchId:refs.branches[0].id},{});
  expect(created).not.toHaveProperty('passwordHash');expect(JSON.stringify(created)).not.toContain(password);
  const session=await auth.login(email,password);expect(session.user.companyIds).not.toHaveLength(0);expect(session.user.branchIds).toEqual([String(refs.branches[0].id)]);
  await expect(access.createUser(telesales,{name:'Forbidden',email:'forbidden@av8.invalid',password,roleId:String(role.id),branchId:refs.branches[0].id},{})).rejects.toThrow('Super Admin');
  expect((await access.overview(admin)).configuration.dataScopeResources).toEqual(expect.arrayContaining(['av8_lead','av8_application']));
 });
 it('matches a USD bank statement against a real AV8 posting and blocks unconverted manual FX',async()=>{
  const erp=server.get(ErpService);const app=await newCase('QA bank reconciliation');await receive(app,'2000');
  const bank=refs.banks.find((b:any)=>b.currency==='USD');const fund=await db.admin.av8Fund.findFirstOrThrow({where:{applicationId:BigInt(app.id),status:'CLEARED'}});
  const statement=await erp.createStatement(admin,{bankAccountId:bank.id,statementDate:date,opening:'0',closing:'2000',lines:[{date,amount:'2000',description:'Synthetic USD statement',reference:key()}]});
  await erp.matchStatementLine(admin,BigInt(statement.lines[0].id),fund.bankTransactionId!);
  const matched=await db.admin.bankStatementLine.findUniqueOrThrow({where:{id:BigInt(statement.lines[0].id)}});expect(matched.matched).toBe(true);
  const counterparty=await db.admin.account.findFirstOrThrow({where:{tenantId:admin.tenantId,code:'2100'}});
  await expect(erp.createBankTransaction(admin,{branchId:refs.branches[0].id,bankAccountId:bank.id,counterpartyAccountId:String(counterparty.id),kind:'RECEIPT',amount:'1',postingDate:date})).rejects.toThrow('historical exchange rates');
 });
 it('uses restricted database role, RLS, balanced journals and existing locked-period controls',async()=>{
  const identity:any=await db.app.$queryRaw`SELECT current_user AS name, current_database() AS db`;expect(identity[0]).toEqual({name:'av8_runtime',db:'av8_test'});expect(await db.app.av8Application.count()).toBe(0);
  const invalid:any=await db.admin.$queryRaw`SELECT j.id FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id WHERE j.tenant_id=${admin.tenantId} AND j.source_module='AV8' GROUP BY j.id HAVING sum(l.debit_minor)<>sum(l.credit_minor)`;expect(invalid).toHaveLength(0);
  const locked=await db.admin.fiscalPeriod.findFirstOrThrow({where:{tenantId:admin.tenantId,year:2025}});await db.admin.fiscalPeriod.update({where:{id:locked.id},data:{status:'CLOSED'}});
  await expect(receive(student,'10',[],'USD',{postingDate:'2025-01-10'})).rejects.toThrow('CLOSED');
  await expect(db.admin.av8Allocation.updateMany({where:{tenantId:admin.tenantId},data:{reason:'tamper'}})).rejects.toThrow('immutable');
 });
});
