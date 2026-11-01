import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export function schedulerConfiguration(env:NodeJS.ProcessEnv=process.env){
  const enabled=env.AV8_SCHEDULER_ENABLED==='true',issues:string[]=[];
  const applicationLimit=Number(env.AV8_SCHEDULER_APPLICATION_LIMIT||20),dispatchLimit=Number(env.AV8_SCHEDULER_DISPATCH_LIMIT||1);
  if(enabled){
    if((env.AV8_SCHEDULER_SECRET||'').length<32||(env.AV8_SCHEDULER_SECRET||'').length>512)issues.push('Configure a distinct AV8 scheduler secret of 32–512 characters');
    if(env.AV8_SCHEDULER_SECRET&&[env.ODIN_TOKEN_SECRET,env.AV8_ACADEMIC_EMAIL_API_KEY].filter(Boolean).includes(env.AV8_SCHEDULER_SECRET))issues.push('Scheduler authorization must use a separate secret from session signing and email delivery');
    if(env.AV8_OPERATIONS_WORKER_ENABLED!=='true'&&env.AV8_ACADEMIC_WORKER_ENABLED!=='true')issues.push('Enable an explicitly configured operational or academic job for scheduled processing');
    if(env.AV8_OPERATIONS_WORKER_ENABLED==='true'&&!/^[1-9]\d*$/.test(env.AV8_OPERATIONS_WORKER_USER_ID||''))issues.push('Configure the scoped operations worker identity');
    if(env.AV8_ACADEMIC_WORKER_ENABLED==='true'&&!/^[1-9]\d*$/.test(env.AV8_ACADEMIC_WORKER_USER_ID||''))issues.push('Configure the scoped academic worker identity');
    if(!Number.isInteger(applicationLimit)||applicationLimit<1||applicationLimit>50)issues.push('Scheduled maintenance batch must contain 1–50 applications');
    if(!Number.isInteger(dispatchLimit)||dispatchLimit<1||dispatchLimit>2)issues.push('Scheduled academic batch must contain 1–2 recipient requests');
  }
  return{enabled,configured:enabled&&issues.length===0,applicationLimit,dispatchLimit,issues};
}
export function authenticateAv8Scheduler(header:unknown,env:NodeJS.ProcessEnv=process.env){
  const config=schedulerConfiguration(env);if(!config.configured)throw new ServiceUnavailableException('AV8 scheduled processing is disabled or incompletely configured');
  const token=typeof header==='string'&&header.startsWith('Bearer ')?header.slice(7):'';
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  const same=timingSafeEqual(hash(token.length<=512?token:''),hash(env.AV8_SCHEDULER_SECRET!));
  if(!token||token.length>512||!same)throw new UnauthorizedException('Valid AV8 scheduler authorization is required');
  return config;
}
