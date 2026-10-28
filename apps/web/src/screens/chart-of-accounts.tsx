"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Pencil,
  FolderTree,
  ArrowUpRight,
  Search,
} from "lucide-react";
import { useERP, useResource } from "../core/erp-context";
import {
  accountTypes,
  accountTypeLabels,
  debitNature,
  type AccountingAccount,
} from "../core/accounting";
import {
  Button,
  PageHeader,
  Resource,
  Status,
  Fields,
  Details,
  ErrorNotice,
  useUnsaved,
} from "../components/ui";
type Company = { id: string; name: string; baseCurrency: string };
export default function ChartOfAccounts() {
  const { tr, allowed, name, money } = useERP();
  const params = useSearchParams();
  const router = useRouter();
  const [companyId, setCompanyId] = useState("");
  const state = useResource<{
    rows: AccountingAccount[];
    companies: Company[];
  }>(
    `/accounting/accounts?includeInactive=true${companyId ? `&companyId=${companyId}` : ""}`,
  );
  const accounts = state.data?.rows || [];
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("ALL");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{
    existing?: AccountingAccount;
    parent?: AccountingAccount;
  } | null>(null);
  const selected =
    accounts.find((a) => a.id === params.get("account")) || accounts[0];
  const balance = useResource(
    selected && allowed("accounting.journal.view")
      ? `/accounting/ledger?accountId=${selected.id}&pageSize=1${companyId ? `&companyId=${companyId}` : ""}`
      : null,
  );
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const children = new Map<string, AccountingAccount[]>();
  for (const a of accounts) {
    const parent =
      a.parentId && byId.has(a.parentId) ? a.parentId : `type:${a.type}`;
    children.set(parent, [...(children.get(parent) || []), a]);
  }
  for (const group of children.values())
    group.sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
  const matches = accounts.filter(
    (a) =>
      (!kind || a.type === kind) &&
      (status === "ALL" || a.active === (status === "ACTIVE")) &&
      `${a.code} ${a.name} ${tr(a.name)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const included = new Set(matches.map((a) => a.id));
  for (const a of matches) {
    let parent = a.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      included.add(parent);
      parent = byId.get(parent)?.parentId || null;
    }
  }
  const filtered = !!query || !!kind || status !== "ALL";
  const toggle = (id: string) =>
    setCollapsed((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const select = (id: string) =>
    router.replace(`/accounting/chart-of-accounts?account=${id}`, {
      scroll: false,
    });
  const saved = (record: AccountingAccount) => {
    setForm(null);
    state.reload();
    select(record.id);
  };
  if (form)
    return (
      <AccountEditor
        existing={form.existing}
        parent={form.parent}
        accounts={accounts}
        companies={state.data?.companies || []}
        companyId={companyId}
        close={() => setForm(null)}
        saved={saved}
      />
    );
  function rows(
    parent: string,
    depth: number,
    ancestors = new Set<string>(),
  ): React.ReactNode[] {
    return (children.get(parent) || [])
      .filter((a) => included.has(a.id) && !ancestors.has(a.id))
      .flatMap((a) => {
        const hasChildren = !!children.get(a.id)?.length;
        const open = filtered || !collapsed.has(a.id);
        const lineage = new Set([...ancestors, a.id]);
        return [
          <tr
            key={a.id}
            data-account-id={a.id}
            className={selected?.id === a.id ? "ac-selected-row" : ""}
          >
            <td>
              <div
                className="ac-tree-label"
                style={{ paddingInlineStart: depth * 24 }}
              >
                {hasChildren ? (
                  <button
                    className="ac-disclosure"
                    aria-label={`${tr(open ? "Collapse account" : "Expand account")} ${a.code}`}
                    aria-expanded={open}
                    onClick={() => toggle(a.id)}
                  >
                    {open ? (
                      <ChevronDown size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                  </button>
                ) : (
                  <span className="ac-tree-end" aria-hidden="true" />
                )}
                <button
                  className="ac-account-name"
                  onClick={() => select(a.id)}
                  aria-pressed={selected?.id === a.id}
                >
                  <bdi className="ac-code">{a.code}</bdi>
                  <span>{name(a)}</span>
                </button>
              </div>
            </td>
            <td>
              <span className="ac-account-mode">
                {tr(
                  a.controlType
                    ? "Control account"
                    : a.postingAllowed
                      ? "Posting account"
                      : "Group account",
                )}
              </span>
            </td>
            <td>
              <Status value={a.active ? "ACTIVE" : "INACTIVE"} />
            </td>
            <td className="ac-row-open">
              <div className="ac-row-actions">
                {a.active && allowed("accounting.account.create") ? (
                  <button
                    className="ac-icon-button"
                    aria-label={`${tr("Add child to")} ${a.code}`}
                    title={tr("Add child account")}
                    onClick={() => setForm({ parent: a })}
                  >
                    <Plus size={16} />
                  </button>
                ) : null}
                <button
                  className="ac-icon-button"
                  aria-label={`${tr("Account details")} ${a.code}`}
                  onClick={() => select(a.id)}
                >
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </td>
          </tr>,
          ...(hasChildren && open ? rows(a.id, depth + 1, lineage) : []),
        ];
      });
  }
  return (
    <section className="ac-workbench">
      <PageHeader
        title="Chart of Accounts"
        subtitle="Organize account groups, posting accounts and the links between them."
      >
        <Button
          onClick={() =>
            setCollapsed(
              collapsed.size ? new Set() : new Set([...children.keys()]),
            )
          }
        >
          {tr(collapsed.size ? "Expand all" : "Collapse all")}
        </Button>
        {allowed("accounting.account.create") ? (
          <Button
            primary
            disabled={!state.data}
            onClick={() => setForm({})}
            data-testid="new-account"
          >
            <Plus size={16} />
            {tr("New account")}
          </Button>
        ) : null}
      </PageHeader>
      <div className="ac-toolbar">
        <label className="search-field">
          <span className="sr-only">{tr("Search account code or name")}</span>
          <Search size={16} />
          <input
            type="search"
            value={query}
            placeholder={tr("Search account code or name")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="ac-filter">
          <span>{tr("Account type")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{tr("All types")}</option>
            {accountTypes.map((t) => (
              <option key={t} value={t}>
                {tr(accountTypeLabels[t])}
              </option>
            ))}
          </select>
        </label>
        <label className="ac-filter">
          <span>{tr("Status")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {["ALL", "ACTIVE", "INACTIVE"].map((s) => (
              <option key={s} value={s}>
                {tr(s === "ALL" ? "All statuses" : s)}
              </option>
            ))}
          </select>
        </label>
        {(state.data?.companies.length || 0) > 1 ? (
          <label className="ac-filter">
            <span>{tr("Company")}</span>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">{tr("All authorized companies")}</option>
              {state.data?.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <Resource state={state}>
        <div className="ac-chart-layout">
          <div className="ac-tree-region">
            <div
              className="table-region"
              tabIndex={0}
              role="region"
              aria-label={tr("Account hierarchy")}
            >
              <table className="ac-tree-table">
                <caption className="sr-only">{tr("Account hierarchy")}</caption>
                <thead>
                  <tr>
                    <th>{tr("Account")}</th>
                    <th>{tr("Posting mode")}</th>
                    <th>{tr("Status")}</th>
                    <th>
                      <span className="sr-only">{tr("Account details")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accountTypes
                    .filter((t) =>
                      (children.get(`type:${t}`) || []).some((a) =>
                        included.has(a.id),
                      ),
                    )
                    .flatMap((t) => {
                      const key = `type:${t}`;
                      const open = filtered || !collapsed.has(key);
                      return [
                        <tr className="ac-tree-group" key={key}>
                          <th colSpan={4}>
                            <button
                              aria-expanded={open}
                              onClick={() => toggle(key)}
                            >
                              {open ? (
                                <ChevronDown size={15} />
                              ) : (
                                <ChevronRight size={15} />
                              )}
                              <FolderTree size={16} />
                              {tr(accountTypeLabels[t])}
                              <small>{tr("Classification")}</small>
                            </button>
                          </th>
                        </tr>,
                        ...(open ? rows(key, 0) : []),
                      ];
                    })}
                  {!matches.length ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        {tr("No matching accounts")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <footer className="ac-table-footer">
              <span>
                <bdi>{matches.length}</bdi> {tr("accounts")}
              </span>
              <span>{tr("Groups follow the saved parent relationships.")}</span>
            </footer>
          </div>
          <aside
            className="ac-account-inspector"
            aria-label={tr("Account details")}
          >
            {selected ? (
              <>
                <div className="ac-inspector-heading">
                  <span>{tr("Account details")}</span>
                  <h2>{name(selected)}</h2>
                  <bdi className="ac-inspector-code">{selected.code}</bdi>
                </div>
                <Details
                  values={[
                    ["Account type", tr(accountTypeLabels[selected.type])],
                    [
                      "Normal balance",
                      tr(debitNature(selected.type) ? "Debit" : "Credit"),
                    ],
                    [
                      "Parent account",
                      selected.parentId && byId.has(selected.parentId)
                        ? `${byId.get(selected.parentId)!.code} · ${name(byId.get(selected.parentId))}`
                        : tr("Classification root"),
                    ],
                    [
                      "Posting mode",
                      tr(
                        selected.controlType
                          ? "Control account"
                          : selected.postingAllowed
                            ? "Posting account"
                            : "Group account",
                      ),
                    ],
                    [
                      "Status",
                      <Status
                        key="status"
                        value={selected.active ? "ACTIVE" : "INACTIVE"}
                      />,
                    ],
                  ]}
                />
                {allowed("accounting.journal.view") ? (
                  <div className="ac-account-balance">
                    <span>{tr("Posted balance")}</span>
                    <strong>
                      <bdi>
                        {balance.loading
                          ? tr("Loading…")
                          : balance.error
                            ? tr("Unavailable")
                            : money(
                                balance.data?.totals?.closingBalanceMinor,
                                balance.data?.currency,
                              )}
                      </bdi>
                    </strong>
                    <small>
                      {tr("Debit less credit · authorized branches")}
                    </small>
                  </div>
                ) : null}
                <div className="ac-inspector-actions">
                  {allowed("accounting.account.edit") &&
                  selected.editable !== false ? (
                    <Button
                      primary
                      onClick={() => setForm({ existing: selected })}
                    >
                      <Pencil size={15} />
                      {tr("Edit account")}
                    </Button>
                  ) : null}
                  {allowed("accounting.journal.view") ? (
                    <Link
                      className="btn"
                      href={`/accounting/general-ledger?view=account&accountId=${selected.id}${companyId ? `&companyId=${companyId}` : ""}`}
                    >
                      {tr("Open account ledger")}
                      <ArrowUpRight size={15} />
                    </Link>
                  ) : null}
                  {selected.active && allowed("accounting.account.create") ? (
                    <Button onClick={() => setForm({ parent: selected })}>
                      <Plus size={15} />
                      {tr("Add child account")}
                    </Button>
                  ) : null}
                </div>
                {selected.controlType ? (
                  <p className="ac-explanation">
                    {tr(
                      "Control accounts are maintained by their source workflows. Manual posting is blocked.",
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="empty">
                {tr("Select an account to review its settings and ledger.")}
              </div>
            )}
          </aside>
        </div>
      </Resource>
    </section>
  );
}
function AccountEditor({
  existing,
  parent,
  accounts,
  companies,
  companyId,
  close,
  saved,
}: {
  existing?: AccountingAccount;
  parent?: AccountingAccount;
  accounts: AccountingAccount[];
  companies: Company[];
  companyId: string;
  close: () => void;
  saved: (record: AccountingAccount) => void;
}) {
  const { tr, request, refreshRefs, notify, name } = useERP();
  const [values, setValues] = useState({
    companyId:
      companyId ||
      existing?.companyIds?.[0] ||
      parent?.companyIds?.[0] ||
      companies[0]?.id ||
      "",
    code: existing?.code || "",
    name: existing?.name || "",
    type: existing?.type || parent?.type || "",
    parentId: existing?.parentId || parent?.id || "",
    postingAllowed: existing?.postingAllowed ?? true,
    active: existing?.active ?? true,
  });
  const [parentQuery, setParentQuery] = useState("");
  const [codeSuggestion, setCodeSuggestion] = useState({ key: "", code: "" });
  const codeKey = `${values.companyId}|${values.type}|${values.parentId}`;
  const suggestedCode = codeSuggestion.key === codeKey ? codeSuggestion.code : "";
  useEffect(() => {
    if (existing || !values.companyId || !values.type) return;
    let cancelled = false;
    const query = new URLSearchParams({ companyId: values.companyId, type: values.type });
    if (values.parentId) query.set("parentId", values.parentId);
    request(`/accounting/accounts/next-code?${query}`)
      .then((result: { code: string }) => {
        if (!cancelled) setCodeSuggestion({ key: codeKey, code: result.code || "" });
      })
      .catch(() => {
        if (!cancelled) setCodeSuggestion({ key: codeKey, code: "" });
      });
    return () => { cancelled = true; };
  }, [existing, request, values.companyId, values.type, values.parentId, codeKey]);
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: string, value: unknown) => {
    setDirty(true);
    setError("");
    if (key === "type" || key === "companyId") setParentQuery("");
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === "type" || key === "companyId" ? { parentId: "" } : {}),
    }));
  };
  const excluded = new Set<string>(existing ? [existing.id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of accounts)
      if (a.parentId && excluded.has(a.parentId) && !excluded.has(a.id)) {
        excluded.add(a.id);
        changed = true;
      }
  }
  const parents = accounts.filter(
    (a) =>
      a.active &&
      a.type === values.type &&
      !excluded.has(a.id) &&
      (!a.companyIds?.length || a.companyIds.includes(values.companyId)),
  );
  const parentMatches = parents.filter(
    (a) =>
      a.id === values.parentId ||
      `${a.code} ${name(a)}`
        .toLocaleLowerCase()
        .includes(parentQuery.trim().toLocaleLowerCase()),
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const placement: AccountingAccount[] = [];
  const visited = new Set<string>();
  let ancestor = accountById.get(values.parentId);
  while (ancestor && !visited.has(ancestor.id)) {
    placement.unshift(ancestor);
    visited.add(ancestor.id);
    ancestor = ancestor.parentId ? accountById.get(ancestor.parentId) : undefined;
  }
  const hasChildren =
    !!existing && accounts.some((a) => a.parentId === existing.id);
  const chosenType = accountTypes.find((type) => type === values.type);
  const classification = chosenType
    ? tr(accountTypeLabels[chosenType])
    : tr("Choose an account type");
  return (
    <>
      <PageHeader
        title={existing ? "Edit account" : "New account"}
        subtitle={
          existing
            ? "Review the account settings before saving changes."
            : "Choose where it belongs, add its details, and review before saving."
        }
        back={() => guard(close)}
      />
      <form
        className={`ac-editor ${existing ? "" : "ac-account-editor"}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const record = await request(
              existing
                ? `/accounting/accounts/${existing.id}`
                : "/accounting/accounts",
              {
                method: existing ? "PATCH" : "POST",
                body: JSON.stringify(existing
                  ? { ...values, parentId: values.parentId || null }
                  : {
                      companyId: values.companyId,
                      name: values.name,
                      type: values.type,
                      parentId: values.parentId || null,
                      postingAllowed: values.postingAllowed,
                      active: values.active,
                      autoCode: true,
                    }),
              },
            );
            setDirty(false);
            await refreshRefs();
            notify("Account saved");
            saved(record);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {existing ? (
          <section className="surface">
            <div className="surface-heading">
              <h2>{tr("Account identity")}</h2>
            </div>
            <div className="form-section">
              <Fields
                specs={[
                  {
                    key: "companyId",
                    label: "Company",
                    options: companies,
                    required: true,
                    readOnly: true,
                  },
                  {
                    key: "code",
                    label: "Account code",
                    required: true,
                    readOnly: !!existing.hasActivity,
                  },
                  {
                    key: "name",
                    label: "Account name",
                    required: true,
                    wide: true,
                  },
                  {
                    key: "type",
                    label: "Account type",
                    options: accountTypes.map((t) => ({
                      value: t,
                      label: accountTypeLabels[t],
                    })),
                    readOnly: !!existing.hasActivity || hasChildren,
                    required: true,
                  },
                  {
                    key: "parentId",
                    label: "Parent account",
                    options: [
                      { value: "", label: "Classification root" },
                      ...parents.map((a) => ({
                        value: a.id,
                        label: `${a.code} · ${name(a)}`,
                      })),
                    ],
                  },
                  {
                    key: "postingAllowed",
                    label: "Allow posting to this account",
                    type: "checkbox",
                    readOnly: hasChildren || !!existing.controlType,
                  },
                  { key: "active", label: "Active", type: "checkbox" },
                ]}
                values={values}
                set={set}
              />
              <p className="ac-explanation">
                {tr(
                  values.postingAllowed
                    ? "Posting accounts receive journal lines and can have children. A group cannot receive direct postings."
                    : "Group accounts organize the chart. Create posting accounts beneath them to record transactions.",
                )}
              </p>
              {existing.hasActivity ? (
                <p className="ac-explanation">
                  {tr(
                    "This account has activity. Its code and financial classification are protected.",
                  )}
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <div className="ac-create-layout">
            <div className="ac-create-steps">
              <section className="surface ac-create-step">
                <div className="surface-heading">
                  <span className="ac-step-number">1</span>
                  <div>
                    <h2>{tr("Where does this account belong?")}</h2>
                    <p>{tr("Choose the company and financial type, then decide whether this is a main or child account.")}</p>
                  </div>
                </div>
                <div className="form-section">
                  <div className="ac-create-fields">
                    <label className="field">
                      <span>
                        {tr("Company")} <span className="required">*</span>
                      </span>
                      <select
                        aria-label={tr("Company")}
                        value={values.companyId}
                        required
                        disabled={!!companyId || companies.length <= 1}
                        onChange={(e) => set("companyId", e.target.value)}
                      >
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>
                        {tr("Account type")} <span className="required">*</span>
                      </span>
                      <select
                        aria-label={tr("Account type")}
                        value={values.type}
                        required
                        onChange={(e) => set("type", e.target.value)}
                      >
                        <option value="">{tr("Choose an account type")}</option>
                        {accountTypes.map((type) => (
                          <option key={type} value={type}>
                            {tr(accountTypeLabels[type])}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="ac-parent-picker">
                    <div className="ac-parent-heading">
                      <strong>{tr("Where should this account appear in the chart?")}</strong>
                      <p>{tr("Choose an existing account below for a child account. Leave Main account selected if it has no parent.")}</p>
                    </div>
                    <div className="ac-parent-controls">
                      <label className="field ac-parent-choice" htmlFor="ac-parent-select">
                        <span>{tr("Place under (optional)")}</span>
                        <select
                          id="ac-parent-select"
                          value={values.parentId}
                          disabled={!values.type}
                          onChange={(e) => set("parentId", e.target.value)}
                        >
                          <option value="">{tr("Main account (no parent)")}</option>
                          {parentMatches.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} · {name(account)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field ac-parent-filter" htmlFor="ac-parent-search">
                        <span>{tr("Search parent accounts (optional)")}</span>
                        <input
                          id="ac-parent-search"
                          type="search"
                          value={parentQuery}
                          disabled={!values.type || parents.length === 0}
                          placeholder={tr("Filter by code or name")}
                          onChange={(e) => setParentQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    {!values.type ? (
                      <p className="ac-picker-note">{tr("Choose an account type first to see where it can go.")}</p>
                    ) : parents.length === 0 ? (
                      <p className="ac-picker-note ac-picker-empty" role="status">{tr("No existing accounts in this type yet. This account will be a main account.")}</p>
                    ) : parentQuery && parentMatches.length === 0 ? (
                      <p className="ac-picker-note" role="status">{tr("No matching parent accounts. Clear the search or choose Main account.")}</p>
                    ) : values.parentId ? (
                      <p className="ac-picker-note">{tr("This account will appear under the selected account.")}</p>
                    ) : (
                      <p className="ac-picker-note">{tr("This account will appear at the top of the selected financial type.")}</p>
                    )}
                  </div>
                </div>
              </section>
              <section className="surface ac-create-step">
                <div className="surface-heading">
                  <span className="ac-step-number">2</span>
                  <div>
                    <h2>{tr("Name and code")}</h2>
                    <p>{tr("Give the account a clear name. Its unique code is assigned automatically.")}</p>
                  </div>
                </div>
                <div className="form-section ac-create-fields">
                  <label className="field">
                    <span>
                      {tr("Account name")} <span className="required">*</span>
                    </span>
                    <input
                      value={values.name}
                      required
                      maxLength={160}
                      autoComplete="off"
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>
                      {tr("Account code")} <span className="required">*</span>
                    </span>
                    <input
                      value={suggestedCode}
                      readOnly
                      placeholder={tr("Assigned when saved")}
                      dir="ltr"
                      aria-describedby="ac-code-help"
                    />
                    <small id="ac-code-help">
                      {tr("The server assigns the next free code when you save. The preview may change if another account is created first.")}
                    </small>
                  </label>
                </div>
              </section>
              <section className="surface ac-create-step">
                <div className="surface-heading">
                  <span className="ac-step-number">3</span>
                  <div>
                    <h2>{tr("How will this account be used?")}</h2>
                    <p>{tr("Choose whether entries can be posted directly to it.")}</p>
                  </div>
                </div>
                <fieldset className="ac-mode-options">
                  <legend className="sr-only">{tr("Posting mode")}</legend>
                  <label className={`ac-mode-card ${values.postingAllowed ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="account-mode"
                      checked={values.postingAllowed}
                      onChange={() => set("postingAllowed", true)}
                    />
                    <span>
                      <strong>{tr("Posting account")}</strong>
                      <small>{tr("Record journal entries directly in this account.")}</small>
                    </span>
                  </label>
                  <label className={`ac-mode-card ${!values.postingAllowed ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="account-mode"
                      checked={!values.postingAllowed}
                      onChange={() => set("postingAllowed", false)}
                    />
                    <span>
                      <strong>{tr("Group account")}</strong>
                      <small>{tr("Organize child accounts without direct posting.")}</small>
                    </span>
                  </label>
                </fieldset>
              </section>
            </div>
            <aside className="surface ac-create-preview" aria-label={tr("Account preview")}>
              <span className="ac-preview-eyebrow">{tr("Account preview")}</span>
              <h2>{values.name.trim() || tr("Account name")}</h2>
              <bdi className="ac-preview-code">{suggestedCode || tr("Assigned when saved")}</bdi>
              <div className="ac-preview-section">
                <span>{tr("Place in chart")}</span>
                <ol className="ac-preview-path">
                  <li>{classification}</li>
                  {placement.map((account) => (
                    <li key={account.id}>{account.code} · {name(account)}</li>
                  ))}
                  <li>{values.name.trim() || tr("New account")}</li>
                </ol>
              </div>
              <div className="ac-preview-section">
                <span>{tr("Posting mode")}</span>
                <strong>{tr(values.postingAllowed ? "Posting account" : "Group account")}</strong>
                <p>
                  {tr(
                    values.postingAllowed
                      ? "Journal entries can use this account after it is saved."
                      : "Create child accounts here after this group is saved.",
                  )}
                </p>
              </div>
            </aside>
          </div>
        )}
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <span>
            {tr(existing ? "Account settings" : "Review the account location before saving.")}
          </span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button primary type="submit" busy={busy}>
              {tr("Save account")}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
