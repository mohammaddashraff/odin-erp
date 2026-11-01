"use client";

import { useState } from 'react';
import Link from 'next/link';
import { decimal, useERP, useResource } from '../core/erp-context';
import { Button, ErrorNotice, Loading, Panel, Status, Table, type FieldSpec } from '../components/ui';
import { Form, SupportingEvidence, cash, f, option, reason, today, useAv8Actions } from './av8-ui';

type Section = 'admission' | 'services' | 'training' | 'delivery';
type Editor = { title: string; fields: FieldSpec[] | ((value: any) => FieldSpec[]); initial?: any; save: (value: any) => Promise<any>; hint?: string };
const select = (key: string, label: string, options: any[], required = true): FieldSpec => ({key, label, options: option(options), required});
const valueOf = (row: any) => ({...row, ...(row.data || {}), status: row.status, id: row.id});

export default function Operations({id, app, refs, section, reload}: {id: string; app: any; refs: any; section: Section; reload: () => void}) {
  const {tr, allowed, dateTime} = useERP();
  const state = useResource(`/av8/applications/${id}/operations`);
  const banking = useResource(section === 'services' && allowed('banking.transaction.view') ? '/banking' : null);
  const [edit, setEdit] = useState<Editor | null>(null);
  const refresh = () => {state.reload(); reload();};
  const act = useAv8Actions(refresh);
  const save = (kind: string, value: any) => act(`/applications/${id}/operations`, {...value, kind});
  const evidence = select('evidenceId', 'Supporting attachment', (app.attachments || []).map((file: any) => ({value: file.id, label: file.filename})));
  const records = (state.data?.records || []).map(valueOf);
  const services = (state.data?.services || []).map(valueOf);
  const charges = services.flatMap((service: any) => (service.charges || []).map((charge: any) => ({...valueOf(charge), service})));
  const dispatches = (state.data?.dispatches || []).map(valueOf);
  const reports = records.filter((record: any) => record.kind === 'report-version' && record.status === 'REVIEWED');
  const choices = (rows: any[], label: (row: any) => string) => rows.map(row => ({value: row.id, label: label(row)}));
  const open = (title: string, kind: string, fields: Editor['fields'], initial: any = {}, hint?: string) => setEdit({title, fields, initial, hint, save: value => save(kind, value)});
  const history = section === 'admission' ? records.filter((row: any) => ['eligibility','admission'].includes(row.kind))
    : section === 'training' ? records.filter((row: any) => ['financial-hold','training','graduation'].includes(row.kind))
    : section === 'services' ? records.filter((row: any) => ['expense','service-payment'].includes(row.kind))
    : [];
  const trainingTransitions:Record<string,string[]>={NONE:['STARTED','SUSPENSION_REQUESTED'],STARTED:['SUSPENSION_REQUESTED'],SUSPENSION_REQUESTED:['SUSPENSION_NOTIFIED','SUSPENDED'],SUSPENSION_NOTIFIED:['SUSPENDED'],SUSPENDED:['RESUMPTION_REQUESTED'],RESUMPTION_REQUESTED:['RESUMED','SUSPENDED'],RESUMED:['SUSPENSION_REQUESTED']};
  const nextTraining=trainingTransitions[records.find((record:any)=>record.kind==='training')?.status||'NONE']||[];
  const serviceFields: FieldSpec[] = [select('type', 'Service type', ['ACCOMMODATION', 'TRANSPORT']), f('provider', 'Provider', 'text', true), f('startDate', 'Start date', 'date', true), f('endDate', 'End date', 'date'), f('amount', 'Agreed monthly price', 'decimal', true), f('currency', 'Currency', 'text', true), select('collectionParty', 'Payment recipient', [{value:'AV8',label:'AV8 collects payment'},{value:'PROVIDER',label:'Student pays provider directly'}]), reason];
  const recordService = (service?: any) => open(service ? 'Amend monthly service' : 'Add monthly service', 'service', serviceFields,
    service ? {...service, key: service.serviceKey || service.key, amount: service.amountMinor == null ? '' : decimal(service.amountMinor,service.precision??2), startDate:'', endDate:'', reason:''} : {key:crypto.randomUUID(),currency:'USD'},
    'Monthly prices are student-specific. Changes preserve the earlier agreement.');
  const payService = (charge: any) => open('Record service payment', 'service-payment', [f('amount', 'Amount', 'decimal', true), f('date', 'Payment date', 'date', true), evidence,
    ...(charge.service.collectionParty === 'AV8' ? [select('fundId', 'Confirmed AV8 receipt', choices((app.finance?.funds || []).filter((fund: any) => fund.kind === 'RECEIPT' && fund.status === 'CLEARED' && fund.currency===charge.currency && BigInt(fund.availableUsdMinor??'0')>0n), fund => `${fund.reference || fund.id} · ${cash(fund.usdMinor)}`))] : []), reason],
    {chargeId: charge.id, date: today()}, charge.service.collectionParty === 'AV8' ? 'Select the actual cleared receipt. A service payment must not also settle tuition.' : 'Direct provider payments are external evidence and do not increase AV8 cash.');
  const serviceCollection = () => setEdit({title:'Record AV8 service collection',fields:value=>[f('amount','Original amount','decimal',true),select('bankAccountId','Cash / bank account',choices(refs?.banks||[],bank=>`${bank.name} · ${bank.currency}`)),f('currency','Currency','text',true),...(value.currency!=='USD'?[f('usdRate','USD per currency unit','decimal',true)]:[]),f('baseRate','Base currency per unit','decimal',true),f('rateDate','Rate date','date',true),f('postingDate','Payment date','date',true),select('collectionBranchId','Collection branch for shared resources',refs?.branches||[],false),select('method','Payment method',['BANK','CASH','CARD','WALLET']),f('payer','Payer / counterparty','text',true),f('reference','Payment reference','text',true),evidence,reason],initial:{currency:'USD',method:'BANK',rateDate:today(),postingDate:today(),payer:app.customer.name},hint:'Confirm the actual collection, then link it to a monthly charge. Do not allocate the same funds to tuition.',save:value=>act('/funds',{...value,kind:'RECEIPT',applicationId:id,notes:value.reason})});
  const confirmServiceCollection=(fund:any)=>setEdit({title:'Confirm actual service collection',fields:[reason],hint:'Confirmation posts the evidenced cash movement without a tuition allocation.',save:value=>act(`/funds/${fund.id}/action`,{...value,action:'confirm',allocations:[]})});
  const recordExpense = (previous?:any) => open('Record student expense', 'expense', value => [select('expenseType','Expense type',['INSURANCE','OTHER']), select('status','Status',['DRAFT','PAID']), f('amount','Expense amount (USD)','decimal',true),
    select('supplierId','Supplier', choices(refs?.suppliers || refs?.academies || [], row => row.name)), f('invoiceReference','Insurance policy / invoice reference','text',true),f('policyReference','Insurance policy reference'), f('startDate','Start date','date'),f('endDate','End date','date'),
    ...(value.status === 'PAID' ? [evidence,f('paidAt','Payment date','date',true), ...(banking.data?.transactions ? [select('bankTransactionId','Posted expense payment', choices(banking.data.transactions.filter((row:any) => row.kind === 'PAYMENT'),row=>`${row.number || row.reference || row.id} · ${row.currency || ''}`))] : [f('bankTransactionId','Posted bank transaction ID','text',true)]), f('paidAmount','Original amount paid','decimal',true), f('paidCurrency','Payment currency','text',true), ...(value.paidCurrency && value.paidCurrency !== 'USD' ? [f('usdRate','USD per currency unit','decimal',true),f('rateDate','Rate date','date',true),f('rateProvenance','Rate source / approval','text',true)] : [])] : []),
    f('refundEligible','Approved as eligible refund expense','checkbox'), f('eligibilityReason','Expense eligibility decision','textarea',true), reason],
    previous?{...previous,priorId:previous.id,key:undefined,status:'PAID',amount:decimal(previous.amountMinor),paidCurrency:'USD',paidAt:today(),reason:''}:{key:crypto.randomUUID(),expenseType:'INSURANCE',status:'DRAFT',amount:'400.00',currency:'USD',paidCurrency:'USD',refundEligible:false},
    'Insurance is an AV8 expense. Only an actual approved eligible expense may reduce a refund.');
  const queueReport = (report: any) => setEdit({title:'Queue report emails',fields:[reason],initial:{reason:''},hint:'Queue separate emails to the student and registered guardian. Provider delivery is recorded separately.',save:value=>act(`/applications/${id}/reports/${report.id}/dispatch`,value)});
  const dispatchAction = (dispatch: any, action: 'retry' | 'reconcile') => setEdit({title:action === 'retry' ? 'Retry failed recipient' : 'Reconcile delivery outcome',
    fields: action === 'retry' ? [reason] : [f('providerReference','Provider message reference','text',true),reason], initial: action === 'reconcile' ? {providerReference:dispatch.providerReference || ''} : {},
    hint: action === 'retry' ? 'Only this failed recipient is retried. Successful recipients are preserved.' : 'Use provider evidence to resolve an unknown outcome before retrying.',
    save:value=>act(`/applications/${id}/dispatches/${dispatch.id}/action`,{...value,action})});

  if (state.loading) return <Loading/>;
  if (state.error) return <ErrorNotice message={state.error} retry={state.reload}/>;
  return <>
    {section !== 'delivery' ? <div className="actions"><SupportingEvidence app={app} reload={refresh} financial={section==='services'&&allowed('av8.finance.create')}/></div> : null}
    {section === 'admission' ? <Panel title="Admission decision" actions={<div className="actions">
      {allowed('av8.affairs.edit') ? <Button onClick={()=>open('Verify academic eligibility','eligibility',[select('status','Eligibility decision',['VERIFIED','REJECTED']),f('criteria','Approved criteria and findings','textarea',true),evidence,reason])}>{tr('Verify academic eligibility')}</Button> : null}
      {allowed('av8.affairs.edit') ? <Button primary onClick={()=>open('Record admission decision','admission',[select('status','Admission decision',['APPROVED','REJECTED']),reason])}>{tr('Record admission decision')}</Button> : null}
    </div>}><p>{tr('Medical clearance, verified required documents and approved eligibility are checked before admission approval.')}</p></Panel> : null}
    {section === 'services' ? <>
      <Panel title="Monthly accommodation and transport" actions={allowed('av8.affairs.edit') ? <Button primary onClick={()=>recordService()}>{tr('Add monthly service')}</Button> : undefined}>
        <p>{tr('Monthly prices are student-specific. Changes preserve the earlier agreement.')}</p>
        <Table rows={services} columns={[
          {key:'type',label:'Service type',render:(row:any)=>tr(row.type)}, {key:'provider',label:'Provider'}, {key:'startDate',label:'Start date'}, {key:'endDate',label:'End date'},
          {key:'amountMinor',label:'Agreed monthly price',render:(row:any)=>cash(row.amountMinor,row.currency,row.precision??2)}, {key:'collectionParty',label:'Payment recipient',render:(row:any)=>tr(row.collectionParty === 'PROVIDER' ? 'Student pays provider directly' : 'AV8 collects payment')},
          {key:'actions',label:'Actions',render:(row:any)=><div className="actions">{allowed('av8.affairs.edit') ? <Button onClick={()=>recordService(row)}>{tr('Amend monthly service')}</Button> : null}{allowed('av8.finance.create') ? <Button onClick={()=>open('Create monthly charge','service-charge',[f('period','Monthly period','month',true),reason],{serviceId:row.id})}>{tr('Create monthly charge')}</Button> : null}</div>}
        ]}/>
      </Panel>
      {allowed('av8.finance.view')&&services.some((service:any)=>service.collectionParty==='AV8')?<Panel title="AV8 service collections" actions={allowed('av8.finance.create')?<Button onClick={serviceCollection}>{tr('Record AV8 service collection')}</Button>:undefined}><p>{tr('Confirm the actual collection, then link it to a monthly charge. Do not allocate the same funds to tuition.')}</p><Table rows={(app.finance?.funds||[]).filter((fund:any)=>fund.kind==='RECEIPT'&&!(fund.allocations||[]).some((allocation:any)=>BigInt(allocation.amountMinor)>0n))} columns={[{key:'reference',label:'Payment reference'},{key:'amountMinor',label:'Original amount',render:(row:any)=>cash(row.amountMinor,row.currency,row.metadata?.originalPrecision??2)},{key:'status',label:'Status',render:(row:any)=><Status value={row.status}/>},{key:'actions',label:'Actions',render:(row:any)=>row.status==='PENDING'&&allowed('av8.finance.confirm')?<Button onClick={()=>confirmServiceCollection(row)}>{tr('Confirm actual service collection')}</Button>:null}]}/></Panel>:null}
      {allowed('av8.finance.view') ? <Panel title="Monthly service balances"><Table rows={charges} columns={[
        {key:'provider',label:'Provider',render:(row:any)=>row.service.provider}, {key:'period',label:'Monthly period'}, {key:'amountMinor',label:'Amount',render:(row:any)=>cash(row.amountMinor,row.currency,row.precision??2)}, {key:'paidMinor',label:'Paid',render:(row:any)=>cash(row.paidMinor,row.currency,row.precision??2)}, {key:'remainingMinor',label:'Remaining',render:(row:any)=>cash(row.remainingMinor ?? row.outstandingMinor,row.currency,row.precision??2)},
        {key:'actions',label:'Actions',render:(row:any)=>allowed('av8.finance.confirm')&&BigInt(row.remainingMinor??row.outstandingMinor??'0')>0n ? <Button onClick={()=>payService(row)}>{tr('Record service payment')}</Button> : null}
      ]}/></Panel> : null}
      {allowed('av8.finance.view') ? <Panel title="Student expenses and insurance" actions={allowed('av8.finance.create') ? <Button onClick={()=>recordExpense()}>{tr('Record student expense')}</Button> : undefined}>
        <p>{tr('Insurance is an AV8 expense. Only an actual approved eligible expense may reduce a refund.')}</p>
        {banking.error ? <ErrorNotice message={banking.error} retry={banking.reload}/> : null}
        <Table rows={records.filter((row:any)=>row.kind === 'expense')} columns={[
          {key:'expenseType',label:'Expense type',render:(row:any)=>tr(row.expenseType)}, {key:'status',label:'Status',render:(row:any)=><Status value={row.status}/>}, {key:'amountMinor',label:'Expense amount (USD)',render:(row:any)=>cash(row.amountMinor)}, {key:'paidAt',label:'Payment date'}, {key:'refundEligible',label:'Approved as eligible refund expense',render:(row:any)=>tr(row.refundEligible?'Yes':'No')}, {key:'invoiceReference',label:'Insurance policy / invoice reference'},{key:'actions',label:'Actions',render:(row:any)=>row.status==='DRAFT'&&allowed('av8.finance.confirm')?<Button onClick={()=>recordExpense(row)}>{tr('Record expense payment')}</Button>:null}
        ]}/>
        <Link className="btn" href="/banking/transactions">{tr('Open treasury payments')}</Link>
      </Panel> : null}
    </> : null}
    {section === 'training' ? <Panel title="Training and graduation" actions={<div className="actions">
      {allowed('av8.affairs.edit') ? <Button onClick={()=>open('Record training event','training',value=>[select('status','Training event',nextTraining),f('date','Event date','date',true),...(['SUSPENDED','RESUMED'].includes(value.status)?[evidence]:[]),...(['RESUMPTION_REQUESTED','RESUMED'].includes(value.status)?[select('resolutionPolicy','Approved resolution rule',[{value:'ALL_OVERDUE_CLEARED',label:'All overdue obligations cleared'},...(allowed('av8.exceptions.approve')?[{value:'AUTHORIZED_EXCEPTION',label:'Authorized exception'}]:[])]),...(value.resolutionPolicy==='AUTHORIZED_EXCEPTION'?[f('exceptionReason','Authorized exception decision','textarea',true)]:[])]:[]),reason],{date:today()})}>{tr('Record training event')}</Button> : null}
      {allowed('av8.affairs.edit') ? <Button primary onClick={()=>open('Record graduation','graduation',[f('date','Graduation date','date',true),evidence,f('notes','Outstanding follow-up actions','textarea'),reason],{date:today()})}>{tr('Record graduation')}</Button> : null}
    </div>}><p>{tr('Financial holds and academy-confirmed training changes are separate. Graduation preserves all financial balances.')}</p></Panel> : null}
    {section === 'delivery' ? <>
      <Panel title="Monthly report email delivery" actions={<Button onClick={state.reload}>{tr('Refresh')}</Button>}>
        <p>{tr('Student and guardian outcomes are tracked separately. Unknown outcomes need provider review before retry.')}</p>
        {state.data?.configuration ? <div className="av8-callout"><strong>{tr(state.data.configuration.emailConfigured ? 'Email provider configured' : 'Email configuration required')}</strong><p>{tr(state.data.configuration.workerEnabled ? 'Dispatch worker enabled' : 'Dispatch worker configuration required')}</p>{(state.data.configuration.issues || []).map((issue:string)=><p key={issue}>{tr(issue)}</p>)}</div> : <p>{tr('Delivery configuration unavailable')}</p>}
        <Table rows={reports} columns={[
          {key:'period',label:'Reporting period',render:(row:any)=>row.period||row.key}, {key:'version',label:'Report version'}, {key:'status',label:'Status',render:(row:any)=><Status value={row.status}/>}, {key:'source',label:'Academy / source',render:(row:any)=>row.source},
          {key:'actions',label:'Actions',render:(row:any)=>allowed('av8.affairs.edit') && allowed('av8.guardian.view') ? <Button onClick={()=>queueReport(row)}>{tr('Queue report emails')}</Button> : null}
        ]}/>
      </Panel>
      <Panel title="Recipient delivery history"><Table rows={dispatches} columns={[
        {key:'reportId',label:'Report reference'}, {key:'recipientKind',label:'Recipient',render:(row:any)=>tr(row.recipientKind || row.recipientType || '')}, {key:'address',label:'Email',render:(row:any)=><bdi>{row.address || row.recipientEmail || tr('Restricted')}</bdi>}, {key:'status',label:'Status',render:(row:any)=><Status value={row.status==='FAILED'?'DELIVERY_FAILED':row.status}/>},
        {key:'attempts',label:'Attempts'}, {key:'providerReference',label:'Provider message reference'}, {key:'lastError',label:'Delivery issue'},
        {key:'actions',label:'Actions',render:(row:any)=>allowed('av8.affairs.edit') ? <div className="actions">{['FAILED','BLOCKED_CONFIGURATION','BLOCKED_CONTACT'].includes(row.status) ? <Button onClick={()=>dispatchAction(row,'retry')}>{tr('Retry failed recipient')}</Button> : null}{['ACCEPTED','DELIVERY_UNKNOWN'].includes(row.status) ? <Button onClick={()=>dispatchAction(row,'reconcile')}>{tr('Reconcile delivery outcome')}</Button> : null}</div> : null}
      ]}/></Panel>
    </> : null}
    {history.length ? <Panel title="Recorded decisions and events"><Table rows={history} columns={[
      {key:'kind',label:'Type',render:(row:any)=>tr(row.kind)}, {key:'status',label:'Status',render:(row:any)=><Status value={row.status}/>}, {key:'date',label:'Date',render:(row:any)=>row.date || row.paidAt || row.createdAt && dateTime(row.createdAt) || '—'}, {key:'reason',label:'Reason / notes'}, {key:'amountMinor',label:'Amount',render:(row:any)=>row.amountMinor==null?'—':cash(row.amountMinor,row.currency||'USD',row.precision??2)},{key:'actions',label:'Actions',render:(row:any)=>row.kind==='service-payment'&&BigInt(row.amountMinor||'0')>0n&&!records.some((other:any)=>String(other.reversalOf)===String(row.id))&&allowed('av8.finance.confirm')?<Button onClick={()=>open('Reverse service payment','service-payment-reversal',[f('date','Event date','date',true),evidence,reason],{paymentId:row.id,date:today()})}>{tr('Reverse service payment')}</Button>:null}, {key:'evidenceId',label:'Supporting attachment',render:(row:any)=>(app.attachments || []).find((file:any)=>file.id===row.evidenceId)?.filename || row.evidenceId || '—'}
    ]}/></Panel> : null}
    {section !== 'delivery' ? <p className="notice">{tr('Upload supporting evidence from Documents or Tasks & exceptions, then select it here.')}</p> : null}
    {edit ? <Form title={edit.title} fields={edit.fields} initial={edit.initial} save={edit.save} close={()=>setEdit(null)}>{edit.hint ? <p>{tr(edit.hint)}</p> : null}</Form> : null}
  </>;
}
