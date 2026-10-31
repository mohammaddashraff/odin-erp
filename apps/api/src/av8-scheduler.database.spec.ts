import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { AuthService, Actor } from './auth';
import { Av8OperationsService } from './av8-operations.service';
import { Av8SchedulerService } from './av8-scheduler.service';

jest.setTimeout(120000);
describe('Hosted scheduler authentication, persistence and bounded processing',()=>{
  let app:any,db:PrismaService,auth:AuthService,operations:Av8OperationsService,scheduler:Av8SchedulerService,actor:Actor,maintain:jest.SpyInstance,processJob:jest.SpyInstance,log:jest.SpyInstance;
  const secret=randomUUID()+randomUUID(),names=['AV8_SCHEDULER_ENABLED','AV8_SCHEDULER_SECRET','AV8_SCHEDULER_APPLICATION_LIMIT','AV8_SCHEDULER_DISPATCH_LIMIT','AV8_OPERATIONS_WORKER_ENABLED','AV8_OPERATIONS_WORKER_USER_ID','AV8_ACADEMIC_WORKER_ENABLED','AV8_ACADEMIC_WORKER_USER_ID'];
  const original:Record<string,string|undefined>={};
  const tick=()=>request(app.getHttpServer()).get('/api/av8/scheduler/tick').set('Authorization',`Bearer ${secret}`);
  const checkpoint=()=>db.admin.av8Record.findFirstOrThrow({where:{tenantId:actor.tenantId,kind:'scheduler-checkpoint',key:`maintenance:${actor.userId}`}});
  beforeAll(async()=>{
    if(process.env.AV8_ENV!=='test')throw new Error('Isolated test database required');
    for(const name of names)original[name]=process.env[name];Object.assign(process.env,{AV8_SCHEDULER_ENABLED:'false',AV8_OPERATIONS_WORKER_ENABLED:'false',AV8_ACADEMIC_WORKER_ENABLED:'false'});
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false});await app.init();db=module.get(PrismaService);auth=module.get(AuthService);operations=module.get(Av8OperationsService);scheduler=module.get(Av8SchedulerService);
    const user=await db.admin.user.findFirstOrThrow({where:{email:'affairs@av8.local'},include:auth.userInclude});actor=auth.actorFor(user);
    Object.assign(process.env,{AV8_SCHEDULER_ENABLED:'true',AV8_SCHEDULER_SECRET:secret,AV8_OPERATIONS_WORKER_ENABLED:'true',AV8_OPERATIONS_WORKER_USER_ID:String(user.id),AV8_SCHEDULER_APPLICATION_LIMIT:'1',AV8_SCHEDULER_DISPATCH_LIMIT:'1'});
    await db.tenant(actor.tenantId,tx=>tx.av8Record.deleteMany({where:{tenantId:actor.tenantId,kind:'scheduler-checkpoint',key:`maintenance:${actor.userId}`}}));
  });
  beforeEach(()=>{
    process.env.AV8_SCHEDULER_ENABLED='true';process.env.AV8_OPERATIONS_WORKER_ENABLED='true';process.env.AV8_OPERATIONS_WORKER_USER_ID=String(actor.userId);process.env.AV8_ACADEMIC_WORKER_ENABLED='false';
    maintain=jest.spyOn(operations,'maintain').mockResolvedValue({checkedApplications:1,date:'2026-10-31',externalActions:0,nextCursor:'12'});
    processJob=jest.spyOn(operations,'process').mockResolvedValue({processed:0,results:[]});log=jest.spyOn(console,'error').mockImplementation(()=>undefined);
  });
  afterEach(()=>jest.restoreAllMocks());
  afterAll(async()=>{if(app)await app.close();for(const name of names)if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];});
  it('denies unauthenticated and wrong-secret HTTP calls; disabled configuration does no work',async()=>{
    await request(app.getHttpServer()).get('/api/av8/scheduler/tick').expect(401);
    await request(app.getHttpServer()).post('/api/av8/scheduler/tick').set('Authorization','Bearer invalid').expect(401);
    process.env.AV8_SCHEDULER_ENABLED='false';await tick().expect(503);expect(maintain).not.toHaveBeenCalled();expect(processJob).not.toHaveBeenCalled();
  });
  it('persists the cursor and resumes it from a newly constructed service instance',async()=>{
    const first=await tick().expect(200);expect(first.headers['cache-control']).toBe('no-store');expect(first.body.maintenance.checkedApplications).toBe(1);expect(maintain).toHaveBeenLastCalledWith(expect.objectContaining({userId:actor.userId}),{limit:1,afterId:null});
    expect((await checkpoint()).data).toMatchObject({cursor:'12',leaseUntil:null});
    maintain.mockResolvedValueOnce({checkedApplications:1,date:'2026-10-31',externalActions:0,nextCursor:'24'});
    await new Av8SchedulerService(db,auth,operations).run();expect(maintain).toHaveBeenLastCalledWith(expect.objectContaining({userId:actor.userId}),{limit:1,afterId:'12'});expect((await checkpoint()).data).toMatchObject({cursor:'24'});
  });
  it('claims a maintenance batch once across concurrent HTTP ticks',async()=>{
    let started!:()=>void,release!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    maintain.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({checkedApplications:1,date:'2026-10-31',externalActions:0,nextCursor:'25'});started();}));
    const first=tick().then(response=>response);await began;const second=await tick().expect(200);expect(second.body.maintenance.status).toBe('BUSY');release();expect((await first).status).toBe(200);expect(maintain).toHaveBeenCalledTimes(1);
  });
  it('preserves the cursor after failure, emits a redacted event, and retries safely',async()=>{
    maintain.mockRejectedValueOnce(new Error('private recipient@example.invalid synthetic credential'));
    await tick().expect(503);expect((await checkpoint()).data).toMatchObject({cursor:'25',leaseUntil:null,lastError:'MAINTENANCE_FAILED; cursor preserved for retry'});expect(log).toHaveBeenCalled();expect(JSON.stringify(log.mock.calls)).not.toMatch(/recipient@|synthetic credential/);
    await tick().expect(200);expect(maintain).toHaveBeenLastCalledWith(expect.anything(),{limit:1,afterId:'25'});
  });
  it('reclaims expired leases and processes a separately scoped bounded academic queue even if maintenance fails',async()=>{
    const row=await checkpoint();await db.tenant(actor.tenantId,tx=>tx.av8Record.update({where:{id:row.id},data:{status:'RUNNING',data:{...(row.data as any),leaseUntil:'2000-01-01T00:00:00.000Z'}}}));
    Object.assign(process.env,{AV8_ACADEMIC_WORKER_ENABLED:'true',AV8_ACADEMIC_WORKER_USER_ID:String(actor.userId)});maintain.mockRejectedValueOnce(new Error('Controlled failure'));
    const result=await tick().expect(503);expect(result.body.results.academic.status).toBe('PROCESSED');expect(processJob).toHaveBeenCalledWith(expect.objectContaining({userId:actor.userId}),1);expect((await checkpoint()).data).toMatchObject({leaseUntil:null});
  });
  it('uses the named actor permissions and rejects missing identities without bypassing scope',async()=>{
    process.env.AV8_OPERATIONS_WORKER_USER_ID='9223372036854775000';await tick().expect(503);expect(maintain).not.toHaveBeenCalled();
    const sales=await db.admin.user.findFirstOrThrow({where:{email:'telesales@av8.local'}});process.env.AV8_OPERATIONS_WORKER_USER_ID=String(sales.id);maintain.mockRestore();await tick().expect(503);
  });
  it('bounds actual maintenance and returns a resumable application cursor',async()=>{
    maintain.mockRestore();const first=await operations.maintain(actor,{limit:1});expect(first.checkedApplications).toBe(1);expect(first.nextCursor).toMatch(/^[1-9]\d*$/);
    const second=await operations.maintain(actor,{limit:1,afterId:first.nextCursor});expect(second.checkedApplications).toBeLessThanOrEqual(1);if(second.nextCursor)expect(BigInt(second.nextCursor)).toBeGreaterThan(BigInt(first.nextCursor!));
  });
});
