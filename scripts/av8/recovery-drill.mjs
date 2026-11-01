/** Encrypted logical recovery drill. Source must be isolated av8_test; production is never accepted. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import pg from 'pg';
const source=new URL(process.env.DATABASE_ADMIN_URL||'');
if(process.env.AV8_ENV!=='test'||source.hostname!=='127.0.0.1'||source.port!=='5549'||source.pathname!=='/av8_test'||source.username!=='av8_owner')throw new Error('Recovery drill requires the isolated local AV8 test database.');
const dir=path.resolve('.av8/recovery',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
const sourceClient=new pg.Client({connectionString:source.href});await sourceClient.connect();
const targetName=`av8_restore_${Date.now()}`,target=new URL(source);target.pathname=`/${targetName}`;
const runtime=new URL(process.env.DATABASE_URL);runtime.pathname=target.pathname;
const evidence={status:'FAIL',startedAt:new Date().toISOString(),source:'isolated local av8_test',target:targetName,scope:'same-server clean logical restore with original roles; not an off-host disaster recovery or production RTO/RPO claim'};
const start=performance.now();let restored,limited,created=false;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(binary,args,url){const u=new URL(url);const child=spawnSync(binary,args,{encoding:'utf8',env:{...process.env,PGHOST:u.hostname,PGPORT:u.port,PGDATABASE:u.pathname.slice(1),PGUSER:u.username,PGPASSWORD:decodeURIComponent(u.password)},maxBuffer:4*1024*1024});if(child.status!==0)throw new Error(`${binary} failed (private diagnostics retained in .av8).`);return child.stdout;}
async function manifest(client){const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;const rows=[];for(const {tablename} of tables){if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw new Error('Unexpected table identifier');const result=await client.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum FROM "${tablename}" t`);rows.push({table:tablename,...result.rows[0]});}return rows;}
async function attachments(client){const rows=[];for(const table of ['private_attachments','av8_attachments']){let bytes=0;const files=(await client.query(`SELECT content,sha256,size_bytes FROM ${table}`)).rows;for(const file of files){if(digest(file.content)!==file.sha256||file.content.length!==Number(file.size_bytes))throw new Error('Document content/hash mismatch');bytes+=file.content.length;}rows.push({table,count:files.length,bytes});}return rows;}
try{
 const identity=(await sourceClient.query('SELECT resource FROM av8_guard.av8_environment_identity')).rows;if(identity.length!==1||identity[0].resource!=='av8-erp-test')throw new Error('Source marker mismatch');
 const before=await manifest(sourceClient),filesBefore=await attachments(sourceClient);const dump=path.join(dir,'snapshot.dump');
 run('pg_dump',['--format=custom','--no-owner','--file',dump],source.href);const plain=fs.readFileSync(dump),key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
 const encryptedPath=path.join(dir,'snapshot.dump.enc');fs.writeFileSync(encryptedPath,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});fs.rmSync(dump);
 const stored=fs.readFileSync(encryptedPath),decipher=createDecipheriv('aes-256-gcm',key,stored.subarray(0,12));decipher.setAuthTag(stored.subarray(12,28));const decoded=Buffer.concat([decipher.update(stored.subarray(28)),decipher.final()]);if(digest(decoded)!==digest(plain))throw new Error('Encrypted backup round-trip hash mismatch');fs.writeFileSync(dump,decoded,{mode:0o600});key.fill(0);
 await sourceClient.query(`CREATE DATABASE "${targetName}" OWNER av8_owner`);created=true;
 run('pg_restore',['--exit-on-error','--no-owner','--dbname',targetName,dump],target.href);fs.rmSync(dump);
 restored=new pg.Client({connectionString:target.href});await restored.connect();const after=await manifest(restored),filesAfter=await attachments(restored);
 if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(filesBefore)!==JSON.stringify(filesAfter))throw new Error('Restored database or attachment manifest mismatch; freeze test writers and repeat');
 const balances=(await restored.query("SELECT count(*)::int AS unbalanced FROM (SELECT je.id FROM journal_entries je LEFT JOIN journal_lines jl ON jl.journal_entry_id=je.id WHERE je.status='POSTED' GROUP BY je.id HAVING coalesce(sum(jl.debit_minor-jl.credit_minor),0)<>0) j")).rows[0];if(balances.unbalanced!==0)throw new Error('Restored journal reconciliation failed');
 limited=new pg.Client({connectionString:runtime.href});await limited.connect();const invisible=(await limited.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n;if(invisible!==0)throw new Error('Runtime RLS leaked unscoped tenant data');
 const document=(await restored.query('SELECT id,tenant_id,sha256 FROM av8_attachments ORDER BY id LIMIT 1')).rows[0];
 if(!document)throw new Error('Recovery acceptance requires at least one synthetic private student attachment');
 await limited.query('BEGIN');await limited.query("SELECT set_config('app.current_tenant_id',$1,true)",[String(document.tenant_id)]);
 const accessed=(await limited.query('SELECT content,sha256 FROM av8_attachments WHERE id=$1',[document.id])).rows;
 if(accessed.length!==1||digest(accessed[0].content)!==document.sha256)throw new Error('Scoped restored document access failed');await limited.query('COMMIT');
 await limited.query('BEGIN');await limited.query("SELECT set_config('app.current_tenant_id','-1',true)");
 if((await limited.query('SELECT count(*)::int AS n FROM av8_attachments WHERE id=$1',[document.id])).rows[0].n!==0)throw new Error('Restored private document crosses tenant scope');await limited.query('COMMIT');
 Object.assign(evidence,{status:'PASS',finishedAt:new Date().toISOString(),elapsedSeconds:Number(((performance.now()-start)/1000).toFixed(3)),backupSha256:digest(plain),encryptedBytes:stored.length,tableCount:after.length,rowCount:after.reduce((n,r)=>n+Number(r.count),0),manifestSha256:digest(JSON.stringify(after)),attachments:filesAfter,unbalancedPostedJournals:0,unscopedRuntimeTenants:0,cleanRestore:true,documentsVerified:true,scopedDocumentReadVerified:true,crossTenantDocumentDenied:true,applicationRestartVerified:false,backupKey:'ephemeral drill key destroyed; this archive is not an operational backup'});
}finally{
 if(limited)await limited.end();if(restored)await restored.end();if(created)await sourceClient.query(`DROP DATABASE "${targetName}" WITH (FORCE)`);await sourceClient.end();
 fs.mkdirSync('output/recovery',{recursive:true});fs.writeFileSync('output/recovery/evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}
