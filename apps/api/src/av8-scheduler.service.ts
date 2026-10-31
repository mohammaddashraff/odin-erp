import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService, Actor } from './auth';
import { PrismaService } from './prisma.service';
import { Av8OperationsService } from './av8-operations.service';
import { positiveId } from './av8-domain';
import { schedulerConfiguration } from './av8-scheduler-config';

@Injectable()
export class Av8SchedulerService {
  constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly operations:Av8OperationsService){}
  private async actor(id:unknown){const user=await this.db.admin.user.findUnique({where:{id:positiveId(id)},include:this.auth.userInclude});if(!user?.active)throw new Error('Configured scheduler identity is not active');return this.auth.actorFor(user);}
  private async maintenance(a:Actor,limit:number){
    const claimId=randomUUID(),key=`maintenance:${a.userId}`;
    const claim=await this.db.tenant(a.tenantId,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`av8-scheduler:${a.tenantId}:${a.userId}`},0))`;
      const old=await tx.av8Record.findFirst({where:{tenantId:a.tenantId,kind:'scheduler-checkpoint',key}}),d:any=old?.data||{};
      if(d.leaseUntil&&Date.parse(d.leaseUntil)>Date.now())return null;
      const data={...d,claimId,leaseUntil:new Date(Date.now()+90000).toISOString(),attempts:Number(d.attempts||0)+1};
      const row=old?await tx.av8Record.update({where:{id:old.id},data:{status:'RUNNING',data}}):await tx.av8Record.create({data:{tenantId:a.tenantId,kind:'scheduler-checkpoint',key,status:'RUNNING',data,createdById:a.userId}});
      return{id:row.id,cursor:d.cursor||null,data};
    });
    if(!claim)return{status:'BUSY'};
    try{
      const result=await this.operations.maintain(a,{limit,afterId:claim.cursor});
      await this.db.tenant(a.tenantId,tx=>tx.av8Record.updateMany({where:{id:claim.id,data:{path:['claimId'],equals:claimId}},data:{status:'IDLE',data:{...claim.data,cursor:result.nextCursor,leaseUntil:null,lastSuccessAt:new Date().toISOString(),lastError:null}}}));
      return{status:'PROCESSED',...result};
    }catch(error){
      await this.db.tenant(a.tenantId,tx=>tx.av8Record.updateMany({where:{id:claim.id,data:{path:['claimId'],equals:claimId}},data:{status:'FAILED',data:{...claim.data,leaseUntil:null,lastError:'MAINTENANCE_FAILED; cursor preserved for retry'}}}));
      throw error;
    }
  }
  async run(){
    const config=schedulerConfiguration();if(!config.configured)throw new ServiceUnavailableException('AV8 scheduler is not configured');
    const results:any={maintenance:{status:'DISABLED'},academic:{status:'DISABLED'}};let failed=false;
    if(process.env.AV8_OPERATIONS_WORKER_ENABLED==='true')try{results.maintenance=await this.maintenance(await this.actor(process.env.AV8_OPERATIONS_WORKER_USER_ID),config.applicationLimit);}catch{failed=true;results.maintenance={status:'FAILED'};}
    if(process.env.AV8_ACADEMIC_WORKER_ENABLED==='true')try{results.academic={status:'PROCESSED',...await this.operations.process(await this.actor(process.env.AV8_ACADEMIC_WORKER_USER_ID),config.dispatchLimit)};}catch{failed=true;results.academic={status:'FAILED'};}
    if(failed){console.error(JSON.stringify({event:'av8.scheduler.failed',message:'Scheduled processing failed; inspect scoped checkpoint and delivery state'}));throw new ServiceUnavailableException({message:'Scheduled processing requires operator review',results});}
    return{ok:true,...results};
  }
}
