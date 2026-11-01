import { randomUUID } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { av8CompanyIntegrity } from './av8-integrity-report';

describe('Integrity report tenant/company boundaries on PostgreSQL',()=>{
  let db:PrismaService;
  beforeAll(()=>{if(process.env.AV8_ENV!=='test')throw new Error('Isolated test environment required');db=new PrismaService();});
  afterAll(async()=>{await db.onModuleDestroy();});
  it('reports real persisted AV8 states with original scope and no personal contact payload',async()=>{
    const owner=await db.admin.user.findFirstOrThrow({where:{email:'admin@av8.local'}}),company=await db.admin.company.findFirstOrThrow({where:{tenantId:owner.tenantId}});
    const report=await av8CompanyIntegrity(db,owner.tenantId,company.id);expect(report.tenantId).toBe(String(owner.tenantId));expect(report.companyId).toBe(String(company.id));expect(report.summary.unappliedReceiptMinor).toMatch(/^-?\d+$/);
    expect(JSON.stringify(report)).not.toMatch(/password|@av8\.invalid|"phone"|"guardian"/);expect(report.issues.every((i:any)=>i.code&&i.entityId&&i.action)).toBe(true);
  });
  it('rejects a company from another tenant instead of mixing its control accounts',async()=>{
    const owner=await db.admin.user.findFirstOrThrow({where:{email:'admin@av8.local'}});
    const tenant=await db.admin.tenant.create({data:{name:`SYNTHETIC integrity isolation ${randomUUID()}`,baseCurrency:'EGP'}});
    const company=await db.admin.company.create({data:{tenantId:tenant.id,code:`SYN-${randomUUID()}`,name:'Synthetic isolated integrity company'}});
    await expect(av8CompanyIntegrity(db,owner.tenantId,company.id)).rejects.toThrow('outside tenant');
    const report=await av8CompanyIntegrity(db,tenant.id,company.id);expect(report.funds).toEqual([]);expect(report.summary.clearedReceiptPrincipalMinor).toBe('0');
  });
});
