import { Av8Tx } from './av8-access';
import { serialize } from './money';

/** Actual opening liabilities and source-linked payments, with original/book currencies separate. */
export async function supplierOpeningBalances(tx:Av8Tx,tenantId:bigint,sources:any[],allowedSupplierIds?:string[]) {
  const settlements=await tx.av8Record.findMany({where:{tenantId,kind:'supplier-opening-settlement',status:'RECORDED'},orderBy:{id:'asc'}});
  const supplierIds=[...new Set(sources.flatMap(s=>(s.data.supplierBalances||[]).map((b:any)=>String(b.supplierId))))].filter(id=>!allowedSupplierIds||allowedSupplierIds.includes(id));
  const suppliers=await tx.supplier.findMany({where:{tenantId,id:{in:supplierIds.map(BigInt)}},select:{id:true,name:true}});
  const currencies=await tx.currency.findMany({where:{tenantId}}),tenant=await tx.tenant.findUniqueOrThrow({where:{id:tenantId}});
  return sources.flatMap(source=>(source.data.supplierBalances||[]).map((balance:any,index:number)=>{
    const supplier=suppliers.find(s=>String(s.id)===String(balance.supplierId));if(!supplier)return null;
    const linked=settlements.filter(r=>{const d:any=r.data;return d.sourceSystem===source.source_system&&d.batchSourceId===source.source_id&&Number(d.balanceIndex)===index;});
    const paid=linked.reduce((n,r)=>n+BigInt((r.data as any).amountMinor),0n),paidBase=linked.reduce((n,r)=>n+BigInt((r.data as any).baseMinor),0n);
    return serialize({...balance,sourceSystem:source.source_system,batchSourceId:source.source_id,balanceIndex:index,branchId:source.data.branchId,cutoverDate:source.data.cutoverDate,supplierName:supplier.name,precision:balance.precision??currencies.find(c=>c.code===balance.currency)?.precision??2,baseCurrency:source.data.baseCurrency||tenant.baseCurrency,basePrecision:source.data.basePrecision??currencies.find(c=>c.code===(source.data.baseCurrency||tenant.baseCurrency))?.precision??2,paidMinor:paid,remainingMinor:BigInt(balance.amountMinor)-paid,paidBaseMinor:paidBase,remainingBaseMinor:BigInt(balance.baseMinor)-paidBase,settlements:linked.map(r=>({id:String(r.id),...(r.data as any)}))});
  }).filter(Boolean));
}
