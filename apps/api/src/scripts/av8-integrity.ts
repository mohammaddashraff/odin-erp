import { PrismaService } from '../prisma.service';
import { av8CompanyIntegrity } from '../av8-integrity-report';

async function main(){
  const db=new PrismaService();
  try{
    await db.onModuleInit();
    const company=process.argv.find(a=>a.startsWith('--company='))?.slice(10),tenant=process.argv.find(a=>a.startsWith('--tenant='))?.slice(9);
    if(company&&!tenant)throw new Error('Supply --tenant with --company so company IDs cannot be interpreted globally');
    for(const value of [company,tenant])if(value&&!/^[1-9]\d*$/.test(value))throw new Error('Integrity scope IDs must be positive integers');
    const companies=await db.admin.company.findMany({where:{...(company?{id:BigInt(company)}:{}),...(tenant?{tenantId:BigInt(tenant)}:{})},select:{id:true,tenantId:true},orderBy:[{tenantId:'asc'},{id:'asc'}]});
    if(!companies.length)throw new Error('No company found for the selected integrity scope');
    const reports=[];for(const item of companies)reports.push(await av8CompanyIntegrity(db,item.tenantId,item.id));
    console.log(JSON.stringify({generatedAt:new Date().toISOString(),environment:process.env.AV8_ENV,readOnly:true,scope:'Per tenant and owning company; no global account-code comparison',ok:reports.every(r=>r.ok),reports},null,2));
    if(reports.some(r=>!r.ok))process.exitCode=1;
  }finally{await db.onModuleDestroy();}
}
main().catch(error=>{console.error(JSON.stringify({event:'av8.integrity.failed',message:'Read-only integrity report could not complete; verify selected tenant/company, isolated configuration and current database schema',errorType:error instanceof Error?error.name:'UnknownError'}));process.exitCode=1;});
