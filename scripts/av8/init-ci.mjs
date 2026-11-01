/** Fresh ephemeral CI PostgreSQL only; refuses existing data, never prints credentials. */
import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true')throw new Error('Restricted to ephemeral GitHub Actions; use init-native.mjs locally.');
const admin=new URL(process.env.AV8_CI_ADMIN_URL||'');
if(admin.hostname!=='127.0.0.1'||admin.port!=='5549'||admin.pathname!=='/av8_test'||admin.username!=='av8_owner')throw new Error('CI database identity mismatch');
if(fs.existsSync('.av8/test.env'))throw new Error('Refusing to overwrite CI configuration');
const db=new pg.Client({connectionString:admin.href});await db.connect();
try{
 if((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")).rows[0].n!==0)throw new Error('CI initializer requires an empty database');
 const secret=()=>randomBytes(32).toString('hex'),password=secret();
 await db.query(`CREATE ROLE av8_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT`);
 await db.query("CREATE SCHEMA av8_guard; CREATE TABLE av8_guard.av8_environment_identity(resource text PRIMARY KEY); GRANT USAGE ON SCHEMA av8_guard TO av8_runtime; GRANT SELECT ON av8_guard.av8_environment_identity TO av8_runtime; INSERT INTO av8_guard.av8_environment_identity VALUES ('av8-erp-test'); REVOKE ALL ON DATABASE av8_test FROM PUBLIC; GRANT CONNECT ON DATABASE av8_test TO av8_runtime;");
 const runtime=new URL(admin);runtime.username='av8_runtime';runtime.password=password;
 const env={AV8_ENV:'test',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',DATABASE_ADMIN_URL:admin.href,DATABASE_URL:runtime.href,API_PORT:'8181',API_ORIGIN:'http://127.0.0.1:8181',ODIN_WEB_ORIGIN:'http://127.0.0.1:8180',ODIN_ALLOWED_ORIGINS:'http://127.0.0.1:8180',ODIN_TOKEN_SECRET:secret(),ODIN_MFA_ENCRYPTION_KEY:secret(),ODIN_REQUIRE_PRIVILEGED_MFA:'false',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',NEXT_PUBLIC_ODIN_DEMO_MODE:'false',ODIN_UI_BUILD_DIR:'.next-av8',NODE_ENV:'test',AV8_BOOTSTRAP_PASSWORD:secret()};
 fs.mkdirSync('.av8',{recursive:true,mode:0o700});fs.writeFileSync('.av8/test.env',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
 console.log('Created fresh isolated CI database identity and private test configuration.');
}finally{await db.end();}
