import PDFDocument from 'pdfkit';
import { publicAsset } from './accounting-pdf';
import { ApiLanguage, apiLabel, apiText } from './i18n';

const arabic: Record<string, string> = {
  TRANSACTION_INPUT:'سعر العملية المسجل','Full academy settlement':'التسوية الكاملة للأكاديمية',
  APPLICATION:'التقديم',CONTRACT:'توقيع العقد',VISA:'التأشيرة',
  'Study package payment':'دفعة البرنامج الدراسي','Study materials':'المواد الدراسية','Aviation headset':'سماعة الطيران','Theoretical study':'الدراسة النظرية','Described training package':'حزمة التدريب المحددة',
  'Operational agreement draft. Review the legal wording before signature.':'مسودة اتفاقية تشغيلية. راجع الصياغة القانونية قبل التوقيع.',
  'Student signature':'توقيع الطالب','Company signature / stamp':'توقيع الشركة / الختم','Issued by / signature':'المحرر / التوقيع','Company stamp':'ختم الشركة','Generated copy; actual signed evidence is stored separately.':'نسخة مولدة؛ تحفظ النسخة الفعلية الموقعة بشكل منفصل.',Total:'الإجمالي',Page:'صفحة',rows:'صفوف',

  'Student statement — USD':'كشف حساب الطالب — USD','Client operational checklist':'قائمة مستندات العميل التشغيلية','Student progress summary':'ملخص تقدم الطالب',
  label:'البند',dueDate:'تاريخ الاستحقاق',charge:'المبلغ المستحق',paid:'المدفوع',remaining:'المتبقي',status:'الحالة',owner:'المسؤول',mandatory:'إلزامي',expiry:'انتهاء الصلاحية',period:'الفترة',examResults:'نتائج الاختبارات',trainingProgress:'التقدم التدريبي',amount:'المبلغ',currency:'العملة',milestone:'مرحلة الاستحقاق',unappliedCredit:'رصيد غير مخصص',refunded:'المبالغ المستردة',guardianSharingPermitted:'مشاركة التقدم مع ولي الأمر مسموحة',inclusions:'يشمل البرنامج',
  REQUESTED:'مطلوب',RECEIVED:'تم الاستلام',ACCEPTED:'مقبول',REJECTED:'مرفوض',NOT_APPLICABLE:'غير منطبق',EXPIRED:'منتهي',UNDER_REVIEW:'قيد المراجعة',EXPECTED:'متوقع',REVIEWED:'تمت المراجعة',PENDING:'معلق',PAID:'مدفوع',OVERDUE:'متأخر',DUE_SOON:'مستحق قريباً',STUDENT:'الطالب',Unknown:'غير معروف',true:'نعم',false:'لا',
  trainingPercent:'نسبة إنجاز التدريب (%)',
  'Official fee reimbursement receipt':'إيصال استرداد رسوم البنك الرسمي','USD bank-fee reimbursement':'استرداد رسوم البنك بالدولار','Official collection receipt':'إيصال تحصيل رسمي','Cheque acknowledgment':'إقرار استلام شيك','Academy settlement statement — USD':'كشف تسوية الأكاديمية — USD','Refund cases — USD':'حالات الاسترداد — USD',
  'Company':'الشركة','Student/application':'الطالب / الطلب','Receipt number':'رقم الإيصال','Payment status':'حالة الدفعة','Payment date':'تاريخ الدفعة','Method':'طريقة الدفع','Payer':'الدافع','Original currency':'العملة الأصلية','Gross amount':'المبلغ الإجمالي','Student-borne bank fee':'رسوم البنك التي يتحملها الطالب','Net cash received':'صافي النقد المستلم','USD principal credited':'أصل المبلغ المقيد بالدولار','External reference':'المرجع الخارجي','Signature/stamp verification':'التحقق من التوقيع والختم','Signed/stamped copy recorded':'تم تسجيل النسخة الموقعة والمختومة','Awaiting actual signed/stamped copy':'بانتظار النسخة الموقعة والمختومة فعلياً','Signed copy evidence':'مرفق النسخة الموقعة','Signatory/date':'الموقع / التاريخ','USD per original currency unit':'الدولار لكل وحدة من العملة الأصلية','Base currency per original currency unit':'العملة الأساسية لكل وحدة من العملة الأصلية','Rate source':'مصدر سعر الصرف','Rate date':'تاريخ سعر الصرف','Pending approved FX event':'بانتظار حدث سعر الصرف المعتمد','Recorded historical transaction input':'سعر العملية التاريخي المسجل','Reversal notice':'إشعار العكس','Original receipt reprint; the returned cheque credit has been reversed. See the linked bank return history.':'إعادة طباعة للإيصال الأصلي؛ تم عكس رصيد الشيك المرتجع. راجع سجل الإرجاع البنكي المرتبط.',
  'Generated company receipt. Signature and stamp must be completed through the recorded evidence workflow; this PDF does not fabricate a signature or government validation.':'إيصال صادر من النظام. يجب استكمال التوقيع والختم وإرفاق النسخة الفعلية؛ هذا الملف لا ينشئ توقيعاً أو اعتماداً حكومياً.',
  'Receipt of a cheque is not confirmation of cleared bank cash. Original signed/stamped evidence is stored separately.':'استلام الشيك لا يؤكد تحصيل النقد بالبنك. تحفظ النسخة الأصلية الموقعة والمختومة بشكل منفصل.',
  value:'القيمة',reference:'المرجع',approved:'المعتمد',terminationDate:'تاريخ الإنهاء',deadline:'الموعد النهائي',recoveryStatus:'حالة الاسترداد من الأكاديمية',DUE:'مستحق',PARTIALLY_PAID:'مدفوع جزئياً',CLEARED:'تم التحصيل',RETURNED:'مرتجع',PRESENTED:'تم التقديم للبنك',BANK:'بنك',CASH:'نقدي',CARD:'بطاقة',CHEQUE:'شيك',

  'Application fee':'رسوم التقديم','Application fee (existing charge)':'رسوم التقديم المحتسبة سابقاً','Cash balance':'رصيد الدفع النقدي','Contract payment':'دفعة العقد','First payment':'الدفعة الأولى','After visa / before departure':'بعد التأشيرة وقبل السفر',
  'Operational wording pending AV8 approval; signed evidence stored separately':'الصياغة التشغيلية بانتظار اعتماد AV8؛ النسخة الموقعة محفوظة بشكل منفصل',
  'No study progress reports have been recorded for this student yet.':'لا توجد تقارير تقدم مسجلة لهذا الطالب حتى الآن.',
};
export const printText = (value: unknown, language: ApiLanguage): string => {
  const text = String(value ?? 'Unknown');
  if (/^CASH_FULL_\d+$/.test(text)) return language==='ar'?'التسوية الكاملة للأكاديمية':'Full academy settlement';
  if (language === 'ar' && arabic[text]) return arabic[text];
  if (language === 'ar' && /^Agreement /.test(text)) return text.replace('Agreement ','اتفاقية ').replace('SIGNED','موقعة').replace('DRAFT','مسودة');
  if (language === 'ar' && /^Deferred installment \d+$/.test(text)) return text.replace('Deferred installment','القسط المؤجل');
  return apiText(text, language);
};
export const printLabel = (key: string, language: ApiLanguage) => language === 'ar' && arabic[key] || apiLabel(key, language);
export const statementNotes = (value: any, language: ApiLanguage) => ['unappliedCredit','refunded','guardianSharingPermitted','inclusions'].filter(k=>value[k] !== undefined).map(k=>`${printLabel(k,language)}: ${Array.isArray(value[k])?value[k].map((x:string)=>printText(x,language)).join(' · '):printText(value[k],language)}`);

/** Render authorized source rows with exact totals, repeated context and embedded bilingual fonts. */
export function statementPdf(value: any, language: ApiLanguage) {
  const doc=new PDFDocument({size:'A4',margin:36,bufferPages:true,info:{Title:value.title,Author:'AV8 ERP'}});
  doc.registerFont('latin',publicAsset('fonts/manrope-regular.ttf'));doc.registerFont('arabic',publicAsset('fonts/noto-arabic-regular.ttf'));
  const rtl=language==='ar',margin=36,width=doc.page.width-margin*2,bottom=doc.page.height-58,pad=value.rows?.[0]?.value!==undefined?4:6,lineHeight=15;
  const isArabic=(s:string)=>/[\u0600-\u06ff]/.test(s);
  const measure=(s:string,size:number)=>doc.font(isArabic(s)?'arabic':'latin').fontSize(size).widthOfString(s,{features:[]});
  const wrap=(value:unknown,maxWidth:number,size=9)=>{
    const lines:string[]=[];for(const paragraph of String(value??'—').split('\n')){let current='';for(const word of paragraph.split(/\s+/).filter(Boolean)){const next=current?`${current} ${word}`:word;if(measure(next,size)<=maxWidth){current=next;continue;}if(current)lines.push(current);current='';for(const char of word){if(current&&measure(current+char,size)>maxWidth){lines.push(current);current='';}current+=char;}}lines.push(current);}return lines.length?lines:[''];
  };
  const line=(text:string,x:number,y:number,w:number,size=9,align:'left'|'right'|'center'=rtl?'right':'left',color='#132f44')=>{
    // Arabic punctuation needs the Arabic font, while the preceding Latin identifier must retain LTR glyph order.
    const tokens=text.replace(/([A-Za-z0-9])([،؛؟])/g,'$1 $2').split(/\s+/).filter(Boolean);
    const runs:{text:string;arabic:boolean}[]=[];for(const word of tokens){const arabic=isArabic(word),last=runs.at(-1);if(last&&last.arabic===arabic)last.text+=` ${word}`;else runs.push({text:word,arabic});}
    const space=measure(' ',size),visual=(isArabic(text)?[...runs].reverse():runs).map(r=>({...r,width:measure(r.text,size)})),total=visual.reduce((n,r)=>n+r.width,0)+Math.max(0,visual.length-1)*space;
    let cursor=x+(align==='right'?w-total:align==='center'?(w-total)/2:0);
    for(const run of visual){if(run.arabic)doc.markContent('Span',{actual:[...run.text].reverse().join(''),lang:'ar'});doc.font(run.arabic?'arabic':'latin').fontSize(size).fillColor(color).text(run.text,cursor,y,{lineBreak:false,features:[]});if(run.arabic)doc.endMarkedContent();cursor+=run.width+space;}
  };
  let y=0;
  const header=()=>{line('AV8 ERP',margin,27,width,20,'left');line(String(value.reference||''),margin,33,width,9,'right');y=61;for(const row of wrap(printText(value.title,language),width,15)){line(row,margin,y,width,15);y+=24;}for(const row of wrap(String(value.name||''),width,9)){line(row,margin,y,width);y+=lineHeight;}doc.moveTo(margin,y+5).lineTo(margin+width,y+5).strokeColor('#ccd7e3').stroke();y+=18;};
  const page=()=>{doc.addPage();header();};
  const paragraph=(text:string,size=9)=>{for(const row of wrap(text,width,size)){if(y+lineHeight>bottom)page();line(row,margin,y,width,size);y+=lineHeight;}y+=8;};
  header();if(value.wording)paragraph(printText(value.wording,language));
  const rows:any[]=value.rows||[],keys=Object.keys(rows[0]||{});
  const weights=keys.map(key=>key==='label'?170:key==='value'?300:['examResults','trainingProgress'].includes(key)?180:key==='milestone'?90:key==='dueDate'?85:70),sum=weights.reduce((n,v)=>n+v,0),widths=weights.map(v=>width*v/sum);
  const positions=widths.map((_,i)=>rtl?margin+width-widths.slice(0,i+1).reduce((n,w)=>n+w,0):margin+widths.slice(0,i).reduce((n,w)=>n+w,0));
  let tableBodyStart=0;
  const tableHeader=()=>{if(!keys.length)return;const cells=keys.map((key,i)=>wrap(printLabel(key,language),widths[i]-pad*2,8));const height=Math.max(...cells.map(c=>c.length))*lineHeight+pad*2;doc.rect(margin,y,width,height).fill('#edf2f8');cells.forEach((cell,i)=>cell.forEach((s,j)=>line(s,positions[i]+pad,y+pad+j*lineHeight,widths[i]-pad*2,8)));y+=height;tableBodyStart=y;};
  const tablePage=()=>{page();tableHeader();};
  tableHeader();
  for(const [index,row]of rows.entries()){
    const cells=keys.map((key,i)=>wrap(printText(row[key]??'—',language),widths[i]-pad*2,9)),count=Math.max(...cells.map(c=>c.length));let offset=0;
    while(offset<count){if(y+lineHeight+pad*2>bottom)tablePage();const available=Math.max(1,Math.floor((bottom-y-pad*2)/lineHeight));if(offset===0&&count>available&&y>tableBodyStart+1&&count*lineHeight+pad*2<bottom-155){tablePage();continue;}
      const length=Math.min(count-offset,available),height=length*lineHeight+pad*2;
      if(index%2===1)doc.rect(margin,y,width,height).fill('#f7f9fc');
      cells.forEach((cell,i)=>cell.slice(offset,offset+length).forEach((s,j)=>line(s,positions[i]+pad,y+pad+j*lineHeight,widths[i]-pad*2,9,['amount','charge','paid','remaining','approved'].includes(keys[i])?'right':rtl?'right':'left')));
      y+=height;doc.moveTo(margin,y).lineTo(margin+width,y).strokeColor('#e1e7ee').stroke();offset+=length;if(offset<count)tablePage();
    }
  }
  y+=12;
  // The statement source uses exact decimal strings. Never sum binary floating-point money or unlike currencies.
  for(const key of ['amount','charge','paid','remaining','approved'])if(keys.includes(key)&&rows.length&&rows.every(r=>/^-?\d+\.\d{2}$/.test(String(r[key])))){
    const currencies=[...new Set(rows.map(r=>r.currency||'USD'))];for(const currency of currencies){const selected=rows.filter(r=>(r.currency||'USD')===currency),total=selected.reduce((n,r)=>n+BigInt(String(r[key]).replace('.','')),0n),absolute=total<0n?-total:total,decimal=`${total<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;paragraph(`${printText('Total',language)} · ${printLabel(key,language)}: ${decimal} ${currency}`,10);}
  }
  for(const note of statementNotes(value,language))paragraph(note);
  if(value.disclaimer)paragraph(printText(value.disclaimer,language),8);
  if(/^Agreement /.test(String(value.title))||['Official collection receipt','Official fee reimbursement receipt','Cheque acknowledgment'].includes(value.title)){
    if(y+100>bottom)page();y+=12;
    const labels=/^Agreement /.test(value.title)?['Student signature','Company signature / stamp']:['Issued by / signature','Company stamp'];
    labels.forEach((label,i)=>{const x=margin+i*(width/2+8);line(printText(label,language),x,y,width/2-8,9);doc.rect(x,y+22,width/2-10,42).strokeColor('#b8c8d8').stroke();});y+=76;
    paragraph(printText('Generated copy; actual signed evidence is stored separately.',language),8);
  }
  const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);line(`${printText('Page',language)} ${i+1} / ${range.count}`,margin,doc.page.height-34,width,8,'right','#53647b');line(`${value.reference||''} · ${rows.length} ${printText('rows',language)}`,margin,doc.page.height-34,width/2,8,'left','#53647b');}
  return doc;
}
