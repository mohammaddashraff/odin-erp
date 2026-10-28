import { decimal } from './av8-domain';
import { printLabel, printText } from './av8-print';
import type { ApiLanguage } from './i18n';

const labels: Record<string, [string, string]> = {
  reference:['Reference','المرجع'], name:['Student','الطالب'], academy:['Academy','الأكاديمية'],
  totalMinor:['Total fees','إجمالي الرسوم'], paidMinor:['Paid','المسدد'], remainingMinor:['Remaining','المتبقي'],
  overdueMinor:['Overdue','المتأخر'], unappliedMinor:['Unapplied credit','رصيد غير مخصص'], refundedMinor:['Refunded','المسترد'],
  amountMinor:['Original amount','المبلغ المدفوع'], usdMinor:['USD equivalent','المقابل بالدولار'],
  obligationMinor:['Academy obligation','استحقاق الأكاديمية'], remittedMinor:['Remitted','المحول للأكاديمية'],
  contractualCommissionMinor:['Contractual commission','العمولة التعاقدية'], netCashRetainedMinor:['Net cash retained','صافي النقد المحتفظ به'],
  academyHeldDeferredMinor:['Deferred funds awaiting transfer','أقساط مؤجلة بانتظار التحويل'],
  currency:['Currency','العملة'], usdCurrency:['Equivalent currency','عملة المقابل'], source:['Inquiry source','مصدر الاستفسار'],
  id:['Record','السجل'],applicationId:['Student file','ملف الطالب'],owner:['Owner','الموظف المسؤول'],status:['Status','الحالة'],
  inquiryAt:['Inquiry time','وقت الاستفسار'],firstContactAt:['First contact','أول تواصل'],nextFollowUp:['Next follow-up','المتابعة القادمة'],postingDate:['Posting date','تاريخ القيد'],
};

export function av8Csv(report: {rows:any[];currency?:string;kind?:string}, language:ApiLanguage) {
  const moneyKeys=new Set(report.rows.flatMap(row=>Object.keys(row).filter(key=>key.endsWith('Minor'))));
  const keys=[...new Set(report.rows.flatMap(row=>Object.keys(row)))];
  if(!keys.length&&report.kind==='student-balances')keys.push('reference','name','totalMinor','paidMinor','remainingMinor','overdueMinor','unappliedMinor','refundedMinor','currency');
  if(moneyKeys.size&&!keys.includes('currency'))keys.push('currency');
  if(keys.includes('usdMinor')&&!keys.includes('usdCurrency'))keys.push('usdCurrency');
  const quote=(value:unknown)=>{
    const text=String(value??'');
    return '"'+(/^[\s]*[=+\-@]/.test(text)&&!/^-[0-9]+\.[0-9]{2}$/.test(text)?"'":'')+text.replaceAll('"','""')+'"';
  };
  const header=(key:string)=>labels[key]?.[language==='ar'?1:0]||printLabel(key.replace(/Minor$/,''),language);
  const cell=(row:any,key:string)=>{
    if(key==='currency')return row.currency||report.currency||'USD';
    if(key==='usdCurrency')return 'USD';
    if(row[key]==null)return '';
    if(moneyKeys.has(key))return decimal(row[key]);
    const value=row[key] instanceof Date?row[key].toISOString():row[key];
    if(key.endsWith('Date')&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value))return value.slice(0,10);
    return typeof value==='object'?JSON.stringify(value):printText(value,language);
  };
  return '\uFEFF'+[keys.map(key=>quote(header(key))).join(','),...report.rows.map(row=>keys.map(key=>quote(cell(row,key))).join(','))].join('\r\n');
}
