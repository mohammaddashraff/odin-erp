import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {statementPdf} from './av8-print';

it('preserves Latin identifiers followed by Arabic punctuation in mixed Arabic text',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'av8-mixed-punctuation-'));
 try{
  const doc=statementPdf({title:'Student statement — USD',reference:'SYNTHETIC-MIXED',name:'طالب تجريبي',wording:'اعتماد ACME-123؛ المرجع INV-902، هل أكد AV8؟',rows:[{label:'Application fee',charge:'100.01',paid:'0.00',remaining:'100.01'}]},'ar');
  const bytes=await new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
  const file=join(dir,'mixed.pdf');writeFileSync(file,bytes);
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
  for(const token of ['ACME-123','INV-902','AV8','100.01'])expect(text).toContain(token);
  expect(text).not.toMatch(/321-EMCA|209-VNI|8VA/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

it('exports Arabic student statements with readable exact money, dates, and no internal settlement fields',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'av8-statement-'));
  try {
    const doc=statementPdf({title:'Student statement — USD',reference:'AV8-001',name:'طالب تجريبي',rows:[{label:'Application fee',dueDate:'2026-10-24',charge:'2000.00',paid:'100.01',remaining:'1899.99'}],unappliedCredit:'0.00',refunded:'0.00'},'ar');
    const bytes=await new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
    const file=join(dir,'student.pdf');writeFileSync(file,bytes);
    const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
    for(const value of ['USD','AV8-001','2026-10-24','2000.00','100.01','1899.99','كشف حساب الطالب'])expect(text).toContain(value);
    expect(text).not.toMatch(/commission|settlement/i);
    expect(execFileSync('pdffonts',[file],{encoding:'utf8'})).toContain('NotoSansArabic');
  } finally {rmSync(dir,{recursive:true,force:true});}
});


it('paginates long bilingual schedules with repeated references, every row, exact total and real-signature spaces',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'av8-long-contract-'));
 try{for(const language of ['en','ar']as const){
  const doc=statementPdf({title:'Agreement QA-50 — DRAFT',reference:'SYNTHETIC-50-ROWS',name:'طالب تجريبي Synthetic',rows:Array.from({length:50},(_,i)=>({label:`ROW-${String(i+1).padStart(3,'0')}`,amount:'1280.00',currency:'USD',milestone:'CONTRACT',dueDate:'2026-10-31'}))},language);
  const bytes=await new Promise<Buffer>((resolve,reject)=>{const chunks:Buffer[]=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});
  const file=join(dir,`long-${language}.pdf`);writeFileSync(file,bytes);const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
  for(let i=1;i<=50;i++)expect(text).toContain(`ROW-${String(i).padStart(3,'0')}`);expect(text).toContain('64000.00');const pages=text.split('\f').filter(p=>p.trim());expect(pages.length).toBeGreaterThan(1);for(const page of pages)expect(page).toContain('SYNTHETIC-50-ROWS');expect(text).toContain(language==='ar'?'توقيع الطالب':'Student signature');
 }}finally{rmSync(dir,{recursive:true,force:true});}
});
