"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useERP, useResource } from '../core/erp-context';
import { Button, ErrorNotice, Loading, PageHeader, Panel, Status, Table, type FieldSpec } from '../components/ui';
import { Form, cash, f, reason, useAv8Actions } from './av8-ui';

const minor=(value:any)=>{
 const match=String(value??'').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
 if(!match)throw new Error('Use an exact amount with at most 2 decimal places');
 return String(BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0')));
};
const decimal=(value:any)=>{
 if(value===null||value===undefined||value==='')return '';
 const amount=BigInt(value);return `${amount/100n}.${String(amount%100n).padStart(2,'0')}`;
};
const select=(key:string,label:string,options:any[],required=true):FieldSpec=>({key,label,options,required});
const displayName=(value:any)=>String(value||'').replace(/\s+[—-]\s+DRAFT\s*$/i,'');

export default function Policies({refs}:{refs?:any}) {
 const {tr,allowed}=useERP();
 const resource=useResource('/av8/policies');
 const [edit,setEdit]=useState<any>(null);
 const act=useAv8Actions(resource.reload);
 const policies=resource.data||[];
 const programs=policies.filter((p:any)=>p.kind==='PROGRAM');
 const plans=policies.filter((p:any)=>p.kind==='PLAN');
 const terms=policies.filter((p:any)=>p.kind==='SETTLEMENT');

 const openProgram=(policy:any)=>setEdit({
  policy,title:'Edit program and fees',
  fields:[f('name','Program name','text',true),f('applicationFee','Application fee (USD)','decimal',true),f('cashStudentTotal','Cash student total (USD)','decimal',true),reason],
  initial:{...policy.data,applicationFee:decimal(policy.data.applicationFeeMinor),cashStudentTotal:decimal(policy.data.cashStudentTotalMinor),reason:''},
 });
 const openPlan=(policy:any)=>{
  const data=policy.data;
  if(policy.key==='CASH')return setEdit({policy,title:'Edit payment plan',fields:[f('name','Plan name','text',true),reason],initial:{...data,reason:''}});
  const amountKey=policy.key==='A'?'contractAmount':'firstAmount';
  const amountLabel=policy.key==='A'?'Contract payment (USD)':'First payment (USD)';
  setEdit({policy,title:'Edit payment plan',fields:[
   f('name','Plan name','text',true),
   select('interpretation','Installment amount means',[{value:'EACH',label:'Each installment'},{value:'TOTAL',label:'Total deferred balance'}]),
   f('installmentCount','Number of deferred installments','number',true),f('installmentAmount','Deferred installment amount (USD)','decimal',true),
   ...(policy.key==='A'?[f('contractAmount',amountLabel,'decimal',true),f('visaAmount','Visa payment (USD)','decimal',true)]:[f(amountKey,amountLabel,'decimal',true)]),
   select('firstMilestone','First payment milestone',['CONTRACT','VISA','BEFORE_DEPARTURE']),
   select('anchor','Deferred schedule starts from',['CONTRACT','DEPARTURE','CUSTOM']),
   f('offsetMonths','First installment after (months)','number',true),f('frequencyMonths','Repeat every (months)','number',true),reason,
  ],initial:{...data,installmentCount:data.installmentCount??(policy.key==='A'?5:6),installmentAmount:decimal(data.installmentAmountMinor??(policy.key==='A'?'960000':'800000')),contractAmount:decimal(data.contractAmountMinor??'600000'),visaAmount:decimal(data.visaAmountMinor??'800000'),firstAmount:decimal(data.firstAmountMinor??'1400000'),reason:''}});
 };
 const openTerms=(policy:any)=>setEdit(policy.key==='CASH'?{
  policy,title:'Edit academy terms',fields:[f('academyAmount','Academy amount (USD)','decimal',true),f('commissionAmount','Commission (USD)','decimal',true),select('additionalMilestone','Academy transfer milestone',['BEFORE_DEPARTURE','AFTER_DEPARTURE']),reason],
  initial:{...policy.data,academyAmount:decimal(policy.data.totalAcademyMinor),commissionAmount:decimal(policy.data.commissionMinor),reason:''},
 }:{
  policy,title:'Edit academy terms',fields:[f('medicalAmount','Medical pass transfer (USD)','decimal',true),f('visaAmount','Visa issuance transfer (USD)','decimal',true),f('commissionAmount','Commission (USD)','decimal',true),f('deferredPassThrough','Transfer deferred collections to academy','checkbox'),reason],
  initial:{...policy.data,medicalAmount:decimal(policy.data.medicalMinor),visaAmount:decimal(policy.data.visaMinor),commissionAmount:decimal(policy.data.commissionMinor),reason:''},
 });
 const save=async(value:any)=>{
  const policy=edit.policy,data={...policy.data,...value};delete data.reason;
  if(policy.kind==='PROGRAM'){
   data.currency='USD';data.applicationFeeMinor=minor(value.applicationFee);data.cashStudentTotalMinor=minor(value.cashStudentTotal);
   delete data.applicationFee;delete data.cashStudentTotal;
  }
  if(policy.kind==='PLAN'&&policy.key!=='CASH'){
   for(const key of ['installmentCount','offsetMonths','frequencyMonths'])data[key]=Number(value[key]);
   data.installmentAmountMinor=minor(value.installmentAmount);delete data.installmentAmount;
   if(policy.key==='A'){data.contractAmountMinor=minor(value.contractAmount);data.visaAmountMinor=minor(value.visaAmount);delete data.contractAmount;delete data.visaAmount;}
   else {data.firstAmountMinor=minor(value.firstAmount);delete data.firstAmount;}
  }
  if(policy.kind==='SETTLEMENT'){
   data.commissionMinor=minor(value.commissionAmount);delete data.commissionAmount;
   if(policy.key==='CASH'){data.totalAcademyMinor=minor(value.academyAmount);delete data.academyAmount;}
   else {data.medicalMinor=minor(value.medicalAmount);data.visaMinor=minor(value.visaAmount);delete data.medicalAmount;delete data.visaAmount;}
  }
  return act('/policies',{id:policy.id,data,reason:value.reason||'Business setting updated'});
 };
 const editButton=(policy:any,open:(policy:any)=>void)=><>{policy.usable?<Status value="ACTIVE"/>:<span className="status warning"><i/>{tr('Needs completion')}</span>}{allowed('av8.policies.manage')?<Button onClick={()=>open(policy)}>{tr(policy.usable?'Edit':'Complete')}</Button>:null}</>;

 return <div className="av8-workspace av8-settings">
  <PageHeader title="Business configuration" subtitle="Everyday AV8 settings — changes apply to new agreements only">
   {allowed('system.super_admin')?<Link className="btn" href="/purchasing/suppliers">{tr('Manage academies')}</Link>:null}
  </PageHeader>
  {resource.error?<ErrorNotice message={resource.error}/>:resource.loading?<Loading/>:<div className="av8-settings-grid">
   <Panel title="Programs and fees" className="av8-settings-card">
    <div className="av8-settings-list">{programs.map((policy:any)=><article key={policy.id}><div><strong>{policy.data.name}</strong><small>{tr('Application fee')} · {cash(policy.data.applicationFeeMinor)}</small><small>{tr('Cash student total')} · {cash(policy.data.cashStudentTotalMinor)}</small></div><div className="actions">{editButton(policy,openProgram)}</div></article>)}</div>
   </Panel>
   <Panel title="Bank and cash accounts" className="av8-settings-card">
    <div className="av8-settings-content"><p>{tr('These accounts determine the currency and destination of each receipt.')}</p><Table rows={refs?.banks||[]} columns={[{key:'name',label:'Account'},{key:'type',label:'Type',render:(row:any)=>tr(row.type)},{key:'currency',label:'Currency'}]}/>{allowed('system.super_admin')?<Link className="btn" href="/banking/accounts">{tr('Manage bank and cash accounts')}</Link>:null}</div>
   </Panel>
   <Panel title="Payment plans" className="av8-settings-card av8-settings-wide">
    <div className="av8-settings-list">{plans.map((policy:any)=><article key={policy.id}><div><strong>{displayName(policy.data.name)||`${tr('Payment plan')} ${policy.key}`}</strong><small>{policy.key==='CASH'?`${tr('Total')} · ${cash(policy.previews?.[0]?.totalMinor||5400000)}`:policy.usable?`${policy.data.installmentCount??(policy.key==='A'?5:6)} ${tr('deferred installments')} · ${tr(policy.data.anchor)}`:tr('Complete the amount and schedule before using this plan')}</small></div><div className="actions">{editButton(policy,openPlan)}</div></article>)}</div>
   </Panel>
   <Panel title="Academies and agreed terms" className="av8-settings-card av8-settings-wide">
    <div className="av8-callout"><strong>{tr('Signed agreements keep an immutable snapshot')}</strong><p>{tr('Changing these settings affects new agreements only; existing signed student terms do not change.')}</p></div>
    <div className="av8-settings-list">{terms.map((policy:any)=><article key={policy.id}><div><strong>{tr(policy.key==='CASH'?'Cash plan terms':'Installment plan terms')}</strong><small>{policy.usable?policy.key==='CASH'?`${tr('Academy')} ${cash(policy.data.totalAcademyMinor)} · ${tr('Commission')} ${cash(policy.data.commissionMinor)}`:`${tr('Medical pass')} ${cash(policy.data.medicalMinor)} · ${tr('Visa')} ${cash(policy.data.visaMinor)}`:tr('Complete the agreed amounts before using these terms')}</small></div><div className="actions">{editButton(policy,openTerms)}</div></article>)}</div>
   </Panel>
  </div>}
  {edit?<Form title={edit.title} fields={edit.fields} initial={edit.initial} save={save} close={()=>setEdit(null)}/>:null}
 </div>;
}
