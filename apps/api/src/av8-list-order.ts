// Presentation ordering only. Call after authorization/filtering and before pagination.
export const av8SortKeys = ['name','reference','source','status','firstContactAt','nextFollowUp','date','plannedAt','amountMinor','program','admissions','visa','travel','inquiryAt','postingDate','totalMinor','paidMinor','remainingMinor','overdueMinor','group','totalLeads','converted','conversionPercent','contacted','averageResponseMinutes','followUpsOverdue'];
export function av8DatabaseOrder(kind:'leads'|'applications',query:any):any[] {
 const allowed=kind==='leads'?['name','source','status','inquiryAt','firstContactAt','nextFollowUp']:['name','reference','program','admissions','visa','travel'];
 const key=String(query.sort||''),direction=query.direction==='desc'?'desc':'asc';
 if(!allowed.includes(key))return kind==='leads'?[{inquiryAt:'desc'},{id:'desc'}]:[{id:'desc'}];
 const order=key==='name'?{customer:{name:direction}}:['firstContactAt','nextFollowUp'].includes(key)?{[key]:{sort:direction,nulls:'last'}}:{[key]:direction};
 return [order,{id:'asc'}];
}
export function orderAv8Rows<T extends Record<string,any>>(rows:T[],query:any):T[] {
 const key=String(query.sort||'');if(!av8SortKeys.includes(key))return rows;
 const direction=query.direction==='desc'?-1:1;
 return rows.map((row,index)=>({row,index})).sort((a,b)=>{
   const left=a.row[key],right=b.row[key];
   if(left==null&&right!=null)return 1;if(right==null&&left!=null)return -1;
   let comparison=0;
   if(left!=null&&right!=null){
     if(key.endsWith('Minor'))comparison=BigInt(left)<BigInt(right)?-1:BigInt(left)>BigInt(right)?1:0;
     else if(typeof left==='number'||['conversionPercent'].includes(key))comparison=Number(left)-Number(right);
     else comparison=String(left).localeCompare(String(right),undefined,{numeric:true});
   }
   const identity=(value:T)=>String(value.id??[value.applicationId,value.kind,value.reference,value.issue,value.key,value.group].join('|'));
   return comparison*direction||identity(a.row).localeCompare(identity(b.row),undefined,{numeric:true})||a.index-b.index;
 }).map(({row})=>row);
}
