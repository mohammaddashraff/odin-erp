import {assertAv8Isolation} from './av8-isolation';

const host='ep-billowing-dust-ba5ea0c4.c-8.eu-central-1.aws.neon.tech';
const runtime=`postgresql://av8_runtime:test-only@${host.replace('.c-8','-pooler.c-8')}/neondb?sslmode=verify-full`;
const owner=`postgresql://neondb_owner:test-only@${host}/neondb?sslmode=verify-full`;
const env={AV8_ENV:'production',AV8_OUTBOUND:'disabled',AV8_JOBS:'disabled',DATABASE_URL:runtime,DATABASE_ADMIN_URL:owner,ODIN_TOKEN_SECRET:'test-only-secret'.repeat(4),ODIN_REQUIRE_PRIVILEGED_MFA:'true',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false',VERCEL:'1',VERCEL_PROJECT_ID:'prj_iHlpBv6jtRpJLOOHwNOyitAeovck'};
describe('AV8 hosted isolation',()=>{
  it('accepts only the dedicated database and restricted runtime role',()=>{
    expect(()=>assertAv8Isolation(env)).not.toThrow();
    expect(()=>assertAv8Isolation({...env,DATABASE_URL:owner})).toThrow('verified AV8');
    expect(()=>assertAv8Isolation({...env,DATABASE_URL:runtime.replace(host.split('.')[0], 'another-database')})).toThrow('verified AV8');
    expect(()=>assertAv8Isolation({...env,DATABASE_URL:runtime.replace('verify-full','disable')})).toThrow('verified AV8');
  });
  it('rejects inherited overrides, wrong projects and weakened authentication',()=>{
    for(const override of [{DATABASE_URL_UNPOOLED:'postgresql://old:old@localhost/odin'}, {VERCEL_PROJECT_ID:'prj_old'}, {ODIN_REQUIRE_PRIVILEGED_MFA:'false'}, {ODIN_ALLOW_SHARED_DEMO_LOGINS:'true'}, {AV8_OUTBOUND:'enabled'}, {AV8_JOBS:'enabled'}])expect(()=>assertAv8Isolation({...env,...override})).toThrow();
  });
  it('allows password-only login only when the mode is explicitly paired with its settings',()=>{
    const simple={...env,AV8_SIMPLE_LOGIN:'true',ODIN_REQUIRE_PRIVILEGED_MFA:'false',ODIN_ALLOW_SHARED_DEMO_LOGINS:'false'};
    expect(()=>assertAv8Isolation(simple)).not.toThrow();
    expect(()=>assertAv8Isolation({...simple,ODIN_ALLOW_SHARED_DEMO_LOGINS:'true'})).toThrow('authentication mode');
    expect(()=>assertAv8Isolation({...simple,ODIN_REQUIRE_PRIVILEGED_MFA:'true'})).toThrow('authentication mode');
  });
});
