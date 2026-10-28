// Display helpers only: these do not change stored states or business decisions.
const tones: Record<string, 'success'|'warning'|'danger'|'neutral'> = {
 APPROVED:'success',POSTED:'success',COMPLETED:'success',ACTIVE:'success',OPEN:'success',PAID:'success',CLEARED:'success',ACCEPTED:'success',PASSED:'success',SIGNED:'success',ISSUED:'success',CONVERTED:'success',ARRIVAL_CONFIRMED:'success',FOLLOWUP_COMPLETED:'success',ATTENDED:'success',
 PENDING:'warning',SUBMITTED:'warning',HELD:'warning',SCHEDULED:'warning',AWAITING:'warning',EXPECTED:'warning',FOLLOWUP_PENDING:'warning',ADDITIONAL_INFORMATION:'warning',PARTIALLY_PAID:'warning',PARTIAL:'warning',IN_PROGRESS:'warning',
 REJECTED:'danger',REFUSED:'danger',FAILED:'danger',OVERDUE:'danger',EXPIRED:'danger',
 CLOSED:'neutral',CANCELLED:'neutral',INACTIVE:'neutral',NOT_APPLICABLE:'neutral',WITHDRAWN:'neutral',NOT_STARTED:'neutral',
};
export const statusTone = (value:string) => tones[value] || 'neutral';
export function formSnapshot(value:any):string {
 return JSON.stringify(value,(_,item)=>{
   if(typeof File!=='undefined'&&item instanceof File)return {name:item.name,size:item.size,lastModified:item.lastModified};
   if(item&&typeof item==='object'&&!Array.isArray(item))return Object.fromEntries(Object.entries(item).filter(([,v])=>v!==''&&v!==undefined&&v!==null&&v!==false).sort(([a],[b])=>a.localeCompare(b)));
   return item;
 });
}
export function countTicks(maximum:number) {
 if(maximum<=0)return [0];
 const step=Math.max(1,Math.ceil(maximum/4)),top=Math.ceil(maximum/step)*step;
 return Array.from({length:top/step+1},(_,i)=>top-i*step);
}
export function defaultBranch(branches:any[],user:any,contextId?:string) {
 const valid=branches.filter(b=>b.active!==false&&b.operational!==false);
 return valid.find(b=>String(b.id)===String(contextId||user?.homeBranchId))?.id || (valid.length===1?valid[0].id:'');
}
export function leadEvents(records:any[]=[],timeline:any[]=[]) {
 const recordLabels:Record<string,string>={appointment:'Appointment record',consultation:'Consultation record'};
 const activityLabels:Record<string,string>={CAPTURED:'Lead captured',CREATED:'Lead captured',STATUS:'Lead status updated',ASSIGN:'Owner changed',APPOINTMENT:'Appointment updated',CONSULTATION:'Consultation recorded',CONVERTED:'Application opened'};
 const events=[...records.map(r=>({id:'record:'+r.id,type:recordLabels[r.kind]||r.kind,source:'Current record',status:r.status,actor:r.createdBy?.name||r.user?.name,actorId:r.createdById,time:r.createdAt,note:r.data?.reason,plannedAt:r.data?.plannedAt})),...timeline.map(r=>({id:'audit:'+r.id,type:activityLabels[r.action.replace(/^AV8_/,'')]||r.action.replace(/^AV8_/,''),source:'Recorded activity',actor:r.user?.name,actorId:r.userId,time:r.createdAt,note:r.newValues?.reason}))];
 return [...new Map(events.map(e=>[e.id,e])).values()].sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0)||a.id.localeCompare(b.id));
}
