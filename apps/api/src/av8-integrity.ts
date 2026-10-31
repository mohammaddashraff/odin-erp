import { convertMinor, serialize } from './money';

type Row = Record<string,any>;
export type Av8IntegrityState = { funds:Row[]; charges:Row[]; obligations:Row[]; allocations:Row[]; records:Row[]; journals:Row[]; openingSources?:Row[]; bankAccounts?:Row[] };
const id=(v:unknown)=>String(v??'');
const amount=(v:unknown)=>BigInt(String(v??'0'));
const sum=(rows:Row[],key='amountMinor')=>rows.reduce((n,r)=>n+amount(r[key]),0n);
const data=(r:Row)=>r.data||{};

/** Reconciliation of actual states, not an assertion that every receipt is fully allocated. */
export function inspectAv8State(state:Av8IntegrityState) {
  const issues:Row[]=[],notes:Row[]=[];
  const issue=(code:string,entity:string,entityId:unknown,action:string)=>issues.push({code,entity,entityId:id(entityId),action});
  const note=(code:string,entity:string,entityId:unknown,action:string)=>notes.push({code,entity,entityId:id(entityId),action});
  const funds=new Map(state.funds.map(f=>[id(f.id),f])),allocations=new Map(state.allocations.map(x=>[id(x.id),x]));
  const charges=new Map(state.charges.map(c=>[id(c.id),c])),obligations=new Map(state.obligations.map(o=>[id(o.id),o]));
  const returned=new Map(state.records.filter(r=>r.kind==='cheque'&&r.status==='RETURNED').map(r=>[id(data(r).fundId),r]));
  const services=state.records.filter(r=>r.kind==='service-payment'&&r.status==='RECORDED');
  const serviceCharges=state.records.filter(r=>r.kind==='service-charge'),serviceReversals=new Set<string>();
  const effective=(f:Row)=>f.status==='CLEARED'&&!returned.has(id(f.id));
  const byFund=(f:Row)=>state.allocations.filter(x=>id(x.fundId)===id(f.id));
  const serviceUsed=(f:Row)=>services.filter(r=>data(r).collectionParty==='AV8'&&id(data(r).fundId)===id(f.id)).reduce((n,r)=>n+amount(data(r).usdMinor),0n);
  const unallocatedRefundUse=(f:Row)=>state.funds.filter(r=>r.kind==='REFUND'&&['PENDING','APPROVED','CLEARED'].includes(r.status)).flatMap(r=>r.metadata?.originalReceiptAllocations||[]).filter(e=>id(e.fundId)===id(f.id)&&!e.chargeId).reduce((n,e)=>n+amount(e.usdMinor),0n);
  const reversed=new Set<string>();
  for(const x of state.allocations){
    const f=funds.get(id(x.fundId));if(!f){issue('ALLOCATION_SOURCE_SCOPE','allocation',x.id,'Resolve the missing/out-of-company fund before posting another allocation');continue;}
    if(f.status!=='CLEARED')issue('ALLOCATION_UNCLEARED','allocation',x.id,'Only actually cleared funds may support this allocation');
    const target=x.chargeId?charges.get(id(x.chargeId)):obligations.get(id(x.obligationId));
    if(!target||target.tenantId!==undefined&&id(target.tenantId)!==id(f.tenantId)||f.applicationId&&id(target.applicationId)!==id(f.applicationId))issue('ALLOCATION_OWNER','allocation',x.id,'Reconcile the source fund with its original student/academy owner');
    if(x.reversedId){const original=allocations.get(id(x.reversedId));if(!original||amount(original.amountMinor)<=0n||amount(x.amountMinor)!==-amount(original.amountMinor)||id(original.fundId)!==id(x.fundId)||id(original.chargeId)!==id(x.chargeId)||reversed.has(id(x.reversedId)))issue('INVALID_NEGATIVE_CORRECTION','allocation',x.id,'Preserve one exact inverse linked to the original positive allocation');reversed.add(id(x.reversedId));}
    else if(amount(x.amountMinor)<0n&&f.kind!=='REFUND')issue('UNLINKED_NEGATIVE_ALLOCATION','allocation',x.id,'Link the authorized correction to its original allocation');
    if(x.chargeId&&!['RECEIPT','REFUND'].includes(f.kind)||x.obligationId&&f.kind!=='REMITTANCE')issue('ALLOCATION_KIND','allocation',x.id,'Separate student principal from academy transfers, fees and recoveries');
  }
  for(const r of services){
    const d=data(r),f=funds.get(id(d.fundId));
    if(!serviceCharges.some(c=>id(c.id)===id(d.chargeId)&&id(c.applicationId)===id(r.applicationId)))issue('SERVICE_CHARGE_SOURCE','service-payment',r.id,'Reconcile the original monthly charge and student ownership');
    if(d.reversalOf){if(serviceReversals.has(id(d.reversalOf))||amount(d.amountMinor)>=0n)issue('SERVICE_REVERSAL_DUPLICATE','service-payment',r.id,'One negative inverse is permitted per original payment');serviceReversals.add(id(d.reversalOf));}
    if(d.collectionParty==='PROVIDER'&&d.fundId)issue('PROVIDER_CASH_LINK','service-payment',r.id,'Remove the false AV8 cash claim through an authorized evidence correction');
    if(d.collectionParty==='AV8'&&(!f||f.kind!=='RECEIPT'||id(f.applicationId)!==id(r.applicationId)))issue('SERVICE_SOURCE','service-payment',r.id,'Reconcile the exact same-student cleared receipt');
    if(amount(d.amountMinor)<0n){const original=services.find(p=>id(p.id)===id(d.reversalOf));if(!original||data(original).reversalOf||amount(d.amountMinor)!==-amount(data(original).amountMinor)||amount(d.usdMinor)!==-amount(data(original).usdMinor)||id(d.chargeId)!==id(data(original).chargeId)||id(d.fundId)!==id(data(original).fundId))issue('INVALID_SERVICE_REVERSAL','service-payment',r.id,'Record one exact inverse of the original service payment');}
  }
  const journalMap=new Map(state.journals.map(j=>[id(j.id),j]));
  for(const j of state.journals)if(j.status==='POSTED'&&(!j.lines?.length||sum(j.lines,'debitMinor')!==sum(j.lines,'creditMinor')))issue('JOURNAL_UNBALANCED','journal',j.id,'Investigate original posting and use an approved correction; never edit posted lines');
  const journalNet=(j:Row,accountId:unknown)=>(j.lines||[]).filter((l:Row)=>id(l.accountId)===id(accountId)).reduce((n:bigint,l:Row)=>n+amount(l.debitMinor)-amount(l.creditMinor),0n);
  const fundRows:Row[]=[];
  for(const f of state.funds){
    const metadata=f.metadata||{},rows=byFund(f),allocated=sum(rows),service=serviceUsed(f),refundReserve=unallocatedRefundUse(f),isReturned=returned.has(id(f.id));
    if(f.status==='CLEARED'){
      if(metadata.importKind==='OPENING_HISTORY'){
        const j=journalMap.get(id(metadata.openingJournalId));if(!j||j.status!=='POSTED'||j.sourceType!=='MANUAL'||f.bankTransactionId)issue('OPENING_HISTORY_SOURCE','fund',f.id,'Reconcile the immutable imported source to its approved opening journal without reposting cash');
      }else{
        const bank=f.bankTransaction,j=bank?.journalEntry;if(!bank||!j||j.status!=='POSTED')issue('CLEARED_CASH_EVIDENCE','fund',f.id,'Locate the actual posted bank movement and balanced journal');
        else{
          const expected=amount(f.amountMinor)+amount(metadata.fee?.originalMinor);
          if(amount(bank.amountMinor)!==expected||id(bank.bankAccountId)!==id(f.bankAccountId))issue('CASH_AMOUNT_MISMATCH','fund',f.id,'Reconcile actual original cash separately from principal and additional bank fees');
          const incoming=['RECEIPT','ACADEMY_RECOVERY','FEE_REIMBURSEMENT'].includes(f.kind);
          if(bank.kind!==(incoming?'RECEIPT':'PAYMENT'))issue('CASH_DIRECTION','fund',f.id,'Reconcile the actual incoming/outgoing bank direction');
          const expectedBase=convertMinor(amount(f.amountMinor),metadata.originalPrecision??2,metadata.basePrecision??2,amount(f.baseRateMicros))+amount(metadata.fee?.baseMinor);
          if(bank.bankAccount&&journalNet(j,bank.bankAccount.glAccountId)!==(incoming?expectedBase:-expectedBase))issue('BANK_LEDGER_LINK','fund',f.id,'Compare source currency/rates/fees with its actual bank GL posting');
          if(metadata.liabilityAccountId&&metadata.liabilityBaseMinor!==undefined&&journalNet(j,metadata.liabilityAccountId)!==(incoming?-amount(metadata.liabilityBaseMinor):amount(metadata.liabilityBaseMinor)))issue('HISTORICAL_LIABILITY_POSTING','fund',f.id,'Compare the actual liability/receivable posting with the preserved original book basis independently of cash conversion');
        }
      }
      if(f.kind==='RECEIPT'&&convertMinor(amount(f.amountMinor),metadata.originalPrecision??2,2,amount(f.usdRateMicros))!==amount(f.usdMinor))issue('RECEIPT_CREDIT_CONVERSION','fund',f.id,'Review original precision and rate; do not rewrite historical USD credit');
      if(metadata.grossOriginalMinor!==undefined&&amount(metadata.grossOriginalMinor)-amount(metadata.feeOriginalMinor)!==amount(f.amountMinor))issue('GROSS_FEE_NET','fund',f.id,'Reconcile documented gross, bank deduction and actual net receipt');
      if(f.kind==='RECEIPT'&&(allocated<0n||service<0n||allocated+service+refundReserve>amount(f.usdMinor)))issue('RECEIPT_OVERUSED','fund',f.id,'Reconcile tuition/service usage plus reserved or paid refunds from previously unapplied credit');
      if(f.kind==='REMITTANCE'&&(allocated<0n||allocated>amount(f.usdMinor)))issue('REMITTANCE_OVERALLOCATED','fund',f.id,'Reconcile actual academy principal and original allocation ownership');
      if(f.kind==='REFUND'&&(allocated>0n||-allocated>amount(f.usdMinor)))issue('REFUND_ALLOCATION_INVALID','fund',f.id,'Refund allocations must be nonpositive and cannot exceed actual payout');
      if(['ACADEMY_RECOVERY','FEE_REIMBURSEMENT'].includes(f.kind)&&allocated!==0n)issue('NONPRINCIPAL_ALLOCATION','fund',f.id,'Do not treat recovery or bank-fee reimbursement as new student principal');
      if(isReturned){
        const cheque=returned.get(id(f.id))!,original=f.bankTransaction?.journalEntry,reversal=journalMap.get(id(data(cheque).reversalJournalEntryId));
        if(allocated!==0n||service!==0n)issue('RETURNED_CHEQUE_CREDIT','fund',f.id,'Reconcile outstanding tuition/service usage before treating the cheque as returned');
        if(!original||!reversal||reversal.status!=='POSTED'||id(reversal.reversesEntryId)!==id(original.id))issue('CHEQUE_REVERSAL_MISSING','cheque',cheque.id,'Locate the authorized exact reversal of the original cleared bank journal');
        else for(const account of new Set([...original.lines,...reversal.lines].map((l:Row)=>id(l.accountId))))if(journalNet(original,account)+journalNet(reversal,account)!==0n)issue('CHEQUE_REVERSAL_DIFFERENCE','cheque',cheque.id,'Reconcile the original and reversal per GL account without altering evidence');
      }
    }else if(rows.length)issue('PENDING_HAS_ALLOCATION','fund',f.id,'Pending/approved/rejected cash cannot settle principal');
    const grossUnallocated=f.kind==='RECEIPT'&&effective(f)?amount(f.usdMinor)-allocated-service:0n,unapplied=grossUnallocated-refundReserve;
    fundRows.push({id:id(f.id),kind:f.kind,status:isReturned?'RETURNED':f.status,originalCurrency:f.currency,originalMinor:f.amountMinor,usdMinor:f.usdMinor,netAllocatedMinor:allocated,serviceMinor:service,grossUnallocatedMinor:grossUnallocated,refundReservedFromUnallocatedMinor:refundReserve,unappliedMinor:unapplied,openingHistory:metadata.importKind==='OPENING_HISTORY'});
  }
  const chargeRows=state.charges.map(c=>{
    const paid=state.allocations.filter(x=>id(x.chargeId)===id(c.id)&&funds.get(id(x.fundId))?.status==='CLEARED').reduce((n,x)=>n+amount(x.amountMinor),0n),net=amount(c.amountMinor)-amount(c.creditMinor);
    if(paid<0n||paid>net)issue('STUDENT_BALANCE_INVALID','charge',c.id,'Reconcile original charge, approved credits and net valid allocations');
    return{id:id(c.id),applicationId:id(c.applicationId),netObligationMinor:net,paidMinor:paid,remainingMinor:net-paid};
  });
  const academyRows=state.obligations.map(o=>{
    const adjustment=state.records.filter(r=>r.kind==='obligation-adjustment'&&id(data(r).obligationId)===id(o.id)).reduce((n,r)=>n+amount(data(r).amountMinor),0n),net=amount(o.amountMinor)+adjustment;
    const paid=state.allocations.filter(x=>id(x.obligationId)===id(o.id)&&funds.get(id(x.fundId))?.status==='CLEARED').reduce((n,x)=>n+amount(x.amountMinor),0n);
    if(net<0n||paid<0n||paid>net)issue('ACADEMY_BALANCE_INVALID','obligation',o.id,'Reconcile entitlement adjustments and actual transfers; preserve separately evidenced advances');
    return{id:id(o.id),applicationId:id(o.applicationId),originalMinor:o.amountMinor,adjustmentMinor:adjustment,netObligationMinor:net,remittedMinor:paid,remainingMinor:net-paid};
  });
  for(const r of state.records.filter(r=>r.kind==='refund')){
    const d=data(r),payouts=state.funds.filter(f=>f.kind==='REFUND'&&id(f.refundCaseId)===id(r.id)&&['PENDING','APPROVED','CLEARED'].includes(f.status));
    if(d.approvedMinor!==undefined&&sum(payouts,'usdMinor')>amount(d.approvedMinor))issue('REFUND_OVERRESERVED','refund',r.id,'Reconcile approved entitlement versus pending and actual payouts before another payout');
  }
  const sourceRefunds=new Map<string,bigint>();
  for(const f of state.funds.filter(f=>f.kind==='REFUND'&&['PENDING','APPROVED','CLEARED'].includes(f.status))){
    const entries=f.metadata?.originalReceiptAllocations;
    if(!Array.isArray(entries)){note('LEGACY_REFUND_SOURCE_REVIEW','fund',f.id,'Legacy medical/refund history lacks itemized source snapshot; retain original case and allocation evidence');continue;}
    if(sum(entries,'usdMinor')!==amount(f.usdMinor))issue('REFUND_SOURCE_TOTAL','fund',f.id,'Reconcile payout entitlement to exact frozen original receipt sources');
    if(f.metadata.liabilityBaseMinor!==undefined&&sum(entries,'baseMinor')!==amount(f.metadata.liabilityBaseMinor))issue('REFUND_BOOK_SOURCE_TOTAL','fund',f.id,'Reconcile the payout historical liability basis to its exact frozen source amounts');
    for(const e of entries){const source=funds.get(id(e.fundId));if(!source||source.kind!=='RECEIPT'||!effective(source)||id(source.applicationId)!==id(f.applicationId))issue('REFUND_SOURCE_INVALID','fund',f.id,'Resolve returned/missing/out-of-student original receipt source');sourceRefunds.set(id(e.fundId),(sourceRefunds.get(id(e.fundId))||0n)+amount(e.usdMinor));}
  }
  for(const [sourceId,used]of sourceRefunds){const f=funds.get(sourceId);if(f&&used+serviceUsed(f)>amount(f.usdMinor))issue('REFUND_SOURCE_OVERUSED','fund',sourceId,'Reconcile total reserved/paid refunds and separate monthly services against the original receipt');}
  const recoverySources=new Map<string,bigint>();
  for(const f of state.funds.filter(f=>f.kind==='ACADEMY_RECOVERY'&&['PENDING','APPROVED','CLEARED'].includes(f.status))){const source=funds.get(id(f.metadata?.originalRemittanceId));if(!source||source.kind!=='REMITTANCE'||!effective(source))issue('RECOVERY_SOURCE','fund',f.id,'Identify the actual original academy remittance');recoverySources.set(id(source?.id),(recoverySources.get(id(source?.id))||0n)+amount(f.usdMinor));}
  for(const [sourceId,recovered]of recoverySources){const f=funds.get(sourceId);if(f&&recovered>amount(f.usdMinor))issue('RECOVERY_OVERUSED','fund',sourceId,'Total academy returns cannot exceed their original remittance');}
  const sourceConsumption=new Map<string,{usd:bigint;base:bigint}>();
  const consume=(entry:Row,direction:bigint)=>{const sourceId=id(entry.fundId),old=sourceConsumption.get(sourceId)||{usd:0n,base:0n};sourceConsumption.set(sourceId,{usd:old.usd+direction*amount(entry.usdMinor),base:old.base+direction*amount(entry.baseMinor)});};
  const bases=state.records.filter(r=>r.kind==='remittance-basis');
  for(const basis of bases){
    const d=data(basis),f=funds.get(id(d.fundId)),entries=d.originalReceiptAllocations;
    if(!f||f.kind!=='REMITTANCE'||f.status!=='CLEARED'||!Array.isArray(entries)){issue('REMITTANCE_BASIS_SOURCE','remittance-basis',basis.id,'Resolve the immutable source-basis record and original cleared remittance');continue;}
    if(sum(entries,'usdMinor')!==amount(f.usdMinor)||sum(entries,'baseMinor')!==amount(d.liabilityBaseMinor))issue('REMITTANCE_BASIS_TOTAL','remittance-basis',basis.id,'Reconcile original receipt USD/base consumption to the exact remittance principal and liability');
    const j=f.bankTransaction?.journalEntry;if(j&&journalNet(j,d.liabilityAccountId)!==amount(d.liabilityBaseMinor))issue('REMITTANCE_LIABILITY_POSTING','remittance-basis',basis.id,'Compare the actual liability debit with preserved original receipt basis, separately from cash/FX/fee lines');
    for(const entry of entries){const source=funds.get(id(entry.fundId));if(!source||source.kind!=='RECEIPT'||source.status!=='CLEARED'||id(source.applicationId)!==id(entry.applicationId))issue('REMITTANCE_RECEIPT_SOURCE','remittance-basis',basis.id,'Preserve the original same-student receipt source, including evidenced returned-cheque funding exposure');consume(entry,1n);}
  }
  for(const f of state.funds.filter(f=>f.kind==='REMITTANCE'&&f.status==='CLEARED'&&f.metadata?.importKind!=='OPENING_HISTORY'))if(!bases.some(b=>id(data(b).fundId)===id(f.id)))note('LEGACY_REMITTANCE_BASIS_REVIEW','fund',f.id,'Original remittance predates itemized receipt-basis snapshot; retain actual journal and review source attribution before new related settlement');
  for(const f of state.funds.filter(f=>f.kind==='REFUND'&&['PENDING','APPROVED','CLEARED'].includes(f.status)))for(const entry of f.metadata?.originalReceiptAllocations||[])consume(entry,1n);
  for(const f of state.funds.filter(f=>f.kind==='ACADEMY_RECOVERY'&&f.status==='CLEARED')){
    const entries=f.metadata?.originalReceiptAllocations;
    if(!Array.isArray(entries)){note('LEGACY_RECOVERY_BASIS_REVIEW','fund',f.id,'Original transfer basis is unavailable; do not fabricate receipt source IDs for this actual recovery');continue;}
    if(sum(entries,'usdMinor')!==amount(f.usdMinor)||sum(entries,'baseMinor')!==amount(f.metadata.liabilityBaseMinor))issue('RECOVERY_BASIS_TOTAL','fund',f.id,'Reconcile actual academy return to exact restored receipt-source USD and historical book basis');
    const basis=bases.find(b=>id(data(b).fundId)===id(f.metadata.originalRemittanceId));
    for(const entry of entries){if(!basis||!(data(basis).originalReceiptAllocations||[]).some((e:Row)=>id(e.fundId)===id(entry.fundId)&&id(e.applicationId)===id(entry.applicationId)))issue('RECOVERY_BASIS_OWNER','fund',f.id,'Restore only original sources of the named remittance');consume(entry,-1n);}
  }
  const sourceRows=[...sourceConsumption].map(([sourceId,used])=>{
    const source=funds.get(sourceId),base=source?convertMinor(amount(source.amountMinor),source.metadata?.originalPrecision??2,source.metadata?.basePrecision??2,amount(source.baseRateMicros)):0n;
    if(source&&(used.usd<0n||used.base<0n||used.usd>amount(source.usdMinor)||used.base>base))issue('HISTORICAL_SOURCE_OVERUSED','fund',sourceId,'Reconcile remittance/refund source consumption less actual source-attributed recoveries in both USD and original book basis');
    return{fundId:sourceId,consumedUsdMinor:used.usd,consumedBookMinor:used.base,sourceUsdMinor:source?.usdMinor,sourceBookMinor:base};
  });
  const feeRows=state.records.filter(r=>r.kind==='bank-fee').map(r=>{const d=data(r),all=state.funds.filter(f=>f.kind==='FEE_REIMBURSEMENT'&&id(f.metadata?.bankFeeId)===id(r.id)&&['PENDING','APPROVED','CLEARED'].includes(f.status)),paid=sum(all.filter(effective),'usdMinor');if(sum(all,'usdMinor')>amount(d.usdMinor))issue('FEE_REIMBURSEMENT_OVERUSED','bank-fee',r.id,'Separate fee receivable/reimbursement from tuition and cap at the actual fee');if(d.cashReimbursedUsdMinor!==undefined&&amount(d.cashReimbursedUsdMinor)!==paid)issue('FEE_STATE_DIFFERENCE','bank-fee',r.id,'Reconcile the fee status with actual posted reimbursements');return{id:id(r.id),feeUsdMinor:amount(d.usdMinor),reimbursedMinor:paid,remainingMinor:amount(d.usdMinor)-paid};});
  const serviceRows=serviceCharges.map(c=>{const d=data(c),paid=services.filter(p=>id(data(p).chargeId)===id(c.id)).reduce((n,p)=>n+amount(data(p).amountMinor),0n);if(paid<0n||paid>amount(d.amountMinor))issue('SERVICE_BALANCE_INVALID','service-charge',c.id,'Reconcile actual payments and evidenced reversals against the agreed original-currency month');return{id:id(c.id),currency:d.currency,collectionParty:d.collectionParty,amountMinor:d.amountMinor,paidMinor:paid,remainingMinor:amount(d.amountMinor)-paid};});
  const supplierRows=(state.openingSources||[]).flatMap(source=>(source.data.supplierBalances||[]).map((balance:Row,index:number)=>{
    const linked=state.records.filter(r=>r.kind==='supplier-opening-settlement'&&data(r).sourceSystem===source.sourceSystem&&data(r).batchSourceId===source.sourceId&&Number(data(r).balanceIndex)===index);
    const original=amount(balance.amountMinor),book=amount(balance.baseMinor),paid=linked.reduce((n,r)=>n+amount(data(r).amountMinor),0n),paidBook=linked.reduce((n,r)=>n+amount(data(r).baseMinor),0n),direction=original<0n?-1n:1n;
    if(paid*direction<0n||paid*direction>original*direction||paidBook*direction<0n||paidBook*direction>book*direction)issue('SUPPLIER_OPENING_OVERSETTLED','opening-source',source.id,'Reconcile original supplier currency and book balance against once-only actual settlements');
    for(const r of linked){const d=data(r),j=journalMap.get(id(d.journalEntryId)),bank=(state.bankAccounts||[]).find(b=>id(b.id)===id(d.bankAccountId));if(!j||j.status!=='POSTED'||!bank||journalNet(j,balance.accountId)!==amount(d.baseMinor)||journalNet(j,bank.glAccountId)!==-amount(d.baseMinor))issue('SUPPLIER_SETTLEMENT_EVIDENCE','supplier-opening-settlement',r.id,'Reconcile the actual posted bank/control amounts with the linked original supplier liability');if(state.funds.some(f=>id(f.bankTransaction?.journalEntry?.id)===id(d.journalEntryId)))issue('SUPPLIER_CASH_REUSED','supplier-opening-settlement',r.id,'Do not reuse student/academy/refund/fee cash for supplier opening settlement');}
    return{sourceSystem:source.sourceSystem,batchSourceId:source.sourceId,balanceIndex:index,supplierId:id(balance.supplierId),currency:balance.currency,originalMinor:original,paidMinor:paid,remainingMinor:original-paid,originalBookMinor:book,paidBookMinor:paidBook,remainingBookMinor:book-paidBook};
  }));
  const cleared=(kind:string)=>state.funds.filter(f=>f.kind===kind&&effective(f));
  const summary={clearedReceiptPrincipalMinor:sum(cleared('RECEIPT'),'usdMinor'),returnedReceiptMinor:sum(state.funds.filter(f=>returned.has(id(f.id))),'usdMinor'),pendingInstructionMinor:sum(state.funds.filter(f=>['PENDING','APPROVED'].includes(f.status)),'usdMinor'),studentNetPaidMinor:sum(chargeRows,'paidMinor'),studentRemainingMinor:sum(chargeRows,'remainingMinor'),serviceAllocationMinor:services.filter(r=>data(r).collectionParty==='AV8').reduce((n,r)=>n+amount(data(r).usdMinor),0n),unappliedReceiptMinor:sum(fundRows,'unappliedMinor'),academyEntitlementMinor:sum(academyRows,'netObligationMinor'),academyTransferredMinor:sum(cleared('REMITTANCE'),'usdMinor'),academyUnallocatedTransferMinor:sum(cleared('REMITTANCE').map(f=>({amountMinor:amount(f.usdMinor)-sum(byFund(f))}))),academyRemainingMinor:sum(academyRows,'remainingMinor'),academyFundingExposureMinor:state.records.filter(r=>r.kind==='academy-funding-exposure').reduce((n,r)=>n+amount(data(r).amountMinor),0n)-state.records.filter(r=>r.kind==='obligation-funding-restored').reduce((n,r)=>n+amount(data(r).amountMinor),0n),actualRefundMinor:sum(cleared('REFUND'),'usdMinor'),actualRecoveryMinor:sum(cleared('ACADEMY_RECOVERY'),'usdMinor'),actualBankFeeMinor:sum(feeRows,'feeUsdMinor'),actualFeeReimbursementMinor:sum(cleared('FEE_REIMBURSEMENT'),'usdMinor')};
  return serialize({ok:issues.length===0,issues,notes,summary,funds:fundRows,charges:chargeRows,academy:academyRows,services:serviceRows,supplierOpenings:supplierRows,fees:feeRows,sourceConsumption:sourceRows,postedJournalCount:state.journals.filter(j=>j.status==='POSTED').length,basis:'USD principal and obligations; original cash/fees and posted book GL independently validated. Unapplied/pending/advance states are legitimate.'});
}
