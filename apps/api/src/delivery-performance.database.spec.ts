import 'reflect-metadata';
import {Test} from '@nestjs/testing';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {AppModule} from './app.module';
import {PrismaService} from './prisma.service';
import {AuthService,Actor} from './auth';
import {Av8Service} from './av8.service';
import {seedAv8} from '../prisma/av8-seed';

jest.setTimeout(120000);
describe('bounded delivery lists at synthetic operating volume',()=>{
 let app:any,db:PrismaService,av8:Av8Service,actor:Actor;const prefix=`PERF-${randomUUID().slice(0,8)}`;let customerIds:bigint[]=[];let coldSearchMilliseconds:number|null=null;
 beforeAll(async()=>{if(process.env.AV8_ENV!=='test')throw new Error('Only isolated AV8 test data is permitted');const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication({logger:false});await app.init();db=module.get(PrismaService);av8=module.get(Av8Service);await seedAv8(db);const auth=module.get(AuthService);actor=auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email:'admin@av8.local'},include:auth.userInclude}));});
 afterAll(async()=>{if(db&&customerIds.length){await db.admin.av8Lead.deleteMany({where:{customerId:{in:customerIds}}});await db.admin.customer.deleteMany({where:{id:{in:customerIds}}});}if(app)await app.close();});
 it('keeps the first search below five seconds before bulk-data statistics can refresh',async()=>{
  // Analyze only the small existing baseline. The following 10k inserts stay
  // uncommitted, so autovacuum cannot hide the original stale-statistics failure.
  await db.admin.$executeRaw`ANALYZE av8_leads`;await db.admin.$executeRaw`ANALYZE customers`;
  const rollback=new Error('Rollback isolated cold-statistics fixture'),coldPrefix=`COLD-${randomUUID().slice(0,8)}`,branchId=BigInt(actor.branchIds[0]);
  try{await db.admin.$transaction(async tx=>{
    await tx.$executeRaw`WITH inserted AS (INSERT INTO customers(tenant_id,company_id,default_branch_id,owner_user_id,code,name,phone,city,customer_type) SELECT ${actor.tenantId},${BigInt(actor.companyIds[0])},${branchId},${actor.userId},${coldPrefix}||'-'||g,'أَحْمَد '||${coldPrefix}||' '||g,'+209'||lpad(g::text,9,'0'),'Synthetic cold-statistics fixture','INDIVIDUAL' FROM generate_series(1,10000)g RETURNING id) INSERT INTO av8_leads(tenant_id,branch_id,owner_id,customer_id,source,program,phones,inquiry_at) SELECT ${actor.tenantId},${branchId},${actor.userId},id,${coldPrefix},'Synthetic cold-statistics fixture','[]'::jsonb,'2026-10-01T10:00:00Z' FROM inserted`;
    await tx.$executeRaw`SET LOCAL ROLE av8_runtime`;await tx.$executeRaw`SELECT set_config('app.current_tenant_id',${String(actor.tenantId)},true)`;
    const identity:any[]=await tx.$queryRaw`SELECT current_user AS name,row_security_active('av8_leads'::regclass) AS rls`;expect(identity[0]).toEqual({name:'av8_runtime',rls:true});
    // Reuse the real service query in this scoped runtime transaction so it can
    // see the uncommitted synthetic rows; no search/permission method is mocked.
    const scoped=new Av8Service({tenant:async(_id:bigint,work:(connection:any)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService,av8.erp,av8.operations);
    const start=performance.now(),result=await scoped.leads(actor,{search:`احمد ${coldPrefix}`,page:1});coldSearchMilliseconds=performance.now()-start;
    expect(result.total).toBe(10000);expect(result.rows).toHaveLength(25);expect(result.rows.every(row=>String(row.branchId)===String(branchId))).toBe(true);expect(coldSearchMilliseconds).toBeLessThan(5000);
    throw rollback;
  },{timeout:60000});}catch(error){if(error!==rollback)throw error;}
 });
 it('queries ten thousand contacts with bounded pagination, Arabic normalization and no cross-scope rows',async()=>{
  const branchId=BigInt(actor.branchIds[0]);for(let batch=0;batch<20;batch++){
   const people=await db.admin.customer.createManyAndReturn({data:Array.from({length:500},(_,i)=>({tenantId:actor.tenantId,companyId:BigInt(actor.companyIds[0]),defaultBranchId:branchId,ownerUserId:actor.userId,code:`${prefix}-${batch*500+i}`,name:`أَحْمَد ${prefix} ${batch*500+i}`,phone:`+209${String(batch*500+i).padStart(9,'0')}`,city:'Synthetic QA',customerType:'INDIVIDUAL'})),select:{id:true}});customerIds.push(...people.map(p=>p.id));
   await db.admin.av8Lead.createMany({data:people.map(person=>({tenantId:actor.tenantId,branchId,ownerId:actor.userId,customerId:person.id,source:prefix,inquiryAt:new Date('2026-10-01T10:00:00Z'),program:'Synthetic volume fixture',phones:[],notes:'Synthetic list performance evidence'}))});
  }
  const samples:number[]=[];for(let i=0;i<20;i++){const start=performance.now();const result=await av8.leads(actor,{search:`احمد ${prefix}`,page:i+1});samples.push(performance.now()-start);expect(result.total).toBe(10000);expect(result.rows).toHaveLength(25);expect(result.rows.every((r:any)=>r.branchId===String(branchId))).toBe(true);}
  const previewSamples:number[]=[];const csv='name,phone,source\n'+Array.from({length:100},(_,i)=>`احمد ${prefix} ${i},+209${String(i).padStart(9,'0')},Synthetic performance`).join('\n');
  for(let i=0;i<3;i++){const start=performance.now();const preview=await av8.importPreview(actor,{csv});previewSamples.push(performance.now()-start);expect(preview.rows).toHaveLength(100);expect(preview.rows.every((row:any)=>row.duplicates.length>0)).toBe(true);}
  const reportSamples:number[]=[];let reportRows=0;for(let i=0;i<5;i++){const start=performance.now();const report:any=await av8.report(actor,'collections',{});reportSamples.push(performance.now()-start);expect(Array.isArray(report.rows)).toBe(true);reportRows=report.rows.length;}
  const sorted=[...samples].sort((a,b)=>a-b);const evidence={synthetic:true,scope:'local PostgreSQL, service + database list query; not a hosted load/SLO claim',rows:10000,requests:20,pageSize:25,coldStatistics:{rows:10000,role:'av8_runtime',rls:true,milliseconds:coldSearchMilliseconds===null?null:Number(coldSearchMilliseconds.toFixed(2)),scope:'Actual first service search within rollback-only bulk insert; baseline analyzed before inserts, never afterward'},importPreview:{rows:100,requests:3,maxMilliseconds:Number(Math.max(...previewSamples).toFixed(2))},collectionsReport:{rows:reportRows,requests:5,maxMilliseconds:Number(Math.max(...reportSamples).toFixed(2)),scope:'current persisted synthetic finance workload'},p50Milliseconds:Number(sorted[9].toFixed(2)),p95Milliseconds:Number(sorted[18].toFixed(2)),maxMilliseconds:Number(sorted[19].toFixed(2)),startedAt:new Date().toISOString()};
  const directory=resolve(process.env.AV8_ROOT!,'output/performance');mkdirSync(directory,{recursive:true});writeFileSync(resolve(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');expect(sorted[19]).toBeLessThan(5000);
 });
});
