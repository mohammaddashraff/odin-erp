import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma.service';
import { AuthService } from '../auth';
import { ErpService } from '../erp.service';
import { Client } from 'pg';

/** Repeat-safe synthetic catalog and opening stock for actual-browser acceptance only. */
async function main(){
  if(!['dev','test'].includes(process.env.AV8_ENV||'')||!process.env.DATABASE_URL?.includes('/av8_'))throw new Error('Isolated synthetic environment required');
  const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
  const lock=new Client({connectionString:process.env.DATABASE_ADMIN_URL});
  try{
    const db=app.get(PrismaService),auth=app.get(AuthService),erp=app.get(ErpService);
    const user=await db.admin.user.findFirstOrThrow({where:{email:'admin@av8.local'},include:auth.userInclude});
    const actor=auth.actorFor(user),branchId=BigInt(actor.branchIds[0]);
    // The dedicated session lock spans the ordinary journal transactions. Process death
    // releases it; the stable description/checkpoint recovers any draft before retry.
    await lock.connect();await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[`synthetic-pos-opening:${actor.tenantId}`]);
    let checker=auth.actorFor(await db.admin.user.findFirstOrThrow({where:{email:'finance@av8.local'},include:auth.userInclude}));
    const result=await db.tenant(actor.tenantId,async tx=>{
      const tenantId=actor.tenantId;
      const warehouse=await tx.warehouse.upsert({where:{tenantId_code:{tenantId,code:'SYN-POS'}},create:{tenantId,branchId,code:'SYN-POS',name:'Synthetic POS acceptance'},update:{}});
      const category=await tx.itemCategory.upsert({where:{tenantId_code:{tenantId,code:'SYN-POS'}},create:{tenantId,code:'SYN-POS',name:'Synthetic POS acceptance'},update:{}});
      const uom=await tx.unitOfMeasure.upsert({where:{tenantId_code:{tenantId,code:'SYN-EA'}},create:{tenantId,code:'SYN-EA',name:'Synthetic each'},update:{}});
      for(const [code,type]of [['1020','ASSET'],['1200','ASSET'],['4000','REVENUE'],['5000','COGS'],['5200','EXPENSE'],['SYN-POS-OPENING','EQUITY']]as const)await tx.account.upsert({where:{tenantId_code:{tenantId,code}},create:{tenantId,code,name:`Synthetic POS ${code}`,type},update:{}});
      let item=await tx.item.findUnique({where:{tenantId_sku:{tenantId,sku:'SYNTHETIC-POS-DELIVERY'}}});
      if(!item){
        item=await tx.item.create({data:{tenantId,sku:'SYNTHETIC-POS-DELIVERY',barcode:'SYNTHETIC-POS-DELIVERY',name:'Synthetic POS acceptance item',nameAr:'صنف اختبار نقطة البيع',categoryId:category.id,uomId:uom.id,purchasePriceMinor:10000n,salePriceMinor:15000n,taxRateBps:0}});
        await tx.stockBalance.create({data:{tenantId,warehouseId:warehouse.id,itemId:item.id,quantityMilli:100000n,valueMinor:1000000n}});
        await tx.stockMovement.create({data:{tenantId,branchId,warehouseId:warehouse.id,itemId:item.id,postingDate:new Date('2026-01-01'),quantityInMilli:100000n,unitCostMinor:10000n,totalCostMinor:1000000n,runningQuantityMilli:100000n,runningValueMinor:1000000n,sourceType:'SYNTHETIC_ACCEPTANCE_OPENING',sourceId:item.id,sourceNumber:'SYNTHETIC-POS-OPENING',createdById:actor.userId}});
      }
      const warehouseIds=Array.isArray(user.warehouseIds)?user.warehouseIds.map(String):[];
      if(!warehouseIds.includes(String(warehouse.id)))await tx.user.update({where:{id:user.id},data:{warehouseIds:[...warehouseIds,String(warehouse.id)]}});
      const movements=await tx.stockMovement.findMany({where:{tenantId,itemId:item.id,warehouseId:warehouse.id,sourceType:'SYNTHETIC_ACCEPTANCE_OPENING',sourceId:item.id,sourceNumber:'SYNTHETIC-POS-OPENING'}});
      if(movements.length!==1||movements[0].quantityInMilli!==100000n||movements[0].quantityOutMilli!==0n||movements[0].totalCostMinor!==1000000n)throw new Error('Synthetic opening stock source differs; review existing evidence without restocking');
      const accounts=await tx.account.findMany({where:{tenantId,code:{in:['1200','SYN-POS-OPENING']}}});
      if(accounts.find(a=>a.code==='1200')?.type!=='ASSET'||accounts.find(a=>a.code==='SYN-POS-OPENING')?.type!=='EQUITY')throw new Error('Synthetic inventory/equity account source differs');
      const resources=await tx.financialResource.findMany({where:{tenantId,linkedAccountId:{in:accounts.map(a=>a.id)},active:true}});
      for(const resource of resources)if(!await tx.financialResourceAssignment.findFirst({where:{tenantId,userId:checker.userId,resourceId:resource.id,revokedAt:null}}))await tx.financialResourceAssignment.create({data:{tenantId,userId:checker.userId,resourceId:resource.id,grantedById:actor.userId,reason:'Explicit synthetic POS opening journal checker scope'}});
      await tx.roleFieldPermission.upsert({where:{tenantId_roleId_resource_field:{tenantId,roleId:BigInt(checker.roleIds[0]),resource:'journal',field:'lines'}},create:{tenantId,roleId:BigInt(checker.roleIds[0]),resource:'journal',field:'lines',access:'VIEW'},update:{}});
      return{synthetic:true,itemId:String(item.id),warehouseId:String(warehouse.id),branchId:String(branchId),sku:item.sku,movement:movements[0],accounts};
    });
    checker=auth.actorFor(await db.admin.user.findFirstOrThrow({where:{id:checker.userId},include:auth.userInclude}));
    const description=`SYNTHETIC POS opening stock source ${result.movement.id} item ${result.itemId}`,key=`stock-movement:${result.movement.id}`;
    const source=await db.tenant(actor.tenantId,async tx=>({checkpoint:await tx.av8Record.findFirst({where:{tenantId:actor.tenantId,kind:'synthetic-pos-opening',key}}),journals:await tx.journalEntry.findMany({where:{tenantId:actor.tenantId,description,sourceType:'MANUAL'},include:{lines:true,reversedBy:true}})}));
    if(source.journals.length>1)throw new Error('Synthetic opening has duplicate journals requiring review');
    let journal=source.journals[0];
    if(source.checkpoint&&(source.checkpoint.data as any).journalId!==String(journal?.id))throw new Error('Synthetic opening checkpoint does not match the original journal');
    const inventory=result.accounts.find(a=>a.code==='1200')!,equity=result.accounts.find(a=>a.code==='SYN-POS-OPENING')!;
    if(!journal){
      const created:any=await erp.createJournal(actor,{branchId:String(branchId),postingDate:result.movement.postingDate.toISOString().slice(0,10),description,lines:[{accountId:String(inventory.id),debit:'10000',credit:'0'},{accountId:String(equity.id),debit:'0',credit:'10000'}]});
      journal=await db.tenant(actor.tenantId,tx=>tx.journalEntry.findUniqueOrThrow({where:{id:BigInt(created.id)},include:{lines:true,reversedBy:true}}));
    }
    if(journal.branchId!==branchId||journal.createdById!==actor.userId||journal.reversedBy||journal.postingDate.toISOString().slice(0,10)!==result.movement.postingDate.toISOString().slice(0,10)||journal.lines.length!==2||!journal.lines.some(l=>l.accountId===inventory.id&&l.debitMinor===1000000n&&l.creditMinor===0n)||!journal.lines.some(l=>l.accountId===equity.id&&l.creditMinor===1000000n&&l.debitMinor===0n))throw new Error('Synthetic opening journal source differs; preserve and review it');
    await db.tenant(actor.tenantId,tx=>source.checkpoint?tx.av8Record.update({where:{id:source.checkpoint.id},data:{status:journal.status}}):tx.av8Record.create({data:{tenantId:actor.tenantId,kind:'synthetic-pos-opening',key,status:journal.status,data:{journalId:String(journal.id),stockMovementId:String(result.movement.id),itemId:result.itemId,originalValueMinor:'1000000',originalQuantityMilli:'100000'},createdById:actor.userId}}));
    if(journal.status==='DRAFT'){await erp.journalWorkflow(actor,journal.id,'submit');journal.status='SUBMITTED';}
    if(journal.status==='SUBMITTED'){await erp.journalWorkflow(checker,journal.id,'approve');journal.status='APPROVED';}
    if(journal.status==='APPROVED')await erp.journalWorkflow(checker,journal.id,'post');
    const posted=await db.tenant(actor.tenantId,tx=>tx.journalEntry.findUniqueOrThrow({where:{id:journal.id}}));
    if(posted.status!=='POSTED'||posted.approvedById===posted.createdById||!posted.approvedById)throw new Error('Synthetic opening journal was not independently approved and posted');
    await db.tenant(actor.tenantId,tx=>tx.av8Record.updateMany({where:{tenantId:actor.tenantId,kind:'synthetic-pos-opening',key},data:{status:'POSTED'}}));
    console.log(JSON.stringify({synthetic:true,itemId:result.itemId,warehouseId:result.warehouseId,branchId:result.branchId,sku:result.sku,openingJournalId:String(posted.id),openingMovementId:String(result.movement.id),openingValueMinor:'1000000',stockAddedOnRepeat:false}));
  }finally{await lock.end();await app.close();}
}
main().catch(error=>{console.error('Synthetic POS fixture failed',error.message);process.exitCode=1;});
