import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Actor, can } from './auth';
import { canAtCompany, companyForBranch, requirePermissionAtCompany } from './access-governance';
import { PrismaService } from './prisma.service';
import { serialize } from './money';
import { fail, positiveId, text } from './av8-domain';
export type Av8Tx = Prisma.TransactionClient;
export const permits = (a:Actor,p:string) => can(a,p) || Object.keys(a.companyBranchIds).some(c=>canAtCompany(a,p,c));
export function requireAv8(a:Actor,p:string) { if(!permits(a,p)) throw new ForbiddenException(`Permission required: ${p}`); }
/** Keep sensitive permissions from another company out of a record projection. */
export function av8ActorAtBranch(a: Actor, branchId: bigint): Actor {
  if (can(a, 'system.super_admin')) return a;
  const companyId = companyForBranch(a, branchId);
  return { ...a, companyScopedPermissions: companyId ? { [companyId]: a.companyScopedPermissions[companyId] || [] } : {} };
}
export function av8Scope(a:Actor,resource='application',permission='av8.applications.view'):any {
  requireAv8(a,permission);
  if(can(a,'system.super_admin')) return {tenantId:a.tenantId};
  const branches=Object.entries(a.companyBranchIds).filter(([c])=>canAtCompany(a,permission,c)).flatMap(([,b])=>b).filter(b=>a.branchIds.includes(b));
  const scope=a.dataScopes.find(s=>s.resource===`av8_${resource}`);
  const base={tenantId:a.tenantId,branchId:{in:branches.map(BigInt)}};
  if(!scope || scope.scope==='NONE')return {...base,id:0n};
  if(['OWN','ASSIGNED'].includes(scope.scope))return {...base,ownerId:a.userId};
  if(scope.scope==='TEAM')return {...base,ownerId:{in:((scope.config as any)?.userIds||[]).map(positiveId)}};
  if(['ALL','BRANCH'].includes(scope.scope))return base;
  return {...base,id:0n};
}
export function atBranch(a:Actor,permission:string,branchId:bigint) {
  if(can(a,'system.super_admin'))return;
  const company=companyForBranch(a,branchId);
  if(!company || !a.branchIds.includes(String(branchId)))throw new ForbiddenException('Record is outside your branch/company scope');
  requirePermissionAtCompany(a,permission,company);
}
export async function application(tx:Av8Tx,a:Actor,id:bigint,permission='av8.applications.view') {
  const row=await tx.av8Application.findFirst({where:{AND:[{id},av8Scope(a,'application',permission)]},include:{customer:true,academy:true}});
  if(!row)throw new NotFoundException('Application not found in your scope');
  return row;
}
export async function audit(tx:Av8Tx,a:Actor,action:string,type:string,id:bigint,branchId:bigint|null,data:any={},before?:any) {
  return tx.auditEvent.create({data:{tenantId:a.tenantId,userId:a.userId,action:`AV8_${action}`,entityType:`AV8_${type}`,entityId:String(id),branchId,companyId:branchId?companyForBranch(a,branchId):undefined,newValues:serialize(data),previousValues:before?serialize(before):undefined}});
}
export async function approval(tx:Av8Tx,a:Actor,type:string,id:bigint,action:string,reason:string) {
  return tx.approvalEvent.create({data:{tenantId:a.tenantId,entityType:`AV8_${type}`,entityId:id,action,actorId:a.userId,comment:reason}});
}
export async function once<T>(db:PrismaService,a:Actor,operation:string,key:unknown,body:any,work:(tx:Av8Tx)=>Promise<T>):Promise<any> {
  const token=text(key,'Idempotency key',true,120);
  const id=`av8:${a.userId}:${operation}:${token}`;
  const hash=createHash('sha256').update(JSON.stringify(serialize(body))).digest('hex');
  const unwrap=(saved:any)=>{if(saved.hash!==hash)throw new ConflictException('Idempotency key was already used for a different request');return saved.result;};
  try {return await db.tenant(a.tenantId,async tx=>{
    const old=await tx.idempotencyKey.findUnique({where:{tenantId_key:{tenantId:a.tenantId,key:id}}});
    if(old)return unwrap(old.responseJson);
    const result=serialize(await work(tx));
    await tx.idempotencyKey.create({data:{tenantId:a.tenantId,key:id,responseJson:{hash,result} as any}});
    return result;
  });}catch(error:any){
    if(error.code==='P2002') {
      const saved=await db.tenant(a.tenantId,tx=>tx.idempotencyKey.findUnique({where:{tenantId_key:{tenantId:a.tenantId,key:id}}}));
      if(saved)return unwrap(saved.responseJson);
    }
    throw error;
  }
}
export function version(expected:unknown,actual:number) {if(Number(expected)!==actual)throw new ConflictException('This record changed. Refresh before saving.');}
export async function assignedUser(tx:Av8Tx,a:Actor,id:bigint,branchId:bigint) {
  const user=await tx.user.findFirst({where:{tenantId:a.tenantId,id,active:true}});
  if(!user || !(user.branchIds as any[]).map(String).includes(String(branchId)))fail('Owner must be an active staff member in this branch');
}
