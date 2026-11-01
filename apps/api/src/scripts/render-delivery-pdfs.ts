/** Re-render only synthetic saved acceptance fixtures, never read live student data. */
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {statementPdf} from '../av8-print';
async function main(){const root=resolve(process.cwd(),'output/pdf/final-delivery');for(const name of readdirSync(root).filter(f=>f.endsWith('.source.json'))){const fixture=JSON.parse(readFileSync(resolve(root,name),'utf8'));if(!String(fixture.value.name||'').includes('SYNTHETIC'))throw new Error('Refusing non-synthetic PDF fixture');for(const language of ['en','ar']as const){const doc=statementPdf(fixture.value,language),chunks:Buffer[]=[];const bytes=await new Promise<Buffer>((done,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>done(Buffer.concat(chunks)));doc.on('error',reject);doc.end();});writeFileSync(resolve(root,`${fixture.name}-${language}.pdf`),bytes);console.log(`${fixture.name}-${language}.pdf`);}}}
main();
