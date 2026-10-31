"use client";
import {defaultBranch} from "../core/ui-presentation";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import {
  useERP,
  useResource,
  today,
  decimal,
  fixed,
} from "../core/erp-context";
import {
  PageHeader,
  Panel,
  Table,
  Resource,
  Button,
  AddButton,
  Status,
  Details,
  Fields,
  type FieldSpec,
  Confirm,
  ErrorNotice,
  SearchField,
  Pagination,
  useUnsaved,
} from "../components/ui";
export function FormPage({
  title,
  defaults,
  specs,
  submit,
  close,
  children,
  submitLabel = "Save changes",
}: {
  title: string;
  defaults: any;
  specs: FieldSpec[];
  submit: (data: any) => Promise<void>;
  close: () => void;
  children?: (data: any, set: (k: string, v: any) => void) => React.ReactNode;
  submitLabel?: string;
}) {
  const { tr } = useERP();
  const [data, setData] = useState(defaults);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useUnsaved(dirty);
  const set = (k: string, v: any) => {
    setDirty(true);
    setData((d: any) => ({ ...d, [k]: v }));
  };
  return (
    <>
      <PageHeader title={title} back={() => guard(close)} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            await submit(data);
            setDirty(false);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Panel>
          <div className="form-section">
            <Fields specs={specs} values={data} set={set} />
          </div>
          {children?.(data, set)}
        </Panel>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <span>{tr(title)}</span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button primary type="submit" busy={busy}>
              {tr(submitLabel)}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
export function Payments() {
  const { tr, user, refs, allowed, money, date, name, request, notify } =
    useERP();
  const state = useResource("/payments");
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState<any>(null);
  if (create)
    return (
      <PaymentEditor
        close={() => setCreate(false)}
        saved={() => {
          setCreate(false);
          state.reload();
        }}
      />
    );
  return (
    <>
      <PageHeader
        title="Receipts & Payments"
        subtitle="Receipts post immediately; supplier payments require an independent checker"
      >
        {allowed(["payments.receipt.create", "payments.payment.create"]) ? (
          <AddButton onClick={() => setCreate(true)}>
            {tr("Allocate payment")}
          </AddButton>
        ) : null}
      </PageHeader>
      <Panel>
        <Resource state={state}>
          <Table
            rows={state.data || []}
            columns={[
              { key: "number", label: "Number" },
              { key: "kind", label: "Kind", render: (p) => tr(p.kind) },
              {
                key: "party",
                label: "Party",
                render: (p) => name(p.customer || p.supplier),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => <Status value={p.status} />,
              },
              {
                key: "date",
                label: "Date",
                render: (p) => date(p.postingDate),
              },
              {
                key: "bank",
                label: "Bank / cash",
                render: (p) => name(p.bankAccount),
              },
              {
                key: "amount",
                label: "Amount",
                numeric: true,
                render: (p) => money(p.amountMinor),
              },
              {
                key: "allocations",
                label: "Allocation",
                render: (p) =>
                  (p.allocations?.length
                    ? p.allocations
                    : p.plannedAllocations || []
                  ).map((a: any) => (
                    <div key={a.id || a.documentId}>
                      <bdi>{a.document?.number}</bdi> ·{" "}
                      <bdi>{money(a.amountMinor)}</bdi>
                    </div>
                  )),
              },
              {
                key: "journal",
                label: "Journal",
                render: (p) =>
                  p.journalEntry ? (
                    <Link href={`/accounting/journals?journal=${p.journalEntry.id}`}>
                      {p.journalEntry.number}
                    </Link>
                  ) : (
                    tr("Not posted")
                  ),
              },
              {
                key: "actions",
                label: "Actions",
                render: (p) =>
                  p.status === "SUBMITTED" ? (
                    String(p.createdById) === String(user.userId) ? (
                      tr("Awaiting another checker")
                    ) : (
                      <div className="actions">
                        {allowed("payments.payment.approve") ? (
                          <Button
                            className="small"
                            primary
                            onClick={() => setAction({ p, action: "approve" })}
                          >
                            {tr("Approve and post")}
                          </Button>
                        ) : null}
                        {allowed("payments.payment.reject") ? (
                          <Button
                            className="small"
                            danger
                            onClick={() => setAction({ p, action: "reject" })}
                          >
                            {tr("Reject")}
                          </Button>
                        ) : null}
                      </div>
                    )
                  ) : null,
              },
            ]}
          />
        </Resource>
      </Panel>
      {action ? (
        <Confirm
          title={action.action === "approve" ? "Approve and post" : "Reject"}
          reason={action.action === "reject"}
          close={() => setAction(null)}
          action={async (comment) => {
            if (action.action === "reject" && comment.trim().length < 3)
              throw new Error(
                tr("Enter a rejection reason of at least 3 characters."),
              );
            await request(`/payments/${action.p.id}/${action.action}`, {
              method: "POST",
              body: JSON.stringify({ comment }),
            });
            state.reload();
            notify("Action completed");
          }}
        />
      ) : null}
    </>
  );
}
function PaymentEditor({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const { tr, refs, allowed, request, money, name, notify } = useERP();
  const [kind, setKind] = useState(
    allowed("payments.receipt.create") ? "RECEIPT" : "PAYMENT",
  );
  const documents = useResource(
    `/documents?type=${kind === "RECEIPT" ? "SALES_INVOICE" : "PURCHASE_BILL"}&status=POSTED`,
  );
  const open = (documents.data || []).filter(
    (d: any) => d.remainingMinor != null && BigInt(d.remainingMinor) > 0n,
  );
  const [form, setForm] = useState({
    bankAccountId: refs.bankAccounts.length===1?refs.bankAccounts[0].id:"",
    documentId: "",
    amount: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  useEffect(() => {
    setForm((f) => ({
      ...f,
      documentId: "",
      amount: "",
    }));
  }, [documents.data]);
  const set = (k: string, v: any) => {
    setDirty(true);
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "documentId"
        ? { amount: decimal(open.find((d: any) => d.id === v)?.remainingMinor) }
        : {}),
    }));
  };
  return (
    <>
      <PageHeader
        title="Allocate receipt or payment"
        back={() => guard(close)}
      />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const d = open.find((d: any) => d.id === form.documentId);
          try {
            const r = await request("/payments", {
              method: "POST",
              body: JSON.stringify({
                kind,
                branchId: d?.branchId,
                bankAccountId: form.bankAccountId,
                postingDate: today(),
                amount: form.amount,
                method:
                  refs.bankAccounts.find(
                    (a: any) => a.id === form.bankAccountId,
                  )?.type === "CASH"
                    ? "CASH"
                    : "BANK",
                allocations: [
                  { documentId: form.documentId, amount: form.amount },
                ],
              }),
            });
            setDirty(false);
            notify(
              r.status === "SUBMITTED"
                ? "Supplier payment submitted for independent approval"
                : "Receipt posted and allocated",
            );
            saved();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Panel>
          <div className="form-section">
            <Fields
              specs={[
                {
                  key: "kind",
                  label: "Direction",
                  options: [
                    ...(allowed("payments.receipt.create")
                      ? [{ value: "RECEIPT", label: "Customer receipt" }]
                      : []),
                    ...(allowed("payments.payment.create")
                      ? [{ value: "PAYMENT", label: "Supplier payment" }]
                      : []),
                  ],
                },
              ]}
              values={{ kind }}
              set={(_, v) => {
                setKind(v);
                setDirty(true);
              }}
            />
          </div>
          <Resource state={documents}>
            <div className="form-section">
              <Fields
                specs={[
                  {
                    key: "bankAccountId",
                    label: "Cash / bank account",
                    options: refs.bankAccounts,
                    required: true,
                  },
                  {
                    key: "documentId",
                    label: "Open document",
                    options: open.map((d: any) => ({
                      value: d.id,
                      label: `${d.number} · ${name(d.customer || d.supplier)} · ${money(d.remainingMinor)}`,
                    })),
                    required: true,
                  },
                  {
                    key: "amount",
                    label: "Allocation amount",
                    type: "decimal",
                    required: true,
                  },
                ]}
                values={form}
                set={set}
              />
              <p style={{ marginTop: 15 }}>
                {tr(
                  kind === "PAYMENT"
                    ? "Supplier payments remain unposted until an independent checker approves them."
                    : "Posting date",
                )}{" "}
                <bdi>{today()}</bdi>
              </p>
            </div>
          </Resource>
        </Panel>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <span>
            {!open.length
              ? tr("There are no open posted documents for this direction.")
              : null}
          </span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button
              primary
              type="submit"
              busy={busy}
              disabled={!form.documentId}
            >
              {tr(
                kind === "PAYMENT"
                  ? "Submit for approval"
                  : "Post and allocate",
              )}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
export function Banking({
  title,
  screenId,
}: {
  title: string;
  screenId: string;
}) {
  const { tr, refs, money, name, date, allowed, request, notify, user } = useERP();
  const [transactionPage,setTransactionPage]=useState(1);
  const [transactionSearch,setTransactionSearch]=useState('');
  const [transactionBank,setTransactionBank]=useState('');
  const [transactionSize,setTransactionSize]=useState(50);
  const [statementPage,setStatementPage]=useState(1);
  const [statementSearch,setStatementSearch]=useState('');
  const [statementSize,setStatementSize]=useState(10);
  const transactionQuery=new URLSearchParams({transactionPage:String(transactionPage),transactionPageSize:String(transactionSize),transactionSearch,statementPage:String(statementPage),statementPageSize:String(statementSize),statementSearch,...(transactionBank?{bankAccountId:transactionBank}:{})});
  const state = useResource(`/banking?${transactionQuery}`);
  const [mode, setMode] = useState("");
  const [statementPreview,setStatementPreview]=useState<any>(null);
  const [previewBusy,setPreviewBusy]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const [match, setMatch] = useState<any>(null);
  const [manualMatch,setManualMatch]=useState<any>(null);
  const data = state.data;
  const saved = async () => {
    setMode("");
    setTransactionPage(1);
    setStatementPage(1);
    state.reload();
    notify("Action completed");
  };
  const accounts = refs.accounts.filter(
    (a: any) => a.postingAllowed && !a.controlType,
  );
  if(manualMatch)return <FormPage title="Match posted transaction by ID" close={()=>setManualMatch(null)} defaults={{transactionId:''}} specs={[{key:'transactionId',label:'Posted bank transaction ID',required:true}]} submitLabel="Confirm match" submit={async value=>{await request(`/banking/statement-lines/${manualMatch.line.id}/match`,{method:'POST',body:JSON.stringify(value)});setManualMatch(null);state.reload();notify('Statement line reconciled');}}>{()=><><Details values={[["Account",name(manualMatch.statement.bankAccount)],["Reference",manualMatch.line.reference],["Amount",money(manualMatch.line.amountMinor,manualMatch.statement.bankAccount.currency)]]}/><p className="notice">{tr('Enter the ID from the original posted movement. The bank, amount, direction and unused reconciliation state must match.')}</p></>}</FormPage>;
  if(mode==='statement-csv')return <FormPage title="Preview bank statement import" close={()=>setMode('')} defaults={{bankAccountId:'',statementDate:today(),opening:'',closing:'',csv:'',dateColumn:'date',amountColumn:'amount',descriptionColumn:'description',referenceColumn:'reference'}} specs={[
    {key:'bankAccountId',label:'Bank account',options:[{value:'',label:tr('Select')},...refs.bankAccounts],required:true},
    {key:'statementDate',label:'Statement date',type:'date',required:true},
    {key:'opening',label:'Opening balance',type:'decimal',required:true},
    {key:'closing',label:'Closing balance',type:'decimal',required:true},
    {key:'dateColumn',label:'Date column',required:true},{key:'amountColumn',label:'Amount column',required:true},
    {key:'descriptionColumn',label:'Description column',required:true},{key:'referenceColumn',label:'Reference column',required:true},
    {key:'csv',label:'Statement CSV',type:'textarea',required:true,wide:true},
  ]} submitLabel="Import validated statement" submit={async(d)=>{
    if(statementPreview?.input!==JSON.stringify(d)||!statementPreview?.result.valid)throw new Error(tr('Preview this statement and resolve its row errors before importing.'));
    await request('/banking/statements',{method:'POST',body:JSON.stringify({...d,mapping:{date:d.dateColumn,amount:d.amountColumn,description:d.descriptionColumn,reference:d.referenceColumn}})});setStatementPreview(null);await saved();
  }}>{d=><>
    <div className="actions"><Button busy={previewBusy} onClick={async()=>{setPreviewBusy(true);setPreviewError('');try{const result=await request('/banking/statements/preview',{method:'POST',body:JSON.stringify({...d,mapping:{date:d.dateColumn,amount:d.amountColumn,description:d.descriptionColumn,reference:d.referenceColumn}})});setStatementPreview({input:JSON.stringify(d),result});}catch(e:any){setPreviewError(e.message);}finally{setPreviewBusy(false);}}}>{tr('Preview import')}</Button></div>
    {previewError?<ErrorNotice message={previewError}/>:null}
    {statementPreview?.input===JSON.stringify(d)?<Panel title="Statement preview"><p>{tr('Rows')}: {statementPreview.result.rowCount} · {tr('Currency')}: {statementPreview.result.currency}</p><Table rows={statementPreview.result.rows} columns={[{key:'row',label:'Row'},{key:'date',label:'Date'},{key:'description',label:'Description'},{key:'reference',label:'Reference'},{key:'amount',label:'Amount'}]}/>{statementPreview.result.errors.map((error:any,index:number)=><ErrorNotice key={index} message={`${error.row||''} ${error.message}`}/>)}</Panel>:null}
  </>}</FormPage>;
  if (mode === "transfer") return <FormPage title="Transfer between resources" close={()=>setMode("")} defaults={{branchId:defaultBranch(refs.branches,user),sourceId:'',destinationId:'',sourceAmount:'',destinationAmount:'',sourceBaseRate:'',destinationBaseRate:'',feeAmount:'0',feeAccountId:'',fxAccountId:'',fxTreatmentConfirmed:false,postingDate:today(),rateSource:'',reference:'',reason:'',idempotencyKey:crypto.randomUUID()}} specs={[
    {key:'branchId',label:'Branch',options:refs.branches,required:true},
    {key:'sourceId',label:'Source resource',options:[{value:'',label:tr('Select')},...refs.bankAccounts],required:true},
    {key:'destinationId',label:'Destination resource',options:[{value:'',label:tr('Select')},...refs.bankAccounts],required:true},
    {key:'sourceAmount',label:'Source principal amount',type:'decimal',required:true},
    {key:'destinationAmount',label:'Destination principal amount',type:'decimal',required:true},
    {key:'sourceBaseRate',label:'Approved source book rate (base per source unit)',type:'decimal'},
    {key:'destinationBaseRate',label:'Actual destination rate (base per destination unit)',type:'decimal'},
    {key:'feeAmount',label:'Fee in source currency',type:'decimal',required:true},
    {key:'feeAccountId',label:'Fee expense account',options:[{value:'',label:tr('Select')},...accounts.filter((a:any)=>a.type==='EXPENSE')]},
    {key:'fxAccountId',label:'Approved FX difference account',options:[{value:'',label:tr('Select')},...accounts]},
    {key:'fxTreatmentConfirmed',label:'I confirm the FX accounting treatment for this transfer',type:'checkbox'},
    {key:'rateSource',label:'Rate provenance or evidence reference',required:true},
    {key:'postingDate',label:'Posting date',type:'date',required:true},
    {key:'reference',label:'Reference'},
    {key:'reason',label:'Transfer reason',required:true},
  ]} submitLabel="Post paired transfer" submit={async(d)=>{await request('/banking/transfers',{method:'POST',headers:{'idempotency-key':d.idempotencyKey},body:JSON.stringify(d)});await saved();}}>{d=><p className="notice">{tr('Account currency')}: {refs.bankAccounts.find((a:any)=>String(a.id)===String(d.sourceId))?.currency||'—'} → {refs.bankAccounts.find((a:any)=>String(a.id)===String(d.destinationId))?.currency||'—'}. {tr('Both resource movements post together. Fees and FX differences require explicit accounts.')}</p>}</FormPage>;
  if (mode === "transaction")
    return (
      <FormPage
        title="Post bank transaction"
        close={() => setMode("")}
        defaults={{
          branchId: defaultBranch(refs.branches,user),
          kind: "RECEIPT",
          bankAccountId: '',
          counterpartyAccountId: '',
          amount: '',
          description: '',
          reference: '',
          postingDate: today(),
        }}
        specs={[
          {key:"branchId",label:"Branch",options:refs.branches,required:true},
          {
            key: "kind",
            label: "Kind",
            options: ["RECEIPT", "PAYMENT"],
          },
          {
            key: "bankAccountId",
            label: "Cash / bank account",
            options: [{value:'',label:'Select'},...refs.bankAccounts.filter((bank:any)=>bank.currency===refs.tenant.baseCurrency)],
            required: true,
          },
          {
            key: "counterpartyAccountId",
            label: "Counterparty GL",
            options: [{value:'',label:'Select'},...accounts],
            required: true,
          },
          { key: "amount", label: "Amount", type: "decimal", required: true, hint:'Amounts use the selected bank account currency.' },
          { key: 'postingDate', label: 'Posting date', type: 'date', required: true },
          { key: "reference", label: "Reference" },
          { key: "description", label: "Description", required: true },
        ]}
        submitLabel="Post transaction"
        submit={async (d) => {
          await request("/banking/transactions", {
            method: "POST",
            body: JSON.stringify({
              ...d,
              branchId: d.branchId,
              postingDate: d.postingDate,
            }),
          });
          await saved();
        }}
      >{d=><p className="notice">{tr('Account currency')}: {refs.bankAccounts.find((bank:any)=>String(bank.id)===String(d.bankAccountId))?.currency||'—'}. {tr('Record student collections and foreign-currency movements in Collections & academy, where historical rates are required.')}</p>}</FormPage>
    );
  if (mode === "statement")
    return (
      <FormPage
        title="Import bank statement"
        close={() => setMode("")}
        defaults={{
          bankAccountId: '',
          amount: '',
          description: '',
          reference: '',
          opening: '',
          closing: '',
          statementDate: today(),
          lineDate: today(),
        }}
        specs={[
          {
            key: "bankAccountId",
            label: "Bank account",
            options: [{value:'',label:'Select'},...refs.bankAccounts.filter(
              (a: any) => a.type !== "CARD_CLEARING",
            )],
            required: true,
          },
          {
            key: "opening",
            label: "Opening balance",
            type: "decimal",
            required: true,
          },
          {key:'statementDate',label:'Statement date',type:'date',required:true},
          {key:'lineDate',label:'Line date',type:'date',required:true},
          {
            key: "closing",
            label: "Closing balance",
            type: "decimal",
            required: true,
          },
          {
            key: "amount",
            label: "Line amount",
            type: "decimal",
            required: true,
          },
          { key: "reference", label: "Bank reference" },
          { key: "description", label: "Description" },
        ]}
        submitLabel="Import statement"
        submit={async (d) => {
          await request("/banking/statements", {
            method: "POST",
            body: JSON.stringify({
              bankAccountId: d.bankAccountId,
              statementDate: d.statementDate,
              opening: d.opening,
              closing: d.closing,
              lines: [
                {
                  date: d.lineDate,
                  amount: d.amount,
                  description: d.description,
                  reference: d.reference,
                },
              ],
            }),
          });
          await saved();
        }}
      >{d=><p className="notice">{tr('Account currency')}: {refs.bankAccounts.find((bank:any)=>String(bank.id)===String(d.bankAccountId))?.currency||'—'}. {tr('A statement import records bank evidence; it does not post a transfer or convert currencies.')}</p>}</FormPage>
    );
  return (
    <>
      <PageHeader
        title={title}
        subtitle="Posted receipts, payments, transfers and bank-statement matching"
      >
        {allowed("banking.transaction.create") ? <Button onClick={()=>setMode("transfer")}>{tr("Transfer between resources")}</Button> : null}
        {allowed("banking.statement.create") ? <Button onClick={()=>setMode("statement-csv")}>{tr("Preview bank statement import")}</Button> : null}
        {screenId !== "bank-statements" &&
        allowed("banking.transaction.create") ? (
          <AddButton onClick={() => setMode("transaction")}>
            {tr("Bank transaction")}
          </AddButton>
        ) : null}
        {screenId !== "bank-transactions" &&
        allowed("banking.statement.reconcile") ? (
          <Button onClick={() => setMode("statement")}>
            {tr("Import statement line")}
          </Button>
        ) : null}
      </PageHeader>
      <Panel><div className="toolbar">
        <label className="field">{tr('Cash / bank account')}<select value={transactionBank} onChange={event=>{setTransactionBank(event.target.value);setTransactionPage(1);setStatementPage(1);}}><option value="">{tr('All')}</option>{(data?.accounts||refs.bankAccounts).map((bank:any)=><option key={bank.id} value={bank.id}>{name(bank)} · {bank.currency}{bank.active===false?` · ${tr('Inactive')}`:''}</option>)}</select></label>
        {screenId!=="bank-statements"?<><SearchField value={transactionSearch} label="Search posted transactions" onChange={value=>{setTransactionSearch(value.slice(0,100));setTransactionPage(1);}}/>
        <label className="field">{tr('Transaction rows per page')}<select value={transactionSize} onChange={event=>{setTransactionSize(Number(event.target.value));setTransactionPage(1);}}>{[25,50,100,200].map(size=><option key={size} value={size}>{size}</option>)}</select></label></>:null}
        {screenId!=="bank-transactions"?<><SearchField value={statementSearch} label="Search bank statements" onChange={value=>{setStatementSearch(value.slice(0,100));setStatementPage(1);}}/>
        <label className="field">{tr('Statements per page')}<select value={statementSize} onChange={event=>{setStatementSize(Number(event.target.value));setStatementPage(1);}}>{[1,5,10,25,50].map(size=><option key={size} value={size}>{size}</option>)}</select></label></>:null}
      </div></Panel>
      <Resource state={state}>
        {data ? (
          <>
            {screenId !== "bank-statements" ? (
              <Panel title="Posted bank transactions">
                <Table
                  rows={data.transactions}
                  columns={[
                    {
                      key: "number",
                      label: "Reference",
                      render: (r) => (
                        <>
                          <strong>{r.number}</strong>
                          <small>{tr("Transaction ID")}: {r.id}</small>
                          <small>{r.reference || r.description}</small>
                        </>
                      ),
                    },
                    {
                      key: "account",
                      label: "Account",
                      render: (r) => name(r.bankAccount),
                    },
                    { key: "kind", label: "Kind", render: (r) => tr(r.kind) },
                    {
                      key: "amount",
                      label: "Amount",
                      numeric: true,
                      render: (r) =>
                        money(r.amountMinor, r.bankAccount?.currency),
                    },
                    {
                      key: "journal",
                      label: "Journal",
                      render: (r) => (
                        <Link href={`/accounting/journals?journal=${r.journalEntryId||r.journalEntry?.id}`}>
                          {r.journalEntry?.number}
                        </Link>
                      ),
                    },
                    {
                      key: "status",
                      label: "Reconciliation",
                      render: (r) => tr(r.reconciled ? "Matched" : "Unmatched"),
                    },
                  ]}
                />
                <Pagination page={transactionPage} pageSize={data.transactionPagination?.size||transactionSize} total={data.transactionPagination?.total||0} onPage={setTransactionPage}/>
              </Panel>
            ) : null}
            {screenId !== "bank-transactions" ? (<>
              {data.statements.length ? (
                data.statements.map((s: any) => {
                  const difference =
                    BigInt(s.closingMinor) -
                    BigInt(s.openingMinor) -
                    s.lines.reduce(
                      (a: bigint, l: any) => a + BigInt(l.amountMinor),
                      0n,
                    );
                  const unmatched = s.lines
                    .filter((l: any) => !l.matched)
                    .reduce(
                      (a: bigint, l: any) =>
                        a +
                        (BigInt(l.amountMinor) < 0n
                          ? -BigInt(l.amountMinor)
                          : BigInt(l.amountMinor)),
                      0n,
                    );
                  return (
                    <Panel
                      key={s.id}
                      title={`${name(s.bankAccount)} · ${date(s.statementDate)}`}
                    >
                      <Details
                        values={[
                          ['Account currency', s.bankAccount.currency],
                          ["Opening balance", money(s.openingMinor,s.bankAccount.currency)],
                          ["Closing balance", money(s.closingMinor,s.bankAccount.currency)],
                          ["Difference", money(difference,s.bankAccount.currency)],
                          ["Unmatched", money(unmatched,s.bankAccount.currency)],
                        ]}
                      />
                      <Table
                        rows={s.lines}
                        columns={[
                          { key: "reference", label: "Reference" },
                          { key: "description", label: "Description" },
                          {
                            key: "amount",
                            label: "Amount",
                            numeric: true,
                            render: (l) => money(l.amountMinor,s.bankAccount.currency),
                          },
                          {
                            key: "match",
                            label: "Reconciliation",
                            render: (l) =>
                              l.matched ? (
                                tr("Matched")
                              ) : allowed("banking.statement.reconcile") ? (
                                <div className="actions"><select
                                  aria-label={tr("Match transaction")}
                                  value=""
                                  onChange={(e) => {
                                    if (e.target.value)
                                      setMatch({
                                        lineId: l.id,
                                        transactionId: e.target.value,
                                      });
                                  }}
                                >
                                  <option value="">{tr("Match…")}</option>
                                  {data.transactions
                                    .filter(
                                      (r: any) =>
                                        !r.reconciled &&
                                        (BigInt(l.amountMinor)<0n?['PAYMENT','TRANSFER_OUT']:['RECEIPT','TRANSFER_IN']).includes(r.kind) &&
                                        r.bankAccountId === s.bankAccountId &&
                                        BigInt(r.amountMinor) ===
                                          (BigInt(l.amountMinor) < 0n
                                            ? -BigInt(l.amountMinor)
                                            : BigInt(l.amountMinor)),
                                    )
                                    .map((r: any) => (
                                      <option key={r.id} value={r.id}>
                                        {r.number}
                                      </option>
                                    ))}
                                </select><Button onClick={()=>setManualMatch({line:l,statement:s})}>{tr('Match posted transaction by ID')}</Button></div>
                              ) : (
                                tr("Read only")
                              ),
                          },
                        ]}
                      />
                    </Panel>
                  );
                })
              ) : (
                <Panel title="Statement reconciliation">
                  <Table rows={[]} columns={[]} />
                </Panel>
              )}
              <Pagination page={statementPage} pageSize={data.statementPagination?.size||statementSize} total={data.statementPagination?.total||0} onPage={setStatementPage}/>
            </>) : null}
          </>
        ) : null}
      </Resource>
      {match ? (
        <Confirm
          title="Match transaction"
          reason={false}
          close={() => setMatch(null)}
          action={async () => {
            await request(`/banking/statement-lines/${match.lineId}/match`, {
              method: "POST",
              body: JSON.stringify({ transactionId: match.transactionId }),
            });
            state.reload();
            notify("Statement line reconciled");
          }}
        />
      ) : null}
    </>
  );
}
