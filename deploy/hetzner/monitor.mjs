import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {providerReplyTo,providerSender} from './provider-config.mjs';

const address=value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function alertConfiguration(env){
  if(env.AV8_ALERT_EMAIL_ENABLED!=='true')return{enabled:false};
  const to=env.AV8_ALERT_EMAIL_TO,from=providerSender(env.AV8_ACADEMIC_EMAIL_FROM),replyTo=providerReplyTo(env.AV8_ACADEMIC_EMAIL_REPLY_TO),key=env.AV8_ACADEMIC_EMAIL_API_KEY;
  if(!address(to)||!key||env.AV8_ACADEMIC_EMAIL_PROVIDER!=='resend')throw new Error('Alert provider configuration is incomplete');
  if(env.AV8_ENV!=='production'&&!(env.AV8_ACADEMIC_TEST_RECIPIENTS||'').split(',').map(s=>s.trim().toLowerCase()).includes(to.toLowerCase()))throw new Error('Staging alerts require the explicitly approved recipient allowlist');
  return{enabled:true,to,from,replyTo,key};
}
export async function monitorOnce({env=process.env,store,transport=fetch,now=()=>new Date(),testId}={}){
  const configuration=alertConfiguration(env),previous=await store.load()||{status:'UNKNOWN',alerts:{}},state={...previous,alerts:{...previous.alerts}};
  const save=()=>store.save(state);
  let healthy=true;
  if(testId){if(!/^[A-Za-z0-9_-]{8,80}$/.test(testId))throw new Error('Controlled alert test needs a stable nonprivate test identity');if(!configuration.enabled)throw new Error('Configure and explicitly enable the authorized alert recipient before testing');}
  else{
    try{const health=await transport('http://api:8181/api/health',{signal:AbortSignal.timeout(10000)});healthy=health.ok;
      if(healthy&&env.AV8_SCHEDULER_ENABLED==='true'){const tick=await transport('http://api:8181/api/av8/scheduler/tick',{method:'POST',headers:{Authorization:`Bearer ${env.AV8_SCHEDULER_SECRET}`},signal:AbortSignal.timeout(60000)});healthy=tick.ok;}
    }catch{healthy=false;}
  }
  let event=testId?`TEST:${testId}`:null;
  if(!testId){if(!healthy){if(state.status!=='DOWN')state.episode=randomUUID();event=`DOWN:${state.episode}`;}else if(healthy&&state.status==='DOWN')event=`RECOVERED:${state.episode}`;state.status=healthy?'UP':'DOWN';state.checkedAt=now().toISOString();await save();}
  if(!event||state.alerts[event]||!configuration.enabled)return{healthy,event:!!event,alert:configuration.enabled?'UNCHANGED':'DISABLED'};
  // Persist intent before sending: process death/timeout must never trigger blind duplicate email.
  state.alerts[event]={status:'SENDING',at:now().toISOString()};await save();
  const identity=createHash('sha256').update(`${env.AV8_HETZNER_RESOURCE}:${event}`).digest('hex');
  let status='DELIVERY_UNKNOWN';
  try{const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${configuration.key}`,'Content-Type':'application/json','Idempotency-Key':`av8-monitor-${identity}`},body:JSON.stringify({from:configuration.from,to:[configuration.to],...(configuration.replyTo?{reply_to:configuration.replyTo}:{}),subject:`AV8 ${env.AV8_ENV}: ${testId?'controlled monitoring test':healthy?'service recovered':'service needs attention'}`,text:`${testId?'Controlled AV8 monitoring delivery test.':healthy?'The AV8 health and enabled scheduler checks recovered.':'An AV8 health or enabled scheduler check failed.'}\nEnvironment: ${env.AV8_ENV}.\nInspect the private hosting logs and scoped delivery/checkpoint state. This alert contains no student or financial payload.`}),signal:AbortSignal.timeout(10000)});
    if(response.ok){const result=await response.json();status=typeof result.id==='string'?'ACCEPTED':'DELIVERY_UNKNOWN';if(status==='ACCEPTED')state.alerts[event].providerReference=result.id;}
    else status=response.status>=500?'DELIVERY_UNKNOWN':'FAILED';
  }catch{status='DELIVERY_UNKNOWN';}
  state.alerts[event]={...state.alerts[event],status,completedAt:now().toISOString()};
  // Bound retained history without replaying the active outage or explicit recent controlled tests.
  const entries=Object.entries(state.alerts);if(entries.length>100)state.alerts=Object.fromEntries([...entries.filter(([key])=>state.episode&&key.endsWith(state.episode)),...entries.slice(-98)]);await save();
  return{healthy,event:true,alert:status};
}
async function main(){
  const directory='/var/lib/av8-monitor',lock=path.join(directory,'run.lock'),stateFile=path.join(directory,'state.json');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  try{const existing=fs.statSync(lock);if(Date.now()-existing.mtimeMs<180000){console.log(JSON.stringify({event:'av8.monitor.busy'}));return;}fs.unlinkSync(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
  let handle;try{handle=fs.openSync(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')return;throw error;}
  try{const store={load:async()=>{try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},save:async value=>{const temp=stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(value)+'\n',{mode:0o600});fs.renameSync(temp,stateFile);}};
    const testId=process.argv[2]==='--test-id'?process.argv[3]:undefined;if(process.argv.length>2&&!testId)throw new Error('Unsupported monitoring invocation');
    const result=await monitorOnce({store,testId});console.log(JSON.stringify({...result,triggered:result.event,event:'av8.monitor.result'}));if(!result.healthy||['FAILED','DELIVERY_UNKNOWN'].includes(result.alert))process.exitCode=1;
  }finally{fs.closeSync(handle);fs.unlinkSync(lock);}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error(JSON.stringify({event:'av8.monitor.failed',message:'Monitoring requires operator review; no confidential diagnostic payload is logged'}));process.exitCode=1;});
