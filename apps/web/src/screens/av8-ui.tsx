"use client";
import { useEffect, useRef, useState } from 'react';
import { useERP } from '../core/erp-context';
import { Button, Dialog, ErrorNotice, Fields, useUnsaved, type FieldSpec } from '../components/ui';
import { cairoToday } from '../core/cairo-time';
import {formSnapshot} from '../core/ui-presentation';
export const cash=(v:any,currency='USD')=>{const x=BigInt(v||0),n=x<0n?-x:x;return `${currency} ${x<0n?'-':''}${(n/100n).toLocaleString('en-US')}.${String(n%100n).padStart(2,'0')}`;};
export const today=cairoToday;
export const time=(v:any,language='en')=>v?new Intl.DateTimeFormat(language==='ar'?'ar-EG':'en-GB',{timeZone:'Africa/Cairo',numberingSystem:'latn',dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
export const option=(items:any[])=>[{value:'',label:'Select'},...items];
export const f=(key:string,label:string,type='text',required=false):FieldSpec=>({key,label,type,required});
export const reason=f('reason','Reason / notes','textarea',true);
export function Form({title,fields,initial={},change,render,save,close,children,dirty:extraDirty=false,submitLabel='Save',submitDisabled=false,submitHint}:{
 title:string;fields:FieldSpec[]|((value:any)=>FieldSpec[]);initial?:any;change?:(key:string,value:any,current:any)=>any;render?:(value:any)=>React.ReactNode;save:(v:any)=>Promise<any>;close:()=>void;children?:React.ReactNode;dirty?:boolean;submitLabel?:string;submitDisabled?:boolean;submitHint?:string;
}) {
 const {tr}=useERP();
 const [value,setValue]=useState(()=>({...initial})),baseline=useRef(formSnapshot(initial));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const form=useRef<HTMLFormElement>(null),inFlight=useRef(false);
 const dirty=extraDirty||formSnapshot(value)!==baseline.current;
 const guard=useUnsaved(dirty);
 useEffect(()=>{if(error&&!Object.keys(fieldErrors).length)form.current?.querySelector<HTMLElement>('.form-error-summary')?.focus();},[error,fieldErrors]);
 const dismiss=()=>{if(!inFlight.current)guard(close);};
 return <Dialog title={title} close={dismiss} className="av8-form-dialog"><form ref={form} onChange={()=>setError('')} onInvalidCapture={e=>{
   const control=e.target as HTMLInputElement,key=control.dataset.fieldKey;
   if(key)setFieldErrors(old=>({...old,[key]:control.validity.valueMissing?'Complete this required field.':'Check this value.'}));
 }} onSubmit={async e=>{
   e.preventDefault();if(inFlight.current||submitDisabled)return;inFlight.current=true;setBusy(true);setError('');setFieldErrors({});
   try{await save(value);close();}catch(e:any){setError(e.message);if(e.field)setFieldErrors({[e.field]:e.message});else form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();}finally{inFlight.current=false;setBusy(false);}
 }}>
 <div className="av8-form-content"><Fields specs={typeof fields==='function'?fields(value):fields} values={value} errors={fieldErrors} set={(k,v)=>{setFieldErrors(old=>{const next={...old};delete next[k];return next;});setValue((old:any)=>change?change(k,v,old):({...old,[k]:v}));}}/>{render?.(value)}{children}{error?<div tabIndex={-1} role="alert" className="form-error-summary"><ErrorNotice title="Could not save" message={error}/></div>:null}</div>
 <div className="actions av8-form-actions">{submitHint?<p>{tr(submitHint)}</p>:null}<Button onClick={dismiss} disabled={busy}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy} disabled={submitDisabled}>{tr(submitLabel)}</Button></div></form></Dialog>;
}
export function FxPreview({value,baseCurrency='EGP'}:{value:any;baseCurrency?:string}) {
 const {tr}=useERP();
 const currency=String(value.currency||'USD'),manual=value.usdToBaseRate||value.baseRate;
 return <div className="av8-callout av8-fx-help" aria-live="polite"><strong>{tr('Currency handling')}</strong><p>{tr('The receiving account sets the payment currency')}: <bdi>{currency}</bdi>.</p><p><bdi>{tr('1 USD =')} {manual||tr('saved dated rate')} {baseCurrency}</bdi></p><small>{tr('The student-payment conversion and ledger conversion are calculated separately and saved with the receipt.')}</small></div>;
}
export function useAv8Actions(reload:()=>void) {const {request,notify}=useERP();return async(path:string,value:any)=>{const result=await request('/av8'+path,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(value)});notify('Saved successfully');reload();return result;};}
import { useSession } from '../core/session-provider';
export function Download({path,label,filename}:{path:string;label:string;filename:string}) {
 const {authorizedFetch}=useSession();const {tr,language}=useERP();const [error,setError]=useState('');
 return <><Button onClick={async()=>{try{const r=await authorizedFetch('/api/av8'+path,{headers:{'Accept-Language':language}});if(!r.ok)throw new Error((await r.json()).message||'Download failed');const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e:any){setError(e.message);}}}>{tr(label)}</Button>{error?<span role="alert">{error}</span>:null}</>;
}
export function Evidence({appId,record,files,reload}:{appId:string;record:any;files:any[];reload:()=>void}) {
 const {request,tr}=useERP();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <div className="av8-evidence"><small>{tr('Supported files: PDF, PNG, JPEG or WebP, up to 4 MB.')}</small>{files.filter(x=>x.recordId===record.id).map(file=><Download key={file.id} path={'/attachments/'+file.id} label={file.filename} filename={file.filename}/>)}<label className="btn">{tr(busy?'Uploading…':'Upload evidence')}<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>4*1024*1024){setError(tr('Choose a file within the 4 MB attachment limit'));e.target.value='';return;}setBusy(true);setError('');const body=new FormData();body.append('file',file);try{await request(`/av8/applications/${appId}/attachments/${record.id}`,{method:'POST',body});reload();}catch(e:any){setError(e.message);}finally{setBusy(false);e.target.value='';}}}/></label>{error?<span role="alert">{error}</span>:null}</div>;
}
