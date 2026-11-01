import { assertAv8Isolation, av8ProductionIdentity } from './av8-isolation';
import { PrismaService } from './prisma.service';
import { demoResetEnabled, privilegedMfaRequired } from './deployment-config';
import { seedAv8 } from '../prisma/av8-seed';

const stage:NodeJS.ProcessEnv={AV8_ENV:'staging',NODE_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',AV8_STAGING_DB_HOST:'staging-db.example.invalid',AV8_STAGING_DB_NAME:'av8_staging_release',AV8_STAGING_DB_ADMIN_ROLE:'av8_staging_owner',AV8_STAGING_RESOURCE:'av8-erp-staging:synthetic-release-fixture',AV8_STAGING_PROJECT_ID:'prj_syntheticStagingApi',VERCEL_PROJECT_ID:'prj_syntheticStagingApi',DATABASE_URL:'postgresql://av8_runtime:synthetic-test-only@staging-db.example.invalid/av8_staging_release?sslmode=verify-full',DATABASE_ADMIN_URL:'postgresql://av8_staging_owner:synthetic-admin-only@staging-db.example.invalid/av8_staging_release?sslmode=verify-full',ODIN_TOKEN_SECRET:'synthetic-isolated-staging-secret'.repeat(2),ODIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('hex'),ODIN_REQUIRE_PRIVILEGED_MFA:'true',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',NEXT_PUBLIC_ODIN_DEMO_MODE:'false',ODIN_WEB_ORIGIN:'https://staging-web.example.invalid',ODIN_ALLOWED_ORIGINS:'https://staging-web.example.invalid'};

afterEach(()=>jest.restoreAllMocks());
describe('Explicit hosted AV8 staging isolation',()=>{
  it('accepts a complete separate target and only its explicitly selected runtime pooler',()=>{
    expect(()=>assertAv8Isolation(stage)).not.toThrow();
    expect(()=>assertAv8Isolation({...stage,AV8_STAGING_DB_POOLER_HOST:'staging-pooler.example.invalid',DATABASE_URL:stage.DATABASE_URL!.replace('staging-db.','staging-pooler.')})).not.toThrow();
  });
  it.each(['AV8_STAGING_DB_HOST','AV8_STAGING_DB_NAME','AV8_STAGING_DB_ADMIN_ROLE','AV8_STAGING_RESOURCE','AV8_STAGING_PROJECT_ID','DATABASE_URL','DATABASE_ADMIN_URL','ODIN_MFA_ENCRYPTION_KEY','ODIN_WEB_ORIGIN','ODIN_ALLOWED_ORIGINS'])('rejects missing %s without production/default fallback',key=>{
    expect(()=>assertAv8Isolation({...stage,[key]:undefined})).toThrow();
  });
  it('rejects known production endpoints, resource markers, projects and inherited database overrides',()=>{
    expect(()=>assertAv8Isolation({...stage,AV8_STAGING_PROJECT_ID:av8ProductionIdentity.webProjectId,VERCEL_PROJECT_ID:av8ProductionIdentity.webProjectId})).toThrow();
    for(const override of [{AV8_STAGING_DB_HOST:av8ProductionIdentity.host},{AV8_STAGING_DB_POOLER_HOST:av8ProductionIdentity.host.replace('.c-8','-pooler.c-8')},{AV8_STAGING_DB_NAME:av8ProductionIdentity.database},{AV8_STAGING_RESOURCE:av8ProductionIdentity.resource},{AV8_STAGING_PROJECT_ID:av8ProductionIdentity.projectId,VERCEL_PROJECT_ID:av8ProductionIdentity.projectId},{VERCEL_PROJECT_ID:'prj_unexpected'},{DATABASE_URL_UNPOOLED:`postgresql://neondb_owner:synthetic@${av8ProductionIdentity.host}/neondb?sslmode=require`},{POSTGRES_URL_NON_POOLING:stage.DATABASE_URL}])expect(()=>assertAv8Isolation({...stage,...override})).toThrow();
  });
  it('rejects owner runtime credentials, insecure TLS and ambiguous connection parameters',()=>{
    for(const value of [stage.DATABASE_ADMIN_URL,stage.DATABASE_URL!.replace('verify-full','disable'),stage.DATABASE_URL!+'&sslmode=disable',stage.DATABASE_URL!+'&host='+av8ProductionIdentity.host,stage.DATABASE_URL!+'&options=-c%20row_security=off'])expect(()=>assertAv8Isolation({...stage,DATABASE_URL:value})).toThrow();
  });
  it('enforces secure hosted authentication and explicit separate HTTPS origins',()=>{
    for(const override of [{NODE_ENV:'development'},{AV8_SIMPLE_LOGIN:'true'},{ODIN_REQUIRE_PRIVILEGED_MFA:'false'},{ODIN_ALLOW_SHARED_DEMO_LOGINS:'true'},{ODIN_DEPLOYMENT_MODE:'demo'},{NEXT_PUBLIC_ODIN_DEMO_MODE:'true'},{ODIN_TOKEN_SECRET:'weak'},{ODIN_MFA_ENCRYPTION_KEY:'invalid'},{ODIN_ALLOWED_ORIGINS:'*'},{ODIN_WEB_ORIGIN:'http://staging.example.invalid'},{ODIN_WEB_ORIGIN:'https://av8-erp.vercel.app'},{AV8_OUTBOUND:'enabled'},{AV8_JOBS:'enabled'}])expect(()=>assertAv8Isolation({...stage,...override})).toThrow();
    expect(privilegedMfaRequired({AV8_ENV:'staging',NODE_ENV:'development',ODIN_ALLOW_SHARED_DEMO_LOGINS:'true'})).toBe(true);expect(demoResetEnabled({AV8_ENV:'staging',NODE_ENV:'development',ODIN_DEPLOYMENT_MODE:'demo'})).toBe(false);
  });
  it('rejects synthetic seeding before any staging database access',async()=>{
    jest.replaceProperty(process,'env',{...process.env,AV8_ENV:'staging'});const tenant={findFirst:jest.fn()};await expect(seedAv8({admin:{tenant}} as any)).rejects.toThrow('restricted to isolated dev/test');expect(tenant.findFirst).not.toHaveBeenCalled();
  });
});

const adminIdentity={resource:stage.AV8_STAGING_RESOURCE,database:stage.AV8_STAGING_DB_NAME,name:stage.AV8_STAGING_DB_ADMIN_ROLE};
const runtimeIdentity={resource:stage.AV8_STAGING_RESOURCE,database:stage.AV8_STAGING_DB_NAME};
const runtimeRole={name:'av8_runtime',rolbypassrls:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,row_security:'on',tls:true};
const tenantTables=['tenants','av8_applications','av8_funds','journal_entries'].map(name=>({name,active:true}));
function startup(adminRows:any[]=[adminIdentity],identityRows:any[]=[runtimeIdentity],roleRows:any[]=[runtimeRole],tables:any[]=tenantTables){
  jest.replaceProperty(process,'env',{...process.env,...stage});
  const service=Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperties(service,{admin:{value:{$queryRaw:jest.fn().mockResolvedValue(adminRows)}},app:{value:{$queryRaw:jest.fn().mockResolvedValueOnce(identityRows).mockResolvedValueOnce(roleRows).mockResolvedValueOnce(tables)}}});return service.onModuleInit();
}
describe('Staging startup checks actual connected database state',()=>{
  it('accepts matching markers on both connections, TLS and effective runtime RLS',async()=>{await expect(startup()).resolves.toBeUndefined();});
  it('rejects a wrong, duplicate or missing admin database marker and wrong connected owner/database',async()=>{
    for(const rows of [[],[adminIdentity,adminIdentity],[{...adminIdentity,resource:av8ProductionIdentity.resource}],[{...adminIdentity,name:'neondb_owner'}],[{...adminIdentity,database:'neondb'}]])await expect(startup(rows)).rejects.toThrow('admin database identity');
  });
  it('rejects a runtime connection to a different actual marker or database',async()=>{
    for(const row of [{...runtimeIdentity,resource:av8ProductionIdentity.resource},{...runtimeIdentity,database:'neondb'}])await expect(startup([adminIdentity],[row])).rejects.toThrow('runtime database identity');
  });
  it('rejects non-TLS, bypass, superuser, role-administration or disabled row security',async()=>{
    for(const override of [{name:'av8_staging_owner'},{rolbypassrls:true},{rolsuper:true},{rolcreatedb:true},{rolcreaterole:true},{row_security:'off'},{tls:false}])await expect(startup([adminIdentity],[runtimeIdentity],[{...runtimeRole,...override}])).rejects.toThrow('restricted RLS role');
  });
  it('rejects a missing core table or any tenant table without effective row security',async()=>{
    await expect(startup([adminIdentity],[runtimeIdentity],[runtimeRole],tenantTables.slice(1))).rejects.toThrow('effective runtime row-level security');
    await expect(startup([adminIdentity],[runtimeIdentity],[runtimeRole],[...tenantTables,{name:'other_tenant_table',active:false}])).rejects.toThrow('effective runtime row-level security');
  });
});
