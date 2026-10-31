import fs from 'node:fs';
import {spawn} from 'node:child_process';
const mode=process.argv[2],file=mode==='web'?'/run/secrets/web_config':'/run/secrets/api_config';
const configuration=JSON.parse(fs.readFileSync(file,'utf8'));
for(const [key,value]of Object.entries(configuration)){
  if(!/^(AV8_|ODIN_|DATABASE_|API_|NEXT_PUBLIC_|NODE_ENV$|ENABLE_SWAGGER$|PORT$)/.test(key)||typeof value!=='string')throw new Error('Invalid private application configuration');
  process.env[key]=value;
}
if(mode!=='web'){
  const {loadProviderConfiguration}=await import('./provider-config.mjs');
  try{loadProviderConfiguration('/run/secrets/provider_config');}catch{console.error('Private provider configuration is invalid; no provider values are logged');process.exit(1);}
}
const commands={api:['.av8/api/src/main.js'],web:['apps/web/server.js'],migrate:['node_modules/prisma/build/index.js','migrate','deploy','--config','apps/api/prisma.config.ts'],integrity:['.av8/api/src/scripts/av8-integrity.js'],bootstrap:['.av8/api/src/scripts/av8-first-owner.js'],monitor:['deploy/hetzner/monitor.mjs']};
if(!Object.hasOwn(commands,mode))throw new Error('Unsupported deployment operation');
const child=spawn(process.execPath,[...commands[mode],...process.argv.slice(3)],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Deployment process could not start');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
