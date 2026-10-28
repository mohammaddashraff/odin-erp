import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const create=process.argv.includes('--create');
const run=(args,input)=>{const r=spawnSync('docker',args,{encoding:'utf8',input});if(r.status!==0)throw new Error(`Docker ${args[0]} failed; inspect the AV8 resource locally (secrets suppressed)`);return r.stdout.trim();};
const inspect=(kind,name)=>{const r=spawnSync('docker',[kind,'inspect',name],{encoding:'utf8'});return r.status===0?JSON.parse(r.stdout)[0]:null;};
const secret=()=>randomBytes(32).toString('hex');
if(create){fs.mkdirSync(path.join(root,'.av8'),{recursive:true,mode:0o700});const network=inspect('network','av8-erp-local');if(network&&network.Labels?.app!=='av8-erp')throw new Error('Network identity conflict');if(!network)run(['network','create','--label','app=av8-erp','av8-erp-local']);}
for(const [kind,port] of [['dev',5548],['test',5549]]){
 const envPath=path.join(root,'.av8',`${kind}.env`),name=`av8-erp-${kind}-db`,volume=`av8-erp-${kind}-pg`;
 let created=false;
 if(!fs.existsSync(envPath)){
  if(!create)throw new Error(`Missing private ${kind} environment; use --create for fresh isolated resources`);
  const owner=secret(),runtime=secret();const values={AV8_ENV:kind,AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',DATABASE_ADMIN_URL:`postgresql://av8_owner:${owner}@127.0.0.1:${port}/av8_${kind}`,DATABASE_URL:`postgresql://av8_runtime:${runtime}@127.0.0.1:${port}/av8_${kind}`,API_PORT:'8181',API_ORIGIN:'http://127.0.0.1:8181',ODIN_WEB_ORIGIN:'http://127.0.0.1:8180',ODIN_ALLOWED_ORIGINS:'http://127.0.0.1:8180,http://localhost:8180',ODIN_TOKEN_SECRET:secret(),ODIN_MFA_ENCRYPTION_KEY:secret(),ODIN_REQUIRE_PRIVILEGED_MFA:'false',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',NEXT_PUBLIC_ODIN_DEMO_MODE:'false',ODIN_UI_BUILD_DIR:'.next-av8',NODE_ENV:'development',AV8_BOOTSTRAP_PASSWORD:secret()};
  fs.writeFileSync(envPath,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  fs.writeFileSync(path.join(root,'.av8',`${kind}-postgres.env`),`POSTGRES_USER=av8_owner\nPOSTGRES_PASSWORD=${owner}\nPOSTGRES_DB=av8_${kind}\n`,{mode:0o600});
 }
 const env=dotenv.parse(fs.readFileSync(envPath));const u=new URL(env.DATABASE_ADMIN_URL),v=new URL(env.DATABASE_URL);
 if(u.hostname!=='127.0.0.1'||u.port!==String(port)||u.pathname!==`/av8_${kind}`||u.username!=='av8_owner'||v.username!=='av8_runtime'||v.host!==u.host||v.pathname!==u.pathname)throw new Error('AV8 endpoint identity mismatch');
 let container=inspect('container',name);
 if(!container){
  if(!create)throw new Error(`Missing ${name}`);
  if(inspect('volume',volume))throw new Error(`Existing unbound ${volume}: verify it manually before attaching`);
  run(['image','inspect','postgres:17-alpine']);
  run(['volume','create','--label','app=av8-erp',volume]);
  run(['run','-d','--name',name,'--label','app=av8-erp','--network','av8-erp-local','--memory','192m','--cpus','0.5','--env-file',path.join(root,'.av8',`${kind}-postgres.env`),'-p',`127.0.0.1:${port}:5432`,'-v',`${volume}:/var/lib/postgresql/data`,'postgres:17-alpine']);created=true;container=inspect('container',name);
 }
 if(container.Config?.Labels?.app!=='av8-erp'||!container.Mounts.some(m=>m.Type==='volume'&&m.Name===volume)||container.Mounts.some(m=>m.Type==='bind'))throw new Error('AV8 container ownership or mounts mismatch');
 const bindings=container.HostConfig?.PortBindings?.['5432/tcp'];if(!bindings?.some(b=>b.HostIp==='127.0.0.1'&&b.HostPort===String(port)))throw new Error('AV8 port binding mismatch');
 if(created){
  for(let attempt=0;attempt<30;attempt++){const r=spawnSync('docker',['exec',name,'pg_isready','-U','av8_owner'],{stdio:'ignore'});if(r.status===0)break;await new Promise(resolve=>setTimeout(resolve,500));}
  const password=decodeURIComponent(v.password);if(!/^[a-f0-9]+$/.test(password))throw new Error('Generated credential format invalid');
  run(['exec','-i',name,'psql','-U','av8_owner','-d',`av8_${kind}`,'-v','ON_ERROR_STOP=1'],`CREATE ROLE av8_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT; CREATE SCHEMA av8_guard; CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY); INSERT INTO av8_guard.av8_environment_identity VALUES ('av8-erp-${kind}'); REVOKE ALL ON DATABASE av8_${kind} FROM PUBLIC; GRANT CONNECT ON DATABASE av8_${kind} TO av8_runtime;`);
 }
 const client=new pg.Client({connectionString:env.DATABASE_ADMIN_URL});await client.connect();const r=await client.query('SELECT current_database() AS db, resource FROM av8_guard.av8_environment_identity');await client.end();if(r.rows.length!==1||r.rows[0].resource!==`av8-erp-${kind}`)throw new Error('AV8 database marker mismatch');
 console.log(`${kind}: verified localhost:${port}, av8_${kind}, dedicated volume and identity; credentials redacted`);
}
