import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { isIP } from 'node:net';
import { schedulerConfiguration } from './av8-scheduler-config';
import { academicEmailConfiguration, academicAddress } from './av8-academic-email';
import { mfaEncryptionKey } from './deployment-config';

export const av8ProductionIdentity = {host:'ep-billowing-dust-ba5ea0c4.c-8.eu-central-1.aws.neon.tech',database:'neondb',adminRole:'neondb_owner',resource:'av8-erp-production:cool-meadow-67774901',projectId:'prj_iHlpBv6jtRpJLOOHwNOyitAeovck',webProjectId:'prj_uhdt4Zm1BiauDHJeHoMa1ccO2GvG'};

/** Configuration only: the server separately verifies these identities over both connections. */
export function av8StagingIdentity(env:NodeJS.ProcessEnv=process.env) {
  const host=env.AV8_STAGING_DB_HOST||'',poolerHost=env.AV8_STAGING_DB_POOLER_HOST||'',database=env.AV8_STAGING_DB_NAME||'',adminRole=env.AV8_STAGING_DB_ADMIN_ROLE||'',resource=env.AV8_STAGING_RESOURCE||'',projectId=env.AV8_STAGING_PROJECT_ID||'';
  const validHost=(value:string)=>/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(value)&&!value.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-'))&&!['localhost',av8ProductionIdentity.host,av8ProductionIdentity.host.replace('.c-8','-pooler.c-8')].includes(value);
  if(!validHost(host)||(poolerHost&&!validHost(poolerHost))||!/^av8_staging_[a-z0-9_]{1,50}$/.test(database)||!/^av8_staging_[a-z0-9_]{1,50}$/.test(adminRole)||!/^av8-erp-staging:[a-zA-Z0-9_-]{1,100}$/.test(resource)||!/^prj_[a-zA-Z0-9]+$/.test(projectId)||[av8ProductionIdentity.projectId,av8ProductionIdentity.webProjectId].includes(projectId))throw new Error('Configure a distinct explicit AV8 staging database, owner, resource marker and project identity');
  return {host,poolerHost,database,adminRole,resource,projectId};
}

export function av8PrivateDatabaseAddress(value:unknown) {
  if(typeof value!=='string')return false;
  if(isIP(value)===6)return value==='::1'||/^f[cd]/i.test(value);
  if(isIP(value)!==4)return false;
  const octets=value.split('.').map(Number);return octets[0]===10||octets[0]===127||octets[0]===192&&octets[1]===168||octets[0]===172&&octets[1]>=16&&octets[1]<=31;
}

export function av8HetznerIdentity(env:NodeJS.ProcessEnv=process.env) {
  const kind=env.AV8_ENV,host=env.AV8_HETZNER_DB_HOST||'',database=env.AV8_HETZNER_DB_NAME||'',adminRole=env.AV8_HETZNER_DB_ADMIN_ROLE||'',resource=env.AV8_HETZNER_RESOURCE||'',deploymentId=env.AV8_HETZNER_DEPLOYMENT_ID||'',transport=env.AV8_DB_TRANSPORT||'TLS';
  const prefix=kind==='production'?'av8_prod_':'av8_staging_',pattern=new RegExp(`^${prefix}[a-z0-9_]{1,50}$`);
  const validHost=transport==='PRIVATE_CONTAINER_NETWORK'?host==='av8-postgres':/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)&&![av8ProductionIdentity.host,av8ProductionIdentity.host.replace('.c-8','-pooler.c-8')].includes(host);
  if(!['production','staging'].includes(kind||'')||!['TLS','PRIVATE_CONTAINER_NETWORK'].includes(transport)||!validHost||!pattern.test(database)||!pattern.test(adminRole)||!/^[a-z0-9][a-z0-9_-]{7,99}$/.test(deploymentId)||resource!==`av8-erp-${kind}:${deploymentId}`||resource===av8ProductionIdentity.resource)throw new Error('Configure an explicit separate Hetzner database, owner, deployment and resource identity');
  return{host,database,adminRole,resource,deploymentId,transport};
}

function assertHetznerIsolation(env:NodeJS.ProcessEnv) {
  const identity=av8HetznerIdentity(env),privateDb=identity.transport==='PRIVATE_CONTAINER_NETWORK';
  if(env.NODE_ENV!=='production'||env.VERCEL||env.VERCEL_PROJECT_ID||env.AV8_OUTBOUND!=='disabled'||env.AV8_JOBS!=='disabled')throw new Error('Hetzner requires an isolated production runtime without inherited Vercel or outbound configuration');
  for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING']){
    if(!env[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
    const u=new URL(env[key]||''),allowedTls=privateDb?['disable']:['require','verify-full'];
    if(!['postgresql:','postgres:'].includes(u.protocol)||u.hostname!==identity.host||u.pathname!==`/${identity.database}`||u.username!==(key==='DATABASE_URL'?'av8_runtime':identity.adminRole)||!u.password||(u.port&&u.port!=='5432')||!allowedTls.includes(u.searchParams.get('sslmode')||'')||[...u.searchParams.keys()].some(name=>name!=='sslmode'||u.searchParams.getAll(name).length!==1)||u.hash)throw new Error(`${key} is not the explicit isolated Hetzner database transport and identity`);
  }
  if(env.AV8_SIMPLE_LOGIN==='true'||env.ODIN_REQUIRE_PRIVILEGED_MFA!=='true'||env.ODIN_ALLOW_SHARED_DEMO_LOGINS!=='false'||env.ODIN_DEPLOYMENT_MODE==='demo'||env.NEXT_PUBLIC_ODIN_DEMO_MODE==='true'||!env.ODIN_TOKEN_SECRET||env.ODIN_TOKEN_SECRET.length<40||!env.ODIN_MFA_ENCRYPTION_KEY||env.ODIN_MFA_ENCRYPTION_KEY===env.ODIN_TOKEN_SECRET)throw new Error('Hetzner requires dedicated secrets and the secure hosted authentication mode');
  mfaEncryptionKey(env);
  const origin=env.ODIN_WEB_ORIGIN||'',url=new URL(origin);
  const loopback=env.AV8_ENV==='staging'&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>=1024&&Number(url.port)<=65535&&env.AV8_STAGING_PUBLIC_ORIGIN===origin;
  if(env.ODIN_PUBLIC_ORIGIN!==origin||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.origin!==origin||!loopback&&url.protocol!=='https:'||['av8-erp.vercel.app','av8-erp-api.vercel.app','odin-erp-web.vercel.app'].includes(url.hostname)||env.AV8_ENV==='production'&&origin!=='https://av8.odin-ltd.com'||env.AV8_ENV==='staging'&&url.hostname==='av8.odin-ltd.com'||!(env.ODIN_ALLOWED_ORIGINS||'').split(',').every(value=>value.trim()===origin))throw new Error('Hetzner requires the approved production origin or an explicit isolated staging origin');
}

/** Fail closed: inherited Odin environment files are never an AV8 runtime. */
export function assertAv8Isolation(env: NodeJS.ProcessEnv = process.env) {
  if(env.AV8_HOSTING&&!['vercel','hetzner'].includes(env.AV8_HOSTING))throw new Error('Unknown AV8 hosting profile');
  for (const key of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED']) {
    if (env[key] && !['true','false'].includes(env[key]!)) throw new Error(`${key} must be explicitly true or false`);
  }
  const scheduler=schedulerConfiguration(env);if(scheduler.enabled&&scheduler.issues.length)throw new Error(scheduler.issues.join('; '));
  // These named, separately configured academic jobs do not enable inherited integrations.
  const academic = academicEmailConfiguration(env);
  if(env.AV8_OPERATIONS_WORKER_ENABLED==='true'&&!/^[1-9]\d*$/.test(env.AV8_OPERATIONS_WORKER_USER_ID||env.AV8_ACADEMIC_WORKER_USER_ID||''))throw new Error('Configure a scoped AV8_OPERATIONS_WORKER_USER_ID');
  if ((academic.emailEnabled || academic.workerEnabled) && academic.issues.length) throw new Error(academic.issues.join('; '));
  if (academic.emailEnabled && env.AV8_ENV !== 'production') {
    for (const recipient of (env.AV8_ACADEMIC_TEST_RECIPIENTS || '').split(',').filter(Boolean)) academicAddress(recipient);
  }
  if(env.AV8_HOSTING==='hetzner'){assertHetznerIsolation(env);return;}
  if(env.AV8_ENV==='staging') {
    const identity=av8StagingIdentity(env);
    if(env.AV8_OUTBOUND!=='disabled'||env.AV8_JOBS!=='disabled')throw new Error('Hosted AV8 outbound services must remain disabled');
    if(env.NODE_ENV!=='production'||env.VERCEL_PROJECT_ID!==identity.projectId)throw new Error('Staging requires production runtime settings and the explicitly selected staging project');
    for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING']){
      if(!env[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
      const u=new URL(env[key]||''),hosts=key==='DATABASE_URL'?[identity.host,identity.poolerHost].filter(Boolean):[identity.host];
      if(!['postgresql:','postgres:'].includes(u.protocol)||!hosts.includes(u.hostname)||u.pathname!==`/${identity.database}`||u.username!==(key==='DATABASE_URL'?'av8_runtime':identity.adminRole)||!u.password||(u.port&&u.port!=='5432')||!['require','verify-full'].includes(u.searchParams.get('sslmode')||'')||[...u.searchParams.keys()].some(name=>!['sslmode','channel_binding'].includes(name)||u.searchParams.getAll(name).length!==1)||(u.searchParams.has('channel_binding')&&u.searchParams.get('channel_binding')!=='require')||u.hash)throw new Error(`${key} is not the explicitly selected TLS AV8 staging database`);
    }
    if(env.AV8_SIMPLE_LOGIN==='true'||env.ODIN_REQUIRE_PRIVILEGED_MFA!=='true'||env.ODIN_ALLOW_SHARED_DEMO_LOGINS!=='false'||env.ODIN_DEPLOYMENT_MODE==='demo'||env.NEXT_PUBLIC_ODIN_DEMO_MODE==='true'||!env.ODIN_TOKEN_SECRET||env.ODIN_TOKEN_SECRET.length<40||!env.ODIN_MFA_ENCRYPTION_KEY||env.ODIN_MFA_ENCRYPTION_KEY===env.ODIN_TOKEN_SECRET)throw new Error('Staging requires dedicated secrets and the secure hosted authentication mode');
    mfaEncryptionKey(env);
    const origins=[env.ODIN_WEB_ORIGIN,...(env.ODIN_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim())];
    if(origins.some(value=>{try{const url=new URL(value||'');return url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||['av8-erp.vercel.app','av8-erp-api.vercel.app','odin-erp-web.vercel.app'].includes(url.hostname);}catch{return true;}}))throw new Error('Configure explicit HTTPS staging web origins distinct from live AV8/Odin origins');
    return;
  }
  if (env.AV8_ENV === 'production') {
    if(env.AV8_OUTBOUND!=='disabled'||env.AV8_JOBS!=='disabled')throw new Error('Hosted AV8 outbound services must remain disabled');
    const host='ep-billowing-dust-ba5ea0c4.c-8.eu-central-1.aws.neon.tech';
    for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING']){
      if(!env[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
      const u=new URL(env[key]||'');
      if(!['postgresql:','postgres:'].includes(u.protocol)||![host,host.replace('.c-8','-pooler.c-8')].includes(u.hostname)||u.pathname!=='/neondb'||u.username!==(key==='DATABASE_URL'?'av8_runtime':'neondb_owner')||!u.password||!['require','verify-full'].includes(u.searchParams.get('sslmode')||''))throw new Error(`${key} is not the verified AV8 hosted database`);
    }
    if(env.VERCEL==='1'&&env.VERCEL_PROJECT_ID!=='prj_iHlpBv6jtRpJLOOHwNOyitAeovck')throw new Error('Unexpected Vercel project');
    const authenticationModeValid=env.AV8_SIMPLE_LOGIN!=='true'
      &&env.ODIN_REQUIRE_PRIVILEGED_MFA==='true'&&env.ODIN_ALLOW_SHARED_DEMO_LOGINS==='false'
      &&env.ODIN_DEPLOYMENT_MODE!=='demo'&&env.NEXT_PUBLIC_ODIN_DEMO_MODE!=='true';
    if(!env.ODIN_TOKEN_SECRET||env.ODIN_TOKEN_SECRET.length<40||!authenticationModeValid)throw new Error('Hosted AV8 requires dedicated secrets and a verified authentication mode');
    return;
  }
  if (!['dev', 'test'].includes(env.AV8_ENV || '') || env.AV8_OUTBOUND !== 'disabled' || env.AV8_JOBS !== 'disabled')
    throw new Error('Use scripts/av8/run.mjs with an isolated AV8 environment; outbound delivery and inherited jobs must be disabled.');
  const kind = env.AV8_ENV!;
  for (const key of ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'DATABASE_URL_UNPOOLED']) {
    if (!env[key] && key === 'DATABASE_URL_UNPOOLED') continue;
    const u = new URL(env[key] || '');
    if (u.hostname !== '127.0.0.1' || u.port !== (kind === 'test' ? '5549' : '5548') || u.pathname !== `/av8_${kind}`
      || u.username !== (key === 'DATABASE_URL' ? 'av8_runtime' : 'av8_owner') || !u.password)
      throw new Error(`${key} is not an isolated AV8 ${kind} database URL`);
  }
  if (env.POSTGRES_URL_NON_POOLING) throw new Error('Inherited PostgreSQL override is forbidden');
  if (!env.AV8_ROOT || realpathSync(env.AV8_ROOT) !== resolve(env.AV8_ROOT)) throw new Error('AV8_ROOT must be an absolute real directory');
  if (!env.ODIN_TOKEN_SECRET || env.ODIN_TOKEN_SECRET.length < 40) throw new Error('An AV8-specific secret is required');
}
