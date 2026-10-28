"use client";
import {reportSchemas} from "../core/report-schema";
import AccountingReports, { GeneralLedger } from "./accounting-reports";
import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { useERP, useResource } from "../core/erp-context";
import {
  PageHeader,
  Panel,
  Table,
  Resource,
  Button,
  SearchField,
  Details,
  Dialog,
  Fields,
  ErrorNotice,
} from "../components/ui";
export const reportCatalog = [
  ["trial-balance", "Trial balance"],
  ["general-ledger", "General ledger"],
  ["account-ledger", "Account ledger"],
  ["income-statement", "Income statement"],
  ["balance-sheet", "Balance sheet"],
  ["customer-balances", "Customer balances"],
  ["customer-statement", "Customer statement"],
  ["supplier-statement", "Supplier statement"],
  ["ar-aging", "AR aging"],
  ["ap-aging", "AP aging"],
  ["inventory-valuation", "Inventory valuation"],
  ["stock-movements", "Stock movements"],
  ["tax-report", "VAT report"],
  ["sales-profitability", "Sales profitability"],
  ["purchase-analysis", "Purchase analysis"],
  ["cash-flow", "Cash position"],
  ["pos-shifts", "POS shift report"],
  ["reconciliation", "Control reconciliation"],
];
const categories: Record<string, string[]> = {
  sales: [
    "customer-balances",
    "customer-statement",
    "ar-aging",
    "sales-profitability",
  ],
  purchasing: ["supplier-statement", "ap-aging", "purchase-analysis"],
  inventory: ["inventory-valuation", "stock-movements"],
  accounting: [
    "trial-balance",
    "general-ledger",
    "account-ledger",
    "income-statement",
    "balance-sheet",
    "tax-report",
    "reconciliation",
  ],
  banking: ["cash-flow", "reconciliation"],
  pos: ["pos-shifts"],
};
const human = (key: string) =>
  key
    .replace(/Minor$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export default function Reports({
  title,
  category,
  initialReport,
}: {
  title: string;
  category?: string;
  initialReport?: string;
}) {
  const { tr, allowed, money, quantity, download, notify, dateTime } = useERP();
  const catalog = reportCatalog.filter(
    ([key]) =>
      (!category || categories[category]?.includes(key)) &&
      (allowed("reports.profitability.view") ||
        !["income-statement", "balance-sheet", "sales-profitability"].includes(
          key,
        )),
  );
  const [selected, setSelected] = useState(
    initialReport && catalog.some(([key]) => key === initialReport)
      ? initialReport
      : catalog[0]?.[0] || "reconciliation",
  );
  const financial = [
    "trial-balance",
    "general-ledger",
    "account-ledger",
    "income-statement",
    "balance-sheet",
  ].includes(selected);
  const state = useResource(financial ? null : `/reports/${selected}`);
  const [evidence, setEvidence] = useState("");
  const report = state.data;
  const columns = reportSchemas[selected] || [];
  return (
    <>
      <PageHeader
        title={title}
        subtitle="Business reports calculated from posted journals and operational ledgers"
      >
        {!financial ? (
          <>
            <Button onClick={() => window.print()}>
              <Printer size={15} />
              {tr("Browser print")}
            </Button>
            {["csv", "pdf"].map((format) => (
              <Button
                key={format}
                primary={format === "pdf"}
                disabled={!report}
                onClick={() =>
                  download(
                    `/reports/${selected}/${format}`,
                    `${selected}.${format}`,
                  ).catch((e: any) => notify(e.message, true))
                }
              >
                <Download size={15} />
                {tr(format === "csv" ? "Export CSV" : "Print PDF")}
              </Button>
            ))}
          </>
        ) : null}
      </PageHeader>
      <div className="report-layout">
        <nav className="report-menu" aria-label={tr("Report Library")}>
          {catalog.map(([key, label]) => (
            <button
              key={key}
              aria-current={selected === key ? "page" : undefined}
              onClick={() => setSelected(key)}
            >
              {tr(label)}
            </button>
          ))}
        </nav>
        {financial ? (
          ["general-ledger", "account-ledger"].includes(selected) ? (
            <GeneralLedger key={selected} initialReport={selected} embedded />
          ) : (
            <AccountingReports
              key={selected}
              initialReport={selected}
              embedded
            />
          )
        ) : (
          <Panel
            title={
              report?.name ||
              catalog.find(([key]) => key === selected)?.[1] ||
              "Report"
            }
          >
            <Resource state={state}>
              <Table
                caption={report?.name}
                rows={report?.rows || []}
                columns={columns.map(({key,label,type,currency})=>({
                  key,label,numeric:['money','quantity','number'].includes(type||''),
                  render:(row:any)=>{
                    const value=row[key];
                    if(value==null)return '—';
                    if(type==='reference')return <button className="link" onClick={()=>setEvidence(String(value))}><bdi>{String(value)}</bdi></button>;
                    if(type==='money')return <bdi>{money(value,currency==='transaction'?row.currency:row.baseCurrency)}</bdi>;
                    if(type==='quantity')return <bdi>{quantity(value)}</bdi>;
                    if(type==='date')return dateTime(value);
                    if(type==='status')return tr(String(value));
                    return <bdi>{typeof value==='object'?value.name||'—':String(value)}</bdi>;
                  }
                }))}
              />
              {report?.totals ? (
                <Details
                  values={Object.entries(report.totals).map(([key, value]) => [
                    human(key),
                    key.includes("Minor") ? money(value) : String(value),
                  ])}
                />
              ) : null}
            </Resource>
          </Panel>
        )}
      </div>
      {evidence ? (
        <Evidence reference={evidence} close={() => setEvidence("")} />
      ) : null}
    </>
  );
}
function Evidence({
  reference,
  close,
}: {
  reference: string;
  close: () => void;
}) {
  const { money, tr } = useERP();
  const state = useResource(`/evidence/${encodeURIComponent(reference)}`);
  const d = state.data;
  return (
    <Dialog title={reference} close={close}>
      <Resource state={state}>
        {d ? (
          <>
            <Details
              values={Object.entries(d)
                .filter(([_, v]) => typeof v !== "object")
                .map(([k, v]) => [
                  human(k),
                  k.toLowerCase().includes("minor")
                    ? money(v)
                    : tr(String(v ?? "—")),
                ])}
            />
            <Panel title="Underlying lines">
              <Table
                rows={(d.lines || []).map((s: any) => ({
                  value: typeof s === "string" ? s : JSON.stringify(s),
                }))}
                columns={[{ key: "value", label: "Evidence" }]}
              />
            </Panel>
            <Panel title="Inventory movements">
              <Table
                rows={(d.stockMovements || []).map((s: any) => ({
                  value: typeof s === "string" ? s : JSON.stringify(s),
                }))}
                columns={[{ key: "value", label: "Movement" }]}
              />
            </Panel>
          </>
        ) : null}
      </Resource>
    </Dialog>
  );
}
export function Audit() {
  const { tr, allowed, dateTime, name, request, notify, endSession } = useERP();
  const state = useResource("/audit");
  const [search, setSearch] = useState("");
  const [reset, setReset] = useState(false);
  const [form, setForm] = useState({ confirmation: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = (state.data || []).filter((e: any) =>
    [e.action, tr(e.action), e.entityType, tr(e.entityType), e.postingReference, e.approvalReference, e.user?.name, e.entityId, JSON.stringify(e.newValues), JSON.stringify(e.previousValues)]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Actor, entity, action, posting/approval reference and recorded payload"
      >
        {allowed("settings.system.reset") ? (
          <Button danger onClick={() => setReset(true)}>
            {tr("Reset demo tenant")}
          </Button>
        ) : null}
      </PageHeader>
      <Panel>
        <div className="toolbar">
          <SearchField
            value={search}
            onChange={setSearch}
            label="Search audit log"
          />
          <span className="toolbar-count">
            {tr("Immutable governance evidence")}
          </span>
        </div>
        <Resource state={state}>
          <Table
            rows={rows}
            columns={[
              {
                key: "date",
                label: "Timestamp",
                render: (e) => dateTime(e.createdAt),
              },
              {
                key: "actor",
                label: "Actor",
                render: (e) => name(e.user || e.actor),
              },
              { key: "action", label: "Action" },
              {
                key: "entity",
                label: "Entity",
                render: (e) => `${tr(e.entityType)} · ${e.entityId}`,
              },
              {
                key: "reference",
                label: "Reference",
                render: (e) => (
                  <bdi>{e.postingReference || e.approvalReference || "—"}</bdi>
                ),
              },
              {
                key: "values",
                label: "Recorded values",
                render: (e) => (
                  <details>
                    <summary>{tr("View")}</summary>
                    <Details
                      values={Object.entries(e.newValues || {}).map(
                        ([k, v]) => [
                          human(k),
                          typeof v === "object" ? JSON.stringify(v) : String(v),
                        ],
                      )}
                    />
                  </details>
                ),
              },
            ]}
          />
        </Resource>
      </Panel>
      {reset ? (
        <Dialog title="Reset demo tenant" close={() => setReset(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const result = await request("/system/reset", {
                  method: "POST",
                  body: JSON.stringify(form),
                });
                notify(result.message);
                endSession();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Fields
              specs={[
                {
                  key: "confirmation",
                  label: "Type RESET ODIN to rebuild the demo tenant",
                  required: true,
                  wide: true,
                },
                {
                  key: "password",
                  label: "Re-enter the administrator password",
                  type: "password",
                  required: true,
                  wide: true,
                },
              ]}
              values={form}
              set={(k, v) => setForm({ ...form, [k]: v })}
            />
            {error ? <ErrorNotice message={error} /> : null}
            <div className="form-actions">
              <Button onClick={() => setReset(false)}>{tr("Cancel")}</Button>
              <Button
                type="submit"
                danger
                busy={busy}
                disabled={form.confirmation !== "RESET ODIN" || !form.password}
              >
                {tr("Reset demo tenant")}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
