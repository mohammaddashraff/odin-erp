/** Staging-only, same-host recovery drill. Source is read-only; original encrypted backup/key are retained. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const digest=value=>createHash('sha256').update(value).digest('hex');
const identifier=value=>{if(!/^[a-z_][a-z0-9_]{0,62}$/.test(value))throw new Error('Unsafe database identifier');return `"${value}"`;};
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const inside=(parent,child)=>child===parent||child.startsWith(parent+path.sep);

export function parseCompose(source){
  const values={};for(const line of source.split(/\r?\n/)){if(!line||line.startsWith('#'))continue;const match=/^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_./:@+-]+)$/.exec(line);if(!match||Object.hasOwn(values,match[1]))throw new Error('Expected generated literal Compose configuration');values[match[1]]=match[2];}return values;
}

export function restorePlan(config,compose,{privateDirectory,backupDirectory,evidenceDirectory,credentialsFile,writersQuiesced,token=randomBytes(12).toString('hex')}){
  if(!writersQuiesced||config.AV8_ENV!=='staging'||config.AV8_HOSTING!=='hetzner'||config.AV8_DB_TRANSPORT!=='PRIVATE_CONTAINER_NETWORK'||config.AV8_HETZNER_DB_HOST!=='av8-postgres'||config.AV8_RECOVERY_DRILL||compose.AV8_COMPOSE_PROJECT!=='av8-delivery-staging')throw new Error('Only the explicitly quiesced isolated Hetzner staging project is accepted');
  const source=config.AV8_HETZNER_DB_NAME,owner=config.AV8_HETZNER_DB_ADMIN_ROLE,deployment=config.AV8_HETZNER_DEPLOYMENT_ID;
  if(!/^av8_staging_[a-z0-9_]{1,50}$/.test(source)||source.includes('_restore_')||!/^av8_staging_[a-z0-9_]{1,50}$/.test(owner)||!/^av8-delivery-staging-[a-f0-9]{12}$/.test(deployment)||config.AV8_HETZNER_RESOURCE!==`av8-erp-staging:${deployment}`||!/^av8-delivery-api:[A-Za-z0-9_.-]{7,100}$/.test(`av8-delivery-api:${compose.AV8_IMAGE_TAG}`))throw new Error('Staging database/resource/image identity mismatch');
  for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING']){
    if(!config[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
    const url=new URL(config[key]);if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='av8-postgres'||url.port!=='5432'||url.pathname!==`/${source}`||url.username!==(key==='DATABASE_URL'?'av8_runtime':owner)||!url.password||url.search!=='?sslmode=disable'||url.hash)throw new Error('Staging database URL does not match its declared identity');
  }
  if(config.ODIN_REQUIRE_PRIVILEGED_MFA!=='true'||config.ODIN_ALLOW_SHARED_DEMO_LOGINS!=='false'||config.AV8_OUTBOUND!=='disabled'||config.AV8_JOBS!=='disabled')throw new Error('Staging authentication/outbound security contract is required');
  for(const directory of [privateDirectory,backupDirectory,evidenceDirectory])if(!path.isAbsolute(directory)||directory!==path.resolve(directory))throw new Error('Use normalized absolute private, backup and evidence directories');
  if(compose.AV8_PRIVATE_DIR!==privateDirectory||compose.AV8_DATABASE_NAME!==source||inside(privateDirectory,backupDirectory)||inside(backupDirectory,privateDirectory)||inside(privateDirectory,evidenceDirectory)||inside(evidenceDirectory,privateDirectory)||inside(backupDirectory,evidenceDirectory)||inside(evidenceDirectory,backupDirectory)||!path.isAbsolute(credentialsFile)||!inside(privateDirectory,credentialsFile)||!/^[a-f0-9]{24}$/.test(token))throw new Error('Recovery paths/identity must be explicit, separate and private');
  const target=`av8_staging_restore_${token}`,resource=`av8-erp-staging:av8-restore-${token}`,container=`av8-staging-restore-${token}`;
  const recovery={...config,AV8_RECOVERY_DRILL:'true',AV8_HETZNER_DB_NAME:target,AV8_HETZNER_DEPLOYMENT_ID:`av8-restore-${token}`,AV8_HETZNER_RESOURCE:resource,ODIN_TOKEN_SECRET:randomBytes(32).toString('hex'),AV8_SCHEDULER_SECRET:randomBytes(32).toString('hex'),AV8_ACADEMIC_EMAIL_API_KEY:'',AV8_ACADEMIC_EMAIL_FROM:'',AV8_ACADEMIC_EMAIL_REPLY_TO:''};
  for(const key of Object.keys(recovery))if(key.startsWith('AV8_INITIAL_'))delete recovery[key];
  for(const flag of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED','AV8_ALERT_EMAIL_ENABLED'])recovery[flag]='false';
  for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'])if(recovery[key]){const url=new URL(recovery[key]);url.pathname=`/${target}`;recovery[key]=url.href;}
  return {source,owner,resource,target,container,recovery,privateDirectory,backupDirectory,evidenceDirectory,credentialsFile,sourceResource:config.AV8_HETZNER_RESOURCE};
}

export function assertContainer(container,service){
  if(container.Config?.Labels?.['com.docker.compose.project']!=='av8-delivery-staging'||container.Config?.Labels?.['com.docker.compose.service']!==service||!container.State?.Running)throw new Error('Container is outside the running isolated staging project');
  if(service==='av8-postgres'&&(Object.values(container.HostConfig?.PortBindings||{}).some(Boolean)||Object.values(container.NetworkSettings?.Ports||{}).some(Boolean)))throw new Error('Staging database must not publish a host port');
}

export const manifestSql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT format('SELECT json_build_object(''table'',%L,''rows'',count(*)::text,''checksum'',md5(coalesce(string_agg(md5(row_to_json(t)::text),'''' ORDER BY md5(row_to_json(t)::text)),''''))) FROM public.%I t',tablename,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
COMMIT;`;

const documentSql=`SELECT json_build_object('table',table_name,'count',n,'bytes',bytes,'invalid',invalid) FROM (
 SELECT 'av8_attachments' AS table_name,count(*) AS n,coalesce(sum(octet_length(content)),0)::text AS bytes,count(*) FILTER(WHERE octet_length(content)<>size_bytes OR encode(sha256(content),'hex')<>sha256) AS invalid FROM public.av8_attachments
 UNION ALL SELECT 'private_attachments',count(*),coalesce(sum(octet_length(content)),0)::text,count(*) FILTER(WHERE octet_length(content)<>size_bytes OR encode(sha256(content),'hex')<>sha256) FROM public.private_attachments
) d ORDER BY table_name;`;
const balanceSql=`SELECT json_build_object('unbalanced',count(*)) FROM (SELECT je.id FROM public.journal_entries je LEFT JOIN public.journal_lines jl ON jl.journal_entry_id=je.id WHERE je.status='POSTED' GROUP BY je.id HAVING coalesce(sum(jl.debit_minor-jl.credit_minor),0)<>0) q;`;

function privateFile(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('A regular owner-only private file is required');}
function command(binary,args,{input,env,timeout=120000}={}){
  const result=spawnSync(binary,args,{cwd:repository,input,encoding:'utf8',env:{...process.env,...env},timeout,maxBuffer:16*1024*1024});
  if(result.status!==0||result.error)throw new Error(`Recovery ${path.basename(binary)} command failed; no child output or credentials logged`);
  return result.stdout.trim();
}
const lines=output=>output.split('\n').filter(Boolean).map(line=>JSON.parse(line));

export async function runRestoreDrill(options){
  privateFile(path.join(options.privateDirectory,'api.json'));privateFile(path.join(options.privateDirectory,'backup-key'));privateFile(options.credentialsFile);
  const config=JSON.parse(fs.readFileSync(path.join(options.privateDirectory,'api.json'),'utf8')),compose=parseCompose(fs.readFileSync(path.join(options.privateDirectory,'compose.env'),'utf8')),plan=restorePlan(config,compose,options);
  const credentials=JSON.parse(fs.readFileSync(plan.credentialsFile,'utf8'));if(!credentials.email||!(credentials.password||credentials.temporaryPassword))throw new Error('Private current named-owner credentials required');
  const key=fs.readFileSync(path.join(plan.privateDirectory,'backup-key'),'utf8').trim();if(!/^[a-f0-9]{64}$/i.test(key))throw new Error('Retained operational backup key is invalid');
  for(const directory of [plan.backupDirectory,plan.evidenceDirectory]){fs.mkdirSync(directory,{recursive:true,mode:0o700});if((fs.statSync(directory).mode&0o077)!==0)throw new Error('Backup/evidence directories must be owner-only');}
  const runDirectory=fs.mkdtempSync(path.join(plan.evidenceDirectory,'restore-')),privateDirectory=path.join(runDirectory,'private');fs.mkdirSync(privateDirectory,{mode:0o700});
  const evidence={status:'FAIL',startedAt:new Date().toISOString(),sourceResource:plan.sourceResource,sourceDatabase:plan.source,targetDatabase:plan.target,targetResource:plan.resource,scope:'Actual staging same-host encrypted logical recovery; off-host disaster recovery and production RPO/RTO are not claimed',phase:'identity'};
  const started=performance.now(),composeArgs=['compose','--env-file',path.join(plan.privateDirectory,'compose.env'),'-f',path.join(repository,'deploy/hetzner/compose.yaml')];
  const docker=(args,settings)=>command('docker',args,settings);
  const serviceId=service=>{const ids=docker([...composeArgs,'ps','-q',service]).split('\n').filter(Boolean);if(ids.length!==1||!/^[a-f0-9]{12,64}$/.test(ids[0]))throw new Error('Expected one running staging service container');return ids[0];};
  let created=false,apiCreated=false,sourceBefore,archive;
  try{
    const pgId=serviceId('av8-postgres'),apiId=serviceId('api'),pgContainer=JSON.parse(docker(['inspect',pgId]))[0],apiContainer=JSON.parse(docker(['inspect',apiId]))[0];
    assertContainer(pgContainer,'av8-postgres');assertContainer(apiContainer,'api');
    const networks=Object.keys(pgContainer.NetworkSettings.Networks||{});if(networks.length!==1)throw new Error('Database must have one dedicated internal network');
    const network=JSON.parse(docker(['network','inspect',networks[0]]))[0];if(network.Internal!==true||network.Labels?.['com.docker.compose.project']!=='av8-delivery-staging'||!apiContainer.NetworkSettings.Networks[networks[0]])throw new Error('Dedicated staging internal database network required');
    const image=apiContainer.Image;if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Exact local API image ID required');evidence.apiImage=image;
    const sql=(database,query)=>lines(docker(['exec','-i',pgId,'psql','-X','-qAt','--set=ON_ERROR_STOP=1','--username=av8_bootstrap',`--dbname=${database}`],{input:query}));
    const identity=sql(plan.source,"SELECT json_build_object('database',current_database(),'resource',resource) FROM av8_guard.av8_environment_identity;");
    if(identity.length!==1||identity[0].database!==plan.source||identity[0].resource!==plan.sourceResource)throw new Error('Actual staging source marker mismatch');
    const sourceState=sql(plan.source,"SELECT json_build_object('migrations',(SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),'applications',(SELECT count(*) FROM public.av8_applications),'reports',(SELECT count(*) FROM public.av8_records WHERE kind='progress'));")[0];
    const expectedMigrations=fs.readdirSync(path.join(repository,'apps/api/prisma/migrations')).filter(name=>fs.existsSync(path.join(repository,'apps/api/prisma/migrations',name,'migration.sql'))).length;
    if(sourceState.migrations!==expectedMigrations||sourceState.applications<1||sourceState.reports<1)throw new Error('Expected all source migrations and actual staging application/report evidence');
    const filesBefore=sql(plan.source,documentSql);if(filesBefore.some(file=>file.invalid!==0)||!filesBefore.some(file=>file.table==='av8_attachments'&&file.count>0))throw new Error('Source attachment content/hash acceptance failed');
    sourceBefore=sql(plan.source,manifestSql);evidence.phase='backup';
    const backup=JSON.parse(command(process.execPath,[path.join(repository,'deploy/hetzner/backup.mjs'),plan.privateDirectory,plan.backupDirectory]));archive=backup.archive;
    if(!backup.ok||!inside(plan.backupDirectory,path.resolve(archive))||!archive.endsWith('.dump.enc'))throw new Error('Backup archive escaped its dedicated directory');
    const backupMeta=JSON.parse(fs.readFileSync(archive+'.json','utf8'));if(backupMeta.sourceResource!==plan.sourceResource||backupMeta.encryption!=='AES-256-GCM')throw new Error('Encrypted archive source identity mismatch');
    const plain=path.join(privateDirectory,'restore.dump');command(process.execPath,[path.join(repository,'deploy/hetzner/decrypt-backup.mjs'),archive,path.join(plan.privateDirectory,'backup-key'),plain]);
    evidence.archive=archive;evidence.backupSha256=backupMeta.sha256Plaintext;evidence.encryptedSha256=digest(fs.readFileSync(archive));evidence.encryptedBytes=fs.statSync(archive).size;evidence.backupKeyRetained=true;evidence.phase='restore';
    // Identifiers are generated locally; no caller-supplied target or cleanup name is accepted.
    sql('postgres',`CREATE DATABASE ${identifier(plan.target)} OWNER ${identifier(plan.owner)} TEMPLATE template0;`);created=true;
    sql(plan.target,`REVOKE ALL ON DATABASE ${identifier(plan.target)} FROM PUBLIC;GRANT CONNECT ON DATABASE ${identifier(plan.target)} TO ${identifier(plan.owner)},av8_runtime;CREATE SCHEMA av8_guard;CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY);INSERT INTO av8_guard.av8_environment_identity VALUES(${literal(plan.resource)});GRANT USAGE ON SCHEMA av8_guard TO ${identifier(plan.owner)},av8_runtime;GRANT SELECT ON av8_guard.av8_environment_identity TO ${identifier(plan.owner)},av8_runtime;`);
    docker(['exec','-i',pgId,'pg_restore','--exit-on-error','--no-owner',`--role=${plan.owner}`,'--username=av8_bootstrap',`--dbname=${plan.target}`],{input:fs.readFileSync(plain)});fs.unlinkSync(plain);
    const restored=sql(plan.target,manifestSql),filesAfter=sql(plan.target,documentSql);
    if(JSON.stringify(sourceBefore)!==JSON.stringify(restored)||JSON.stringify(filesBefore)!==JSON.stringify(filesAfter))throw new Error('Restored public table/attachment manifest differs from source');
    if(sql(plan.target,balanceSql)[0].unbalanced!==0)throw new Error('Restored posted journals do not balance');
    if(JSON.stringify(sourceBefore)!==JSON.stringify(sql(plan.source,manifestSql)))throw new Error('Staging writers changed the source during backup; preserve evidence and repeat quiescent');
    Object.assign(evidence,{migrations:sourceState.migrations,tableCount:restored.length,rowCount:restored.reduce((sum,row)=>sum+Number(row.rows),0),manifestSha256:digest(JSON.stringify(restored)),attachments:filesAfter,unbalancedPostedJournals:0,cleanRestore:true,sourceUnchangedAtRestore:true});
    fs.writeFileSync(path.join(runDirectory,'public-manifest.json'),JSON.stringify(restored,null,2)+'\n',{flag:'wx',mode:0o600});
    const writePrivate=(name,value)=>{const file=path.join(privateDirectory,name);fs.writeFileSync(file,value,{flag:'wx',mode:0o600});if(process.getuid?.()===0)fs.chownSync(file,1000,1000);return file;};
    const recoveryConfig=writePrivate('api.json',JSON.stringify(plan.recovery)),recoveryCredentials=writePrivate('credentials.json',JSON.stringify(credentials)),provider=writePrivate('provider.env','# Recovery has no provider credentials or enabled sends.\n');
    evidence.phase='application';
    docker(['run','--detach','--pull=never','--name',plan.container,'--label',`av8.recovery.resource=${plan.resource}`,'--network',networks[0],'--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges:true','--pids-limit=150','--memory=512m','--cpus=1','--mount',`type=bind,src=${recoveryConfig},dst=/run/secrets/api_config,readonly`,'--mount',`type=bind,src=${recoveryCredentials},dst=/run/secrets/recovery_credentials,readonly`,'--mount',`type=bind,src=${provider},dst=/run/secrets/provider_config,readonly`,'--mount',`type=bind,src=${path.join(repository,'deploy/hetzner/restore-verify.mjs')},dst=/run/restore-verify.mjs,readonly`,image,'api']);apiCreated=true;
    let healthy=false;for(let attempt=0;attempt<40;attempt++){
      const probe=spawnSync('docker',['exec',plan.container,'node','-e',"fetch('http://127.0.0.1:8181/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],{stdio:'ignore',timeout:4000});
      if(probe.status===0){healthy=true;break;}await new Promise(resolve=>setTimeout(resolve,500));
    }if(!healthy)throw new Error('Restored API did not become healthy');
    const application=JSON.parse(docker(['exec',plan.container,'node','/run/restore-verify.mjs']));if(application.status!=='PASS')throw new Error('Restored application acceptance failed');
    if(JSON.stringify(sourceBefore)!==JSON.stringify(sql(plan.source,manifestSql)))throw new Error('Staging source changed during application recovery acceptance');
    Object.assign(evidence,application,{status:'PASS',sourceUnchangedAtCompletion:true,finishedAt:new Date().toISOString(),elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(3)),phase:'cleanup'});
  }catch(error){evidence.error='Recovery gate failed; see phase and private configuration. Source was not altered by this helper.';throw error;}
  finally{
    let cleanup=true;
    try{if(apiCreated){const container=JSON.parse(docker(['inspect',plan.container]))[0];if(container.Config?.Labels?.['av8.recovery.resource']!==plan.resource)throw new Error('Cleanup identity mismatch');docker(['rm','--force',plan.container]);}}catch{cleanup=false;}
    try{if(created){const pgId=serviceId('av8-postgres');assertContainer(JSON.parse(docker(['inspect',pgId]))[0],'av8-postgres');docker(['exec','-i',pgId,'psql','-X','-qAt','--set=ON_ERROR_STOP=1','--username=av8_bootstrap','--dbname=postgres'],{input:`DROP DATABASE ${identifier(plan.target)} WITH (FORCE);`});}}catch{cleanup=false;}
    for(const name of ['restore.dump','api.json','credentials.json','provider.env']){const file=path.join(privateDirectory,name);if(fs.existsSync(file))fs.unlinkSync(file);}fs.rmdirSync(privateDirectory);
    evidence.recoveryResourcesRemoved=cleanup;evidence.retainedEncryptedArchive=!!archive&&fs.existsSync(archive);evidence.finishedAt ||= new Date().toISOString();if(!cleanup)evidence.status='FAIL';
    fs.writeFileSync(path.join(runDirectory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
    if(evidence.status==='PASS'){const metadata=JSON.parse(fs.readFileSync(archive+'.json','utf8'));metadata.restoreVerified=true;metadata.restoreEvidence=path.join(runDirectory,'evidence.json');metadata.restoreVerifiedAt=evidence.finishedAt;fs.writeFileSync(archive+'.json',JSON.stringify(metadata,null,2)+'\n',{mode:0o600});}
    console.log(JSON.stringify({status:evidence.status,evidence:path.join(runDirectory,'evidence.json'),archive:archive||null,recoveryResourcesRemoved:cleanup,secretsPrinted:false}));
  }
  return evidence;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i];if(key==='--writers-quiesced'){options.writersQuiesced=true;continue;}if(!['--private-directory','--backup-directory','--evidence-directory','--credentials-file'].includes(key)||!process.argv[i+1])throw new Error('Invalid recovery arguments');options[key.slice(2).replace(/-([a-z])/g,(_,value)=>value.toUpperCase())]=process.argv[++i];}const evidence=await runRestoreDrill(options);if(evidence.status!=='PASS')process.exitCode=1;}
  catch{console.error('Isolated staging recovery failed closed; no credentials or raw command output were printed.');process.exitCode=1;}
}
