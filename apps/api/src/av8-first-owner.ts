import { hash } from 'bcryptjs';
import { initialPolicies } from './av8-domain';
import { PERMISSION_REGISTRY } from './permissions';
import { PrismaService } from './prisma.service';

export function firstOwnerConfiguration(env:NodeJS.ProcessEnv=process.env){
  if(env.AV8_HOSTING!=='hetzner'||!['production','staging'].includes(env.AV8_ENV||'')||env.AV8_INITIAL_SETUP!=='EMPTY_DATABASE_ONLY')throw new Error('First-owner setup requires the explicit empty Hetzner installation mode');
  const required=(key:string)=>{const value=(env[key]||'').trim();if(!value||value.length>150)throw new Error(`Configure ${key} explicitly`);return value;};
  const email=required('AV8_INITIAL_ADMIN_EMAIL').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Configure a valid named owner email');
  const branchCode=required('AV8_INITIAL_BRANCH_CODE');if(!/^[A-Za-z0-9_-]{1,24}$/.test(branchCode))throw new Error('Initial branch code must use 1–24 letters, numbers, underscores or hyphens');
  return{email,name:required('AV8_INITIAL_ADMIN_NAME'),company:required('AV8_INITIAL_COMPANY_NAME'),branchName:required('AV8_INITIAL_BRANCH_NAME'),branchCode};
}

/** New empty installation only. No sample people, partners, journals or approved financial rules. */
export async function createFirstOwner(db:PrismaService,config:ReturnType<typeof firstOwnerConfiguration>,password:string){
  if(password.length<40)throw new Error('A generated private high-entropy temporary password is required');
  const passwordHash=await hash(password,12),expiresAt=new Date(Date.now()+24*60*60*1000);
  const result=await db.admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('av8-first-owner',0))`;
    if(await tx.tenant.count()||await tx.user.count())throw new Error('First-owner setup refuses an existing installation; use authenticated administration/recovery');
    const tenant=await tx.tenant.create({data:{name:config.company,baseCurrency:'EGP',makerChecker:true,approvalLimit:0n,customerCodePrefix:'AV8'}});
    const tenantId=tenant.id,company=await tx.company.findFirstOrThrow({where:{tenantId}});
    await tx.company.update({where:{id:company.id},data:{name:config.company}});
    const branch=await tx.branch.create({data:{tenantId,code:config.branchCode,name:config.branchName}});
    const permissions=await Promise.all(PERMISSION_REGISTRY.map(permission=>tx.permission.create({data:{tenantId,...permission}})));
    const role=await tx.role.create({data:{tenantId,key:'super_admin',name:'Initial named administrator',permissions:[]}});
    const adminPermission=permissions.find(p=>p.key==='system.super_admin');if(!adminPermission)throw new Error('Administrator permission registry is incomplete');
    await tx.rolePermission.create({data:{tenantId,roleId:role.id,permissionId:adminPermission.id}});
    const user=await tx.user.create({data:{tenantId,roleId:role.id,email:config.email,name:config.name,passwordHash,passwordChangeRequired:true,temporaryPasswordExpiresAt:expiresAt,mfaRequired:true,branchIds:[String(branch.id)],warehouseIds:[]}});
    for(const code of ['EGP','USD'])await tx.currency.create({data:{tenantId,code,name:code,symbol:code,precision:2,active:true}});
    for(const initial of initialPolicies)await tx.av8Policy.create({data:{tenantId,...initial,data:initial.data as any,version:1,status:'DRAFT'}});
    await tx.auditEvent.create({data:{tenantId,userId:user.id,branchId:branch.id,action:'AV8_EMPTY_INSTALLATION_INITIALIZED',entityType:'AV8_CONFIGURATION',entityId:String(tenantId),newValues:{namedOwner:true,mfaRequired:true,passwordChangeRequired:true,policies:'DRAFT',financialTransactions:0}}});
    return{tenantId:String(tenantId),companyId:String(company.id),userId:String(user.id),expiresAt:expiresAt.toISOString()};
  },{isolationLevel:'Serializable',timeout:60000});
  return result;
}
