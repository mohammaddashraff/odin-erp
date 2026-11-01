import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Actor, AuthService } from './auth';
import { PrismaService } from './prisma.service';
import { application, atBranch, audit, av8ActorAtBranch, av8Scope, once, permits, requireAv8, Av8Tx } from './av8-access';
import { calendarDate, cairoCalendarDate, decimal, fail, missingDocuments, monthsAfter, positiveId, positiveMoney, text } from './av8-domain';
import { currencyAmount, convertMinor, parseFixed, serialize } from './money';
import { academicAddress, academicSender, academicEmailConfiguration, assertAcademicRecipient, retrieveAcademicEmail, sendAcademicEmail } from './av8-academic-email';
import { cairoDayStart, nextCalendarDate } from './av8-operations-domain';

const OPERATION_KINDS = ['eligibility','admission','training','financial-hold','graduation','service','service-charge','service-payment','service-payment-reversal','expense','report-version','academic-dispatch'];
const FINANCIAL_KINDS = ['service-charge','service-payment','expense'];
const json = (record: any): any => record?.data || {};
const period = (value: unknown) => { const result = text(value, 'Monthly period', true, 7); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) fail('Use a monthly period YYYY-MM'); return result; };
const currency = (value: unknown) => { const result = text(value, 'Currency', true, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) fail('Use an ISO currency code'); return result; };

@Injectable()
export class Av8OperationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(private readonly db: PrismaService, private readonly auth: AuthService) {}

  onModuleInit() {
    if(process.env.VERCEL==='1'||process.env.AV8_SCHEDULER_ENABLED==='true')return;
    if (process.env.AV8_ACADEMIC_WORKER_ENABLED !== 'true' && process.env.AV8_OPERATIONS_WORKER_ENABLED !== 'true') return;
    const configuration = academicEmailConfiguration();
    if (configuration.workerEnabled && !configuration.emailConfigured) throw new Error(configuration.issues.join('; '));
    const tick = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const actorFor = async (id: unknown) => {
          const user = await this.db.admin.user.findUnique({ where: { id: positiveId(id) }, include: this.auth.userInclude });
          if (!user?.active) throw new Error('Configured operational worker account is not active');
          return this.auth.actorFor(user);
        };
        if (process.env.AV8_OPERATIONS_WORKER_ENABLED === 'true') await this.maintain(await actorFor(process.env.AV8_OPERATIONS_WORKER_USER_ID));
        if (configuration.workerEnabled) await this.process(await actorFor(process.env.AV8_ACADEMIC_WORKER_USER_ID), 10);
      } catch { console.error(JSON.stringify({ event: 'av8.operations.worker.failed', message: 'Academic processing failed; inspect scoped delivery queue and configuration' })); }
      finally { this.busy = false; }
    };
    this.timer = setInterval(() => { void tick(); }, 30000);
    this.timer.unref();
    void tick();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async evidence(tx: Av8Tx, a: Actor, appId: bigint, evidenceId: unknown, allowedCategories?: string[]) {
    const file = await tx.av8Attachment.findFirst({ where: { tenantId: a.tenantId, applicationId: appId, id: String(evidenceId || '') } });
    if (!file || (allowedCategories && !allowedCategories.includes(file.category))) fail('Select authorized evidence attached to this student and operation');
    if (createHash('sha256').update(Buffer.from(file.content)).digest('hex') !== file.sha256) fail('Attachment integrity failed');
    return file;
  }

  async overview(a: Actor, id: bigint) {
    requireAv8(a, 'av8.applications.view');
    return serialize(await this.db.tenant(a.tenantId, async tx => {
      const app = await application(tx, a, id); a = av8ActorAtBranch(a, app.branchId);
      const finance = permits(a, 'av8.finance.view'), affairs = permits(a, 'av8.affairs.view');
      const rows = await tx.av8Record.findMany({ where: { tenantId: a.tenantId, applicationId: id, kind: { in: OPERATION_KINDS } }, orderBy: { id: 'desc' } });
      const records = rows.filter(r => FINANCIAL_KINDS.includes(r.kind) ? finance : affairs);
      const safe = records.map(r => r.kind === 'academic-dispatch' && !permits(a, 'av8.guardian.view') ? { ...r, data: { ...json(r), address: undefined, history: undefined } } : r);
      const services = affairs || finance ? rows.filter(r => r.kind === 'service').map(r => ({ id: r.id, status: r.status, ...json(r), charges: finance ? rows.filter(c => c.kind === 'service-charge' && json(c).serviceId === String(r.id)).map(c => {
        const paid = rows.filter(p => p.kind === 'service-payment' && p.status === 'RECORDED' && json(p).chargeId === String(c.id)).reduce((sum, p) => sum + BigInt(json(p).amountMinor), 0n);
        return { id: c.id, ...json(c), paidMinor: String(paid), remainingMinor: String(BigInt(json(c).amountMinor) - paid), outstandingMinor: String(BigInt(json(c).amountMinor) - paid) };
      }) : [] })) : [];
      return { records: safe, dispatches: safe.filter(r => r.kind === 'academic-dispatch').map(r => ({ id: r.id, status: r.status, ...json(r) })), services, configuration: academicEmailConfiguration() };
    }));
  }

  async report(a: Actor, kind: string, q: any = {}) {
    requireAv8(a, 'av8.reports.view');
    const financial = ['services','insurance'].includes(kind), permission = financial ? 'av8.finance.view' : 'av8.affairs.view';
    requireAv8(a, permission);
    const kinds: Record<string,string[]> = { services: ['service-charge','service-payment'], insurance: ['expense'], 'academic-delivery': ['academic-dispatch'], training: ['training','financial-hold'], graduation: ['graduation'] };
    if (!kinds[kind]) fail('Unknown operational report');
    const page = Math.max(1, Math.min(100000, Number(q.page) || 1)), size = 25;
    return serialize(await this.db.tenant(a.tenantId, async tx => {
      const scope = av8Scope(a, 'application', permission);
      const filter: any = { AND: [scope, ...(q.branchId ? [{ branchId: positiveId(q.branchId) }] : []), ...(q.search ? [{ OR: [{ reference: { contains: String(q.search).slice(0,100), mode: 'insensitive' } }, { customer: { name: { contains: String(q.search).slice(0,100), mode: 'insensitive' } } }] }] : [])] };
      const where: any = { tenantId: a.tenantId, application: { is: filter }, kind: { in: kinds[kind] }, ...(q.status ? { status: String(q.status) } : {}), ...(kind === 'insurance' ? { data: { path: ['expenseType'], equals: 'INSURANCE' } } : {}) };
      if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: cairoDayStart(q.from) } : {}), ...(q.to ? { lt: cairoDayStart(nextCalendarDate(q.to)) } : {}) };
      const records = await tx.av8Record.findMany({ where, include: { application: { include: { customer: { select: { name: true } } } } }, orderBy: { id: 'desc' }, skip: (page-1)*size, take: size });
      const rows = records.map(r => { const d = json(r), scoped = av8ActorAtBranch(a,r.application!.branchId); return { applicationId: String(r.applicationId), reference: r.application!.reference, name: r.application!.customer.name, kind: r.kind, status: r.status, period: d.period || null, date: r.createdAt.toISOString(), ...(financial ? { amountMinor: d.amountMinor, currency: d.currency, precision: d.precision || 2, provider: d.provider || d.supplierId, collectionParty: d.collectionParty || d.paidBy, evidenceId: d.evidenceId || null } : {}), ...(kind === 'academic-delivery' ? { recipientKind: d.recipientKind, address: permits(scoped,'av8.guardian.view') ? d.address : 'Restricted', attempts: d.attempts, providerReference: d.providerReference || null, lastError: d.lastError || null } : {}), ...(kind === 'training' ? { externalConfirmation: d.externalConfirmation || false } : {}) }; });
      return { rows, total: await tx.av8Record.count({ where }), page, size, dateBasis: 'recordCreatedAt', timezone: 'Africa/Cairo', currency: financial ? 'per row' : undefined };
    }));
  }

  execute(a: Actor, id: bigint, body: any, key: string) {
    const kind = String(body.kind), permission = ['service-charge','expense'].includes(kind) ? 'av8.finance.create' : ['service-payment','service-payment-reversal'].includes(kind) ? 'av8.finance.confirm' : 'av8.affairs.edit';
    if (!OPERATION_KINDS.includes(kind) || ['academic-dispatch','report-version','financial-hold'].includes(kind)) fail('Unknown student operation');
    requireAv8(a, permission);
    return once(this.db, a, `operations.${id}`, key, body, async tx => {
      const app = await application(tx, a, id, permission); a = av8ActorAtBranch(a, app.branchId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av8-operations:${a.tenantId}:${id}`}, 0))`;
      const reason = text(body.reason, 'Reason');
      const records = await tx.av8Record.findMany({ where: { tenantId: a.tenantId, applicationId: id }, orderBy: { id: 'desc' } });
      let expenseDraft: any = null;
      let data: any = { reason, actorId: String(a.userId) }, status = String(body.status || 'RECORDED'), recordKey = text(body.key || randomUUID(), 'Operation key', true, 120);
      if (kind === 'eligibility') {
        if (!['VERIFIED','REJECTED'].includes(status)) fail('Select the eligibility verification outcome');
        const file = await this.evidence(tx, a, id, body.evidenceId, ['document','ordinary','task','eligibility']);
        data = { ...data, criteria: text(body.criteria, 'Approved criteria / manual verification basis'), evidenceId: file.id, verifiedAt: new Date().toISOString() };
      } else if (kind === 'admission') {
        if (!['APPROVED','REJECTED'].includes(status)) fail('Select the admission decision');
        if (status === 'APPROVED') {
          if (app.medical !== 'PASSED') fail('Admission requires a verified medical pass');
          const eligibility = records.find(r => r.kind === 'eligibility');
          if (eligibility?.status !== 'VERIFIED') fail('Admission requires evidenced educational eligibility verification');
          const missing = missingDocuments(records);
          if (missing.length) fail(`Admission prerequisites incomplete: ${missing.join(', ')}`);
          data.eligibilityId = String(eligibility.id);
          data.verifiedDocuments = records.filter(r => r.kind === 'document').map(r => ({ id: String(r.id), status: r.status, evidenceIds: json(r).verifiedEvidenceIds || [] }));
        }
        data.decidedAt = new Date().toISOString();
        await tx.av8Application.update({ where: { id }, data: { admissions: status === 'APPROVED' ? 'ADMITTED' : 'ADMISSION_REJECTED' } });
      } else if (kind === 'training') {
        const current = records.find(r => r.kind === 'training');
        const transitions: Record<string, string[]> = { NONE: ['STARTED','SUSPENSION_REQUESTED'], STARTED: ['SUSPENSION_REQUESTED'], SUSPENSION_REQUESTED: ['SUSPENSION_NOTIFIED','SUSPENDED'], SUSPENSION_NOTIFIED: ['SUSPENDED'], SUSPENDED: ['RESUMPTION_REQUESTED'], RESUMPTION_REQUESTED: ['RESUMED','SUSPENDED'], RESUMED: ['SUSPENSION_REQUESTED'] };
        if (!transitions[current?.status || 'NONE']?.includes(status)) fail('Invalid training status transition');
        const date = calendarDate(body.date); if (date > cairoCalendarDate()) fail('Actual training event cannot be future dated');
        if (status === 'STARTED' && !app.departedAt) fail('Record actual travel before academy training starts');
        data = { ...data, date, previousId: current ? String(current.id) : null };
        if (['SUSPENDED','RESUMED'].includes(status)) data.evidenceId = (await this.evidence(tx, a, id, body.evidenceId, ['progress','task','training','ordinary'])).id;
        if (['RESUMPTION_REQUESTED','RESUMED'].includes(status)) {
          if (!['ALL_OVERDUE_CLEARED','AUTHORIZED_EXCEPTION'].includes(body.resolutionPolicy)) fail('Select the approved payment-resolution policy');
          data.resolutionPolicy = body.resolutionPolicy;
          const overdue = await tx.av8Charge.findMany({ where: { applicationId: id, dueDate: { lt: new Date(cairoCalendarDate()) } }, include: { allocations: { include: { fund: true } } } });
          const outstanding = overdue.reduce((sum, c) => sum + c.amountMinor - c.creditMinor - c.allocations.filter(x => x.fund.status === 'CLEARED').reduce((n, x) => n + x.amountMinor, 0n), 0n);
          if (body.resolutionPolicy === 'AUTHORIZED_EXCEPTION') { atBranch(a, 'av8.exceptions.approve', app.branchId); data.exceptionReason = text(body.exceptionReason, 'Authorized exception decision'); }
          else if (outstanding > 0n) fail('Overdue obligations remain; a partial payment does not authorize resumption');
          data.overdueMinorAtDecision = String(outstanding);
        }
        data.externalConfirmation = ['SUSPENDED','RESUMED'].includes(status);
      } else if (kind === 'graduation') {
        if (records.some(r => r.kind === 'graduation')) fail('Graduation already recorded; preserve the original and request an audited correction');
        const file = await this.evidence(tx, a, id, body.evidenceId, ['progress','task','graduation','ordinary']);
        const date = calendarDate(body.date); if (date > cairoCalendarDate()) fail('Graduation cannot be future dated');
        if (!records.some(r => r.kind === 'training' && ['STARTED','RESUMED'].includes(r.status))) fail('Record actual academy training before graduation');
        status = 'GRADUATED'; data = { ...data, date, evidenceId: file.id, notes: text(body.notes, 'Outstanding actions', false), financialBalancesPreserved: true };
      } else if (kind === 'service') {
        if (!['ACCOMMODATION','TRANSPORT'].includes(body.type)) fail('Select accommodation or transport');
        if (!['AV8','PROVIDER'].includes(body.collectionParty)) fail('Explicitly select the service payment recipient');
        const startDate = calendarDate(body.startDate), endDate = body.endDate ? calendarDate(body.endDate) : null;
        if (endDate && endDate < startDate) fail('Service end must be on or after start');
        const previous = records.find(r => r.kind === 'service' && json(r).serviceKey === recordKey);
        if (previous && startDate <= json(previous).startDate) fail('An agreement change needs a later effective date');
        const code = currency(body.currency), supported = await tx.currency.findFirst({ where: { tenantId: a.tenantId, code, active: true } });
        if (!supported) fail('Choose a supported service currency');
        const amountMinor = currencyAmount(body.amount, supported.precision); if (amountMinor <= 0n) fail('Monthly price must be positive');
        data = { ...data, serviceKey: recordKey, type: body.type, provider: text(body.provider, 'Provider'), startDate, endDate, amountMinor: String(amountMinor), currency: code, precision: supported.precision, collectionParty: body.collectionParty, frequency: 'MONTHLY', priorId: previous ? String(previous.id) : null, version: previous ? Number(json(previous).version) + 1 : 1 };
        recordKey = `${recordKey}:v${data.version}`; status = 'ACTIVE';
      } else if (kind === 'service-charge') {
        const service = records.find(r => r.kind === 'service' && String(r.id) === String(body.serviceId)); if (!service) fail('Service agreement not found');
        const agreement = json(service), month = period(body.period);
        if (month < agreement.startDate.slice(0, 7) || (agreement.endDate && month > agreement.endDate.slice(0, 7))) fail('Monthly charge is outside the agreed service period');
        const later = records.find(r => r.kind === 'service' && json(r).serviceKey === agreement.serviceKey && json(r).version > agreement.version && json(r).startDate.slice(0, 7) <= month);
        if (later) fail('Select the agreement version effective for this month');
        recordKey = `${agreement.serviceKey}:${month}`;
        if (records.some(r => r.kind === kind && r.key === recordKey)) fail('This monthly service charge already exists');
        data = { ...data, serviceId: String(service.id), serviceKey: agreement.serviceKey, period: month, amountMinor: agreement.amountMinor, currency: agreement.currency, precision: agreement.precision, collectionParty: agreement.collectionParty, provider: agreement.provider, type: agreement.type, agreementVersion: agreement.version };
        status = 'DUE';
      } else if (kind === 'service-payment') {
        const charge = records.find(r => r.kind === 'service-charge' && String(r.id) === String(body.chargeId)); if (!charge) fail('Monthly service charge not found');
        const amountMinor = currencyAmount(body.amount, Number(json(charge).precision ?? 2)), prior = records.filter(r => r.kind === kind && r.status === 'RECORDED' && json(r).chargeId === String(charge.id)).reduce((sum, r) => sum + BigInt(json(r).amountMinor), 0n);
        if (amountMinor <= 0n) fail('Service payment must be positive');
        if (amountMinor + prior > BigInt(json(charge).amountMinor)) fail('Service payment exceeds the outstanding monthly charge');
        const file = await this.evidence(tx, a, id, body.evidenceId, ['finance','finance_evidence','service-payment','expense']);
        const date = calendarDate(body.date); if (date > cairoCalendarDate()) fail('Service payment cannot be future dated');
        data = { ...data, chargeId: String(charge.id), amountMinor: String(amountMinor), currency: json(charge).currency, collectionParty: json(charge).collectionParty, date, evidenceId: file.id, fundId: null, usdMinor: null };
        if (data.collectionParty === 'AV8') {
          const fund = await tx.av8Fund.findFirst({ where: { tenantId: a.tenantId, applicationId: id, id: positiveId(body.fundId), kind: 'RECEIPT', status: 'CLEARED' }, include: { allocations: true } });
          if (!fund || fund.currency !== data.currency) fail('Select a cleared AV8 receipt in the service currency for this student');
          const usdMinor = convertMinor(amountMinor, Number(json(charge).precision ?? 2), 2, fund.usdRateMicros); if (usdMinor <= 0n) fail('Service payment converts to zero');
          const used = records.filter(r => r.kind === kind && r.status === 'RECORDED' && json(r).fundId === String(fund.id)).reduce((sum, r) => sum + BigInt(json(r).usdMinor), 0n);
          const refundInstructions=await tx.av8Fund.findMany({where:{tenantId:a.tenantId,applicationId:id,kind:'REFUND',status:{in:['PENDING','APPROVED','CLEARED']}}});
          const refundReserved=refundInstructions.flatMap(r=>(r.metadata as any)?.originalReceiptAllocations||[]).filter(e=>String(e.fundId)===String(fund.id)&&!e.chargeId).reduce((sum,e)=>sum+BigInt(e.usdMinor),0n);
          if (used + usdMinor + refundReserved + fund.allocations.reduce((sum, x) => sum + x.amountMinor, 0n) > fund.usdMinor) fail('Receipt funds are already allocated; do not reuse tuition money for services');
          data.fundId = String(fund.id); data.usdMinor = String(usdMinor);
        } else if (body.fundId) fail('Direct provider payments must not be recorded as AV8 cash');
        status = 'RECORDED';
      } else if (kind === 'service-payment-reversal') {
        const original=records.find(r=>r.kind==='service-payment'&&r.status==='RECORDED'&&String(r.id)===String(body.paymentId));
        if(!original||json(original).reversalOf||BigInt(json(original).amountMinor)<=0n)fail('Select an original recorded service payment');
        if(records.some(r=>r.kind==='service-payment'&&json(r).reversalOf===String(original.id)))fail('This service payment was already reversed');
        const file=await this.evidence(tx,a,id,body.evidenceId,['finance','finance_evidence','service-payment','expense']);
        const date=calendarDate(body.date);if(date>cairoCalendarDate())fail('Service correction cannot be future dated');
        const originalData=json(original);data={...originalData,reason,actorId:String(a.userId),reversalOf:String(original.id),amountMinor:String(-BigInt(originalData.amountMinor)),usdMinor:originalData.usdMinor?String(-BigInt(originalData.usdMinor)):null,date,evidenceId:file.id};
        recordKey=`reversal:${original.id}`;status='RECORDED';
      } else if (kind === 'expense') {
        if (!['DRAFT','PAID'].includes(status)) fail('Select draft or evidenced paid expense');
        if (!['INSURANCE','OTHER'].includes(body.expenseType)) fail('Select expense type');
        if (body.priorId) {
          expenseDraft = records.find(r => r.kind === 'expense' && r.status === 'DRAFT' && String(r.id) === String(body.priorId));
          if (!expenseDraft || status !== 'PAID') fail('Select an unpaid draft expense to record its actual payment');
          recordKey = `${expenseDraft.id}:paid`;
        }
        const amountMinor = positiveMoney(body.amount);
        if (body.expenseType === 'INSURANCE' && amountMinor !== 40000n) fail('Confirmed AV8 insurance amount is USD 400');
        if (currency(body.currency || 'USD') !== 'USD') fail('Record the expense basis in USD and retain actual payout currency separately');
        const supplier = await tx.supplier.findFirst({ where: { id: positiveId(body.supplierId), tenantId: a.tenantId, companyId: app.customer.companyId, active: true } });
        if (!supplier) fail('Select an active supplier in the student company');
        if (typeof body.refundEligible !== 'boolean') fail('Select refund eligibility explicitly; no expense is automatically deducted');
        data = { ...data, expenseType: body.expenseType, amountMinor: String(amountMinor), currency: 'USD', supplierId: String(supplier.id), paidBy: 'AV8', refundEligible: body.refundEligible, eligibilityReason: text(body.eligibilityReason, 'Expense eligibility basis'), invoiceReference: text(body.invoiceReference, 'Invoice / policy reference'), policyReference: text(body.policyReference, 'Policy reference', false), startDate: body.startDate ? calendarDate(body.startDate) : null, endDate: body.endDate ? calendarDate(body.endDate) : null, priorId: expenseDraft ? String(expenseDraft.id) : null };
        if (expenseDraft && ['amountMinor','supplierId','expenseType','invoiceReference'].some(field => json(expenseDraft)[field] !== data[field])) fail('Paid expense must match the original draft; record an explicit correction first');
        if (status === 'PAID') {
          atBranch(a, 'av8.finance.confirm', app.branchId);
          const file = await this.evidence(tx, a, id, body.evidenceId, ['finance','finance_evidence','expense']);
          const payment = await tx.bankTransaction.findFirst({ where: { tenantId: a.tenantId, id: positiveId(body.bankTransactionId), kind: 'PAYMENT', branchId: app.branchId, journalEntry: { status: 'POSTED' }, counterpartyAccount: { type: 'EXPENSE' } }, include: { bankAccount: true } });
          if (!payment) fail('Link an actual posted supplier expense payment in this branch');
          if (records.some(r => r.kind === 'expense' && r.status === 'PAID' && json(r).bankTransactionId === String(payment.id))) fail('This expense payment is already linked');
          const paidCurrency = currency(body.paidCurrency || payment.bankAccount.currency);
          const supportedCurrency=await tx.currency.findFirst({where:{tenantId:a.tenantId,code:paidCurrency,active:true}});if(!supportedCurrency)fail('Expense payout currency is not configured');
          const paidAmount = currencyAmount(body.paidAmount || body.amount,supportedCurrency.precision);if(paidAmount<=0n)fail('Actual expense payout must be positive');
          if (paidCurrency !== payment.bankAccount.currency || paidAmount !== payment.amountMinor) fail('Expense payout must match the linked bank movement');
          const usdRate = paidCurrency === 'USD' ? 1000000n : parseFixed(body.usdRate, 6, 'USD per payout currency');
          if (usdRate <= 0n || convertMinor(paidAmount,supportedCurrency.precision,2,usdRate) !== amountMinor) fail('The documented payout and historical rate must reconcile to the USD expense');
          data = { ...data, paidAt: calendarDate(body.paidAt), evidenceId: file.id, bankTransactionId: String(payment.id), paidAmountMinor: String(paidAmount), paidCurrency, usdRateMicros: String(usdRate), rateProvenance: text(body.rateProvenance || (paidCurrency === 'USD' ? 'USD identity' : ''), 'Actual conversion provenance') };
          if (data.paidAt > cairoCalendarDate()) fail('Actual expense payment cannot be future dated');
          if(data.paidAt!==payment.postingDate.toISOString().slice(0,10))fail('Actual expense paid date must match the posted bank movement');
        }
      }
      const record = await tx.av8Record.create({ data: { tenantId: a.tenantId, applicationId: id, kind:kind==='service-payment-reversal'?'service-payment':kind, key: recordKey, status, data: serialize(data), createdById: a.userId } });
      if (expenseDraft) await tx.av8Record.update({ where: { id: expenseDraft.id }, data: { status: 'PAID_LINKED', data: { ...json(expenseDraft), paidRecordId: String(record.id) } } });
      await tx.av8Application.update({ where: { id }, data: { version: { increment: 1 } } });
      await audit(tx, a, `OPERATION_${kind.toUpperCase()}_${status}`, 'APPLICATION', id, app.branchId, { recordId: String(record.id), ...data });
      return record;
    });
  }

  async reviewedReport(tx: Av8Tx, a: Actor, app: any, report: any, data: any) {
    if (!data.source || (!data.examResults && !data.trainingProgress && !data.examRows?.length)) fail('Record the academy source and meaningful academic results before review');
    const files = await tx.av8Attachment.findMany({ where: { tenantId: a.tenantId, applicationId: app.id, recordId: report.id, category: 'progress' }, orderBy: { createdAt: 'desc' } });
    const ids: string[] = Array.isArray(data.evidenceIds) && data.evidenceIds.length ? data.evidenceIds : files.slice(0, 1).map(f => f.id);
    if (!ids.length || ids.some(id => !files.some(f => f.id === id))) fail('Upload the original academy report and select its evidence before review');
    const version = Number(data.revision || 1);
    const previous = await tx.av8Record.findFirst({ where: { applicationId: app.id, kind: 'report-version', key: `${report.key}:v${version}` } });
    if (previous) return previous;
    const snapshot = await tx.av8Record.create({ data: { tenantId: a.tenantId, applicationId: app.id, kind: 'report-version', key: `${report.key}:v${version}`, status: 'REVIEWED', data: serialize({ ...data, reportId: String(report.id), period: report.key, version, evidenceIds: ids, reviewerId: String(a.userId), reviewedAt: new Date().toISOString() }), createdById: a.userId } });
    await this.enqueue(tx, a, app, snapshot);
    return snapshot;
  }

  private async enqueue(tx: Av8Tx, a: Actor, app: any, report: any) {
    const configuration = academicEmailConfiguration();
    const result: any[] = [];
    for (const recipientKind of ['STUDENT','GUARDIAN']) {
      const key = `${report.id}:${recipientKind}`;
      const existing = await tx.av8Record.findFirst({ where: { applicationId: app.id, kind: 'academic-dispatch', key } });
      if (existing && !['BLOCKED_CONTACT','BLOCKED_CONFIGURATION'].includes(existing.status)) { result.push(existing); continue; }
      let address = '', error = '';
      try { address = academicAddress(recipientKind === 'STUDENT' ? app.customer.email : app.guardian?.email); } catch { error = 'Valid recipient email is required'; }
      if (recipientKind === 'GUARDIAN' && !app.guardian?.sharingScope?.includes('PROGRESS')) error = 'Guardian progress sharing consent is required';
      const status = error ? 'BLOCKED_CONTACT' : configuration.emailConfigured ? 'QUEUED' : 'BLOCKED_CONFIGURATION';
      const data = { ...json(existing), reportId: String(report.id), period: json(report).period, version: json(report).version, recipientKind, address, subject: `AV8 academic report ${app.reference} · ${json(report).period} · v${json(report).version}`, attempts: 0, lastError: error || (status === 'BLOCKED_CONFIGURATION' ? 'Academic email provider is not configured/enabled' : null), nextAttemptAt: new Date().toISOString(), queuedById: String(a.userId), history: json(existing).history || [] };
      result.push(existing ? await tx.av8Record.update({ where: { id: existing.id }, data: { status, data } }) : await tx.av8Record.create({ data: { tenantId: a.tenantId, applicationId: app.id, kind: 'academic-dispatch', key, status, data, createdById: a.userId } }));
    }
    return result;
  }

  queue(a: Actor, id: bigint, reportId: bigint, key: string) {
    requireAv8(a, 'av8.affairs.edit');
    return once(this.db, a, `academic.queue.${id}.${reportId}`, key, {}, async tx => {
      const app = await application(tx, a, id, 'av8.affairs.edit'); a = av8ActorAtBranch(a, app.branchId); atBranch(a, 'av8.guardian.view', app.branchId);
      const report = await tx.av8Record.findFirst({ where: { tenantId: a.tenantId, applicationId: id, id: reportId, kind: 'report-version', status: 'REVIEWED' } });
      if (!report) fail('Select an immutable reviewed report version');
      const result = await this.enqueue(tx, a, app, report);
      await audit(tx, a, 'ACADEMIC_QUEUED', 'APPLICATION', id, app.branchId, { reportId: String(reportId), dispatchIds: result.map(r => String(r.id)) });
      return result;
    });
  }

  async dispatchAction(a: Actor, id: bigint, dispatchId: bigint, body: any, key: string) {
    requireAv8(a, 'av8.affairs.edit');
    if (body.action === 'reconcile') {
      const dispatch = await this.db.tenant(a.tenantId, async tx => { await application(tx, a, id, 'av8.affairs.edit'); return tx.av8Record.findFirst({ where: { id: dispatchId, tenantId: a.tenantId, applicationId: id, kind: 'academic-dispatch' } }); });
      if (!dispatch) fail('Dispatch not found');
      const d = json(dispatch);
      const evidence = await retrieveAcademicEmail(String(body.providerReference || d.providerReference || ''), d.address, d.subject);
      return once(this.db, a, `academic.reconcile.${dispatchId}`, key, body, async tx => {
        const app = await application(tx, a, id, 'av8.affairs.edit');
        const current = await tx.av8Record.findFirstOrThrow({ where: { id: dispatchId, applicationId: id, tenantId: a.tenantId } });
        if (current.status === 'SENDING') fail('Worker currently owns this dispatch');
        const updated = await tx.av8Record.update({ where: { id: dispatchId }, data: { status: evidence.status, data: { ...json(current), ...evidence, history: [...(json(current).history || []), { status: evidence.status, date: evidence.verifiedAt, reason: text(body.reason, 'Reconciliation reason'), source: 'PROVIDER_RETRIEVAL' }] } } });
        await audit(tx, a, 'ACADEMIC_RECONCILED', 'APPLICATION', id, app.branchId, { dispatchId: String(dispatchId), providerReference: evidence.providerReference, status: evidence.status }); return updated;
      });
    }
    return once(this.db, a, `academic.retry.${dispatchId}`, key, body, async tx => {
      const app = await application(tx, a, id, 'av8.affairs.edit');
      const dispatch = await tx.av8Record.findFirst({ where: { id: dispatchId, tenantId: a.tenantId, applicationId: id, kind: 'academic-dispatch' } });
      if (!dispatch || body.action !== 'retry' || !['FAILED','BLOCKED_CONFIGURATION','BLOCKED_CONTACT'].includes(dispatch.status)) fail('Only confirmed failed or configuration/contact-blocked dispatches can be retried; reconcile unknown outcomes first');
      const d = json(dispatch); if (d.recipientKind === 'GUARDIAN') atBranch(a, 'av8.guardian.view', app.branchId);
      const address = academicAddress(d.recipientKind === 'STUDENT' ? app.customer.email : (app.guardian as any)?.email);
      if (d.recipientKind === 'GUARDIAN' && !(app.guardian as any)?.sharingScope?.includes('PROGRESS')) fail('Guardian progress sharing consent is required');
      assertAcademicRecipient(address);
      const reason = text(body.reason, 'Retry reason');
      const history = [...(d.history || []), { status: dispatch.status, address: d.address, date: new Date().toISOString(), reason }];
      const updated = await tx.av8Record.update({ where: { id: dispatchId }, data: { status: 'QUEUED', data: { ...d, address, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * 2 ** Math.min(10, Number(d.attempts || 0)))).toISOString(), history, lastError: null, retryGeneration: Number(d.retryGeneration || 0) + 1 } } });
      await audit(tx, a, 'ACADEMIC_RETRY_QUEUED', 'APPLICATION', id, app.branchId, { dispatchId: String(dispatchId), reason }); return updated;
    });
  }

  async process(a: Actor, requestedLimit = 10) {
    requireAv8(a, 'av8.affairs.edit');
    const configuration = academicEmailConfiguration(); if (!configuration.emailConfigured) fail(configuration.issues.join('; ') || 'Academic email is disabled');
    const limit = Math.min(50, Math.max(1, Math.trunc(requestedLimit))), results: any[] = [];
    for (let i = 0; i < limit; i++) {
      const claimed = await this.db.tenant(a.tenantId, async tx => {
        const candidates = await tx.av8Record.findMany({ where: { tenantId: a.tenantId, application: { is: av8Scope(a, 'application', 'av8.affairs.edit') }, kind: 'academic-dispatch', status: { in: ['QUEUED','SENDING'] } }, orderBy: { id: 'asc' }, take: 100 });
        for (const row of candidates) {
          const d = json(row), now = Date.now();
          if (row.status === 'SENDING') {
            if (Date.parse(d.leaseUntil || '') < now) await tx.av8Record.updateMany({ where: { id: row.id, status: 'SENDING', updatedAt: row.updatedAt }, data: { status: 'DELIVERY_UNKNOWN', data: { ...d, lastError: 'Worker lease expired after possible provider acceptance; reconcile before retry' } } });
            continue;
          }
          if (Date.parse(d.nextAttemptAt) > now) continue;
          const app = await application(tx, a, row.applicationId!, 'av8.affairs.edit');
          if (d.recipientKind === 'GUARDIAN') atBranch(a, 'av8.guardian.view', app.branchId);
          const consent = d.recipientKind !== 'GUARDIAN' || (app.guardian as any)?.sharingScope?.includes('PROGRESS');
          let currentAddress:string|null=null;try{currentAddress=academicAddress(d.recipientKind==='GUARDIAN'?(app.guardian as any)?.email:app.customer.email);}catch{}
          if (!consent || currentAddress!==d.address) { await tx.av8Record.update({ where: { id: row.id }, data: { status: 'BLOCKED_CONTACT', data: { ...d, lastError: 'Contact or guardian sharing consent changed before dispatch; review and retry explicitly' } } }); continue; }
          try { assertAcademicRecipient(d.address); } catch { await tx.av8Record.update({ where: { id: row.id }, data: { status: 'BLOCKED_CONFIGURATION', data: { ...d, lastError: 'Provider configuration or controlled recipient allowlist prevents sending' } } }); continue; }
          const report = await tx.av8Record.findFirstOrThrow({ where: { tenantId: a.tenantId, applicationId: row.applicationId, id: positiveId(d.reportId), kind: 'report-version', status: 'REVIEWED' } });
          const snapshot = json(report), attachmentIds: string[] = snapshot.evidenceIds || [];
          const files = await tx.av8Attachment.findMany({ where: { tenantId: a.tenantId, applicationId: row.applicationId!, id: { in: attachmentIds }, category: 'progress', recordId: positiveId(snapshot.reportId) } });
          if (!files.length || files.length !== attachmentIds.length || files.some(file=>createHash('sha256').update(Buffer.from(file.content)).digest('hex')!==file.sha256)) {
            await tx.av8Record.update({where:{id:row.id},data:{status:'FAILED',data:{...d,lastError:'APPROVED_EVIDENCE_INTEGRITY_FAILED; review original report and create a corrected version'}}});
            await audit(tx,a,'ACADEMIC_EVIDENCE_FAILURE','APPLICATION',app.id,app.branchId,{dispatchId:String(row.id),reportId:String(report.id)});continue;
          }
          const claimId = randomUUID(), updated = await tx.av8Record.updateMany({ where: { id: row.id, status: 'QUEUED', updatedAt: row.updatedAt }, data: { status: 'SENDING', data: { ...d, claimId, leaseUntil: new Date(now + 120000).toISOString(), attempts: Number(d.attempts || 0) + 1, lastAttemptAt: new Date(now).toISOString() } } });
          if (!updated.count) continue;
          const academicEntries=(entries:any[]) => (entries||[]).map(entry=>typeof entry==='string'?entry:[entry.name,entry.result,entry.date].filter(Boolean).join(' · ')).join('\n');
          const textBody = [`AV8 · ${app.customer.name}`, `Academic reporting period: ${snapshot.period}`, `Academy/source: ${snapshot.source}`, `Exam results: ${snapshot.examResults || ''}`, snapshot.examRows?.length ? `Exam details:\n${academicEntries(snapshot.examRows)}` : '', snapshot.qualifications?.length ? `Qualifications / milestones:\n${academicEntries(snapshot.qualifications)}` : '', `Training progress: ${snapshot.trainingProgress || ''}`, `Completion: ${snapshot.trainingPercent ?? 'Not supplied'}`, snapshot.flightHours === undefined ? '' : `Flight hours: ${snapshot.flightHours}`, snapshot.studyHours === undefined ? '' : `Study hours: ${snapshot.studyHours}`, `Notes: ${snapshot.issues || ''}`,snapshot.followups ? `Follow-up actions: ${snapshot.followups}` : ''].filter(Boolean).join('\n');
          return { row, claimId, branchId: app.branchId, identity: `${a.tenantId}:${row.id}:${d.retryGeneration || 0}`, message: { from: academicSender(process.env.AV8_ACADEMIC_EMAIL_FROM), to: [d.address], subject: d.subject, text: textBody, attachments: files.map(f => ({ filename: f.filename, content: Buffer.from(f.content).toString('base64') })) } };
        }
        return null;
      });
      if (!claimed) break;
      // External send is outside the retryable database transaction.
      const outcome = await sendAcademicEmail(claimed.identity, claimed.message);
      await this.db.tenant(a.tenantId, async tx => {
        const current = await tx.av8Record.findUniqueOrThrow({ where: { id: claimed.row.id } }); const d = json(current);
        if (current.status !== 'SENDING' || d.claimId !== claimed.claimId) return;
        const date = new Date().toISOString();
        await tx.av8Record.update({ where: { id: current.id }, data: { status: outcome.status, data: { ...d, leaseUntil: null, providerReference: outcome.providerReference || null, lastError: outcome.status === 'ACCEPTED' ? null : outcome.code, history: [...(d.history || []), { status: outcome.status, code: outcome.code, date, providerReference: outcome.providerReference || null }] } } });
        await audit(tx, a, `ACADEMIC_${outcome.status}`, 'APPLICATION', claimed.row.applicationId!, claimed.branchId, { dispatchId: String(current.id), providerReference: outcome.providerReference || null, code: outcome.code });
      });
      results.push({ dispatchId: String(claimed.row.id), ...outcome });
    }
    return { processed: results.length, results };
  }

  /** Recomputable queues + durable per-period records; no financial posting or external suspension. */
  async maintain(a: Actor, options:{limit?:number;afterId?:string|null} = {}) {
    requireAv8(a, 'av8.affairs.edit');
    let cursor: bigint | undefined=options.afterId?positiveId(options.afterId):undefined, count = 0,nextCursor:string|null=null;
    const limit=options.limit===undefined?Number.MAX_SAFE_INTEGER:Math.min(50,Math.max(1,Math.trunc(options.limit)));
    const today = cairoCalendarDate();
    for (;;) {
      const pageSize=Math.min(50,limit-count);
      const page = await this.db.tenant(a.tenantId, tx => tx.av8Application.findMany({ where: av8Scope(a, 'application', 'av8.affairs.edit'), orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } }));
      if (!page.length) break;
      for (const { id } of page) await this.db.tenant(a.tenantId, async tx => {
        const app = await application(tx, a, id, 'av8.affairs.edit');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av8-operations:${a.tenantId}:${id}`}, 0))`;
        const records = await tx.av8Record.findMany({ where: { applicationId: id, tenantId: a.tenantId }, orderBy: { id: 'desc' } });
        if (app.departedAt && !records.some(r => r.kind === 'graduation')) {
          const anchor = cairoCalendarDate(app.departedAt), months = Math.min(120, Math.max(12, (Number(today.slice(0,4)) - Number(anchor.slice(0,4))) * 12 + Number(today.slice(5,7)) - Number(anchor.slice(5,7)) + 2));
          for (let i = 1; i <= months; i++) {
            const dueDate = monthsAfter(anchor, i), key = dueDate.slice(0,7);
            await tx.av8Record.upsert({ where: { applicationId_kind_key: { applicationId: id, kind: 'progress', key } }, update: {}, create: { tenantId: a.tenantId, applicationId: id, kind: 'progress', key, status: 'EXPECTED', data: { period: key, dueDate, ownerId: String(app.ownerId), examResults: null, trainingProgress: null }, createdById: a.userId } });
          }
        }
        const charges = await tx.av8Charge.findMany({ where: { applicationId: id, dueDate: { lt: new Date(today) } }, include: { allocations: { include: { fund: true } } } });
        const overdue = charges.some(c => c.amountMinor - c.creditMinor - c.allocations.filter(x => x.fund.status === 'CLEARED').reduce((s,x) => s+x.amountMinor,0n) > 0n);
        const current = records.find(r => r.kind === 'financial-hold');
        const status = overdue ? 'HOLD' : 'RESOLVED';
        if ((overdue || current) && current?.status !== status) {
          await tx.av8Record.create({ data: { tenantId: a.tenantId, applicationId: id, kind: 'financial-hold', key: randomUUID(), status, data: { observedDate: today, ownerId: String(app.ownerId), reason: overdue ? 'Overdue contractual obligation; staff must coordinate academy suspension' : 'Overdue obligation cleared; academy resumption still requires confirmation', externalTrainingChanged: false }, createdById: a.userId } });
          await audit(tx, a, `FINANCIAL_HOLD_${status}`, 'APPLICATION', id, app.branchId, { observedDate: today, externalTrainingChanged: false });
        }
        for (const refund of records.filter(r => r.kind === 'refund' && json(r).deadline && json(r).deadline < today && !['PAID','REJECTED','CANCELLED'].includes(r.status))) {
          const key = `refund-deadline:${refund.id}`;
          await tx.av8Record.upsert({ where: { applicationId_kind_key: { applicationId: id, kind: 'task', key } }, update: {}, create: { tenantId: a.tenantId, applicationId: id, kind: 'task', key, status: 'OPEN', data: { title: 'Refund deadline requires escalation', ownerId: String(app.ownerId), dueDate: json(refund).deadline, refundId: String(refund.id), reason: 'Original contractual deadline remains visible while academy recovery is pending' }, createdById: a.userId } });
        }
      });
      count += page.length; cursor = page[page.length-1].id;
      if(page.length<pageSize)break;
      if(count>=limit){nextCursor=String(cursor);break;}
    }
    return { checkedApplications: count, date: today, externalActions: 0,nextCursor };
  }
}
