"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { useERP, useResource, decimal, today } from "../core/erp-context";
import { allRoutes, routeForDocumentType } from "../core/navigation";
import {
  PageHeader,
  Panel,
  Table,
  Resource,
  SearchField,
  Button,
  AddButton,
  Pagination,
  Status,
  Tabs,
  Details,
  Stats,
  Confirm,
  Fields,
  Dialog,
  ErrorNotice,
} from "../components/ui";
import DocumentEditor from "./document-editor";
export const resources: Record<string, string> = {
  QUOTATION: "sales.quotation",
  SALES_ORDER: "sales.order",
  DELIVERY_NOTE: "sales.delivery",
  SALES_INVOICE: "sales.invoice",
  SALES_RETURN: "sales.return",
  CREDIT_NOTE: "sales.credit_note",
  PURCHASE_REQUEST: "purchasing.request",
  PURCHASE_RFQ: "purchasing.rfq",
  PURCHASE_ORDER: "purchasing.order",
  GOODS_RECEIPT: "purchasing.receipt",
  PURCHASE_BILL: "purchasing.bill",
  PURCHASE_RETURN: "purchasing.return",
  WAREHOUSE_TRANSFER: "inventory.transfer",
  INVENTORY_ADJUSTMENT: "inventory.adjustment",
  STOCK_COUNT: "inventory.stock_count",
};
const conversions: Record<string, string[]> = {
  QUOTATION: ["SALES_ORDER"],
  SALES_ORDER: ["DELIVERY_NOTE"],
  DELIVERY_NOTE: ["SALES_INVOICE"],
  SALES_INVOICE: ["SALES_RETURN", "CREDIT_NOTE"],
  PURCHASE_REQUEST: ["PURCHASE_RFQ"],
  PURCHASE_RFQ: ["PURCHASE_ORDER"],
  PURCHASE_ORDER: ["GOODS_RECEIPT"],
  GOODS_RECEIPT: ["PURCHASE_BILL", "PURCHASE_RETURN"],
  PURCHASE_BILL: ["PURCHASE_RETURN"],
};
export default function Documents({
  type,
  title,
}: {
  type: string;
  title: string;
}) {
  const { tr, refs, allowed, name, money, date } = useERP();
  const params = useSearchParams();
  const router = useRouter();
  const sales = resources[type].startsWith("sales.");
  const direct = [
    "QUOTATION",
    "SALES_ORDER",
    "PURCHASE_REQUEST",
    "PURCHASE_RFQ",
    "PURCHASE_ORDER",
    "WAREHOUSE_TRANSFER",
    "INVENTORY_ADJUSTMENT",
    "STOCK_COUNT",
  ].includes(type);
  const [mode, setMode] = useState(
    params.get("new") === "1" && direct ? "create" : "list",
  );
  const [id, setId] = useState(params.get("document") || "");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    status: "",
    branchId: "",
    salespersonId: "",
    currency: "",
    sort: "updated",
  });
  const linkedId = params.get("document") || "";
  useEffect(() => {
    setId(linkedId);
    setMode(params.get("new") === "1" && direct ? "create" : "list");
  }, [linkedId, params, direct]);
  const query = new URLSearchParams({
    type,
    page: String(page),
    pageSize: "15",
    search,
    ...filters,
  });
  const state = useResource(
    sales ? `/sales/documents?${query}` : `/documents?type=${type}`,
  );
  const rows = sales
    ? state.data?.rows || []
    : (state.data || []).filter(
        (d: any) =>
          (!filters.status || d.status === filters.status) &&
          [d.number, d.customer?.name, d.supplier?.name, d.branch?.name]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      );
  const close = () => {
    setMode("list");
    setId("");
    router.replace(window.location.pathname);
    state.reload();
  };
  if (mode === "create" && direct && allowed(`${resources[type]}.create`))
    return (
      <DocumentEditor
        type={type}
        customerId={params.get("customer") || undefined}
        close={close}
        saved={(d) => {
          setMode("list");
          setId(d.id);
          state.reload();
        }}
      />
    );
  if (id) return <DocumentDetail id={id} close={close} />;
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          sales
            ? "Manage customer documents from quotation through collection and return"
            : type.startsWith("PURCHASE") || type === "GOODS_RECEIPT"
              ? "Manage supplier sourcing, receiving, billing and returns"
              : "Record and review controlled movements of stock between locations"
        }
      >
        {direct && allowed(`${resources[type]}.create`) ? (
          <AddButton testId="new-document" onClick={() => setMode("create")}>
            {tr("New")} {tr(type)}
          </AddButton>
        ) : (
          <span className="muted">
            {tr("Created from an approved source document")}
          </span>
        )}
      </PageHeader>
      {!sales && state.data ? (
        <Stats
          items={[
            { label: "Total records", value: state.data.length },
            {
              label: "Draft",
              value: state.data.filter((r: any) => r.status === "DRAFT").length,
            },
            {
              label: "Awaiting approval",
              value: state.data.filter((r: any) => r.status === "SUBMITTED")
                .length,
            },
            {
              label: "Posted records",
              value: state.data.filter((r: any) => r.status === "POSTED")
                .length,
            },
          ]}
        />
      ) : null}
      <Panel>
        <div className="toolbar">
          <SearchField
            value={search}
            onChange={(s) => {
              setSearch(s);
              setPage(1);
            }}
          />
          {[
            {
              key: "status",
              label: "Status",
              rows: [
                "DRAFT",
                "SUBMITTED",
                "APPROVED",
                "POSTED",
                "REJECTED",
                "EXPIRED",
              ],
            },
            ...(sales
              ? [
                  { key: "branchId", label: "Branch", rows: refs.branches },
                  {
                    key: "salespersonId",
                    label: "Salesperson",
                    rows: refs.salesEmployees,
                  },
                  {
                    key: "currency",
                    label: "Currency",
                    rows: refs.currencies.map((c: any) => c.code),
                  },
                ]
              : []),
          ].map((f) => (
            <label className="field" key={f.key}>
              {tr(f.label)}
              <select
                value={(filters as any)[f.key]}
                onChange={(e) => {
                  setFilters({ ...filters, [f.key]: e.target.value });
                  setPage(1);
                }}
              >
                <option value="">{tr("All")}</option>
                {f.rows.map((r: any) =>
                  typeof r === "string" ? (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ) : (
                    <option key={r.id} value={r.id}>
                      {name(r)}
                    </option>
                  ),
                )}
              </select>
            </label>
          ))}
          <span className="toolbar-count">
            {state.data?.pagination?.total ?? rows.length} {tr("records")}
          </span>
        </div>
        <Resource state={state}>
          <Table
            testId="document-table"
            caption={title}
            rows={sales ? rows : rows.slice((page - 1) * 15, page * 15)}
            filtered={!!search || !!filters.status}
            columns={[
              {
                key: "number",
                label: "Document",
                render: (d) => (
                  <button className="link" onClick={() => setId(d.id)}>
                    <bdi>{d.number}</bdi>
                  </button>
                ),
              },
              {
                key: "party",
                label: "Party",
                render: (d) => (
                  <>
                    <strong>
                      {d.customer || d.supplier
                        ? name(d.customer || d.supplier)
                        : tr("Internal")}
                    </strong>
                    <small>{name(d.branch)}</small>
                  </>
                ),
              },
              {
                key: "date",
                label: "Date",
                render: (d) => <bdi>{date(d.documentDate)}</bdi>,
              },
              {
                key: "status",
                label: "Status",
                render: (d) => <Status value={d.status} />,
              },
              {
                key: "total",
                label: "Total",
                numeric: true,
                render: (d) => (
                  <strong>{money(d.totalMinor, d.currency)}</strong>
                ),
              },
              {
                key: "source",
                label: "Source",
                render: (d) =>
                  d.sourceDocument ? (
                    <Link
                      href={`${routeForDocumentType(d.sourceDocument.type)}?document=${d.sourceDocument.id}`}
                    >
                      {d.sourceDocument.number}
                    </Link>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "actions",
                label: "Actions",
                render: (d) => (
                  <Button className="small" onClick={() => setId(d.id)}>
                    {tr("View")}
                  </Button>
                ),
              },
            ]}
          />
          <Pagination
            page={page}
            total={state.data?.pagination?.total ?? rows.length}
            onPage={setPage}
          />
        </Resource>
      </Panel>
    </>
  );
}
export function DocumentDetail({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const {
    tr,
    allowed,
    field,
    user,
    refs,
    name,
    money,
    quantity,
    date,
    dateTime,
    request,
    notify,
    download,
  } = useERP();
  const state = useResource(`/documents/${id}`);
  const d = state.data;
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("Document details");
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const router = useRouter();
  if (editing && d)
    return (
      <DocumentEditor
        type={d.type}
        existing={d}
        close={() => setEditing(false)}
        saved={() => {
          setEditing(false);
          state.reload();
        }}
      />
    );
  const allow = (action: string) =>
    d && allowed(`${resources[d.type]}.${action}`);
  const sales = d?.type && resources[d.type]?.startsWith("sales.");
  const attach =
    allowed("system.super_admin") ||
    (field("attachment", "metadata") !== "HIDDEN" &&
      user.dataScopes?.some(
        (s: any) => s.resource === "attachment" && s.scope !== "NONE",
      ));
  const tabs = [
    "Document details",
    "Accounting effect",
    "Inventory effect",
    "Terms",
    "Approvals",
    "Activity",
    ...(attach ? ["Attachments"] : []),
  ];
  const actor = (r: any) => name(r.actor || r.user);
  const isMaker =
    d && String(d.submittedById || "") === String(user.userId || "");
  const act = async (comment: string) => {
    await request(`/documents/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    });
    notify(`${d.number}: ${action} completed`);
    state.reload();
  };
  return (
    <Resource state={state}>
      {d ? (
        <>
          <PageHeader
            title={d.number}
            subtitle={`${tr(d.type)} · ${d.customer || d.supplier ? name(d.customer || d.supplier) : tr("Internal")}`}
            back={close}
          >
            <Status value={d.status} />
            {d.editState?.editable && allow("edit") ? (
              <Button onClick={() => setEditing(true)}>{tr("Edit")}</Button>
            ) : null}
            {allow("print") ? (
              <Button
                onClick={() =>
                  download(`/documents/${id}/pdf`, `${d.number}.pdf`).catch(
                    (e: any) => notify(e.message, true),
                  )
                }
              >
                <Download size={15} />
                {tr("Print / PDF")}
              </Button>
            ) : null}
            {["DRAFT", "REJECTED"].includes(d.status) &&
            allow("edit") &&
            !(sales && d.type === "QUOTATION" && d.status === "DRAFT") ? (
              <Button primary onClick={() => setAction("submit")}>
                {tr("Submit for approval")}
              </Button>
            ) : null}
            {d.status === "SUBMITTED" && !isMaker && allow("approve") ? (
              <Button primary onClick={() => setAction("approve")}>
                {tr("Approve")}
              </Button>
            ) : null}
            {d.status === "SUBMITTED" && !isMaker && allow("reject") ? (
              <Button danger onClick={() => setAction("reject")}>
                {tr("Reject")}
              </Button>
            ) : null}
            {d.status === "SUBMITTED" &&
            !isMaker &&
            allowed("approvals.queue.edit") ? (
              <Button onClick={() => setAction("request-changes")}>
                {tr("Request Changes")}
              </Button>
            ) : null}
            {d.status === "SUBMITTED" && allowed("approvals.queue.history") ? (
              <Button onClick={() => setAction("comment")}>
                {tr("Add Comment")}
              </Button>
            ) : null}
            {d.status === "APPROVED" && allow("post") ? (
              <Button
                primary
                data-testid="post-document"
                onClick={() => setAction("post")}
              >
                {tr("Post effects")}
              </Button>
            ) : null}
            {((d.type === "QUOTATION" && d.status === "DRAFT") ||
              ["APPROVED", "POSTED"].includes(d.status)) &&
            allow("convert")
              ? (conversions[d.type] || [])
                  .filter((t) => !sales || allowed(`${resources[t]}.create`))
                  .map((t) => (
                    <Button
                      key={t}
                      data-testid={`convert-${t}`}
                      primary
                      onClick={() => setTarget(t)}
                    >
                      {tr("Convert to")} {tr(t)}
                    </Button>
                  ))
              : null}
          </PageHeader>
          {d.status === "SUBMITTED" && isMaker ? (
            <div className="notice" data-testid="approval-waiting">
              {tr("Awaiting approval from another authorized user")}
            </div>
          ) : null}
          {d.editState?.reason ? (
            <p className="muted" style={{ marginBottom: 16 }}>
              {tr(d.editState.reason)}
            </p>
          ) : null}
          <Panel>
            <Details
              values={[
                ["Party", name(d.customer || d.supplier)],
                ["Document date", date(d.documentDate)],
                ["Branch", name(d.branch)],
                ["Warehouse", name(d.warehouse)],
                ["Salesperson", name(d.salesEmployee)],
                ["Currency", d.currency],
                ["Due date", date(d.dueDate)],
                ["Total", money(d.totalMinor, d.currency)],
                ...(d.type === "SALES_INVOICE"
                  ? [
                      "paidMinor",
                      "returnedMinor",
                      "creditedMinor",
                      "netReceivableMinor",
                      "remainingMinor",
                    ].map(
                      (key, i) =>
                        [
                          [
                            "Paid",
                            "Returned",
                            "Credited",
                            "Net receivable",
                            "Remaining",
                          ][i],
                          money(d[key], d.currency),
                        ] as [string, any],
                    )
                  : []),
              ]}
            />
          </Panel>
          <Tabs tabs={tabs} value={tab} set={setTab} />
          {tab === "Document details" ? (
            <>
              <Panel>
                <Table
                  rows={d.lines}
                  columns={[
                    {
                      key: "item",
                      label: "Product",
                      render: (l) => (
                        <>
                          <bdi>{l.item?.sku}</bdi>
                          <small>{name(l.item)}</small>
                        </>
                      ),
                    },
                    { key: "description", label: "Description" },
                    ...(d.type === "STOCK_COUNT"
                      ? [
                          {
                            key: "system",
                            label: "System",
                            numeric: true,
                            render: (l: any) => quantity(l.systemQuantityMilli),
                          },
                          {
                            key: "count",
                            label: "Counted",
                            numeric: true,
                            render: (l: any) =>
                              quantity(l.countedQuantityMilli),
                          },
                        ]
                      : []),
                    {
                      key: "quantity",
                      label: d.type === "STOCK_COUNT" ? "Variance" : "Quantity",
                      numeric: true,
                      render: (l) => quantity(l.quantityMilli),
                    },
                    {
                      key: "price",
                      label: "Unit price",
                      numeric: true,
                      render: (l) => money(l.unitPriceMinor, d.currency),
                    },
                    {
                      key: "discount",
                      label: "Discount",
                      numeric: true,
                      render: (l) => money(l.discountMinor, d.currency),
                    },
                    {
                      key: "tax",
                      label: "Tax",
                      numeric: true,
                      render: (l) => money(l.taxMinor, d.currency),
                    },
                    {
                      key: "total",
                      label: "Line total",
                      numeric: true,
                      render: (l) => money(l.totalMinor, d.currency),
                    },
                  ]}
                />
              </Panel>
              <div className="document-bottom">
                <Panel title="Notes">
                  <div className="surface-body">
                    <p>
                      {field("document", "notes") === "HIDDEN"
                        ? tr("Restricted")
                        : d.notes || tr("No notes")}
                    </p>
                  </div>
                </Panel>
                <Panel title="Totals summary">
                  <div className="totals">
                    {[
                      ["Subtotal", d.subtotalMinor],
                      ["Discount", d.discountMinor],
                      ["VAT", d.taxMinor],
                      ["Total", d.totalMinor],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{tr(label)}</span>
                        <bdi>{money(value, d.currency)}</bdi>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </>
          ) : tab === "Accounting effect" ? (
            <Panel
              title={d.journalEntry?.number || "No general-ledger posting"}
            >
              {d.journalEntry ? (
                <Table
                  rows={d.journalEntry.lines || []}
                  columns={[
                    {
                      key: "account",
                      label: "Account",
                      render: (l) => `${l.account?.code} · ${name(l.account)}`,
                    },
                    { key: "description", label: "Description" },
                    {
                      key: "debit",
                      label: "Debit",
                      numeric: true,
                      render: (l) => money(l.debitMinor),
                    },
                    {
                      key: "credit",
                      label: "Credit",
                      numeric: true,
                      render: (l) => money(l.creditMinor),
                    },
                  ]}
                />
              ) : (
                <p className="surface-body">
                  {tr(d.accountingEffect || "No general-ledger posting")}
                </p>
              )}
            </Panel>
          ) : tab === "Inventory effect" ? (
            <Panel title="Perpetual inventory movements">
              <Table
                rows={d.stockMovements || []}
                columns={[
                  { key: "item", label: "Item", render: (l) => name(l.item) },
                  {
                    key: "warehouse",
                    label: "Warehouse",
                    render: (l) => name(l.warehouse),
                  },
                  {
                    key: "in",
                    label: "In",
                    numeric: true,
                    render: (l) => quantity(l.quantityInMilli),
                  },
                  {
                    key: "out",
                    label: "Out",
                    numeric: true,
                    render: (l) => quantity(l.quantityOutMilli),
                  },
                  ...(d.stockMovements?.some(
                    (m: any) => m.totalCostMinor !== undefined,
                  )
                    ? [
                        {
                          key: "cost",
                          label: "Cost",
                          numeric: true,
                          render: (l: any) => money(l.totalCostMinor),
                        },
                        {
                          key: "value",
                          label: "RunningValue",
                          numeric: true,
                          render: (l: any) => money(l.runningValueMinor),
                        },
                      ]
                    : []),
                ]}
              />
            </Panel>
          ) : tab === "Terms" ? (
            <Panel>
              <Details
                values={[
                  ["Currency", d.currency],
                  ["Exchange rate", decimal(d.exchangeRateMicros, 6)],
                  ["Rate date", date(d.exchangeRateDate)],
                  ["Payment terms", d.paymentTerms],
                  [
                    "Notes",
                    field("document", "notes") === "HIDDEN"
                      ? tr("Restricted")
                      : d.notes,
                  ],
                ]}
              />
            </Panel>
          ) : tab === "Attachments" ? (
            <Attachments
              documentId={id}
              canUpload={
                field("attachment", "metadata") === "EDIT" && allow("edit")
              }
            />
          ) : (
            <Panel title={tab}>
              <Table
                rows={
                  tab === "Approvals"
                    ? d.approvals || []
                    : [...(d.approvals || []), ...(d.audit || [])]
                }
                columns={[
                  {
                    key: "date",
                    label: "Timestamp",
                    render: (r) => dateTime(r.createdAt),
                  },
                  { key: "actor", label: "Actor", render: actor },
                  { key: "action", label: "Action" },
                  {
                    key: "comment",
                    label: "Comment",
                    render: (r) => r.comment || r.postingReference || "—",
                  },
                ]}
              />
            </Panel>
          )}
          <div className="document-chain">
            <strong>{tr("Related documents")}</strong>
            {[d.sourceDocument, ...(d.targetDocuments || [])]
              .filter(Boolean)
              .map((r: any) => (
                <Link
                  key={r.id}
                  href={`${routeForDocumentType(r.type)}?document=${r.id}`}
                >
                  <bdi>{r.number}</bdi> <ArrowRight size={14} />
                </Link>
              ))}
          </div>
          {action ? (
            <Confirm
              title={tr(action)}
              reason={action !== "post"}
              dangerous={action === "reject"}
              close={() => setAction("")}
              action={act}
            />
          ) : null}
          {target ? (
            <Conversion
              document={d}
              target={target}
              close={() => setTarget("")}
              converted={(r) => {
                setTarget("");
                router.push(`${routeForDocumentType(r.type)}?document=${r.id}`);
                state.reload();
              }}
            />
          ) : null}
        </>
      ) : null}
    </Resource>
  );
}
function Conversion({
  document: d,
  target,
  close,
  converted,
}: {
  document: any;
  target: string;
  close: () => void;
  converted: (r: any) => void;
}) {
  const { tr, refs, quantity, name, request } = useERP();
  const rows = d.lines.map((l: any) => ({
    ...l,
    remaining:
      BigInt(l.quantityMilli) -
      (l.targetLines || [])
        .filter(
          (t: any) => !["REJECTED", "CANCELLED"].includes(t.document?.status),
        )
        .reduce((s: bigint, t: any) => s + BigInt(t.quantityMilli), 0n),
  }));
  const [values, setValues] = useState<any>(
    Object.fromEntries(rows.map((l: any) => [l.id, decimal(l.remaining, 3)])),
  );
  const [context, setContext] = useState({
    warehouseId: d.warehouseId || refs.warehouses[0]?.id || "",
    supplierId: d.supplierId || refs.suppliers[0]?.id || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title={`${tr("Convert to")} ${tr(target)}`} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await request(`/documents/${d.id}/convert`, {
              method: "POST",
              body: JSON.stringify({
                targetType: target,
                documentDate: today(),
                warehouseId: context.warehouseId,
                supplierId:
                  target === "PURCHASE_RFQ" ? context.supplierId : undefined,
                lines: rows
                  .filter((l: any) => l.remaining > 0n)
                  .map((l: any) => ({
                    sourceLineId: l.id,
                    quantity: values[l.id],
                  })),
              }),
            });
            converted(r);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {tr(
            "Enter a quantity up to the remaining source quantity. The backend rejects over-conversion and preserves every source-line link.",
          )}
        </p>
        <Table
          rows={rows}
          columns={[
            { key: "item", label: "Item", render: (l) => name(l.item) },
            {
              key: "remaining",
              label: "Remaining",
              render: (l) => quantity(l.remaining),
            },
            {
              key: "quantity",
              label: "Convert now",
              render: (l) => (
                <input
                  aria-label={`${tr("Convert now")} ${l.item.sku}`}
                  disabled={l.remaining <= 0n}
                  dir="ltr"
                  inputMode="decimal"
                  value={values[l.id]}
                  onChange={(e) =>
                    setValues({ ...values, [l.id]: e.target.value })
                  }
                />
              ),
            },
          ]}
        />
        <Fields
          specs={[
            {
              key: "warehouseId",
              label: "Warehouse",
              options: refs.warehouses,
            },
            ...(target === "PURCHASE_RFQ"
              ? [
                  {
                    key: "supplierId",
                    label: "Supplier",
                    options: refs.suppliers,
                  },
                ]
              : []),
          ]}
          values={context}
          set={(k, v) => setContext({ ...context, [k]: v })}
        />
        {error ? <ErrorNotice message={error} /> : null}
        <div className="form-actions">
          <Button onClick={close}>{tr("Cancel")}</Button>
          <Button
            type="submit"
            primary
            busy={busy}
            disabled={!rows.some((l: any) => l.remaining > 0n)}
          >
            {tr("Create linked draft")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function Attachments({
  documentId,
  canUpload,
}: {
  documentId: string;
  canUpload: boolean;
}) {
  const { tr, request, download, notify } = useERP();
  const state = useResource(`/private-attachments?documentId=${documentId}`);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Attachments">
      {canUpload ? (
        <form
          className="toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            const data = new FormData();
            data.set("documentId", documentId);
            data.set("file", file);
            try {
              await request("/private-attachments/upload", {
                method: "POST",
                body: data,
              });
              setFile(null);
              state.reload();
              notify("Private attachment uploaded");
            } catch (e: any) {
              notify(e.message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            {tr("File")}
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </label>
          <Button type="submit" primary busy={busy} disabled={!file}>
            {tr("Upload")}
          </Button>
        </form>
      ) : null}
      <Resource state={state}>
        <Table
          rows={state.data || []}
          columns={[
            { key: "filename", label: "Name" },
            { key: "contentType", label: "Type" },
            {
              key: "sizeBytes",
              label: "Size",
              render: (r) =>
                `${Math.max(1, Math.ceil(Number(r.sizeBytes) / 1024))} KB`,
            },
            {
              key: "scanStatus",
              label: "Status",
              render: (r) => (
                <>
                  <Status value={r.scanStatus} />
                  {r.scanStatus === "NOT_CONFIGURED" ? (
                    <small>
                      {tr(
                        "Malware scanning is not configured. The file passed type and signature validation only.",
                      )}
                    </small>
                  ) : null}
                </>
              ),
            },
            {
              key: "download",
              label: "Actions",
              render: (r) => (
                <Button
                  onClick={async () => {
                    try {
                      const ticket = await request(
                        `/private-attachments/${r.id}/ticket`,
                        { method: "POST" },
                      );
                      await download(
                        `/private-attachments/${r.id}/download?ticket=${encodeURIComponent(ticket.ticket)}`,
                        r.filename,
                      );
                    } catch (e: any) {
                      notify(e.message, true);
                    }
                  }}
                >
                  {tr("Download")}
                </Button>
              ),
            },
          ]}
        />
      </Resource>
    </Panel>
  );
}
export function Approvals() {
  const { tr, name, money, dateTime } = useERP();
  const state = useResource("/approvals");
  const [id, setId] = useState("");
  const [search, setSearch] = useState("");
  if (id)
    return (
      <DocumentDetail
        id={id}
        close={() => {
          setId("");
          state.reload();
        }}
      />
    );
  return (
    <>
      <PageHeader
        title="Approval Inbox"
        subtitle="Review documents with the full context, history, and comments."
      />
      <Panel>
        <div className="toolbar">
          <SearchField
            value={search}
            onChange={setSearch}
            label="Search approval queue…"
          />
        </div>
        <Resource state={state}>
          <Table
            rows={(state.data?.documents || []).filter((d: any) =>
              [d.number, d.customer?.name, d.supplier?.name]
                .join(" ")
                .toLowerCase()
                .includes(search.toLowerCase()),
            )}
            columns={[
              {
                key: "number",
                label: "Document",
                render: (d) => (
                  <button className="link" onClick={() => setId(d.id)}>
                    {d.number}
                  </button>
                ),
              },
              {
                key: "party",
                label: "Party",
                render: (d) => name(d.customer || d.supplier),
              },
              {
                key: "requested",
                label: "Requested by",
                render: (d) => name(d.submittedBy),
              },
              {
                key: "submitted",
                label: "Submitted",
                render: (d) => dateTime(d.submittedAt),
              },
              {
                key: "total",
                label: "Total",
                numeric: true,
                render: (d) => money(d.totalMinor, d.currency),
              },
              {
                key: "action",
                label: "Actions",
                render: (d) => (
                  <Button primary className="small" onClick={() => setId(d.id)}>
                    {tr("Review")}
                  </Button>
                ),
              },
            ]}
          />
        </Resource>
      </Panel>
      {state.data?.journals?.length ? (
        <Panel title="Journal approvals">
          <Table
            rows={state.data.journals}
            columns={[
              {
                key: "number",
                label: "Number",
                render: (j) => (
                  <Link href={`/accounting/journals?journal=${j.id}`}>{j.number}</Link>
                ),
              },
              { key: "description", label: "Description" },
              {
                key: "status",
                label: "Status",
                render: (j) => <Status value={j.status} />,
              },
            ]}
          />
        </Panel>
      ) : null}
    </>
  );
}
