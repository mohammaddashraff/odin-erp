import { BadRequestException } from '@nestjs/common';
import { money } from './money';

export function fail(message: string): never { throw new BadRequestException(message); }
export function failField(field: string, message: string, messageAr?: string): never {
  throw new BadRequestException({ message, messageAr, field });
}
export const text = (value: unknown, label: string, required = true, max = 2000): string => {
  const s = String(value ?? '').trim();
  if ((required && !s) || s.length > max) fail(`${label} is required and must be at most ${max} characters`);
  return s;
};
export const positiveId = (value: unknown): bigint => {
  if (!/^[1-9]\d{0,17}$/.test(String(value))) fail('A valid record identifier is required');
  return BigInt(String(value));
};
export function calendarDate(value: unknown): string {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s) fail('Use a valid calendar date (YYYY-MM-DD)');
  return s;
}
export const cairoCalendarDate=(value:Date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',numberingSystem:'latn'}).format(value);
export function instant(value: unknown): Date {
  const s = String(value || '');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s) || !Number.isFinite(Date.parse(s))) fail('Date/time must include a timezone offset');
  return new Date(s);
}
export function monthsAfter(anchor: string, months: number): string {
  calendarDate(anchor);
  if (!Number.isInteger(months) || months < 0 || months > 600) fail('Month offset must be an integer from 0 to 600');
  const d = new Date(`${anchor}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return d.toISOString().slice(0,10);
}
export const positiveMoney = (value: unknown) => { const n = money(value); if (n <= 0n || n > 100_000_000_000n) fail('Amount must be positive and within the supported limit'); return n; };
export const decimal = (n: bigint | string) => { const x=BigInt(n), a=x<0n?-x:x; return `${x<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`; };
export function splitMinor(total: bigint, count: number) {
  return Array.from({length:count},(_,i)=>total/BigInt(count)+(BigInt(i)<total%BigInt(count)?1n:0n));
}
export const inclusions = ['Study materials','Aviation headset','Theoretical study','Described training package'];
export const documentChecklist = [
  {key:'passport',label:'Valid passport',arabic:'جواز سفر ساري',owner:'STUDENT',mandatory:true,sensitivity:'passport'},
  {key:'criminal',label:'Criminal record addressed to South African embassy',arabic:'فيش وتشبيه موجه لسفارة جنوب أفريقيا',owner:'STUDENT',mandatory:true,sensitivity:'criminal'},
  {key:'birth',label:'Birth certificate with specified three-part number',arabic:'شهادة ميلاد بها الرقم الثلاثي',owner:'STUDENT',mandatory:true,sensitivity:'ordinary'},
  {key:'bank',label:'Student or first-degree relative bank statement',arabic:'كشف حساب الطالب أو قريب من الدرجة الأولى',owner:'STUDENT',mandatory:true,sensitivity:'bank'},
  {key:'family',label:'Family record when applicable',arabic:'قيد عائلي عند الطلب',owner:'STUDENT',mandatory:false,sensitivity:'ordinary'},
  {key:'photo',label:'Passport-size photograph',arabic:'صورة شخصية',owner:'STUDENT',mandatory:true,sensitivity:'ordinary'},
  {key:'acceptance',label:'Acceptance documents',arabic:'مستندات القبول',owner:'AV8',mandatory:true,sensitivity:'ordinary'},
  {key:'insurance',label:'Health insurance documents',arabic:'مستندات التأمين الصحي',owner:'AV8',mandatory:true,sensitivity:'ordinary'},
  {key:'ato',label:'Academy ATO license',arabic:'ترخيص الأكاديمية',owner:'AV8',mandatory:true,sensitivity:'ordinary'},
  {key:'embassy',label:'Embassy application',arabic:'طلب السفارة',owner:'AV8',mandatory:true,sensitivity:'ordinary'},
];
export const initialPolicies = [
  {kind:'PROGRAM',key:'DEFAULT',data:{name:'Flight training',currency:'USD',applicationFeeMinor:'200000',cashStudentTotalMinor:'5400000'}},
  ...['A','B'].map(key=>({kind:'PLAN',key,data:{name:`Installment ${key}`, interpretation:null,anchor:null,offsetMonths:null,frequencyMonths:3,firstMilestone:key==='A'?'CONTRACT':null,inclusions,original:key==='A'?'والباقي ٩٦٠٠ دولار علي ٥ دفعات دفعة كل ٣ شهور':'وباقي الدفعات ٨٠٠٠ دولار علي ٦ دفعات دفعة كل ٣ شهور'}})),
  {kind:'PLAN',key:'CASH',data:{name:'Cash — confirmed student price',inclusions}},
  {kind:'SETTLEMENT',key:'INSTALLMENT',data:{medicalMinor:'150000',visaMinor:'450000',commissionMinor:'1000000',deferredPassThrough:true}},
  {kind:'SETTLEMENT',key:'CASH',data:{totalAcademyMinor:null,commissionMinor:null,additionalMilestone:null,conditionalExample:'If commission is USD 10,000, academy total would be USD 44,000. Unapproved.'}},
  {kind:'DOCUMENTS',key:'CHECKLIST',data:{requirements:documentChecklist,source:'Client operational checklist; not verified embassy law'}},
  {kind:'PLANNING',key:'DEFAULT',data:{responseMinutes:60,visaFollowupDays:60,departureEstimateDays:90,reviewDays:7,englishRequired:false}},
  {kind:'ACCOUNTING',key:'AGENCY',data:{agencyAccountCode:null,fxPolicy:null,revenueRecognition:'Pending accounting review; no automatic revenue posting'}},
];
export type ScheduleItem = {key:string;label:string;amountMinor:string;milestone:string;predeparture:boolean;deferred:boolean;dueDate:string|null};
export function planPreview(key: string, data: any, anchorDate?: string, live = false): {totalMinor:string;items:ScheduleItem[]} {
  if (!['A','B','CASH'].includes(key)) fail('Unknown student plan');
  const explicitMinor=(value:unknown,fallback:bigint,label:string)=>{if(value===undefined||value===null||value==='')return fallback;if(!/^\d+$/.test(String(value))||BigInt(String(value))<=0n)fail(`${label} must be an explicit positive amount`);return BigInt(String(value));};
  const applicationFee=explicitMinor(data.applicationFeeMinor,200000n,'Application fee');
  const items: ScheduleItem[] = [{key:'APPLICATION',label:'Application fee (existing charge)',amountMinor:String(applicationFee),milestone:'APPLICATION',predeparture:true,deferred:false,dueDate:null}];
  const add = (k:string,label:string,n:bigint,milestone:string,predeparture:boolean,deferred=false,dueDate:string|null=null) => items.push({key:k,label,amountMinor:String(n),milestone,predeparture,deferred,dueDate});
  if (key === 'CASH') {
    const total=explicitMinor(data.cashStudentTotalMinor,5400000n,'Cash student total');if(total<=applicationFee)fail('Cash student total must exceed the application fee');
    add('CASH_BALANCE','Cash balance',total-applicationFee,'BEFORE_DEPARTURE',true);
  }
  else {
    if (!['EACH','TOTAL'].includes(data.interpretation)) fail('Choose EACH installment or TOTAL deferred balance');
    const frequency=Number(data.frequencyMonths),count=Number(data.installmentCount??(key==='A'?5:6));
    if (live && (!['CONTRACT','DEPARTURE','CUSTOM'].includes(data.anchor) || !Number.isInteger(data.offsetMonths) || data.offsetMonths < 0 || data.offsetMonths > 120 || !Number.isInteger(frequency) || frequency<1 || frequency>24 || !Number.isInteger(count)||count<1||count>60 || !['CONTRACT','VISA','BEFORE_DEPARTURE'].includes(data.firstMilestone))) fail('Complete the installment count, amount, milestone, anchor and date frequency before using this plan');
    if (key==='A') { add('CONTRACT','Contract payment',explicitMinor(data.contractAmountMinor,600000n,'Contract payment'),'CONTRACT',true); add('VISA','After visa / before departure',explicitMinor(data.visaAmountMinor,800000n,'Visa payment'),'VISA',true); }
    else add('FIRST','First payment',explicitMinor(data.firstAmountMinor,1400000n,'First payment'),data.firstMilestone || 'UNCONFIRMED',true);
    const stated=explicitMinor(data.installmentAmountMinor,key==='A'?960000n:800000n,'Installment amount');
    const values=data.interpretation==='EACH'?Array<bigint>(count).fill(stated):splitMinor(stated,count);
    values.forEach((n,i)=>add(`DEFERRED_${i+1}`,`Deferred installment ${i+1}`,n,data.anchor||'PENDING_ANCHOR',false,true,anchorDate && Number.isInteger(data.offsetMonths)?monthsAfter(anchorDate,data.offsetMonths+i*frequency):null));
  }
  return {totalMinor:String(items.reduce((s,i)=>s+BigInt(i.amountMinor),0n)),items};
}

export const transitions: Record<string,Record<string,string[]>> = {
  crm:{NEW:['CONTACTED','NOT_PROCEEDING'],CONTACTED:['NURTURING','APPOINTMENT_BOOKED','DEFERRED','NOT_PROCEEDING'],NURTURING:['CONTACTED','APPOINTMENT_BOOKED','DEFERRED','NOT_PROCEEDING'],APPOINTMENT_BOOKED:['ATTENDED','NURTURING','DEFERRED'],ATTENDED:['CONVERTED','NURTURING','DEFERRED','NOT_PROCEEDING'],DEFERRED:['CONTACTED','NURTURING','APPOINTMENT_BOOKED','ATTENDED','NOT_PROCEEDING'],NOT_PROCEEDING:['CONTACTED'],CONVERTED:['CONTACTED','ATTENDED']},
  appointment:{SCHEDULED:['CONFIRMED','ATTENDED','NO_SHOW','RESCHEDULED','CANCELLED'],CONFIRMED:['ATTENDED','NO_SHOW','RESCHEDULED','CANCELLED'],RESCHEDULED:['CONFIRMED','ATTENDED','NO_SHOW','RESCHEDULED','CANCELLED'],NO_SHOW:['RESCHEDULED','CANCELLED'],ATTENDED:[],CANCELLED:[]},
  document:{REQUESTED:['RECEIVED','NOT_APPLICABLE'],RECEIVED:['UNDER_REVIEW','REJECTED'],UNDER_REVIEW:['ACCEPTED','REJECTED','NOT_APPLICABLE'],ACCEPTED:['EXPIRED','RECEIVED'],REJECTED:['RECEIVED','NOT_APPLICABLE'],EXPIRED:['RECEIVED'],NOT_APPLICABLE:['REQUESTED']},
  visa:{PREPARING:['READY','WITHDRAWN'],READY:['SUBMITTED','PREPARING','WITHDRAWN'],SUBMITTED:['ADDITIONAL_INFORMATION','ISSUED','REFUSED','WITHDRAWN'],ADDITIONAL_INFORMATION:['SUBMITTED','ISSUED','REFUSED','WITHDRAWN'],REFUSED:[],WITHDRAWN:[],ISSUED:[]},
  travel:{PREPARING:['READY','DEPARTED'],READY:['BOOKED','PREPARING','DEPARTED'],BOOKED:['DEPARTED','PREPARING'],DEPARTED:['ARRIVAL_CONFIRMED'],ARRIVAL_CONFIRMED:[]},
  progress:{EXPECTED:['RECEIVED'],RECEIVED:['REVIEWED'],REVIEWED:['FOLLOWUP_PENDING','FOLLOWUP_COMPLETED'],FOLLOWUP_PENDING:['FOLLOWUP_COMPLETED'],FOLLOWUP_COMPLETED:[]},
  english:{ASSESSMENT_PENDING:['ASSESSMENT_COMPLETED'],ASSESSMENT_COMPLETED:['NOT_STARTED','IN_PROGRESS'],NOT_STARTED:['IN_PROGRESS'],IN_PROGRESS:['COMPLETED'],COMPLETED:[]},
};
export function transition(kind:string, from:string,to:string) {
  if (!transitions[kind]?.[from]?.includes(to)) fail(`Cannot change ${kind} from ${from} to ${to}`);
}
export function missingDocuments(records:any[],today=cairoCalendarDate()) {
  return records.filter(r=>r.kind==='document' && !(!r.data.mandatory && r.status==='NOT_APPLICABLE' && r.data.reason) && (r.status!=='ACCEPTED' || (r.data.expiry && r.data.expiry<today))).map(r=>r.data.label || r.key);
}
export function csvRows(input:string):string[][] {
  if (Buffer.byteLength(input)>512000) fail('CSV exceeds 500 KB');
  const rows:string[][]=[];let row:string[]=[],cell='',quote=false;
  for(let i=0;i<input.length;i++) { const c=input[i]; if(c==='"') { if(quote&&input[i+1]==='"'){cell+='"';i++;} else quote=!quote; } else if(c===','&&!quote){row.push(cell);cell='';} else if(c==='\n'&&!quote){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c; }
  if(quote) fail('CSV has an unclosed quoted field');
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  if(rows.length>501)fail('Import at most 500 leads at a time');
  return rows;
}
export function leadInput(body:any) {
  const name=text(body.name,'Name',true,160),phone=text(body.phone,'Phone',true,40);
  if(!/^[+\d() .-]{5,40}$/.test(phone))fail('Phone format is invalid');
  const email=text(body.email,'Email',false,200);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email format is invalid');
  return {name,phone,email,source:text(body.source,'Source',true,80),campaign:text(body.campaign,'Campaign',false,120),program:text(body.program||'Flight training','Program',true,160),notes:text(body.notes,'Notes',false),inquiryAt:body.inquiryAt?instant(body.inquiryAt):new Date(),nextFollowUp:body.nextFollowUp?instant(body.nextFollowUp):null};
}
