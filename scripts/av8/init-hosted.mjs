import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
const source=dotenv.parse(fs.readFileSync('.av8/neon-production.env'));
const host='ep-billowing-dust-ba5ea0c4.c-8.eu-central-1.aws.neon.tech';
const marker='av8-erp-production:cool-meadow-67774901';
if(source.NEON_PROJECT_ID!=='cool-meadow-67774901'||new URL(source.DATABASE_URL_UNPOOLED).hostname!==host)throw new Error('Unexpected hosted database identity');
const db=new pg.Client({connectionString:source.DATABASE_URL_UNPOOLED});await db.connect();
try {
 const tables=await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'");
 const exists=await db.query("SELECT to_regclass('av8_guard.av8_environment_identity') AS name");
 if(exists.rows[0].name){const check=await db.query('SELECT resource FROM av8_guard.av8_environment_identity');if(check.rows.length!==1||check.rows[0].resource!==marker)throw new Error('Hosted marker mismatch');if(!fs.existsSync('.av8/production.env'))throw new Error('Existing AV8 database requires its saved credentials');console.log('Hosted AV8 identity verified; already initialized');}
 else {
  if(tables.rows[0].n!==0)throw new Error('Refusing to initialize a nonempty hosted database');
  const secret=()=>randomBytes(32).toString('hex'),password=secret();
  await db.query(`CREATE ROLE av8_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT`);
  await db.query('CREATE SCHEMA av8_guard; CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY)');
  await db.query('INSERT INTO av8_guard.av8_environment_identity VALUES ($1)',[marker]);
  await db.query('GRANT USAGE ON SCHEMA av8_guard TO av8_runtime; GRANT SELECT ON av8_guard.av8_environment_identity TO av8_runtime');
  const runtime=new URL(source.DATABASE_URL);runtime.username='av8_runtime';runtime.password=password;
  const env={AV8_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',DATABASE_URL:runtime.href,DATABASE_ADMIN_URL:source.DATABASE_URL_UNPOOLED,DATABASE_URL_UNPOOLED:source.DATABASE_URL_UNPOOLED,ODIN_WEB_ORIGIN:'https://av8-erp.vercel.app',ODIN_ALLOWED_ORIGINS:'https://av8-erp.vercel.app',ODIN_TOKEN_SECRET:secret(),ODIN_MFA_ENCRYPTION_KEY:secret(),ODIN_REQUIRE_PRIVILEGED_MFA:'true',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',AV8_BOOTSTRAP_PASSWORD:secret(),NODE_ENV:'production',ENABLE_SWAGGER:'false'};
  fs.writeFileSync('.av8/production.env',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
  console.log('Initialized new empty AV8 hosted database; separate runtime role and private secrets saved');
 }
 const roles=await db.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname IN (current_user,'av8_runtime')");console.log(JSON.stringify(roles.rows));
} finally {await db.end();}
