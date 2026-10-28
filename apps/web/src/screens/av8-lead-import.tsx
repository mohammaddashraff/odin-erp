"use client";
import {useRef,useState} from 'react';
import {useERP} from '../core/erp-context';
import {Button,ErrorNotice,Table,type FieldSpec} from '../components/ui';
import {Form} from './av8-ui';
import {canonicalLeadInput} from '../core/av8-report-schema';
export default function LeadImport({fields,initial,close,reload}:{fields:FieldSpec[];initial:any;close:()=>void;reload:()=>void}) {
 const {tr,request,notify}=useERP();
 const [csv,setCsv]=useState(''),[preview,setPreview]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const inFlight=useRef(false);
 const valid=preview?.rows?.length>0&&preview.rows.length<=500&&!preview.rows.some((r:any)=>r.error||((r.duplicates.length||r.duplicateInFile)&&!r.reviewed));
 const change=(value:string)=>{setCsv(value);setPreview(null);setError('');};
 return <Form title="Import leads" fields={fields} initial={initial} dirty={!!csv} submitLabel="Import validated leads" submitDisabled={!valid||busy} submitHint={valid?'Ready to import the reviewed rows.':'Upload and preview 1–500 rows, resolve errors and review duplicates first.'} close={close} save={async value=>{
   if(!valid)throw new Error('Resolve row errors and review duplicates before importing');
   const result=await request('/av8/leads/import/commit',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({...value,rows:preview.rows.map((r:any)=>({...canonicalLeadInput(r.data),duplicateReviewed:!!r.reviewed}))})});
   notify(`${tr('Imported leads')}: ${result.count}`);reload();
 }}>
 <section className="import-step"><h3>{tr('1. Choose a CSV file')}</h3><p>{tr('Required columns: name, phone, source. Optional columns: email, campaign, program.')}</p><label className="field"><span>{tr('CSV file')}</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];if(file)change(await file.text());}}/></label><details><summary>{tr('Advanced: paste CSV')}</summary><label className="field"><span>{tr('CSV content')}</span><textarea value={csv} disabled={busy} onChange={event=>change(event.target.value)}/></label></details></section>
 <section className="import-step"><h3>{tr('2. Preview and review')}</h3><Button busy={busy} disabled={!csv.trim()} onClick={async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{setPreview(await request('/av8/leads/import/preview',{method:'POST',body:JSON.stringify({csv})}));}catch(e:any){setPreview(null);setError(e.message);}finally{setBusy(false);inFlight.current=false;}}}>{tr('Preview CSV')}</Button>{error?<ErrorNotice message={error}/>:null}{preview?<Table caption="Import preview" rows={preview.rows} columns={[{key:'row',label:'Row',numeric:true},{key:'name',label:'Name',render:r=><bdi>{r.data.name}</bdi>},{key:'error',label:'Error',render:r=>r.error?tr(r.error):'—'},{key:'duplicates',label:'Potential duplicates reviewed',render:r=>r.duplicates.length||r.duplicateInFile?<label><input type="checkbox" checked={!!r.reviewed} onChange={e=>setPreview((p:any)=>({...p,rows:p.rows.map((x:any)=>x.row===r.row?{...x,reviewed:e.target.checked}:x)}))}/>{r.duplicates.map((d:any)=>d.name).join(', ')||tr('Same phone in CSV')}</label>:'—'}]}/>:null}</section>
 <section className="import-step"><h3>{tr('3. Import validated leads')}</h3><p>{tr('The import saves all reviewed rows together. If validation fails, no rows are imported.')}</p></section>
 </Form>;
}
