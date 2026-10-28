import { hash } from 'bcryptjs';
import { PrismaService } from '../src/prisma.service';
import { initialPolicies } from '../src/av8-domain';
import { PERMISSION_REGISTRY } from '../src/permissions';

/** Empty AV8 environment only. No Odin seed, customer records or public passwords. */
export async function seedAv8(db:PrismaService) {
  const password=process.env.AV8_BOOTSTRAP_PASSWORD;
  if(!password||password.length<20)throw new Error('Private AV8_BOOTSTRAP_PASSWORD required');
  const existing=await db.admin.tenant.findFirst();if(existing)return existing;
  const passwordHash=await hash(password,12);
  return db.admin.$transaction(async tx=>{
    const tenant=await tx.tenant.create({data:{name:'AV8 ERP · isolated workspace',baseCurrency:'EGP',makerChecker:true,customerCodePrefix:'AV8'}});
    const tenantId=tenant.id;
    const branch=await tx.branch.create({data:{tenantId,code:'CAI',name:'Cairo'}});
    const second=await tx.branch.create({data:{tenantId,code:'TEST',name:'Synthetic second branch',operational:false}});
    const permissions=await Promise.all(PERMISSION_REGISTRY.map(p=>tx.permission.create({data:{tenantId,...p}})));
    const groups:Record<string,string[]>={
      admin:['system.super_admin'],
      management:['av8.*','dashboard.overview.view','accounting.*','banking.*','payments.*','reports.*','audit.business.view'],
      telesales:['av8.workspace.view','av8.leads.view','av8.leads.create','av8.leads.edit','av8.leads.import'],
      sales:['av8.workspace.view','av8.leads.*','av8.applications.*','av8.medical.*','av8.guardian.*','av8.reports.view','av8.reports.print'],
      affairs:['av8.workspace.view','av8.applications.view','av8.affairs.*','av8.passport.*','av8.bank.*','av8.criminal.*','av8.guardian.*','av8.reports.view','av8.reports.print'],
      finance:['av8.workspace.view','av8.applications.view','av8.finance.*','av8.reports.*','av8.policies.view','accounting.*','banking.*','payments.*','reports.standard.*'],
    };
    const users:any[]=[];
    for(const [key,grants] of Object.entries(groups)) {
      const role=await tx.role.create({data:{tenantId,key:key==='admin'?'super_admin':`av8_${key}`,name:`AV8 ${key}`,permissions:[]}});
      for(const p of permissions.filter(p=>grants.some(g=>g===p.key||g.endsWith('.*')&&p.key.startsWith(g.slice(0,-1)))))await tx.rolePermission.create({data:{tenantId,roleId:role.id,permissionId:p.id}});
      for(const resource of ['av8_lead','av8_application','account','bank_account','journal','payment','report','customer','supplier','audit'])await tx.roleDataScope.create({data:{tenantId,roleId:role.id,resource,scope:['account','bank_account'].includes(resource)?'ASSIGNED':key==='telesales'||key==='sales'?'ASSIGNED':'BRANCH'}});
      const user=await tx.user.create({data:{tenantId,roleId:role.id,email:`${key}@av8.local`,name:`AV8 ${key}`,passwordHash,branchIds:[String(branch.id)],warehouseIds:[],mfaRequired:false}});users.push(user);
    }
    const other=await tx.user.create({data:{tenantId,roleId:users[0].roleId,email:'branch-test@av8.local',name:'Synthetic branch actor',passwordHash,branchIds:[String(second.id)],warehouseIds:[],active:false}});
    for(const [code,name,type] of [['1000','AV8 USD bank','ASSET'],['1010','AV8 EGP bank','ASSET'],['2100','Student agency collections liability','LIABILITY'],['2200','Academy balances liability','LIABILITY'],['4100','Commission revenue — requires approved recognition','REVENUE']] as const)await tx.account.create({data:{tenantId,code,name,type}});
    for(const [code,currency,gl] of [['AV8-USD','USD','1000'],['AV8-EGP','EGP','1010']]) {const account=await tx.account.findUniqueOrThrow({where:{tenantId_code:{tenantId,code:gl}}});await tx.bankAccount.create({data:{tenantId,code,name:`AV8 ${currency} bank`,currency,type:'BANK',glAccountId:account.id}});}
    const resources=await tx.financialResource.findMany({where:{tenantId}});
    for(const user of users.filter(u=>['admin@av8.local','management@av8.local','finance@av8.local'].includes(u.email)))for(const resource of resources)await tx.financialResourceAssignment.create({data:{tenantId,userId:user.id,resourceId:resource.id,grantedById:users[0].id,reason:'Isolated AV8 bootstrap bank/account scope'}});
    const year=new Date().getUTCFullYear();for(let y=year-1;y<=year+3;y++)await tx.fiscalPeriod.create({data:{tenantId,name:String(y),year:y,month:1,startDate:new Date(`${y}-01-01`),endDate:new Date(`${y}-12-31`),status:'OPEN'}});
    for(const currency of ['EGP','USD'])await tx.currency.create({data:{tenantId,code:currency,name:currency,symbol:currency,precision:2,active:true}});
    for(const initial of initialPolicies) {
      const active=initial.kind==='PROGRAM'||initial.kind==='DOCUMENTS'||initial.kind==='PLANNING'||initial.key==='CASH'&&initial.kind==='PLAN';
      await tx.av8Policy.create({data:{tenantId,...initial,data:initial.data as any,version:1,status:active?'ACTIVE':'DRAFT'}});
    }
    await tx.supplier.create({data:{tenantId,code:'AV8-SYNTHETIC-ACADEMY',name:'Synthetic academy — replace before operations',city:'South Africa'}});
    await tx.auditEvent.create({data:{tenantId,userId:users[0].id,action:'AV8_ISOLATED_BOOTSTRAP',entityType:'AV8_CONFIGURATION',entityId:String(tenantId),newValues:{environment:process.env.AV8_ENV,synthetic:true,baseCurrency:'EGP',outbound:'disabled',businessTerms:'Installment and cash settlement remain draft'}}});
    return tenant;
  },{timeout:60000});
}
if(process.argv[1]?.endsWith('av8-seed.ts')){const db=new PrismaService();seedAv8(db).then(()=>console.log('AV8 isolated configuration ready; credentials remain in .av8 environment file.')).finally(()=>db.onModuleDestroy());}
