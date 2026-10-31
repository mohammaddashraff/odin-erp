import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function deploymentConfiguration({mode,directory,imageTag,origin,webPort,providerConfigFile}){
  if(!['production','staging'].includes(mode)||!directory||!path.isAbsolute(directory)||!/^[A-Za-z0-9_./-]+$/.test(directory)||!/^[A-Za-z0-9_.-]{7,100}$/.test(imageTag||''))throw new Error('Provide production|staging, a private absolute directory and reviewed image tag');
  const port=Number(webPort|| (mode==='staging'?18180:18181));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose an unused nonprivileged loopback port');
  const publicOrigin=origin||(mode==='production'?'https://av8.odin-ltd.com':`http://127.0.0.1:${port}`),url=new URL(publicOrigin);
  if(url.origin!==publicOrigin||url.username||url.password||mode==='production'&&publicOrigin!=='https://av8.odin-ltd.com'||mode==='staging'&&(url.hostname==='av8.odin-ltd.com'||!(url.protocol==='https:'||url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)===port)))throw new Error('Choose the approved production origin or a distinct explicit staging origin');
  const secret=()=>randomBytes(32).toString('hex'),token=randomBytes(6).toString('hex'),prefix=mode==='production'?'av8_prod_':'av8_staging_',deploymentId=`av8-delivery-${mode}-${token}`,database=`${prefix}${token}`,owner=`${prefix}owner_${token}`,ownerPassword=secret(),runtimePassword=secret();
  const shared={AV8_HOSTING:'hetzner',AV8_ENV:mode,NODE_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',AV8_HETZNER_DEPLOYMENT_ID:deploymentId,AV8_HETZNER_RESOURCE:`av8-erp-${mode}:${deploymentId}`,ODIN_PUBLIC_ORIGIN:publicOrigin,ODIN_WEB_ORIGIN:publicOrigin,ODIN_ALLOWED_ORIGINS:publicOrigin,API_ORIGIN:'http://api:8181',ODIN_REQUIRE_PRIVILEGED_MFA:'true',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',NEXT_PUBLIC_ODIN_DEMO_MODE:'false',ODIN_UI_BUILD_DIR:'.next',...(mode==='staging'?{AV8_STAGING_PUBLIC_ORIGIN:publicOrigin}:{})};
  const api={...shared,AV8_HETZNER_DB_HOST:'av8-postgres',AV8_HETZNER_DB_NAME:database,AV8_HETZNER_DB_ADMIN_ROLE:owner,AV8_DB_TRANSPORT:'PRIVATE_CONTAINER_NETWORK',DATABASE_ADMIN_URL:`postgresql://${owner}:${ownerPassword}@av8-postgres:5432/${database}?sslmode=disable`,DATABASE_URL:`postgresql://av8_runtime:${runtimePassword}@av8-postgres:5432/${database}?sslmode=disable`,ODIN_TOKEN_SECRET:secret(),ODIN_MFA_ENCRYPTION_KEY:secret(),PORT:'8181',API_PORT:'8181',ENABLE_SWAGGER:'false',AV8_ACADEMIC_EMAIL_ENABLED:'false',AV8_ACADEMIC_EMAIL_PROVIDER:'resend',AV8_ACADEMIC_EMAIL_FROM:'',AV8_ACADEMIC_EMAIL_REPLY_TO:'',AV8_ACADEMIC_EMAIL_API_KEY:'',AV8_ACADEMIC_TEST_RECIPIENTS:'',AV8_ACADEMIC_WORKER_ENABLED:'false',AV8_OPERATIONS_WORKER_ENABLED:'false',AV8_SCHEDULER_ENABLED:'false',AV8_SCHEDULER_SECRET:secret(),AV8_SCHEDULER_APPLICATION_LIMIT:'20',AV8_SCHEDULER_DISPATCH_LIMIT:'1',AV8_ALERT_EMAIL_ENABLED:'false',AV8_ALERT_EMAIL_TO:''};
  const productionProviderFile=path.join(path.resolve(directory),'provider.env');
  const providerFile=providerConfigFile||(mode==='production'?productionProviderFile:'/srv/av8-erp-final/private/resend.env');if(!path.isAbsolute(providerFile)||!/^[A-Za-z0-9_./-]+$/.test(providerFile))throw new Error('Choose an absolute private provider file path');
  if(mode==='production'&&path.resolve(providerFile)!==productionProviderFile)throw new Error('Production requires its own private provider.env; staging credentials must not be reused');
  const compose={AV8_COMPOSE_PROJECT:mode==='staging'?'av8-delivery-staging':'av8-delivery-prod',AV8_PRIVATE_DIR:path.resolve(directory),AV8_IMAGE_TAG:imageTag,AV8_POSTGRES_IMAGE:'postgres:17-alpine',AV8_WEB_PORT:String(port),AV8_DATABASE_NAME:database,AV8_PROVIDER_CONFIG_FILE:providerFile};
  const databaseValues={AV8_DATABASE_NAME:database,AV8_DATABASE_OWNER:owner,AV8_DATABASE_OWNER_PASSWORD:ownerPassword,AV8_DATABASE_RUNTIME_PASSWORD:runtimePassword,AV8_DATABASE_RESOURCE:api.AV8_HETZNER_RESOURCE};
  return{api,web:shared,compose,databaseValues,postgresPassword:secret(),backupKey:secret()};
}
export function writeConfiguration(options){
  const configuration=deploymentConfiguration(options),directory=path.resolve(options.directory);
  if(fs.existsSync(directory))throw new Error('Refusing to replace saved credentials or an existing deployment directory');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const write=(name,value)=>{const file=path.join(directory,name);fs.writeFileSync(file,value,{flag:'wx',mode:0o600});if(process.getuid?.()===0){const uid=['database.env','postgres-password'].includes(name)?70:['api.json','web.json','provider.env'].includes(name)?1000:0;fs.chownSync(file,uid,uid);}};
  if(!fs.existsSync(configuration.compose.AV8_PROVIDER_CONFIG_FILE)){write('provider.env','# Optional provider values remain empty; email switches stay disabled.\n');configuration.compose.AV8_PROVIDER_CONFIG_FILE=path.join(directory,'provider.env');}
  write('api.json',JSON.stringify(configuration.api,null,2)+'\n');write('web.json',JSON.stringify(configuration.web,null,2)+'\n');
  write('compose.env',Object.entries(configuration.compose).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');
  write('database.env',Object.entries(configuration.databaseValues).map(([key,value])=>`${key}='${value}'`).join('\n')+'\n');
  write('postgres-password',configuration.postgresPassword+'\n');write('backup-key',configuration.backupKey+'\n');
  fs.mkdirSync(path.join(directory,'bootstrap'),{mode:0o700});if(process.getuid?.()===0)fs.chownSync(path.join(directory,'bootstrap'),1000,1000);
  return{directory,project:configuration.compose.AV8_COMPOSE_PROJECT,origin:configuration.api.ODIN_PUBLIC_ORIGIN,containerUid:1000,secretsPrinted:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try{const values={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--mode','--directory','--image-tag','--origin','--web-port','--provider-config-file'].includes(key)||!process.argv[i+1])throw new Error('Invalid deployment configuration arguments');values[key.slice(2).replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=process.argv[i+1];}console.log(JSON.stringify(writeConfiguration(values)));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
