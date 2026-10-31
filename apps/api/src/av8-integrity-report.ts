import { PrismaService } from './prisma.service';
import { inspectAv8State } from './av8-integrity';

/** Operator-only read-only report. Every query is tenant-bound and company-scoped. */
export async function av8CompanyIntegrity(db:PrismaService,tenantId:bigint,companyId:bigint) {
  return db.tenant(tenantId,async tx=>{
    if(!await tx.company.findFirst({where:{id:companyId,tenantId}}))throw new Error('Integrity company is outside tenant scope');
    const application={customer:{companyId}},branch={companyLinks:{some:{tenantId,companyId}}};
    const branchIds=(await tx.companyBranch.findMany({where:{tenantId,companyId},select:{branchId:true}})).map(r=>r.branchId);
    const funds=await tx.av8Fund.findMany({where:{tenantId,OR:[{application:{is:application}},{applicationId:null,branchId:{in:branchIds}}]},include:{bankTransaction:{include:{bankAccount:true,journalEntry:{include:{lines:true}}}}}});
    const charges=await tx.av8Charge.findMany({where:{tenantId,application:{is:application}}});
    const obligations=await tx.av8Obligation.findMany({where:{tenantId,application:{is:application}}});
    const allocations=await tx.av8Allocation.findMany({where:{tenantId,OR:[{fundId:{in:funds.map(f=>f.id)}},{chargeId:{in:charges.map(c=>c.id)}},{obligationId:{in:obligations.map(o=>o.id)}}]}});
    const records=await tx.av8Record.findMany({where:{tenantId,OR:[{application:{is:application}},{kind:'remittance-basis',key:{in:funds.map(f=>String(f.id))}},{kind:'supplier-opening-settlement',data:{path:['companyId'],equals:String(companyId)}}],kind:{in:['supplier-opening-settlement','remittance-basis','cheque','service-charge','service-payment','obligation-adjustment','academy-funding-exposure','obligation-funding-restored','refund','bank-fee']}}});
    const journals=await tx.journalEntry.findMany({where:{tenantId,branch:{is:branch},status:'POSTED'},include:{lines:true}});
    const sourceRows=await tx.av8OpeningSource.findMany({where:{tenantId,kind:'BATCH'}}),openingSources=sourceRows.filter(r=>branchIds.some(id=>String(id)===(r.data as any).branchId));
    const bankAccounts=await tx.bankAccount.findMany({where:{tenantId,financialResources:{some:{companyId}}},select:{id:true,glAccountId:true,currency:true}});
    const report=inspectAv8State({funds,charges,obligations,allocations,records,journals,openingSources,bankAccounts});
    return {tenantId:String(tenantId),companyId:String(companyId),...report};
  });
}
