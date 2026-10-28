"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { routeEntry } from "../core/navigation";
import { Plus, Trash2, Printer, ArrowUpRight, Copy } from "lucide-react";
import { useERP, useResource, today, decimal } from "../core/erp-context";
import {
  inputMinor,
  journalTotals,
  sourceDocumentLink,
  type Journal,
  type Paged,
  type AccountingAccount,
} from "../core/accounting";
import {
  PageHeader,
  Panel,
  Button,
  Resource,
  Table,
  Status,
  Details,
  Fields,
  Confirm,
  ErrorNotice,
  Pagination,
  useUnsaved,
} from "../components/ui";
export default function Journals() {
  const { tr, refs, allowed, field, money, date, name, request, notify } =
    useERP();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("journal");
  const [editor, setEditor] = useState<Journal | "new" | null>(
    params.get("new") === "1" ? "new" : null,
  );
  const [reversal, setReversal] = useState<Journal | null>(null);
  const [action, setAction] = useState<{
    journal: Journal;
    kind: string;
  } | null>(null);
  const [filters, setFilters] = useState({
    search: params.get("search") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
    branchId: params.get("branchId") || "",
    status: params.get("status") || "",
    sourceType: params.get("sourceType") || "",
  });
  const page = Math.max(1, Number(params.get("page") || 1));
  const query = new URLSearchParams(params);
  query.delete("journal");
  query.delete("new");
  query.set("page", String(page));
  query.set("pageSize", "25");
  const state = useResource<Paged<Journal>>(
    !id ? `/accounting/journals?${query}` : null,
  );
  const detail = useResource<Journal>(id ? `/accounting/journals/${id}` : null);
  const open = (journalId: string) => {
    setEditor(null);
    setReversal(null);
    const q = new URLSearchParams(params);
    q.delete("new");
    q.set("journal", journalId);
    router.replace(`/accounting/journals?${q}`);
  };
  const back = () => {
    setEditor(null);
    setReversal(null);
    const q = new URLSearchParams(params);
    q.delete("journal");
    q.delete("new");
    router.replace(`/accounting/journals?${q}`);
    state.reload();
  };
  const actions = (journal: Journal) => (
    <JournalActions
      journal={journal}
      edit={() => setEditor(journal)}
      reverse={() => setReversal(journal)}
      action={(kind) => setAction({ journal, kind })}
    />
  );
  if (
    editor &&
    (editor === "new"
      ? allowed("accounting.journal.create")
      : allowed("accounting.journal.edit")) &&
    field("journal", "lines") === "EDIT"
  )
    return (
      <JournalEditor
        existing={editor === "new" ? undefined : editor}
        close={back}
        saved={(journal) => {
          notify("Journal saved");
          open(journal.id);
          state.reload();
          detail.reload();
        }}
      />
    );
  if (reversal)
    return (
      <ReversalEditor
        journal={reversal}
        close={() => setReversal(null)}
        saved={(journal) => {
          setReversal(null);
          open(journal.id);
          notify("Reversal draft created");
        }}
      />
    );
  return (
    <>
      {id ? (
        <Resource state={detail}>
          {detail.data ? (
            <JournalDetail
              journal={detail.data}
              back={back}
              actions={actions(detail.data)}
            />
          ) : null}
        </Resource>
      ) : (
        <section className="ac-workbench">
          <PageHeader
            title="Journal Entries"
            subtitle="Prepare, review and post entries with a traceable approval history."
          >
            {allowed("accounting.journal.create") &&
            field("journal", "lines") === "EDIT" ? (
              <Button primary onClick={() => setEditor("new")}>
                <Plus size={16} />
                {tr("New manual journal")}
              </Button>
            ) : null}
          </PageHeader>
          <form
            className="ac-toolbar ac-register-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const q = new URLSearchParams();
              Object.entries(filters).forEach(([k, v]) => {
                if (v) q.set(k, v);
              });
              router.replace(`/accounting/journals?${q}`);
            }}
          >
            <label className="ac-filter ac-search">
              <span>{tr("Search journals")}</span>
              <input
                type="search"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
              />
            </label>
            <label className="ac-filter">
              <span>{tr("From date")}</span>
              <input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) =>
                  setFilters({ ...filters, from: e.target.value })
                }
              />
            </label>
            <label className="ac-filter">
              <span>{tr("To date")}</span>
              <input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </label>
            <label className="ac-filter">
              <span>{tr("Branch")}</span>
              <select
                value={filters.branchId}
                onChange={(e) =>
                  setFilters({ ...filters, branchId: e.target.value })
                }
              >
                <option value="">{tr("All authorized branches")}</option>
                {refs.branches.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {name(b)}
                  </option>
                ))}
              </select>
            </label>
            <label className="ac-filter">
              <span>{tr("Status")}</span>
              <select
                value={filters.status}
                onChange={(e) =>
                  setFilters({ ...filters, status: e.target.value })
                }
              >
                <option value="">{tr("All statuses")}</option>
                {["DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REJECTED"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {tr(s)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="ac-filter">
              <span>{tr("Entry origin")}</span>
              <select
                value={filters.sourceType}
                onChange={(e) =>
                  setFilters({ ...filters, sourceType: e.target.value })
                }
              >
                <option value="">{tr("All origins")}</option>
                <option value="MANUAL">{tr("Manual entries")}</option>
                <option value="REVERSAL">{tr("Reversals")}</option>
              </select>
            </label>
            <Button type="submit" primary>
              {tr("Apply filters")}
            </Button>
            <Button
              onClick={() => {
                setFilters({
                  search: "",
                  from: "",
                  to: "",
                  branchId: "",
                  status: "",
                  sourceType: "",
                });
                router.replace("/accounting/journals");
              }}
            >
              {tr("Reset")}
            </Button>
          </form>
          <Resource state={state}>
            <Table
              caption="Journal register"
              rows={state.data?.rows || []}
              columns={[
                {
                  key: "number",
                  label: "Journal",
                  render: (j) => (
                    <button className="link" onClick={() => open(j.id)}>
                      <bdi>{j.number}</bdi>
                    </button>
                  ),
                },
                {
                  key: "date",
                  label: "Posting date",
                  render: (j) => <bdi>{date(j.postingDate)}</bdi>,
                },
                {
                  key: "description",
                  label: "Description",
                  render: (j) => (
                    <div className="ac-record-description">
                      <strong>{j.description}</strong>
                      <small>
                        {name(
                          refs.branches.find((b: any) => b.id === j.branchId),
                        )}{" "}
                        · <bdi>{j.sourceNumber}</bdi>
                      </small>
                    </div>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (j) => <Status value={j.status} />,
                },
                {
                  key: "debit",
                  label: "Debit",
                  numeric: true,
                  render: (j) => (
                    <bdi>
                      {journalTotals(j.lines)
                        ? money(journalTotals(j.lines)!.debit, j.currency)
                        : tr("Restricted")}
                    </bdi>
                  ),
                },
                {
                  key: "credit",
                  label: "Credit",
                  numeric: true,
                  render: (j) => (
                    <bdi>
                      {journalTotals(j.lines)
                        ? money(journalTotals(j.lines)!.credit, j.currency)
                        : tr("Restricted")}
                    </bdi>
                  ),
                },
                { key: "actions", label: "Actions", render: actions },
              ]}
            />
            {state.data ? (
              <Pagination
                page={page}
                total={state.data.pagination.total}
                pageSize={25}
                onPage={(p) => {
                  const q = new URLSearchParams(params);
                  q.set("page", String(p));
                  router.replace(`/accounting/journals?${q}`);
                }}
              />
            ) : null}
          </Resource>
        </section>
      )}
      {action ? (
        <Confirm
          title={
            {
              submit: "Submit",
              approve: "Approve",
              reject: "Reject",
              post: "Post",
            }[action.kind] || action.kind
          }
          reason={action.kind === "reject"}
          dangerous={action.kind === "reject"}
          close={() => setAction(null)}
          action={async (comment) => {
            await request(`/journals/${action.journal.id}/${action.kind}`, {
              method: "POST",
              body: JSON.stringify({ comment }),
            });
            notify("Action completed");
            state.reload();
            detail.reload();
          }}
        />
      ) : null}
    </>
  );
}
function JournalActions({
  journal,
  edit,
  reverse,
  action,
}: {
  journal: Journal;
  edit: () => void;
  reverse: () => void;
  action: (kind: string) => void;
}) {
  const { tr, allowed, field, user } = useERP();
  const visible = field("journal", "lines") !== "HIDDEN";
  const editable = field("journal", "lines") === "EDIT";
  const own = String(journal.submittedById) === String(user.userId || user.id);
  return (
    <div className="actions ac-journal-actions">
      {journal.status === "DRAFT" &&
      (journal.sourceType === "MANUAL" || !!journal.reversesEntryId) &&
      allowed("accounting.journal.edit") &&
      editable ? (
        <>
          <Button className="small" onClick={edit}>
            {tr("Edit")}
          </Button>
          <Button className="small" onClick={() => action("submit")}>
            {tr("Submit")}
          </Button>
        </>
      ) : null}
      {journal.status === "SUBMITTED" && visible ? (
        <>
          {allowed("accounting.journal.approve") && !own ? (
            <Button className="small" onClick={() => action("approve")}>
              {tr("Approve")}
            </Button>
          ) : null}
          {allowed("accounting.journal.reject") ? (
            <Button className="small" danger onClick={() => action("reject")}>
              {tr("Reject")}
            </Button>
          ) : null}
        </>
      ) : null}
      {journal.status === "APPROVED" &&
      visible &&
      allowed("accounting.journal.post") ? (
        <Button primary className="small" onClick={() => action("post")}>
          {tr("Post")}
        </Button>
      ) : null}
      {journal.status === "POSTED" &&
      !journal.reversedBy &&
      editable &&
      allowed("accounting.journal.create") ? (
        <Button className="small" onClick={reverse}>
          {tr("Reverse")}
        </Button>
      ) : null}
    </div>
  );
}
function JournalDetail({
  journal: j,
  back,
  actions,
}: {
  journal: Journal;
  back: () => void;
  actions: React.ReactNode;
}) {
  const { tr, refs, name, date, dateTime, money, allowed } = useERP();
  const totals = journalTotals(j.lines);
  const sourcePath = sourceDocumentLink(j.sourceType, j.sourceId);
  const source =
    sourcePath && allowed(routeEntry(sourcePath.split("?")[0]).child.permission)
      ? sourcePath
      : null;
  const stages = [
    { label: "Created", date: j.createdAt, person: j.createdBy?.name },
    { label: "Submitted", date: j.submittedAt, person: j.submittedBy?.name },
    { label: "Approved", date: j.approvedAt, person: j.approvedBy?.name },
    { label: "Posted", date: j.postedAt, person: j.postedBy?.name },
  ];
  return (
    <article className="ac-journal-detail">
      <PageHeader title={j.number} subtitle={j.description} back={back}>
        <Status value={j.status} />
        {actions}
        {allowed("accounting.journal.print") ? (
          <Button onClick={() => window.print()}>
            <Printer size={15} />
            {tr("Print journal")}
          </Button>
        ) : null}
      </PageHeader>
      <section className="surface ac-journal-sheet">
        <div className="ac-print-company">{refs.tenant.name}</div>
        <Details
          values={[
            ["Posting date", date(j.postingDate)],
            [
              "Branch",
              name(refs.branches.find((b: any) => b.id === j.branchId)),
            ],
            ["Currency", j.currency],
            [
              "Entry origin",
              tr(
                j.sourceType === "MANUAL"
                  ? "Manual entry"
                  : j.sourceType === "REVERSAL"
                    ? "Reversal"
                    : j.sourceModule,
              ),
            ],
            [
              "Source",
              source ? (
                <Link href={source}>
                  {j.sourceNumber}
                  <ArrowUpRight size={13} />
                </Link>
              ) : (
                j.sourceNumber
              ),
            ],
            ["Prepared by", j.createdBy?.name || "—"],
          ]}
        />
        {j.reversesEntry ? (
          <p className="ac-related-entry">
            {tr("Reverses entry")}:{" "}
            <Link href={`/accounting/journals?journal=${j.reversesEntry.id}`}>
              <bdi>{j.reversesEntry.number}</bdi>
            </Link>
          </p>
        ) : null}
        {j.reversedBy ? (
          <p className="ac-related-entry">
            {tr("Linked reversal")}:{" "}
            <Link href={`/accounting/journals?journal=${j.reversedBy.id}`}>
              <bdi>{j.reversedBy.number}</bdi>
            </Link>
          </p>
        ) : null}
        {j.reversalReason ? (
          <p className="ac-related-entry">
            {tr("Reason")}: {j.reversalReason}
          </p>
        ) : null}
        {j.lines ? (
          <>
            <Table
              caption="Journal lines"
              rows={j.lines}
              columns={[
                {
                  key: "account",
                  label: "Account",
                  render: (l) =>
                    allowed("accounting.journal.view") ? (
                      <Link
                        href={`/accounting/general-ledger?view=account&accountId=${l.accountId}`}
                      >
                        <bdi>{l.account?.code}</bdi> · {name(l.account)}
                      </Link>
                    ) : (
                      name(l.account)
                    ),
                },
                { key: "description", label: "Description" },
                { key: "costCenter", label: "Cost center" },
                {
                  key: "debit",
                  label: "Debit",
                  numeric: true,
                  render: (l) => <bdi>{money(l.debitMinor, j.currency)}</bdi>,
                },
                {
                  key: "credit",
                  label: "Credit",
                  numeric: true,
                  render: (l) => <bdi>{money(l.creditMinor, j.currency)}</bdi>,
                },
              ]}
            />
            <div className="ac-totals-band">
              <span>{tr("Journal totals")}</span>
              <div>
                <small>{tr("Debit")}</small>
                <strong>
                  <bdi>{money(totals!.debit, j.currency)}</bdi>
                </strong>
              </div>
              <div>
                <small>{tr("Credit")}</small>
                <strong>
                  <bdi>{money(totals!.credit, j.currency)}</bdi>
                </strong>
              </div>
              <div>
                <small>{tr("Difference")}</small>
                <strong>
                  <bdi>{money(totals!.debit - totals!.credit, j.currency)}</bdi>
                </strong>
              </div>
            </div>
          </>
        ) : (
          <p className="surface-body">
            {tr("Journal lines are restricted for your role.")}
          </p>
        )}
      </section>
      <section className="surface">
        <div className="surface-heading">
          <h2>{tr("Approval trail")}</h2>
        </div>
        <ol className="ac-lifecycle">
          {stages.map((s) => (
            <li key={s.label} className={s.date ? "complete" : ""}>
              <span className="ac-step-dot" />
              <strong>{tr(s.label)}</strong>
              <span>
                {s.date ? <bdi>{dateTime(s.date)}</bdi> : tr("Not yet")}
              </span>
              {s.person ? <small>{s.person}</small> : null}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
type DraftLine = {
  accountId: string;
  description: string;
  costCenter: string;
  debit: string;
  credit: string;
};
function JournalEditor({
  existing,
  close,
  saved,
}: {
  existing?: Journal;
  close: () => void;
  saved: (journal: Journal) => void;
}) {
  const { tr, refs, request, name, money, allowed } = useERP();
  const blank = (): DraftLine => ({
    accountId: "",
    description: "",
    costCenter: "",
    debit: "",
    credit: "",
  });
  const [data, setData] = useState({
    branchId: existing?.branchId || refs.branches[0]?.id || "",
    postingDate: existing?.postingDate.slice(0, 10) || today(),
    description: existing?.description || "",
    lines: existing?.lines?.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      costCenter: l.costCenter || "",
      debit: decimal(l.debitMinor),
      credit: decimal(l.creditMinor),
    })) || [blank(), blank()],
  });
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reversal = !!existing?.reversesEntryId;
  const accounts: AccountingAccount[] = refs.accounts.filter(
    (a: AccountingAccount) =>
      (a.active && a.postingAllowed && !a.controlType) ||
      (reversal && existing?.lines?.some((l) => l.accountId === a.id)),
  );
  const totals = data.lines.reduce(
    (result, line) => {
      const debit = inputMinor(line.debit),
        credit = inputMinor(line.credit);
      return {
        debit: result.debit + (debit ?? 0n),
        credit: result.credit + (credit ?? 0n),
        valid:
          result.valid &&
          debit !== null &&
          credit !== null &&
          debit > 0n !== credit > 0n &&
          !!line.accountId,
      };
    },
    { debit: 0n, credit: 0n, valid: true },
  );
  const difference = totals.debit - totals.credit;
  const balanced = totals.valid && difference === 0n && totals.debit > 0n;
  const period = refs.periods.find(
    (p: any) =>
      data.postingDate >= p.startDate.slice(0, 10) &&
      data.postingDate <= p.endDate.slice(0, 10),
  );
  const periodBlocked =
    !reversal && allowed("accounting.period.view") && period?.status !== "OPEN";
  const set = (key: string, value: any) => {
    setDirty(true);
    setData((d) => ({ ...d, [key]: value }));
  };
  const setLine = (index: number, key: keyof DraftLine, value: string) =>
    set(
      "lines",
      data.lines.map((l, i) => (i === index ? { ...l, [key]: value } : l)),
    );
  return (
    <>
      <PageHeader
        title={existing ? "Edit journal" : "New manual journal"}
        subtitle="Record a balanced entry using active posting accounts."
        back={() => guard(close)}
      />
      <form
        className="ac-editor ac-journal-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!balanced) {
            setError(tr("Enter valid, balanced debit and credit lines."));
            return;
          }
          setBusy(true);
          setError("");
          try {
            const body = reversal ? { description: data.description } : data;
            const result = await request(
              existing ? `/journals/${existing.id}` : "/journals",
              {
                method: existing ? "PATCH" : "POST",
                body: JSON.stringify(body),
              },
            );
            setDirty(false);
            saved(result);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="surface">
          <div className="surface-heading">
            <h2>{tr("Entry details")}</h2>
            <span
              className={`ac-period-indicator ${period?.status === "OPEN" ? "" : "closed"}`}
            >
              {period
                ? `${tr(period.name)} · ${tr(period.status)}`
                : tr(
                    allowed("accounting.period.view")
                      ? "No fiscal period"
                      : "The posting date will be validated when the draft is saved.",
                  )}
            </span>
          </div>
          <div className="form-section">
            <Fields
              specs={[
                {
                  key: "postingDate",
                  label: "Posting date",
                  type: "date",
                  required: true,
                  readOnly: reversal,
                },
                {
                  key: "branchId",
                  label: "Branch",
                  options: refs.branches,
                  required: true,
                  readOnly: reversal,
                },
                {
                  key: "description",
                  label: "Description",
                  required: true,
                  wide: true,
                },
              ]}
              values={data}
              set={set}
            />
          </div>
        </section>
        <section className="surface">
          <div className="surface-heading">
            <h2>{tr("Journal lines")}</h2>
            <span>
              {tr("Base currency")}: <bdi>{refs.tenant.baseCurrency}</bdi>
            </span>
          </div>
          <div
            className="table-region"
            tabIndex={0}
            role="region"
            aria-label={tr("Journal lines")}
          >
            <table className="ac-line-editor">
              <thead>
                <tr>
                  {[
                    "Line",
                    "Posting account",
                    "Description",
                    "Cost center",
                    "Debit",
                    "Credit",
                    "Actions",
                  ].map((h) => (
                    <th key={h}>{tr(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <bdi>{i + 1}</bdi>
                    </td>
                    <td>
                      <select
                        required
                        aria-label={`${tr("Posting account")} ${i + 1}`}
                        disabled={reversal}
                        value={l.accountId}
                        onChange={(e) =>
                          setLine(i, "accountId", e.target.value)
                        }
                      >
                        <option value="">{tr("Select posting account")}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {name(a)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`${tr("Line description")} ${i + 1}`}
                        readOnly={reversal}
                        value={l.description}
                        onChange={(e) =>
                          setLine(i, "description", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${tr("Cost center")} ${i + 1}`}
                        readOnly={reversal}
                        value={l.costCenter}
                        onChange={(e) =>
                          setLine(i, "costCenter", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${tr("Debit")} ${i + 1}`}
                        className="numeric"
                        inputMode="decimal"
                        dir="ltr"
                        readOnly={reversal}
                        value={l.debit}
                        onChange={(e) => setLine(i, "debit", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${tr("Credit")} ${i + 1}`}
                        className="numeric"
                        inputMode="decimal"
                        dir="ltr"
                        readOnly={reversal}
                        value={l.credit}
                        onChange={(e) => setLine(i, "credit", e.target.value)}
                      />
                    </td>
                    <td>
                      <Button
                        className="small"
                        aria-label={`${tr("Remove line")} ${i + 1}`}
                        disabled={reversal || data.lines.length <= 2}
                        onClick={() =>
                          set(
                            "lines",
                            data.lines.filter((_, index) => index !== i),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!reversal ? (
            <div className="ac-line-tools">
              <Button onClick={() => set("lines", [...data.lines, blank()])}>
                <Plus size={15} />
                {tr("Add line")}
              </Button>
              <Button
                onClick={() =>
                  set("lines", [
                    ...data.lines,
                    {
                      ...blank(),
                      debit: difference < 0n ? decimal(-difference) : "",
                      credit: difference > 0n ? decimal(difference) : "",
                    },
                  ])
                }
                disabled={!difference}
              >
                <Copy size={15} />
                {tr("Add balancing line")}
              </Button>
              <span>
                {tr(
                  "Cost center is optional. Use an assigned code when required.",
                )}
              </span>
            </div>
          ) : (
            <p className="surface-body">
              {tr(
                "Reversal lines stay linked to the original entry. Only the description can be edited.",
              )}
            </p>
          )}
          <div
            className={`ac-totals-band ${balanced ? "balanced" : ""}`}
            aria-live="polite"
          >
            <strong>
              {tr(balanced ? "Balanced entry" : "Entry needs attention")}
            </strong>
            <div>
              <small>{tr("Debit")}</small>
              <strong>
                <bdi>{money(totals.debit)}</bdi>
              </strong>
            </div>
            <div>
              <small>{tr("Credit")}</small>
              <strong>
                <bdi>{money(totals.credit)}</bdi>
              </strong>
            </div>
            <div>
              <small>{tr("Difference")}</small>
              <strong>
                <bdi>{money(difference)}</bdi>
              </strong>
            </div>
          </div>
        </section>
        {error ? <ErrorNotice message={error} /> : null}
        {periodBlocked ? (
          <p className="ac-validation" role="status">
            {tr("Choose a posting date within an open fiscal period.")}
          </p>
        ) : null}
        <div className="editor-footer">
          <span>
            {tr(
              "Draft entries have no ledger effect until approved and posted.",
            )}
          </span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button
              type="submit"
              primary
              busy={busy}
              disabled={!balanced || periodBlocked}
            >
              {tr(existing ? "Save changes" : "Create balanced draft")}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
function ReversalEditor({
  journal,
  close,
  saved,
}: {
  journal: Journal;
  close: () => void;
  saved: (journal: Journal) => void;
}) {
  const { tr, request, money } = useERP();
  const [data, setData] = useState({ postingDate: today(), reason: "" });
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const totals = journalTotals(journal.lines);
  return (
    <>
      <PageHeader
        title="Reverse journal"
        subtitle={journal.number}
        back={() => guard(close)}
      />
      <form
        className="ac-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await request(
              `/journals/${journal.id}/reverse/create`,
              { method: "POST", body: JSON.stringify(data) },
            );
            setDirty(false);
            saved(result);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Panel title="Linked reversal">
          <div className="form-section">
            <p>
              {tr(
                "A reversal creates a separate balanced draft. The original posted entry remains unchanged.",
              )}
            </p>
            <Details
              values={[
                ["Original entry", journal.number],
                [
                  "Reversal amount",
                  totals ? money(totals.debit) : tr("Restricted"),
                ],
              ]}
            />
            <Fields
              specs={[
                {
                  key: "postingDate",
                  label: "Open reversal date (YYYY-MM-DD)",
                  type: "date",
                  required: true,
                },
                {
                  key: "reason",
                  label: "Reversal reason",
                  type: "textarea",
                  required: true,
                  wide: true,
                },
              ]}
              values={data}
              set={(k, v) => {
                setDirty(true);
                setData({ ...data, [k]: v });
              }}
            />
          </div>
        </Panel>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <span>{tr("Independent approval is required before posting.")}</span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button primary type="submit" busy={busy}>
              {tr("Create balanced draft")}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
