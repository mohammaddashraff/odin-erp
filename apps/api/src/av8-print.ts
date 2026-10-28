import PDFDocument from 'pdfkit';
import { publicAsset } from './accounting-pdf';
import { ApiLanguage, apiLabel, apiText } from './i18n';

const arabic: Record<string, string> = {
  'Student statement — USD':'كشف حساب الطالب — USD','Client operational checklist':'قائمة مستندات العميل التشغيلية','Student progress summary':'ملخص تقدم الطالب',
  label:'البند',dueDate:'تاريخ الاستحقاق',charge:'المبلغ المستحق',paid:'المدفوع',remaining:'المتبقي',status:'الحالة',owner:'المسؤول',mandatory:'إلزامي',expiry:'انتهاء الصلاحية',period:'الفترة',examResults:'نتائج الاختبارات',trainingProgress:'التقدم التدريبي',amount:'المبلغ',currency:'العملة',milestone:'مرحلة الاستحقاق',unappliedCredit:'رصيد غير مخصص',refunded:'المبالغ المستردة',guardianSharingPermitted:'مشاركة التقدم مع ولي الأمر مسموحة',inclusions:'يشمل البرنامج',
  REQUESTED:'مطلوب',RECEIVED:'تم الاستلام',ACCEPTED:'مقبول',REJECTED:'مرفوض',NOT_APPLICABLE:'غير منطبق',EXPIRED:'منتهي',UNDER_REVIEW:'قيد المراجعة',EXPECTED:'متوقع',REVIEWED:'تمت المراجعة',PENDING:'معلق',PAID:'مدفوع',OVERDUE:'متأخر',DUE_SOON:'مستحق قريباً',STUDENT:'الطالب',Unknown:'غير معروف',true:'نعم',false:'لا',
  trainingPercent:'نسبة إنجاز التدريب (%)',
  'Application fee':'رسوم التقديم','Application fee (existing charge)':'رسوم التقديم المحتسبة سابقاً','Cash balance':'رصيد الدفع النقدي','Contract payment':'دفعة العقد','First payment':'الدفعة الأولى','After visa / before departure':'بعد التأشيرة وقبل السفر',
  'Operational wording pending AV8 approval; signed evidence stored separately':'الصياغة التشغيلية بانتظار اعتماد AV8؛ النسخة الموقعة محفوظة بشكل منفصل',
  'No study progress reports have been recorded for this student yet.':'لا توجد تقارير تقدم مسجلة لهذا الطالب حتى الآن.',
};
export const printText = (value: unknown, language: ApiLanguage): string => {
  const text = String(value ?? 'Unknown');
  if (language === 'ar' && arabic[text]) return arabic[text];
  if (language === 'ar' && /^Deferred installment \d+$/.test(text)) return text.replace('Deferred installment','القسط المؤجل');
  return apiText(text, language);
};
export const printLabel = (key: string, language: ApiLanguage) => language === 'ar' && arabic[key] || apiLabel(key, language);
export const statementNotes = (value: any, language: ApiLanguage) => ['unappliedCredit','refunded','guardianSharingPermitted','inclusions'].filter(k=>value[k] !== undefined).map(k=>`${printLabel(k,language)}: ${Array.isArray(value[k])?value[k].map((x:string)=>printText(x,language)).join(' · '):printText(value[k],language)}`);

/** Authorized statement data only; embedded local fonts support Arabic and Latin. */
export function statementPdf(value: any, language: ApiLanguage) {
  const doc = new PDFDocument({size:'A4',margin:40,info:{Title:value.title,Author:'AV8 ERP'}});
  doc.registerFont('latin',publicAsset('fonts/manrope-regular.ttf'));
  doc.registerFont('arabic',publicAsset('fonts/noto-arabic-regular.ttf'));
  const isArabic=(s:string)=>/[\u0600-\u06ff]/.test(s);
  const measure=(s:string,size:number)=>doc.font(isArabic(s)?'arabic':'latin').fontSize(size).widthOfString(s,{features:[]});
  const line=(value:unknown,size=10)=>{
    const width=doc.page.width-80,lines:string[]=[];
    for(const paragraph of printText(value,language).split('\n')){
      let current='';for(const word of paragraph.split(/\s+/)){const next=current?`${current} ${word}`:word;if(current&&measure(next,size)>width){lines.push(current);current=word;}else current=next;}lines.push(current);
    }
    for(const text of lines){
      if(doc.y>doc.page.height-60)doc.addPage();const y=doc.y;
      const runs:{text:string;arabic:boolean}[]=[];
      for(const word of text.split(/\s+/).filter(Boolean)){const arabic=isArabic(word),previous=runs.at(-1);if(previous&&previous.arabic===arabic)previous.text+=` ${word}`;else runs.push({text:word,arabic});}
      const space=measure(' ',size),visual=(isArabic(text)?[...runs].reverse():runs).map(r=>({...r,width:measure(r.text,size)}));
      const total=visual.reduce((n,r)=>n+r.width,0)+Math.max(0,visual.length-1)*space;let x=language==='ar'?doc.page.width-40-total:40;
      for(const run of visual){if(run.arabic)doc.markContent('Span',{actual:[...run.text].reverse().join(''),lang:'ar'});doc.font(run.arabic?'arabic':'latin').fontSize(size).fillColor('#132f44').text(run.text,x,y,{lineBreak:false,features:[]});if(run.arabic)doc.endMarkedContent();x+=run.width+space;}
      doc.y=y+size*1.8;
    }
  };
  line('AV8 ERP',22);line(value.title,15);line(`${value.reference} · ${value.name}`);doc.moveDown();
  if(value.wording)line(value.wording);
  for(const row of value.rows||[]){
    if(doc.y>doc.page.height-140)doc.addPage();
    for(const [key,v] of Object.entries(row))line(`${printLabel(key,language)}: ${printText(v,language)}`);
    doc.moveDown(.6);
  }
  for(const note of statementNotes(value,language))line(note);
  if(value.disclaimer)line(value.disclaimer,9);
  return doc;
}
