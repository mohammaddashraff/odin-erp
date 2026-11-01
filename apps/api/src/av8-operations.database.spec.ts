import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { Actor, AuthService } from './auth';
import { Av8Service } from './av8.service';
import { Av8OperationsService } from './av8-operations.service';
import { Av8FinanceService } from './av8-finance.service';
import { ErpService } from './erp.service';

jest.setTimeout(120000);
describe('AV8 operational delivery on isolated PostgreSQL', () => {
  let server: any, erp:ErpService, db: PrismaService, av8: Av8Service, ops: Av8OperationsService, finance: Av8FinanceService, admin: Actor, affairs: Actor, telesales: Actor, refs: any, student: any, reportVersion: any;
  let fetchMock: jest.SpyInstance;
  const originalEnv: Record<string,string | undefined> = {};
  const key = () => randomUUID();
  const evidence = { buffer: Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF'), mimetype: 'application/pdf', originalname: 'SYNTHETIC-academic-evidence.pdf' };
  const detail = async (id: string) => av8.detail(admin, BigInt(id)) as Promise<any>;
  async function app(name: string) {
    const lead = await av8.createLead(admin, { name: `SYNTHETIC operations ${name} ${key()}`, phone: '+201000000001', email: 'student@av8.invalid', source: 'Controlled operations test', branchId: refs.branches[0].id, ownerId: String(admin.userId), duplicateReviewed: true }, key());
    await av8.leadAction(admin, BigInt(lead.id), { version: 1, action: 'appointment', status: 'SCHEDULED', plannedAt: '2026-01-01T10:00:00+02:00', reason: 'Synthetic booking' }, key());
    const before = await av8.leadDetail(admin, BigInt(lead.id));
    await av8.leadAction(admin, BigInt(lead.id), { version: before.version, action: 'appointment', recordId: before.records[0].id, status: 'ATTENDED', actualAt: '2026-01-01T10:00:00+02:00', reason: 'Synthetic attendance' }, key());
    return av8.convert(admin, BigInt(lead.id), { academyId: refs.academies[0].id, reason: 'Synthetic application' }, key());
  }
  async function record(application: any, value: any) { const current = await detail(application.id); return av8.record(admin, BigInt(application.id), { ...value, version: current.version, reason: value.reason || 'Synthetic documented operation' }, key()); }
  async function file(application: any, kind = 'task') {
    const result = await record(application, { kind, key: key(), title: 'Synthetic supporting evidence', status: kind === 'task' ? 'OPEN' : 'RECORDED' });
    return av8.upload(admin, BigInt(application.id), BigInt(result.recordId), evidence);
  }
  beforeAll(async () => {
    if (process.env.AV8_ENV !== 'test' || !process.env.DATABASE_URL?.includes('/av8_test')) throw new Error('Isolated AV8 test database required');
    for (const name of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_EMAIL_PROVIDER','AV8_ACADEMIC_EMAIL_FROM','AV8_ACADEMIC_EMAIL_API_KEY','AV8_ACADEMIC_TEST_RECIPIENTS','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED']) originalEnv[name] = process.env[name];
    Object.assign(process.env, { AV8_ACADEMIC_EMAIL_ENABLED: 'true', AV8_ACADEMIC_EMAIL_PROVIDER: 'resend', AV8_ACADEMIC_EMAIL_FROM: 'sender@av8.invalid', AV8_ACADEMIC_EMAIL_API_KEY: 'synthetic-key-no-real-provider', AV8_ACADEMIC_TEST_RECIPIENTS: 'student@av8.invalid,guardian@av8.invalid', AV8_ACADEMIC_WORKER_ENABLED: 'false', AV8_OPERATIONS_WORKER_ENABLED: 'false' });
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Synthetic fetch disabled unless explicitly stubbed'));
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile(); server = module.createNestApplication({ logger: false }); await server.init();
    erp=module.get(ErpService);db = module.get(PrismaService); av8 = module.get(Av8Service); ops = module.get(Av8OperationsService); finance = module.get(Av8FinanceService);
    const auth = module.get(AuthService);
    const actor = async (email: string) => auth.actorFor(await db.admin.user.findFirstOrThrow({ where: { email }, include: auth.userInclude }));
    admin = await actor('admin@av8.local'); affairs = await actor('affairs@av8.local'); telesales = await actor('telesales@av8.local'); refs = await av8.refs(admin);
  });
  afterAll(async () => { fetchMock?.mockRestore(); if (server) await server.close(); for (const [name,value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });

  it('requires medical, eligibility and reviewed documents for admission, with a reasoned conditional family exception', async () => {
    student = await app('admission');
    await expect(ops.execute(affairs, BigInt(student.id), { kind: 'admission', status: 'APPROVED', reason: 'Premature approval' }, key())).rejects.toThrow('medical');
    let current = await detail(student.id);
    await finance.receipt(admin, BigInt(student.id), { amount: '2000', currency: 'USD', bankAccountId: refs.banks.find((b:any) => b.currency === 'USD').id, paymentDate: '2026-10-31', method: 'BANK', chargeId: current.finance.schedule[0].id, usdToBaseRate: '50', reference: key(), notes: 'Synthetic fee' }, key());
    current = await detail(student.id); await av8.medical(admin, BigInt(student.id), { version: current.version, outcome: 'PASSED', date: '2026-10-31', provider: 'Synthetic medical provider', reason: 'Synthetic medical pass' }, key());
    await expect(ops.execute(affairs, BigInt(student.id), { kind: 'admission', status: 'APPROVED', reason: 'Missing eligibility' }, key())).rejects.toThrow('eligibility');
    const education = await file(student); await ops.execute(affairs, BigInt(student.id), { kind: 'eligibility', status: 'VERIFIED', evidenceId: education.id, criteria: 'Synthetic approved manual eligibility fixture', reason: 'Verified source evidence' }, key());
    await expect(ops.execute(affairs, BigInt(student.id), { kind: 'admission', status: 'APPROVED', reason: 'Missing documents' }, key())).rejects.toThrow('prerequisites');
    current = await detail(student.id);
    for (const document of current.records.filter((r:any) => r.kind === 'document')) {
      if (document.key === 'family') { await record(student, { kind: 'document', key: document.key, status: 'NOT_APPLICABLE', reason: 'Not requested for this synthetic embassy application' }); continue; }
      await av8.upload(admin, BigInt(student.id), BigInt(document.id), evidence);
      for (const status of ['RECEIVED','UNDER_REVIEW','ACCEPTED']) await record(student, { kind: 'document', key: document.key, status, statementOwner: 'Synthetic student', relationship: 'Self' });
    }
    await ops.execute(affairs, BigInt(student.id), { kind: 'admission', status: 'APPROVED', reason: 'All evidence verified' }, key());
    expect((await detail(student.id)).admissions).toBe('ADMITTED');
    expect(() => ops.execute(telesales, BigInt(student.id), { kind: 'admission', status: 'APPROVED', reason: 'Unauthorized' }, key())).toThrow();
  });

  it('requires original academic evidence and retains immutable corrected versions with independent recipient dispatches', async () => {
    await record(student, { kind: 'travel', status: 'DEPARTED', actualDeparture: '2026-01-31T12:00:00+02:00', exception: true, reason: 'Synthetic exception to isolate academic workflow' });
    await record(student, { kind: 'guardian', name: 'Synthetic guardian', relationship: 'Parent', phone: '+201000000002', email: 'guardian@av8.invalid', sharingScope: ['PROGRESS'], consentDate: '2026-01-01' });
    const current = await detail(student.id), report = current.records.find((r:any) => r.kind === 'progress');
    await record(student, { kind: 'progress', key: report.key, status: 'RECEIVED', source: 'Synthetic academy', examResults: 'Theory 85/100', trainingProgress: 'Phase one', trainingPercent: '25', flightHours: 40, qualifications:['Synthetic instrument milestone'],examRows:[{name:'Synthetic air law',result:'85/100',date:'2026-02-01'}], receivedDate: '2026-10-31' });
    await expect(record(student, { kind: 'progress', key: report.key, status: 'REVIEWED' })).rejects.toThrow('original academy report');
    await av8.upload(admin, BigInt(student.id), BigInt(report.id), evidence);
    await record(student, { kind: 'progress', key: report.key, status: 'REVIEWED' });
    const first: any = await ops.overview(admin, BigInt(student.id)); reportVersion = first.records.find((r:any) => r.kind === 'report-version');
    expect(first.dispatches.filter((r:any) => r.reportId === reportVersion.id).map((r:any) => r.recipientKind).sort()).toEqual(['GUARDIAN','STUDENT']);
    await expect(record(student, { kind: 'progress', key: report.key, status: 'REVIEWED', examResults: 'Untracked edit' })).rejects.toThrow('corrected report');
    await expect(db.admin.av8Record.update({ where: { id: BigInt(reportVersion.id) }, data: { data: { erased: true } } })).rejects.toThrow('immutable');
    await record(student, { kind: 'progress', key: report.key, correction: true, source: 'Synthetic corrected academy report', examResults: 'Theory 90/100' });
    await av8.upload(admin, BigInt(student.id), BigInt(report.id), { ...evidence, originalname: 'SYNTHETIC-corrected.pdf' });
    await record(student, { kind: 'progress', key: report.key, status: 'REVIEWED' });
    const after: any = await ops.overview(admin, BigInt(student.id));
    expect(after.records.filter((r:any) => r.kind === 'report-version')).toHaveLength(2);
    expect(after.records.find((r:any) => r.id === reportVersion.id).data.examResults).toBe('Theory 85/100');
    expect(after.dispatches).toHaveLength(4);
  });

  it('claims each recipient once across concurrent workers and retries only the failed guardian', async () => {
    fetchMock.mockImplementation(async (_url: any, request: any) => {
      const body = JSON.parse(request.body);
      return body.to[0] === 'guardian@av8.invalid' ? new Response('{}', { status: 422 }) : new Response(JSON.stringify({ id: 'synthetic-' + key() }), { status: 200 });
    });
    const before = fetchMock.mock.calls.length;
    await Promise.all([ops.process(admin, 10), ops.process(admin, 10)]);
    expect(fetchMock.mock.calls.length - before).toBe(4);
    expect(fetchMock.mock.calls.slice(before).every(call=>String(call[1]?.body||'').includes('Synthetic instrument milestone')&&String(call[1]?.body||'').includes('Synthetic air law'))).toBe(true);
    let overview: any = await ops.overview(admin, BigInt(student.id));
    expect(overview.dispatches.filter((d:any) => d.recipientKind === 'STUDENT').every((d:any) => d.status === 'ACCEPTED')).toBe(true);
    const guardian = overview.dispatches.find((d:any) => d.reportId === reportVersion.id && d.recipientKind === 'GUARDIAN'); expect(guardian.status).toBe('FAILED');
    await ops.dispatchAction(admin, BigInt(student.id), BigInt(guardian.id), { action: 'retry', reason: 'Synthetic provider issue resolved' }, key());
    // Advance only this synthetic retry schedule instead of sleeping.
    const row = await db.admin.av8Record.findUniqueOrThrow({ where: { id: BigInt(guardian.id) } });
    await db.admin.av8Record.update({ where: { id: row.id }, data: { data: { ...row.data as any, nextAttemptAt: '2020-01-01T00:00:00Z' } } });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'synthetic-retry-' + key() }), { status: 200 }));
    const retryBefore = fetchMock.mock.calls.length; await ops.process(admin, 10); expect(fetchMock.mock.calls.length - retryBefore).toBe(1);
    overview = await ops.overview(admin, BigInt(student.id)); expect(overview.dispatches.find((d:any) => d.id === guardian.id).status).toBe('ACCEPTED');
  });

  it('holds ambiguous provider outcomes for reconciliation rather than replaying them', async () => {
    const current: any = await ops.overview(admin, BigInt(student.id)); const guardian = current.dispatches.find((d:any) => d.status === 'FAILED');
    await ops.dispatchAction(admin, BigInt(student.id), BigInt(guardian.id), { action: 'retry', reason: 'Synthetic timeout scenario' }, key());
    const row = await db.admin.av8Record.findUniqueOrThrow({ where: { id: BigInt(guardian.id) } }); await db.admin.av8Record.update({ where: { id: row.id }, data: { data: { ...row.data as any, nextAttemptAt: '2020-01-01T00:00:00Z' } } });
    fetchMock.mockRejectedValue(new Error('Synthetic timeout after possible acceptance')); await ops.process(admin, 10);
    const before = fetchMock.mock.calls.length; await ops.process(admin, 10); expect(fetchMock.mock.calls.length).toBe(before);
    await expect(ops.dispatchAction(admin, BigInt(student.id), BigInt(guardian.id), { action: 'retry', reason: 'Unsafe blind retry' }, key())).rejects.toThrow('reconcile unknown');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'synthetic-reconciled', to: [guardian.address], subject: guardian.subject, last_event: 'delivered' }), { status: 200 }));
    await ops.dispatchAction(admin, BigInt(student.id), BigInt(guardian.id), { action: 'reconcile', providerReference: 'synthetic-reconciled', reason: 'Synthetic provider evidence matches' }, key());
    expect((await ops.overview(admin, BigInt(student.id)) as any).dispatches.find((d:any) => d.id === guardian.id).status).toBe('DELIVERED');
  });

  it('recovers a persisted abandoned sending lease as unknown after worker restart without resending it',async()=>{
    const caseApp=await app('abandoned-dispatch');
    const abandoned=await db.tenant(admin.tenantId,tx=>tx.av8Record.create({data:{tenantId:admin.tenantId,applicationId:BigInt(caseApp.id),kind:'academic-dispatch',key:key(),status:'SENDING',data:{leaseUntil:'2020-01-01T00:00:00Z',claimId:'crashed-worker',address:'student@av8.invalid',attempts:1},createdById:admin.userId}}));
    const before=fetchMock.mock.calls.length;await ops.process(admin,10);const result=await db.admin.av8Record.findUniqueOrThrow({where:{id:abandoned.id}});expect(result.status).toBe('DELIVERY_UNKNOWN');expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('records monthly direct-provider payments without creating company cash and rejects duplicate/overpayments', async () => {
    const caseApp = await app('services'), doc = await file(caseApp, 'finance_evidence');
    const service = await ops.execute(admin, BigInt(caseApp.id), { kind: 'service', key: key(), type: 'ACCOMMODATION', provider: 'Synthetic provider', startDate: '2026-01-01', amount: '350', currency: 'USD', collectionParty: 'PROVIDER', reason: 'Explicit synthetic agreement' }, key());
    const charge = await ops.execute(admin, BigInt(caseApp.id), { kind: 'service-charge', serviceId: service.id, period: '2026-02', reason: 'Monthly synthetic charge' }, key());
    await expect(ops.execute(admin, BigInt(caseApp.id), { kind: 'service-charge', serviceId: service.id, period: '2026-02', reason: 'Duplicate month' }, key())).rejects.toThrow('already exists');
    const before = await detail(caseApp.id), token = key(), body = { kind: 'service-payment', chargeId: charge.id, amount: '100', date: '2026-02-01', evidenceId: doc.id, reason: 'Provider evidence received' };
    const pair = await Promise.all([ops.execute(admin, BigInt(caseApp.id), body, token), ops.execute(admin, BigInt(caseApp.id), body, token)]); expect(pair[0]).toEqual(pair[1]);
    const after = await detail(caseApp.id); expect(after.finance.funds).toHaveLength(before.finance.funds.length); expect(after.finance.paidMinor).toBe(before.finance.paidMinor);
    expect((await ops.overview(admin, BigInt(caseApp.id)) as any).services[0].charges[0].remainingMinor).toBe('25000');
    await expect(ops.execute(admin, BigInt(caseApp.id), { ...body, amount: '251' }, key())).rejects.toThrow('exceeds');
    expect((await ops.overview(affairs, BigInt(caseApp.id)) as any).records.some((r:any) => r.kind === 'service-payment')).toBe(false);
    const reversal={kind:'service-payment-reversal',paymentId:pair[0].id,date:'2026-02-02',evidenceId:doc.id,reason:'Synthetic provider correction'};await ops.execute(admin,BigInt(caseApp.id),reversal,key());
    expect((await ops.overview(admin,BigInt(caseApp.id))as any).services[0].charges[0].remainingMinor).toBe('35000');
    await expect(ops.execute(admin,BigInt(caseApp.id),reversal,key())).rejects.toThrow('already reversed');
  });

  it('links the USD400 AV8 insurance expense to actual supplier payment without a new student charge or remittance',async()=>{
    const caseApp=await app('insurance'),doc=await file(caseApp,'finance_evidence'),before=await detail(caseApp.id);
    const expenseAccount=await db.tenant(admin.tenantId,tx=>tx.account.create({data:{tenantId:admin.tenantId,code:`SYN-EXP-${key()}`,name:'Synthetic insurance expense',type:'EXPENSE'}}));
    const payment:any=await erp.createBankTransaction(admin,{branchId:caseApp.branchId||refs.branches[0].id,bankAccountId:refs.banks.find((b:any)=>b.currency==='EGP').id,counterpartyAccountId:String(expenseAccount.id),kind:'PAYMENT',amount:'20000',postingDate:'2026-10-31',description:'Synthetic documented insurance paid by AV8'});
    const body={kind:'expense',expenseType:'INSURANCE',amount:'400',currency:'USD',supplierId:refs.academies[0].id,refundEligible:false,eligibilityReason:'No approved expense deduction policy',invoiceReference:'Synthetic insurer invoice',reason:'Synthetic evidenced AV8 insurance'};
    const draft=await ops.execute(admin,BigInt(caseApp.id),{...body,status:'DRAFT'},key());
    await expect(ops.execute(admin,BigInt(caseApp.id),{...body,amount:'399',status:'DRAFT'},key())).rejects.toThrow('USD 400');
    const posted=await ops.execute(admin,BigInt(caseApp.id),{...body,priorId:draft.id,status:'PAID',evidenceId:doc.id,bankTransactionId:String(payment.id),paidAmount:'20000',paidCurrency:'EGP',usdRate:'0.02',paidAt:'2026-10-31',rateProvenance:'Actual documented synthetic 50 EGP/USD'},key());
    expect(posted.data.amountMinor).toBe('40000');expect(posted.data.refundEligible).toBe(false);
    const after=await detail(caseApp.id);expect(after.finance.totalMinor).toBe(before.finance.totalMinor);expect(after.finance.academyExpectedMinor).toBe(before.finance.academyExpectedMinor);expect(after.finance.funds).toHaveLength(before.finance.funds.length);
    expect((await ops.overview(affairs,BigInt(caseApp.id))as any).records.some((r:any)=>r.kind==='expense')).toBe(false);
  });

  it('keeps financial holds separate from academy suspension/resumption and preserves debt at graduation', async () => {
    const caseApp = await app('training'), doc = await file(caseApp);
    await record(caseApp, { kind: 'travel', status: 'DEPARTED', actualDeparture: '2026-01-31T12:00:00+02:00', exception: true });
    await ops.execute(affairs, BigInt(caseApp.id), { kind: 'training', status: 'STARTED', date: '2026-02-01', reason: 'Academy start confirmed' }, key());
    await ops.execute(affairs, BigInt(caseApp.id), { kind: 'training', status: 'SUSPENSION_REQUESTED', date: '2026-03-01', reason: 'Coordinate payment hold' }, key());
    await ops.execute(affairs, BigInt(caseApp.id), { kind: 'training', status: 'SUSPENDED', date: '2026-03-02', evidenceId: doc.id, reason: 'Academy confirmation received' }, key());
    await db.admin.av8Charge.updateMany({ where: { applicationId: BigInt(caseApp.id), key: 'APPLICATION' }, data: { dueDate: new Date('2026-01-01') } });
    await expect(ops.execute(affairs, BigInt(caseApp.id), { kind: 'training', status: 'RESUMPTION_REQUESTED', date: '2026-03-03', resolutionPolicy: 'ALL_OVERDUE_CLEARED', reason: 'Partial payment insufficient' }, key())).rejects.toThrow('Overdue');
    await ops.maintain(affairs); await ops.maintain(affairs);
    const current: any = await ops.overview(affairs, BigInt(caseApp.id)); expect(current.records.filter((r:any) => r.kind === 'financial-hold' && r.status === 'HOLD')).toHaveLength(1);
    await ops.execute(admin,BigInt(caseApp.id),{kind:'training',status:'RESUMPTION_REQUESTED',date:'2026-03-03',resolutionPolicy:'AUTHORIZED_EXCEPTION',exceptionReason:'Synthetic authorized payment resolution',reason:'Explicit permitted exception'},key());
    await ops.execute(admin,BigInt(caseApp.id),{kind:'training',status:'RESUMED',date:'2026-03-04',resolutionPolicy:'AUTHORIZED_EXCEPTION',exceptionReason:'Synthetic authorized payment resolution',evidenceId:doc.id,reason:'Academy confirmed actual resumption'},key());
    const before = await detail(caseApp.id);
    await ops.execute(admin, BigInt(caseApp.id), { kind: 'graduation', date: '2026-10-31', evidenceId: doc.id, notes: 'Financial account remains open', reason: 'Synthetic academic completion evidence' }, key());
    const after = await detail(caseApp.id); expect(after.finance.remainingMinor).toBe(before.finance.remainingMinor); expect(after.finance.remainingMinor).toBe('200000');
  });
});
