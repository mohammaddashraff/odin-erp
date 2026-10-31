/** Runs only inside the disposable restored API container; never prints credentials or document bytes. */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';

async function main(){
  const config=JSON.parse(fs.readFileSync('/run/secrets/api_config','utf8'));
  if(config.AV8_ENV!=='staging'||config.AV8_HOSTING!=='hetzner'||config.AV8_RECOVERY_DRILL!=='true'||!/^av8_staging_restore_[a-f0-9]{24}$/.test(config.AV8_HETZNER_DB_NAME)||config.AV8_HETZNER_RESOURCE!==`av8-erp-staging:av8-restore-${config.AV8_HETZNER_DB_NAME.slice('av8_staging_restore_'.length)}`)throw new Error('Recovery identity required');
  for(const flag of ['AV8_ACADEMIC_EMAIL_ENABLED','AV8_ACADEMIC_WORKER_ENABLED','AV8_OPERATIONS_WORKER_ENABLED','AV8_SCHEDULER_ENABLED','AV8_ALERT_EMAIL_ENABLED'])if(config[flag]!=='false')throw new Error('Recovery delivery/jobs must be disabled');
  Object.assign(process.env,config);
  const require=createRequire('/app/.av8/api/src/prisma.service.js');require('reflect-metadata');
  const {PrismaService}=require('/app/.av8/api/src/prisma.service.js'),{totpCode,decryptMfaSecret}=require('/app/.av8/api/src/mfa-security.js');
  const db=new PrismaService(),credentials=JSON.parse(fs.readFileSync('/run/secrets/recovery_credentials','utf8'));
  const email=String(credentials.email||'').trim().toLowerCase();let password=String(credentials.password||credentials.temporaryPassword||'');
  if(!email||!password)throw new Error('Private current login credentials required');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const request=async(route,body,token,extraHeaders={})=>{
    const response=await fetch(`http://127.0.0.1:8181/api/${route}`,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{}) ,...extraHeaders},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Recovery HTTP ${route.split('/')[0]} verification failed`);
    return response.json();
  };
  try{
    await db.onModuleInit();
    const role=(await db.app.$queryRaw`SELECT current_user AS name,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,pg_has_role(current_user,${config.AV8_HETZNER_DB_ADMIN_ROLE},'MEMBER') AS owner_member FROM pg_roles WHERE rolname=current_user`)[0];
    if(role.name!=='av8_runtime'||role.rolsuper||role.rolbypassrls||role.rolcreatedb||role.rolcreaterole||role.owner_member)throw new Error('Recovery runtime privilege mismatch');
    if(await db.app.tenant.count()!==0||await db.app.av8Attachment.count()!==0)throw new Error('Recovery unscoped RLS leak');
    const user=await db.admin.user.findFirst({where:{email,active:true}});if(!user)throw new Error('Restored named user missing');
    const file=await db.admin.av8Attachment.findFirst({where:{tenantId:user.tenantId},orderBy:{createdAt:'asc'}});if(!file)throw new Error('Restored named tenant needs a private document');
    const scoped=await db.tenant(user.tenantId,tx=>tx.av8Attachment.findFirst({where:{id:file.id}}));
    if(!scoped||hash(scoped.content)!==file.sha256||scoped.content.length!==Number(file.sizeBytes))throw new Error('Recovery scoped document mismatch');
    if(await db.tenant(-1n,tx=>tx.av8Attachment.count({where:{id:file.id}}))!==0)throw new Error('Recovery cross-tenant document leak');
    const health=await request('health');if(!health)throw new Error('Recovery health failed');
    let enrolled=false,passwordChanged=false;
    const login=async()=>{
      const challenge=await request('auth/login',{email,password,rememberMe:false});
      if(!challenge.challengeToken||!(challenge.mfaRequired||challenge.mfaEnrollmentRequired)||challenge.accessToken||challenge.token)throw new Error('Restored privileged login did not require MFA');
      const latest=await db.admin.user.findUnique({where:{id:user.id}});if(!latest?.mfaSecretEncrypted)throw new Error('Restored MFA secret missing');
      const session=await request('auth/mfa/verify',{challengeToken:challenge.challengeToken,code:totpCode(decryptMfaSecret(latest.mfaSecretEncrypted))});
      if(!session.accessToken||!session.user?.mfaVerifiedAt)throw new Error('Restored MFA login failed');
      enrolled ||= !!challenge.mfaEnrollmentRequired;
      return session;
    };
    let session=await login();
    if(session.user.passwordChangeRequired){
      const next=randomBytes(36).toString('base64url');
      const latest=await db.admin.user.findUnique({where:{id:user.id}});
      const step=await request('auth/step-up',{password,code:totpCode(decryptMfaSecret(latest.mfaSecretEncrypted))},session.accessToken);
      if(!step.stepUpToken)throw new Error('Restored password change step-up failed');
      await request('auth/change-password',{currentPassword:password,newPassword:next},session.accessToken,{'x-odin-step-up':step.stepUpToken});
      password=next;passwordChanged=true;session=await login();
    }
    const me=await request('auth/me',undefined,session.accessToken);if(String(me.userId)!==String(user.id))throw new Error('Restored authenticated identity mismatch');
    const uri=`http://127.0.0.1:8181/api/av8/attachments/${encodeURIComponent(file.id)}`;
    const denied=await fetch(uri,{signal:AbortSignal.timeout(15000)});if(denied.status!==401)throw new Error('Restored unauthenticated document was not denied');
    const downloaded=await fetch(uri,{headers:{authorization:`Bearer ${session.accessToken}`},signal:AbortSignal.timeout(15000)});
    if(!downloaded.ok||hash(Buffer.from(await downloaded.arrayBuffer()))!==file.sha256)throw new Error('Restored authenticated document download mismatch');
    console.log(JSON.stringify({status:'PASS',applicationRestartVerified:true,healthVerified:true,actualPasswordAndMfaLoginVerified:true,restoredCopyMfaEnrollment:enrolled,restoredCopyPasswordChange:passwordChanged,runtimeRoleRestricted:true,unscopedRuntimeTenants:0,unscopedRuntimeAttachments:0,scopedDocumentReadVerified:true,crossTenantDocumentDenied:true,authenticatedDocumentDownloadVerified:true,unauthenticatedDocumentDenied:true,outboundAndJobsDisabled:true}));
  }finally{password='';await db.onModuleDestroy();}
}
main().catch(()=>{console.error('Restored application verification failed; credentials, MFA material and document content were not logged.');process.exitCode=1;});
