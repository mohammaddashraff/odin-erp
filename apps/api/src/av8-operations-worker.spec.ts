import { Av8OperationsService } from './av8-operations.service';

describe('AV8 scheduled processing and redacted monitoring route',()=>{
  const names=['AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_OPERATIONS_WORKER_USER_ID','AV8_SCHEDULER_ENABLED','VERCEL'];
  let original:any,service:Av8OperationsService,maintain:jest.SpyInstance,log:jest.SpyInstance,find:jest.Mock;
  beforeEach(()=>{
    jest.useFakeTimers();original=Object.fromEntries(names.map(n=>[n,process.env[n]]));
    Object.assign(process.env,{AV8_ACADEMIC_WORKER_ENABLED:'false',AV8_OPERATIONS_WORKER_ENABLED:'true',AV8_OPERATIONS_WORKER_USER_ID:'1',AV8_SCHEDULER_ENABLED:'false',VERCEL:'0'});
    find=jest.fn().mockResolvedValue({id:1n,active:true});service=new Av8OperationsService({admin:{user:{findUnique:find}}}as any,{userInclude:{},actorFor:()=>({userId:1n})}as any);
    maintain=jest.spyOn(service,'maintain').mockResolvedValue({}as any);log=jest.spyOn(console,'error').mockImplementation(()=>undefined);
  });
  afterEach(()=>{service.onModuleDestroy();jest.useRealTimers();jest.restoreAllMocks();for(const name of names)if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];});
  it('runs only when explicitly enabled, and cancels its timer on shutdown',async()=>{
    process.env.AV8_OPERATIONS_WORKER_ENABLED='false';service.onModuleInit();await jest.advanceTimersByTimeAsync(60000);expect(maintain).not.toHaveBeenCalled();
    process.env.AV8_OPERATIONS_WORKER_ENABLED='true';service.onModuleInit();await jest.advanceTimersByTimeAsync(0);expect(maintain).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30000);expect(maintain).toHaveBeenCalledTimes(2);service.onModuleDestroy();await jest.advanceTimersByTimeAsync(60000);expect(maintain).toHaveBeenCalledTimes(2);
  });
  it('does not create a process timer in hosted or external scheduler mode',async()=>{
    process.env.VERCEL='1';service.onModuleInit();await jest.advanceTimersByTimeAsync(60000);expect(maintain).not.toHaveBeenCalled();
    process.env.VERCEL='0';process.env.AV8_SCHEDULER_ENABLED='true';service.onModuleInit();await jest.advanceTimersByTimeAsync(60000);expect(maintain).not.toHaveBeenCalled();
  });
  it('routes a controlled failure to structured stderr without source payload or credential, then recovers',async()=>{
    maintain.mockRejectedValueOnce(new Error('SECRET_SYNTHETIC_CREDENTIAL and private student@example.invalid'));
    service.onModuleInit();await jest.advanceTimersByTimeAsync(0);expect(log).toHaveBeenCalledTimes(1);const event=JSON.parse(log.mock.calls[0][0]);expect(event.event).toBe('av8.operations.worker.failed');expect(JSON.stringify(event)).not.toMatch(/SECRET|student@/);
    await jest.advanceTimersByTimeAsync(30000);expect(maintain).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledTimes(1);
  });
  it('does not overlap a slow run and rejects a disabled worker identity',async()=>{
    let release:()=>void=()=>{};maintain.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({}as any);}));
    service.onModuleInit();await jest.advanceTimersByTimeAsync(60000);expect(maintain).toHaveBeenCalledTimes(1);release();await jest.advanceTimersByTimeAsync(0);
    find.mockResolvedValue({id:1n,active:false});await jest.advanceTimersByTimeAsync(30000);expect(maintain).toHaveBeenCalledTimes(1);expect(log).toHaveBeenCalledTimes(1);
  });
});
