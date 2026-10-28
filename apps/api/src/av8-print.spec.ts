import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {statementPdf} from './av8-print';

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
