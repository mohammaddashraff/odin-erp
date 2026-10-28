import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/** Fail closed: inherited Odin environment files are never an AV8 runtime. */
export function assertAv8Isolation(env: NodeJS.ProcessEnv = process.env) {
  if (env.AV8_ENV === 'production') {
    if(env.AV8_OUTBOUND!=='disabled'||env.AV8_JOBS!=='disabled')throw new Error('Hosted AV8 outbound services must remain disabled');
    const host='ep-billowing-dust-ba5ea0c4.c-8.eu-central-1.aws.neon.tech';
    for(const key of ['DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING']){
      if(!env[key]&&['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING'].includes(key))continue;
      const u=new URL(env[key]||'');
      if(!['postgresql:','postgres:'].includes(u.protocol)||![host,host.replace('.c-8','-pooler.c-8')].includes(u.hostname)||u.pathname!=='/neondb'||u.username!==(key==='DATABASE_URL'?'av8_runtime':'neondb_owner')||!u.password||!['require','verify-full'].includes(u.searchParams.get('sslmode')||''))throw new Error(`${key} is not the verified AV8 hosted database`);
    }
    if(env.VERCEL==='1'&&env.VERCEL_PROJECT_ID!=='prj_iHlpBv6jtRpJLOOHwNOyitAeovck')throw new Error('Unexpected Vercel project');
    const simpleLogin=env.AV8_SIMPLE_LOGIN==='true';
    const authenticationModeValid=simpleLogin
      ? env.ODIN_REQUIRE_PRIVILEGED_MFA==='false'&&env.ODIN_ALLOW_SHARED_DEMO_LOGINS==='false'
      : env.ODIN_REQUIRE_PRIVILEGED_MFA==='true'&&env.ODIN_ALLOW_SHARED_DEMO_LOGINS==='false';
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
