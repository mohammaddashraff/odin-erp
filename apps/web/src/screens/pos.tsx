"use client";
import {defaultBranch} from "../core/ui-presentation";
import { useRef, useState } from "react";
import { Plus, Minus, Trash2 } from "lucide-react";
import { useERP, useResource, decimal, fixed } from "../core/erp-context";
import {
  PageHeader,
  Panel,
  Table,
  Resource,
  Button,
  SearchField,
  Status,
  Fields,
  Confirm,
  Details,
  useUnsaved,
} from "../components/ui";
import { FormPage } from "./finance";
export default function Pos() {
  const {
    tr,
    refs,
    user,
    request,
    name,
    money,
    dateTime,
    notify,
    download,
    allowed,
  } = useERP();
  const state = useResource("/pos");
  const data = state.data;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    customerId: "",
    discountPercent: "0",
    CASH: "0.00",
    CARD: "0.00",
    BANK: "0.00",
  });
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState("");
  const [action, setAction] = useState<any>(null);
  const shift = data?.shifts.find((s: any) => s.status === "OPEN");
  const add = (id: string, delta = 1) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + delta) }));
  const lines = refs.items
    .filter((i: any) => cart[i.id])
    .map((item: any) => {
      const gross = BigInt(item.salePriceMinor) * BigInt(cart[item.id]);
      const discount = (gross * fixed(form.discountPercent) + 5000n) / 10000n;
      const net = gross - discount;
      const tax = (net * BigInt(item.taxRateBps) + 5000n) / 10000n;
      return { item, quantity: cart[item.id], discount, total: net + tax };
    });
  const guard = useUnsaved(lines.length > 0);
  const showShiftForm = (nextMode: string) =>
    guard(() => {
      setCart({});
      setForm((f) => ({ ...f, CASH: "0.00", CARD: "0.00", BANK: "0.00" }));
      setMode(nextMode);
    });
  const total = lines.reduce((s: bigint, l: any) => s + l.total, 0n);
  async function checkout(hold = false) {
    if (!shift || busy) return;
    setBusy(hold ? "hold" : "checkout");
    try {
      const sale = await request("/pos/sales", {
        method: "POST",
        body: JSON.stringify({
          shiftId: shift.id,
          customerId: form.customerId || undefined,
          hold,
          lines: lines.map((l: any) => ({
            itemId: l.item.id,
            quantity: `${l.quantity}.000`,
            discount: decimal(l.discount),
          })),
          tenders: ["CASH", "CARD", "BANK"]
            .filter((m) => fixed((form as any)[m]) > 0n)
            .map((method) => ({ method, amount: (form as any)[method] })),
        }),
      });
      setCart({});
      setForm((f) => ({ ...f, CASH: "0.00", CARD: "0.00", BANK: "0.00" }));
      state.reload();
      notify(
        `${sale.number} ${hold ? "held for resume" : "completed with stock and journal effects"}`,
      );
    } catch (e: any) {
      notify(e.message, true);
    } finally {
      setBusy("");
    }
  }
  const saved = () => {
    setMode("");
    state.reload();
    notify("Action completed");
  };
  if (mode === "open") {
    const branchId=defaultBranch(refs.branches,user);
    const warehouses=refs.warehouses.filter((w:any)=>String(w.branchId)===String(branchId));
    const wh=warehouses.length===1?warehouses[0]:undefined;
    return (
      <FormPage
        title="Open register shift"
        close={() => setMode("")}
        defaults={{
          branchId,
          warehouseId: wh?.id || "",
          registerCode: "",
          openingCash: "",
        }}
        specs={[
          {
            key: "branchId",
            label: "Branch",
            options: refs.branches,
            required: true,
          },
          {
            key: "warehouseId",
            label: "Warehouse",
            options: refs.warehouses,
            required: true,
          },
          { key: "registerCode", label: "Register", required: true },
          {
            key: "openingCash",
            label: "Opening",
            type: "decimal",
            required: true,
          },
        ]}
        submitLabel="Open register shift"
        submit={async (d) => {
          await request("/pos/shifts", {
            method: "POST",
            body: JSON.stringify(d),
          });
          saved();
        }}
      />
    );
  }
  if (mode === "close" && shift)
    return (
      <FormPage
        title="Close shift"
        close={() => setMode("")}
        defaults={{ actualCash: decimal(shift.expectedCashMinor) }}
        specs={[
          {
            key: "actualCash",
            label: "Count actual closing cash",
            type: "decimal",
            required: true,
          },
        ]}
        submitLabel="Close shift"
        submit={async (d) => {
          const r = await request(`/pos/shifts/${shift.id}/close`, {
            method: "POST",
            body: JSON.stringify(d),
          });
          notify(`${tr("Difference")}: ${money(r.differenceMinor)}`);
          saved();
        }}
      />
    );
  return (
    <>
      <PageHeader
        title="Point of sale"
        subtitle="Shift control, held carts, split tenders, perpetual stock and same-transaction journals"
      >
        {shift ? (
          <>
            <Status value="OPEN" />
            <span>
              <bdi>{shift.registerCode}</bdi>
            </span>
            <Button danger onClick={() => showShiftForm("close")}>
              {tr("Close shift")}
            </Button>
          </>
        ) : (
          <Button primary onClick={() => showShiftForm("open")}>
            {tr("Open register shift")}
          </Button>
        )}
      </PageHeader>
      <Resource state={state}>
        {data ? (
          <>
            <div className="pos-columns">
              <Panel title="PRODUCT CATALOG">
                <div
                  className="toolbar"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const item = refs.items.find(
                        (i: any) =>
                          i.barcode === search.trim() ||
                          i.sku === search.trim(),
                      );
                      if (item) {
                        e.preventDefault();
                        add(item.id);
                        setSearch("");
                      }
                    }
                  }}
                >
                  <SearchField
                    label="Search or scan barcode…"
                    value={search}
                    onChange={setSearch}
                  />
                </div>
                <div className="product-list">
                  {refs.items
                    .filter((i: any) =>
                      [i.sku, i.barcode, i.name, i.nameAr]
                        .join(" ")
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((i: any) => (
                      <button key={i.id} onClick={() => add(i.id)}>
                        <strong>{name(i)}</strong>
                        <span>
                          <bdi>{money(i.salePriceMinor)}</bdi>
                        </span>
                        <small>
                          <bdi>{i.sku}</bdi> · {tr("VAT")} {i.taxRateBps / 100}%
                        </small>
                      </button>
                    ))}
                </div>
              </Panel>
              <Panel title="ACTIVE CART">
                {lines.length ? (
                  lines.map((l: any) => (
                    <div className="cart-line" key={l.item.id}>
                      <div>
                        <strong>{name(l.item)}</strong>
                        <small>
                          <bdi>{money(l.total)}</bdi>
                        </small>
                      </div>
                      <div className="quantity-actions">
                        <Button
                          className="small"
                          aria-label={tr("Decrease quantity")}
                          onClick={() => add(l.item.id, -1)}
                        >
                          <Minus size={13} />
                        </Button>
                        <bdi>{l.quantity}</bdi>
                        <Button
                          className="small"
                          aria-label={tr("Increase quantity")}
                          onClick={() => add(l.item.id)}
                        >
                          <Plus size={13} />
                        </Button>
                        <Button
                          className="small"
                          aria-label={tr("Remove line")}
                          onClick={() =>
                            setCart((c) => ({ ...c, [l.item.id]: 0 }))
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty">{tr("Cart is empty")}</p>
                )}
                <div className="cart-form">
                  <Fields
                    specs={[
                      {
                        key: "customerId",
                        label: "Customer",
                        options: [
                          { value: "", label: "Walk-in customer" },
                          ...refs.customers,
                        ],
                      },
                      {
                        key: "discountPercent",
                        label: "Discount %",
                        type: "number",
                        min: "0",
                        max: "20",
                      },
                    ]}
                    values={form}
                    set={(k, v) => setForm({ ...form, [k]: v })}
                  />
                  <Details values={[["Total including VAT", money(total)]]} />
                  <div className="actions" style={{ marginBottom: 18 }}>
                    <Button
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          CASH: decimal(total),
                          CARD: "0.00",
                          BANK: "0.00",
                        }))
                      }
                    >
                      {tr("Exact cash")}
                    </Button>
                    <Button
                      data-testid="split-tender"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          CASH: decimal(total / 2n),
                          CARD: decimal(total - total / 2n),
                          BANK: "0.00",
                        }))
                      }
                    >
                      {tr("Split 50 / 50")}
                    </Button>
                  </div>
                  <Fields
                    specs={["CASH", "CARD", "BANK"].map((key) => ({
                      key,
                      label: key,
                      type: "decimal",
                    }))}
                    values={form}
                    set={(k, v) => setForm({ ...form, [k]: v })}
                  />
                  <div className="form-actions">
                    <Button
                      disabled={!shift || !lines.length || !!busy}
                      busy={busy === "hold"}
                      onClick={() => checkout(true)}
                    >
                      {tr("Hold")}
                    </Button>
                    <Button
                      primary
                      data-testid="pos-checkout"
                      disabled={!shift || !lines.length || !!busy}
                      busy={busy === "checkout"}
                      onClick={() => checkout()}
                    >
                      {tr("Complete split tender")}
                    </Button>
                  </div>
                </div>
              </Panel>
            </div>
            <Panel title="Shift and sale history">
              <Table
                rows={data.sales}
                columns={[
                  { key: "number", label: "Sale" },
                  {
                    key: "status",
                    label: "Status",
                    render: (s) => <Status value={s.status} />,
                  },
                  {
                    key: "shift",
                    label: "Shift",
                    render: (s) => <bdi>{s.shift?.registerCode}</bdi>,
                  },
                  {
                    key: "total",
                    label: "Total",
                    numeric: true,
                    render: (s) => money(s.totalMinor),
                  },
                  {
                    key: "tenders",
                    label: "Tenders",
                    render: (s) =>
                      s.tenders
                        ?.map(
                          (t: any) => `${tr(t.method)} ${money(t.amountMinor)}`,
                        )
                        .join(" + ") || tr("Held"),
                  },
                  {
                    key: "journal",
                    label: "Journal",
                    render: (s) => s.journalEntry?.number || "—",
                  },
                  {
                    key: "action",
                    label: "Actions",
                    render: (s) => (
                      <div className="actions">
                        {s.status !== "HELD" ? (
                          <Button
                            className="small"
                            onClick={() =>
                              download(
                                `/pos/sales/${s.id}/pdf`,
                                `${s.number}.pdf`,
                              ).catch((e: any) => notify(e.message, true))
                            }
                          >
                            {tr("Receipt")}
                          </Button>
                        ) : (
                          <Button
                            className="small"
                            onClick={() =>
                              setAction({ sale: s, type: "resume" })
                            }
                          >
                            {tr("Resume")}
                          </Button>
                        )}
                        {s.status === "COMPLETED" ? (
                          <Button
                            className="small"
                            onClick={() =>
                              setAction({ sale: s, type: "return" })
                            }
                          >
                            {tr("Return")}
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </Panel>
            <Panel title="POS shift closing report">
              <Table
                rows={data.shifts}
                columns={[
                  { key: "registerCode", label: "Register" },
                  {
                    key: "status",
                    label: "Status",
                    render: (s) => <Status value={s.status} />,
                  },
                  {
                    key: "openedAt",
                    label: "Opened",
                    render: (s) => dateTime(s.openedAt),
                  },
                  {
                    key: "closedAt",
                    label: "Closed",
                    render: (s) => dateTime(s.closedAt),
                  },
                  ...[
                    "openingCashMinor",
                    "expectedCashMinor",
                    "actualCashMinor",
                    "differenceMinor",
                  ].map((key, i) => ({
                    key,
                    label: ["Opening", "Expected", "Actual", "Difference"][i],
                    numeric: true,
                    render: (s: any) => money(s[key]),
                  })),
                ]}
              />
            </Panel>
          </>
        ) : null}
      </Resource>
      {action ? (
        <Confirm
          title={action.type === "return" ? "Return" : "Resume"}
          reason={action.type === "return"}
          close={() => setAction(null)}
          action={async (reason) => {
            await request(`/pos/sales/${action.sale.id}/${action.type}`, {
              method: "POST",
              body: JSON.stringify(
                action.type === "return"
                  ? { reason }
                  : {
                      tenders: [
                        {
                          method: "CASH",
                          amount: decimal(action.sale.totalMinor),
                        },
                      ],
                    },
              ),
            });
            state.reload();
            notify("Action completed");
          }}
        />
      ) : null}
    </>
  );
}
