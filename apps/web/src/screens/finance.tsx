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
  const state = useResource("/banking");
  const [mode, setMode] = useState("");
  const [match, setMatch] = useState<any>(null);
  const data = state.data;
  const saved = async () => {
    setMode("");
    state.reload();
    notify("Action completed");
  };
  const accounts = refs.accounts.filter(
    (a: any) => a.postingAllowed && !a.controlType,
  );
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
            options: ["RECEIPT", "PAYMENT", "TRANSFER_IN", "TRANSFER_OUT"],
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
              </Panel>
            ) : null}
            {screenId !== "bank-transactions" ? (
              data.statements.length ? (
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
                                <select
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
                                </select>
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
              )
            ) : null}
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
