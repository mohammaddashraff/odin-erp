import { createHash } from 'node:crypto';
import { calendarDate, cairoCalendarDate, fail, text } from './av8-domain';
import { convertMinor, serialize } from './money';

export const openingHash = (value: unknown) => createHash('sha256').update(JSON.stringify(serialize(value))).digest('hex');
export function openingMinor(value: unknown, field: string, signed = false): bigint {
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(String(value)) || String(value).length > 18) fail(`${field} must be an exact integer minor-unit string`);
  return BigInt(String(value));
}
export function openingList(value: unknown, field: string, max = 500): any[] {
  if (!Array.isArray(value) || value.length > max) fail(`${field} must be an array with at most ${max} rows`);
  return value;
}
export function validateOpeningManifest(input: any, precisions: Record<string,number>) {
  if (input?.version !== 1) fail('Opening manifest version must be 1');
  const sourceSystem = text(input.sourceSystem, 'Source system', true, 80), cutoff = calendarDate(input.cutoverDate);
  if(cutoff>cairoCalendarDate())fail('Opening cutover cannot be future dated');
  const applications = openingList(input.applications, 'Applications', 200);
  if (!applications.length) fail('Import at least one application');
  const errors: any[] = [], ids = new Set<string>(), globalFunds = new Set<string>();
  const totals = { studentContractMinor: 0n, studentPaidMinor: 0n, studentOutstandingMinor: 0n, academyEntitlementMinor: 0n, academyTransferredMinor: 0n };
  const add = (path: string, check: () => void) => { try { check(); } catch (error: any) { errors.push({ path, message: error?.message || 'Invalid source value' }); } };
  applications.forEach((row, index) => add(`applications[${index}]`, () => {
    const sourceId = text(row.sourceId, 'Application source ID', true, 100);
    if(row.admissions && !['ADMITTED','IMPORTED_REVIEW_REQUIRED'].includes(row.admissions))fail('Imported admissions must be admitted or review required');
    if(row.medical && !['PASSED','FAILED','PENDING','IN_PROGRESS'].includes(row.medical))fail('Imported medical state invalid');
    if(row.visa && !['PREPARING','SUBMITTED','APPROVED','REJECTED'].includes(row.visa))fail('Imported visa state invalid');
    if(row.travel && !['PREPARING','BOOKED','DEPARTED','ARRIVED'].includes(row.travel))fail('Imported travel state invalid');
    if(row.departedAt && (Number.isNaN(new Date(row.departedAt).getTime()) || new Date(row.departedAt).toISOString().slice(0,10)>cutoff))fail('Original departure date invalid');
    if(row.inquiryDate && calendarDate(row.inquiryDate)>cutoff)fail('Original enquiry must be on or before cutover');
    if (ids.has(sourceId)) fail('Application source ID is repeated within the file'); ids.add(sourceId);
    text(row.personSourceId, 'Person source ID', true, 100); text(row.name, 'Student name', true, 160); text(row.phone, 'Student phone', true, 40); text(row.reference, 'Original application reference', true, 100);
    const schedule = openingList(row.schedule, 'Original schedule', 120), receipts = openingList(row.receipts || [], 'Historical receipts'), obligations = openingList(row.academyObligations || [], 'Academy obligations'), transfers = openingList(row.remittances || [], 'Historical academy transfers');
    if (!schedule.length) fail('The original application/contract schedule is required');
    const chargeIds = new Set<string>(), chargePaid = new Map<string,bigint>(), obligationIds = new Set<string>(), obligationPaid = new Map<string,bigint>();
    let total = 0n, paid = 0n, credits = 0n, academy = 0n, transferred = 0n;
    for (const charge of schedule) {
      const id = text(charge.sourceId, 'Charge source ID', true, 100); if (chargeIds.has(id)) fail('Charge source ID repeated'); chargeIds.add(id);
      const amount = openingMinor(charge.amountMinor, 'Charge amount'), credit = openingMinor(charge.creditMinor || '0', 'Charge credit'); if (amount <= 0n || credit > amount) fail('Original charge and credit amounts are invalid');
      text(charge.label,'Original charge label');
      if (charge.currency !== 'USD') fail('Tuition schedule must be USD; services have a separate currency');
      if (charge.dueDate) calendarDate(charge.dueDate); total += amount; credits += credit;
    }
    const fundIds = new Set<string>();
    for (const [kind, funds] of [['RECEIPT', receipts], ['REMITTANCE', transfers]] as const) for (const fund of funds) {
      const id = text(fund.sourceId, 'Historical fund source ID', true, 100); if (fundIds.has(id) || globalFunds.has(id)) fail('Historical fund source ID repeated across the source file'); fundIds.add(id); globalFunds.add(id);
      text(fund.reference,'Original payment reference'); text(fund.rateProvenance,'Historical rate provenance');
      const date = calendarDate(fund.date), rateDate = calendarDate(fund.rateDate); if (date > cutoff || rateDate > cutoff) fail('Historical payment dates must be on or before cutover');
      if (fund.confirmed !== true) fail('Only source-confirmed cleared payments belong in paid opening history; import pending evidence separately');
      if (!['BANK','CASH','CHEQUE'].includes(fund.method)) fail('Historical method must be bank, cash or confirmed-cleared cheque');
      const precision = precisions[fund.currency]; if (precision === undefined) fail('Historical payment currency is not configured');
      if (kind === 'REMITTANCE' && fund.currency !== 'USD') fail('Historical academy remittances must be USD');
      const amount = openingMinor(fund.amountMinor, 'Historical original amount'), usd = openingMinor(fund.usdMinor, 'Historical USD credit'), rate = openingMinor(fund.usdRateMicros, 'USD rate');
      if(fund.currency==='USD'&&rate!==1000000n)fail('USD historical receipts require the identity USD rate');
      if (amount <= 0n || usd <= 0n || rate <= 0n || openingMinor(fund.baseRateMicros, 'Base rate') <= 0n || convertMinor(amount,precision,2,rate) !== usd) fail('Original amount/rate/USD credit do not reconcile');
      const allocated = openingList(fund.allocations || [], 'Historical allocations').reduce((sum, allocation) => {
        const allocationAmount = openingMinor(allocation.amountMinor, 'Allocation amount'); if (allocationAmount <= 0n) fail('Historical allocation must be positive');
        const source = text(allocation.sourceId, 'Allocated charge/obligation source ID', true, 100), target = kind === 'RECEIPT' ? chargePaid : obligationPaid;
        target.set(source, (target.get(source) || 0n) + allocationAmount); return sum + allocationAmount;
      },0n);
      if (allocated > usd) fail('Allocations exceed historical cleared payment');
      if (kind === 'REMITTANCE' && allocated !== usd) fail('Historical transfer must identify its complete original academy allocation');
      if (kind === 'RECEIPT') paid += allocated; else transferred += allocated;
    }
    for (const charge of schedule) {
      const actual = chargePaid.get(charge.sourceId) || 0n;
      if (actual !== openingMinor(charge.paidMinor || '0', 'Source charge paid amount')) fail('Historical receipt allocations do not equal the source paid schedule');
      if (actual > openingMinor(charge.amountMinor,'Charge') - openingMinor(charge.creditMinor || '0','Credit')) fail('Historical allocation exceeds original charge');
    }
    for (const id of chargePaid.keys()) if (!chargeIds.has(id)) fail('Receipt allocation references an unknown original charge');
    for (const obligation of obligations) {
      const id = text(obligation.sourceId,'Academy source ID',true,100); if (obligationIds.has(id)) fail('Academy source ID repeated'); obligationIds.add(id);
      const amount = openingMinor(obligation.amountMinor,'Academy entitlement'), paid = obligationPaid.get(id) || 0n; if (amount <= 0n || paid > amount) fail('Historical academy allocation exceeds entitlement');
      if (paid !== openingMinor(obligation.paidMinor || '0','Transferred amount')) fail('Academy transfer allocations do not reconcile to source');
      if(obligation.dueDate)calendarDate(obligation.dueDate); academy += amount;
    }
    for (const id of obligationPaid.keys()) if (!obligationIds.has(id)) fail('Academy transfer references an unknown entitlement');
    if(schedule.some((c:any)=>c.deferred===true)&&(!row.contract?.settlement||row.contract.settlement.deferredPassThrough!==true||!String(row.contract.settlement.approvalReference||'').trim()))fail('Deferred original charges require explicit approved source pass-through treatment and reference');
    if (row.contract) {
      calendarDate(row.contract.signedDate); if (row.contract.signedDate > cutoff) fail('Signed contract cannot be after cutover');
      text(row.contract.reference,'Signed contract reference'); if (!row.contract.document?.base64) fail('Preserve the original signed contract document');
      if (!['A','B','CASH'].includes(row.contract.planKey)) fail('Select the actual signed plan identifier');
    }
    const serviceIds=new Set<string>();
    for (const service of openingList(row.services || [],'Historical services',120)) {
      text(service.sourceId,'Service source ID',true,100); text(service.provider,'Service provider'); if(serviceIds.has(service.sourceId))fail('Service source ID repeated');serviceIds.add(service.sourceId); if(!['ACCOMMODATION','TRANSPORT'].includes(service.type)||!['AV8','PROVIDER'].includes(service.collectionParty))fail('Historical service type/recipient must be explicit');
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(service.period))fail('Service period must be YYYY-MM');
      if(service.startDate)calendarDate(service.startDate);if(service.endDate)calendarDate(service.endDate);if(service.startDate&&service.endDate&&service.endDate<service.startDate)fail('Historical service end precedes start');
      if(service.period>cutoff.slice(0,7))fail('Opening services cannot be after cutover');
      if(openingMinor(service.amountMinor,'Service charge')<=0n)fail('Service charge must be positive');
      if(precisions[service.currency]===undefined)fail('Service currency is not configured');
      if(openingMinor(service.paidMinor||'0','Service paid')>openingMinor(service.amountMinor,'Service charge'))fail('Historical service payment exceeds charge');
      if(BigInt(service.paidMinor||'0')>0n)text(service.evidenceReference,'Original service payment evidence');
      if(service.collectionParty==='AV8'&&BigInt(service.paidMinor||'0')>0n){ const receipt=receipts.find((f:any)=>f.sourceId===service.receiptSourceId);if(!receipt||receipt.currency!==service.currency)fail('Historical AV8 service payment must link a confirmed receipt in the same currency'); }
    }
    for(const receipt of receipts){const serviceCredit=(row.services||[]).filter((v:any)=>v.collectionParty==='AV8'&&v.receiptSourceId===receipt.sourceId).reduce((sum:bigint,v:any)=>sum+convertMinor(BigInt(v.paidMinor||'0'),precisions[v.currency],2,BigInt(receipt.usdRateMicros)),0n);const tuition=(receipt.allocations||[]).reduce((sum:bigint,v:any)=>sum+BigInt(v.amountMinor),0n);if(tuition+serviceCredit>BigInt(receipt.usdMinor))fail('Historical tuition and service allocations exceed their receipt');}
    const refundIds=new Set<string>();
    for (const refund of openingList(row.pendingRefunds || [],'Pending refunds',100)) {
      text(refund.sourceId,'Refund source ID',true,100);if(refundIds.has(refund.sourceId))fail('Pending refund source ID repeated');refundIds.add(refund.sourceId); calendarDate(refund.terminationDate); calendarDate(refund.deadline); if(openingMinor(refund.amountMinor,'Pending refund')<=0n)fail('Pending refund must be positive'); text(refund.policyReference,'Original refund policy reference');
    }
    totals.studentContractMinor += total - credits; totals.studentPaidMinor += paid; totals.studentOutstandingMinor += total - credits - paid; totals.academyEntitlementMinor += academy; totals.academyTransferredMinor += transferred;
  }));
  for (const [field,value] of Object.entries(totals)) add(`expectedTotals.${field}`, () => { if(openingMinor(input.expectedTotals?.[field],field)!==value)fail(`Source control total differs from calculated ${value}`); });
  const counts={applications:applications.length,people:new Set(applications.map(a=>a?.personSourceId).filter(Boolean)).size,contracts:applications.filter(a=>a?.contract).length,charges:applications.reduce((n,a)=>n+(Array.isArray(a?.schedule)?a.schedule.length:0),0),receipts:applications.reduce((n,a)=>n+(a?.receipts?.length||0),0),remittances:applications.reduce((n,a)=>n+(a?.remittances?.length||0),0),obligations:applications.reduce((n,a)=>n+(a?.academyObligations?.length||0),0),services:applications.reduce((n,a)=>n+(a?.services?.length||0),0),pendingRefunds:applications.reduce((n,a)=>n+(a?.pendingRefunds?.length||0),0)};
  return { sourceSystem, cutoff, errors, counts, totals: serialize(totals), applications, previewHash: openingHash(input) };
}
