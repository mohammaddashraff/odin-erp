import { authenticateAv8Scheduler, schedulerConfiguration } from './av8-scheduler-config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

describe('AV8 hosted scheduler credentials and bounds',()=>{
  const configured=()=>({AV8_SCHEDULER_ENABLED:'true',AV8_SCHEDULER_SECRET:'synthetic-scheduler-secret-never-used-by-hosting',AV8_OPERATIONS_WORKER_ENABLED:'true',AV8_OPERATIONS_WORKER_USER_ID:'4'});
  it('fails closed while disabled or missing the named identity and distinct secret',()=>{
    expect(()=>authenticateAv8Scheduler('Bearer arbitrary',{})).toThrow(ServiceUnavailableException);
    expect(schedulerConfiguration({...configured(),AV8_SCHEDULER_SECRET:''}).configured).toBe(false);
    expect(schedulerConfiguration({...configured(),AV8_OPERATIONS_WORKER_USER_ID:''}).configured).toBe(false);
    expect(schedulerConfiguration({...configured(),AV8_OPERATIONS_WORKER_ENABLED:'false'}).configured).toBe(false);
    expect(schedulerConfiguration({...configured(),ODIN_TOKEN_SECRET:configured().AV8_SCHEDULER_SECRET}).configured).toBe(false);
  });
  it('validates the exact bearer token without accepting a session or overlong value',()=>{
    const env=configured();expect(authenticateAv8Scheduler(`Bearer ${env.AV8_SCHEDULER_SECRET}`,env).configured).toBe(true);
    for(const header of [undefined,`bearer ${env.AV8_SCHEDULER_SECRET}`,'Bearer wrong',`Bearer ${'x'.repeat(513)}`])expect(()=>authenticateAv8Scheduler(header,env)).toThrow(UnauthorizedException);
    expect(schedulerConfiguration({...env,AV8_SCHEDULER_SECRET:'x'.repeat(513)}).configured).toBe(false);
  });
  it('bounds each invocation and rejects malformed limits',()=>{
    expect(schedulerConfiguration(configured())).toMatchObject({applicationLimit:20,dispatchLimit:1});
    for(const value of ['0','51','1.5','NaN'])expect(schedulerConfiguration({...configured(),AV8_SCHEDULER_APPLICATION_LIMIT:value}).configured).toBe(false);
    for(const value of ['0','3','1.5','Infinity'])expect(schedulerConfiguration({...configured(),AV8_SCHEDULER_DISPATCH_LIMIT:value}).configured).toBe(false);
  });
});
