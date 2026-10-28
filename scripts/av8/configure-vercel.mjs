import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';

// CLI owns authentication. Secret values travel through stdin, never argv/logs.
const root=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
const cli=process.argv[2];
if(!cli||!fs.existsSync(cli))throw new Error('Pass the installed Vercel CLI entrypoint');
const source=dotenv.parse(fs.readFileSync(path.join(root,'.av8/production.env')));
const apiKeys=['AV8_ENV','AV8_SIMPLE_LOGIN','AV8_OUTBOUND','AV8_JOBS','DATABASE_URL','DATABASE_ADMIN_URL','DATABASE_URL_UNPOOLED','ODIN_WEB_ORIGIN','ODIN_ALLOWED_ORIGINS','ODIN_TOKEN_SECRET','ODIN_MFA_ENCRYPTION_KEY','ODIN_REQUIRE_PRIVILEGED_MFA','ODIN_ALLOW_SHARED_DEMO_LOGINS','ENABLE_SWAGGER'];
const api=Object.fromEntries(apiKeys.map(key=>{if(!source[key])throw new Error(`Missing ${key}`);return [key,source[key]];}));
api.ODIN_ATTACHMENT_MAX_BYTES=String(4*1024*1024);
const web={AV8_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',API_ORIGIN:'https://av8-erp-api.vercel.app',ODIN_UI_BUILD_DIR:'.next',NEXT_PUBLIC_ODIN_DEMO_MODE:'false'};
for(const [project,values] of [['prj_iHlpBv6jtRpJLOOHwNOyitAeovck',api],['prj_uhdt4Zm1BiauDHJeHoMa1ccO2GvG',web]]){
  for(const [key,value] of Object.entries(values)){
    const secret=/DATABASE|SECRET|ENCRYPTION_KEY/.test(key);
    const result=spawnSync(process.execPath,[cli,'env','add',key,'production','--force','--yes',secret?'--sensitive':'--no-sensitive','--project',project,'--scope','muhammadashraf-s-projects','--non-interactive'],{cwd:root,input:value,encoding:'utf8'});
    if(result.status!==0){fs.writeFileSync(path.join(root,'.av8/vercel-env-error.log'),(result.stdout||'')+(result.stderr||''),{mode:0o600});throw new Error(`Could not configure ${project}: ${key}; inspect private log`);}
    console.log(`Configured ${project}: ${key}`);
  }
}
