import { assertAv8Isolation, av8PrivateDatabaseAddress } from './av8-isolation';
import { PrismaService } from './prisma.service';

const env:NodeJS.ProcessEnv={AV8_HOSTING:'hetzner',AV8_ENV:'production',NODE_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',AV8_DB_TRANSPORT:'PRIVATE_CONTAINER_NETWORK',AV8_HETZNER_DB_HOST:'av8-postgres',AV8_HETZNER_DB_NAME:'av8_prod_release',AV8_HETZNER_DB_ADMIN_ROLE:'av8_prod_owner',AV8_HETZNER_DEPLOYMENT_ID:'av8-release-fixture',AV8_HETZNER_RESOURCE:'av8-erp-production:av8-release-fixture',DATABASE_URL:'postgresql://av8_runtime:synthetic-runtime@av8-postgres/av8_prod_release?sslmode=disable',DATABASE_ADMIN_URL:'postgresql://av8_prod_owner:synthetic-owner@av8-postgres/av8_prod_release?sslmode=disable',ODIN_TOKEN_SECRET:'synthetic-private-hetzner-secret'.repeat(2),ODIN_MFA_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('hex'),ODIN_REQUIRE_PRIVILEGED_MFA:'true',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',ODIN_WEB_ORIGIN:'https://av8.odin-ltd.com',ODIN_PUBLIC_ORIGIN:'https://av8.odin-ltd.com',ODIN_ALLOWED_ORIGINS:'https://av8.odin-ltd.com'};
afterEach(()=>jest.restoreAllMocks());
describe('Dedicated Hetzner hosting profile',()=>{
  it('accepts the explicit isolated container target without inherited Vercel identities',()=>{expect(()=>assertAv8Isolation(env)).not.toThrow();});
  it('accepts verified TLS on an explicitly separate external database',()=>{expect(()=>assertAv8Isolation({...env,AV8_DB_TRANSPORT:'TLS',AV8_HETZNER_DB_HOST:'dedicated-db.example.invalid',DATABASE_URL:env.DATABASE_URL!.replace('av8-postgres','dedicated-db.example.invalid').replace('disable','verify-full'),DATABASE_ADMIN_URL:env.DATABASE_ADMIN_URL!.replace('av8-postgres','dedicated-db.example.invalid').replace('disable','verify-full')})).not.toThrow();});
  it('rejects missing and mismatched database, deployment and marker identity',()=>{
    for(const key of ['AV8_HETZNER_DB_HOST','AV8_HETZNER_DB_NAME','AV8_HETZNER_DB_ADMIN_ROLE','AV8_HETZNER_DEPLOYMENT_ID','AV8_HETZNER_RESOURCE','DATABASE_URL','DATABASE_ADMIN_URL'])expect(()=>assertAv8Isolation({...env,[key]:undefined})).toThrow();
    for(const override of [{AV8_HETZNER_RESOURCE:'av8-erp-production:another-deployment'},{AV8_HETZNER_DB_NAME:'neondb'},{AV8_HETZNER_DB_ADMIN_ROLE:'neondb_owner'},{VERCEL:'1'},{VERCEL_PROJECT_ID:'prj_live'},{AV8_HOSTING:'unknown'}])expect(()=>assertAv8Isolation({...env,...override})).toThrow();
  });
  it('rejects unencrypted external targets, inherited aliases and owner runtime credentials',()=>{
    for(const override of [{AV8_HETZNER_DB_HOST:'public.example.invalid'},{AV8_DB_TRANSPORT:'TLS'},{DATABASE_URL:env.DATABASE_ADMIN_URL},{DATABASE_URL_UNPOOLED:'postgresql://root:synthetic@127.0.0.1/other?sslmode=disable'},{DATABASE_URL:env.DATABASE_URL!+'&host=public.example.invalid'},{DATABASE_URL:env.DATABASE_URL!+'&sslmode=require'}])expect(()=>assertAv8Isolation({...env,...override})).toThrow();
  });
  it('requires the authorized production HTTPS origin and secure authentication',()=>{
    for(const override of [{ODIN_WEB_ORIGIN:'http://av8.odin-ltd.com',ODIN_PUBLIC_ORIGIN:'http://av8.odin-ltd.com',ODIN_ALLOWED_ORIGINS:'http://av8.odin-ltd.com'},{ODIN_WEB_ORIGIN:'https://other.example.invalid',ODIN_PUBLIC_ORIGIN:'https://other.example.invalid',ODIN_ALLOWED_ORIGINS:'https://other.example.invalid'},{ODIN_PUBLIC_ORIGIN:'https://different.example.invalid'},{ODIN_ALLOWED_ORIGINS:'*'},{ODIN_REQUIRE_PRIVILEGED_MFA:'false'},{ODIN_ALLOW_SHARED_DEMO_LOGINS:'true'},{AV8_SIMPLE_LOGIN:'true'},{NODE_ENV:'development'},{ODIN_MFA_ENCRYPTION_KEY:''}])expect(()=>assertAv8Isolation({...env,...override})).toThrow();
  });
  it('allows explicitly selected staging over loopback SSH forwarding, never a public HTTP origin',()=>{
    const stage={...env,AV8_ENV:'staging',AV8_HETZNER_DB_NAME:'av8_staging_release',AV8_HETZNER_DB_ADMIN_ROLE:'av8_staging_owner',AV8_HETZNER_RESOURCE:'av8-erp-staging:av8-release-fixture',DATABASE_URL:env.DATABASE_URL!.replaceAll('av8_prod_','av8_staging_'),DATABASE_ADMIN_URL:env.DATABASE_ADMIN_URL!.replaceAll('av8_prod_','av8_staging_'),ODIN_WEB_ORIGIN:'http://127.0.0.1:8280',ODIN_PUBLIC_ORIGIN:'http://127.0.0.1:8280',ODIN_ALLOWED_ORIGINS:'http://127.0.0.1:8280',AV8_STAGING_PUBLIC_ORIGIN:'http://127.0.0.1:8280'};
    expect(()=>assertAv8Isolation(stage)).not.toThrow();expect(()=>assertAv8Isolation({...stage,AV8_STAGING_PUBLIC_ORIGIN:undefined})).toThrow();
    for(const origin of ['http://0.0.0.0:8280','http://2.28.75.201:8280','https://av8.odin-ltd.com'])expect(()=>assertAv8Isolation({...stage,ODIN_WEB_ORIGIN:origin,ODIN_PUBLIC_ORIGIN:origin,ODIN_ALLOWED_ORIGINS:origin,AV8_STAGING_PUBLIC_ORIGIN:origin})).toThrow();
  });
  it('classifies only valid private/loopback database addresses',()=>{for(const value of ['127.0.0.1','10.1.2.3','172.16.0.1','172.31.255.254','192.168.1.10','::1','fd00::1'])expect(av8PrivateDatabaseAddress(value)).toBe(true);for(const value of [undefined,'8.8.8.8','172.15.0.1','172.32.0.1','10.999.1.1','10.1.2.3.evil','2001:4860:4860::8888'])expect(av8PrivateDatabaseAddress(value)).toBe(false);});
});

function start(overrides:{admin?:Record<string,unknown>;runtime?:Record<string,unknown>;tables?:any[]}={}){
  jest.replaceProperty(process,'env',{...env});
  const service=Object.create(PrismaService.prototype) as PrismaService;
  const identity={resource:env.AV8_HETZNER_RESOURCE,database:env.AV8_HETZNER_DB_NAME,name:env.AV8_HETZNER_DB_ADMIN_ROLE,server_address:'172.20.0.2',client_address:'172.20.0.3',tls:false,...overrides.admin};
  const role={name:'av8_runtime',rolbypassrls:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,row_security:'on',server_address:'172.20.0.2',client_address:'172.20.0.3',tls:false,...overrides.runtime};
  const tables=overrides.tables||['tenants','av8_applications','av8_funds','journal_entries'].map(name=>({name,active:true}));
  Object.defineProperties(service,{admin:{value:{$queryRaw:jest.fn().mockResolvedValue([identity])}},app:{value:{$queryRaw:jest.fn().mockResolvedValueOnce([{resource:env.AV8_HETZNER_RESOURCE,database:env.AV8_HETZNER_DB_NAME}]).mockResolvedValueOnce([role]).mockResolvedValueOnce(tables)}}});return service.onModuleInit();
}
describe('Hetzner actual startup transport checks',()=>{
  it('accepts actual private client/server addresses with exact marker, restricted role and effective tenant RLS',async()=>{await expect(start()).resolves.toBeUndefined();});
  it('rejects a public or absent admin database endpoint despite configured internal hostname',async()=>{for(const admin of [{server_address:'8.8.8.8'},{client_address:'2.28.75.201'},{server_address:null}])await expect(start({admin})).rejects.toThrow('admin connection');});
  it('rejects a public runtime endpoint, bypass role or missing RLS',async()=>{for(const runtime of [{server_address:'8.8.8.8'},{client_address:'2.28.75.201'},{rolbypassrls:true},{rolsuper:true},{rolcreaterole:true},{row_security:'off'}])await expect(start({runtime})).rejects.toThrow('restricted RLS role');await expect(start({tables:[{name:'av8_funds',active:false}]})).rejects.toThrow('effective runtime row-level security');});
});
