"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useERP, decimal, fixed, today } from "../core/erp-context";
import {defaultBranch} from '../core/ui-presentation';
import {
  PageHeader,
  Panel,
  Fields,
  type FieldSpec,
  Button,
  ErrorNotice,
  useUnsaved,
} from "../components/ui";
const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
export default function DocumentEditor({
  type,
  existing,
  customerId,
  close,
  saved,
}: {
  type: string;
  existing?: any;
  customerId?: string;
  close: () => void;
  saved: (d: any) => void;
}) {
  const { refs, request, notify, allowed, field, tr, money, name, user } = useERP();
  const sales = [
    "QUOTATION",
    "SALES_ORDER",
    "DELIVERY_NOTE",
    "SALES_INVOICE",
    "SALES_RETURN",
    "CREDIT_NOTE",
  ].includes(type);
  const purchase = type.startsWith("PURCHASE") || type === "GOODS_RECEIPT";
  const inventory = !sales && !purchase;
  const customer =
    refs.customers.find((c: any) => String(c.id) === String(customerId));
  const branch =
    refs.branches.find((b: any) => String(b.id) === String(defaultBranch(refs.branches,user,customer?.defaultBranchId)));
  const warehouses = refs.warehouses.filter((w:any)=>String(w.branchId)===String(branch?.id));
  const warehouse = warehouses.length===1?warehouses[0]:undefined;
  const [form, setForm] = useState<any>({
    customerId: customer?.id || "",
    supplierId: "",
    branchId: branch?.id || "",
    warehouseId: warehouse?.id || "",
    destinationWarehouseId: "",
    salespersonId: refs.salesEmployees.find((s:any)=>s.userId && String(s.userId)===String(user?.userId||user?.id))?.id || "",
    documentDate: today(),
    dueDate: sales
      ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      : "",
    currency: refs.tenant.baseCurrency,
    exchangeRate: "1.000000",
    exchangeRateDate: today(),
    manualExchangeRate: false,
    exchangeRateOverrideReason: "",
    priceOverrideReason: "",
    rateSource: "BASE_CURRENCY",
    taxMode: "EXCLUSIVE",
    priceList: tr(purchase ? "Standard purchase" : "Standard sales"),
    paymentTerms: sales ? "" : tr("30 days"),
    salesperson: "",
    deliveryTerms: "",
    notes: "",
    ...existing,
    ...(existing
      ? {
          documentDate: existing.documentDate.slice(0, 10),
          dueDate: existing.dueDate?.slice(0, 10) || "",
          exchangeRate: decimal(existing.exchangeRateMicros, 6),
        }
      : {}),
  });
  const newLine = () => ({
    itemId: "",
    description:
      type === "INVENTORY_ADJUSTMENT"
        ? "Increase"
        : type === "STOCK_COUNT"
          ? ""
          : "",
    quantity: "1.000",
    unitPrice: "",
    discount: "0.00",
    discountPercent: "0",
  });
  const [lines, setLines] = useState<any[]>(
    existing?.lines?.map((l: any) => ({
      itemId: l.itemId,
      description: l.description || "",
      quantity: decimal(l.quantityMilli, 3),
      unitPrice: decimal(l.unitPriceMinor),
      discount: decimal(l.discountMinor),
      discountPercent: "0",
    })) || [newLine()],
  );
  const [savedDraft, setSavedDraft] = useState<any>(null);
  const [employees, setEmployees] = useState(refs.salesEmployees || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  const set = (k: string, v: any) => {
    setDirty(true);
    setForm((f: any) => ({ ...f, [k]: v }));
  };
  useEffect(() => {
    if (!sales || existing) return;
    const controller = new AbortController();
    setEmployees([]);
    request(`/references/sales-employees?branchId=${form.branchId}`, {
      signal: controller.signal,
    })
      .then((rows: any[]) => {
        if (controller.signal.aborted) return;
        setEmployees(rows);
        setForm((f: any) => ({
          ...f,
          salespersonId: rows.some((r) => r.id === f.salespersonId)
            ? f.salespersonId
            : rows.find((r:any)=>r.userId && String(r.userId)===String(user?.userId||user?.id))?.id || "",
        }));
      })
      .catch((e: any) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    const valid = refs.warehouses.filter(
      (w: any) => w.branchId === form.branchId,
    );
    setForm((f: any) => ({
      ...f,
      warehouseId: valid.some((w: any) => w.id === f.warehouseId)
        ? f.warehouseId
        : valid.length === 1
          ? valid[0].id
          : "",
    }));
    return () => controller.abort();
  }, [form.branchId, sales, existing, request, refs.warehouses]);
  useEffect(() => {
    if (!sales || existing) return;
    if (form.currency === refs.tenant.baseCurrency) {
      setForm((f: any) => ({
        ...f,
        exchangeRate: "1.000000",
        exchangeRateDate: f.documentDate,
        rateSource: "BASE_CURRENCY",
        manualExchangeRate: false,
        exchangeRateOverrideReason: "",
      }));
      return;
    }
    if (form.manualExchangeRate) return;
    const controller = new AbortController();
    setForm((f: any) => ({ ...f, exchangeRate: "", rateSource: "MISSING" }));
    request(
      `/exchange-rates?currency=${form.currency}&date=${form.documentDate}`,
      { signal: controller.signal },
    )
      .then((r: any) => {
        if (!controller.signal.aborted)
          setForm((f: any) => ({
            ...f,
            exchangeRate: r.rate,
            exchangeRateDate: r.rateDate.slice(0, 10),
            rateSource: r.source,
          }));
      })
      .catch((e: any) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [
    form.currency,
    form.documentDate,
    form.manualExchangeRate,
    refs.tenant.baseCurrency,
    sales,
    existing,
    request,
  ]);
  const rate = fixed(form.exchangeRate, 6) || 1000000n;
  const defaultMinor = (item: any) => {
    const p = BigInt(
      (purchase ? item?.purchasePriceMinor : item?.salePriceMinor) || 0,
    );
    return sales && form.currency !== refs.tenant.baseCurrency
      ? round(p * 1000000n, rate)
      : p;
  };
  const calculations = lines.map((l) => {
    const item = refs.items.find((i: any) => i.id === l.itemId);
    const known =
      l.unitPrice !== "" ||
      (purchase ? item?.purchasePriceMinor : item?.salePriceMinor) != null;
    const price = l.unitPrice !== "" ? fixed(l.unitPrice) : defaultMinor(item);
    const gross = round(fixed(l.quantity, 3) * price, 1000n);
    const discount =
      sales && !existing
        ? round(gross * fixed(l.discountPercent), 10000n)
        : fixed(l.discount);
    const charged = gross - discount;
    const taxRate = BigInt(item?.taxRateBps || 0);
    const net =
      form.taxMode === "INCLUSIVE"
        ? round(charged * 10000n, 10000n + taxRate)
        : charged;
    const tax =
      form.taxMode === "EXEMPT"
        ? 0n
        : form.taxMode === "INCLUSIVE"
          ? charged - net
          : round(net * taxRate, 10000n);
    return { item, known, price, gross, discount, net, tax, total: net + tax };
  });
  const totalsKnown = calculations.every((line) => line.known);
  const totals = calculations.reduce(
    (sum, l) => ({
      net: sum.net + l.net,
      discount: sum.discount + l.discount,
      tax: sum.tax + l.tax,
      total: sum.total + l.total,
    }),
    { net: 0n, discount: 0n, tax: 0n, total: 0n },
  );
  const override =
    sales &&
    !existing &&
    calculations.some(
      (c, i) => lines[i].unitPrice !== "" && c.price !== defaultMinor(c.item),
    );
  const update = (i: number, k: string, v: string) => {
    setDirty(true);
    setLines((rows) =>
      rows.map((l, j) =>
        i === j
          ? {
              ...l,
              [k]: v,
              ...(k === "itemId"
                ? {
                    description:
                      type === "INVENTORY_ADJUSTMENT"
                        ? "Increase"
                        : type === "STOCK_COUNT"
                          ? ""
                          : refs.items.find((x: any) => x.id === v)?.name || "",
                    unitPrice: "",
                  }
                : {}),
            }
          : l,
      ),
    );
  };
  const spec = (key: string, label: string, options: any = {}) => ({
    key,
    label,
    ...options,
  });
  const context: FieldSpec[] = [
    ...(sales
      ? [
          spec("customerId", "Customer", {
            options: refs.customers,
            required: true,
          }),
        ]
      : purchase && type !== "PURCHASE_REQUEST"
        ? [
            spec("supplierId", "Supplier", {
              options: refs.suppliers,
              required: true,
            }),
          ]
        : []),
    spec("branchId", "Branch", { options: refs.branches, required: true }),
    spec("warehouseId", "Warehouse", {
      options: [
        { value: "", label: "Select warehouse" },
        ...refs.warehouses.filter(
          (w: any) => !sales || w.branchId === form.branchId,
        ),
      ],
      required: true,
    }),
    ...(type === "WAREHOUSE_TRANSFER"
      ? [
          spec("destinationWarehouseId", "Destination warehouse", {
            options: refs.warehouses,
            required: true,
          }),
        ]
      : []),
    ...(sales
      ? [
          spec("salespersonId", "Salesperson", {
            options: employees,
            required: true,
          }),
        ]
      : []),
  ].map((f) => ({ ...f, readOnly: !!existing }));
  const commercial: FieldSpec[] = [
    spec("documentDate", "Document date", { type: "date", required: true }),
    spec("dueDate", type === "QUOTATION" ? "Valid until" : "Due date", {
      type: "date",
    }),
    spec("currency", "Currency", {
      options: refs.currencies.map((c: any) => ({
        value: c.code,
        label: c.code,
      })),
      required: true,
      readOnly: !!existing,
    }),
    spec("exchangeRate", "Exchange rate", {
      type: "decimal",
      required: true,
      readOnly: !!existing || (sales && !form.manualExchangeRate),
    }),
    spec("taxMode", "Tax mode", {
      options: ["EXCLUSIVE", "INCLUSIVE", "EXEMPT"],
      readOnly: !!existing,
    }),
    ...(sales && !existing
      ? [
          spec("manualExchangeRate", "Override system exchange rate", {
            type: "checkbox",
            readOnly: form.currency === refs.tenant.baseCurrency,
          }),
          spec("exchangeRateDate", "Rate date", {
            type: "date",
            readOnly: !form.manualExchangeRate,
          }),
          ...(form.manualExchangeRate
            ? [
                spec(
                  "exchangeRateOverrideReason",
                  "Exchange rate override reason",
                  { required: true, wide: true },
                ),
              ]
            : []),
        ]
      : []),
    ...(!sales
      ? [spec("priceList", "Price list"), spec("salesperson", "Salesperson")]
      : []),
  ];
  async function persist(e: FormEvent, submit = false) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (
      !lines.length ||
      lines.some(
        (l) => fixed(l.quantity, 3) < (type === "STOCK_COUNT" ? 0n : 1n),
      )
    ) {
      setError(tr("Every product line needs a quantity greater than zero."));
      return;
    }
    if (override && !form.priceOverrideReason.trim()) {
      setError(
        tr("Explain why the standard selling price is being overridden."),
      );
      return;
    }
    if (sales && fixed(form.exchangeRate, 6) <= 0n) {
      setError(tr("A valid exchange rate is required."));
      return;
    }
    setBusy(true);
    const converted = lines.map((l, i) => ({
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity,
      ...(type === "STOCK_COUNT" ? { countedQuantity: l.quantity } : {}),
      unitPrice: sales
        ? decimal(calculations[i].price)
        : l.unitPrice || undefined,
      discount: decimal(calculations[i].discount),
      ...(sales ? { taxRateBps: calculations[i].item?.taxRateBps } : {}),
    }));
    const body: any = existing
      ? {
          documentDate: form.documentDate,
          dueDate: form.dueDate,
          paymentTerms: form.paymentTerms,
          priceOverrideReason: form.priceOverrideReason,
          lines: converted,
        }
      : {
          type,
          branchId: form.branchId,
          warehouseId: form.warehouseId,
          destinationWarehouseId:
            type === "WAREHOUSE_TRANSFER"
              ? form.destinationWarehouseId
              : undefined,
          customerId: sales ? form.customerId : undefined,
          supplierId:
            purchase && type !== "PURCHASE_REQUEST"
              ? form.supplierId
              : undefined,
          salespersonId: sales ? form.salespersonId : undefined,
          documentDate: form.documentDate,
          dueDate: form.dueDate || undefined,
          currency: form.currency,
          exchangeRate: form.exchangeRate,
          manualExchangeRate: sales ? !!form.manualExchangeRate : undefined,
          exchangeRateDate: sales ? form.exchangeRateDate : undefined,
          exchangeRateOverrideReason: form.exchangeRateOverrideReason,
          priceOverrideReason: form.priceOverrideReason,
          priceList: form.priceList,
          paymentTerms: form.paymentTerms,
          salesperson: form.salesperson,
          taxMode: form.taxMode,
          lines: converted,
        };
    if (field("document", "notes") === "EDIT")
      body.notes = [form.deliveryTerms, form.notes].filter(Boolean).join("\n");
    try {
      const currentId = existing?.id || savedDraft?.id;
      const result = await request(
        currentId ? `/documents/${currentId}` : "/documents",
        { method: currentId ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setSavedDraft(result);
      setDirty(false);
      if (submit)
        await request(`/documents/${result.id}/submit`, {
          method: "POST",
          body: JSON.stringify({ comment: "Submitted from document review." }),
        });
      notify(
        `${result.number} ${submit ? "submitted for approval" : "saved as draft"}`,
      );
      saved(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title={
          existing
            ? `${tr("Edit")} ${existing.number}`
            : `${tr("New")} ${tr(type)}`
        }
        back={() => guard(close)}
        subtitle="Document details, product lines and commercial terms"
      />
      <form onSubmit={persist}>
        <Panel>
          <div className="form-section">
            <h2>{tr("Document information")}</h2>
            <Fields
              specs={context}
              values={form}
              set={(k, v) => {
                set(k, v);
                if (k === "customerId") {
                  const c = refs.customers.find((c: any) => c.id === v);
                  if (c?.defaultBranchId) set("branchId", c.defaultBranchId);
                  if (!form.paymentTerms && c?.paymentTermsDays != null)
                    set("paymentTerms", `${c.paymentTermsDays} days`);
                }
              }}
            />
          </div>
          <div className="form-section">
            <Fields specs={commercial} values={form} set={set} />
          </div>
        </Panel>
        <Panel title="Document lines">
          <div className="table-region">
            <table className="line-table">
              <thead>
                <tr>
                  {[
                    "Product",
                    "Description",
                    type === "STOCK_COUNT" ? "Counted" : "Quantity",
                    "Unit price",
                    sales && !existing ? "Discount %" : "Discount",
                    "Tax",
                    "Line total",
                    "Actions",
                  ].map((c, i) => (
                    <th key={i}>{tr(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        aria-label={`${tr("Product")} ${i + 1}`}
                        value={l.itemId}
                        onChange={(e) => update(i, "itemId", e.target.value)}
                      >
                        <option value="">{tr('Select product')}</option>
                        {refs.items.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.sku} · {name(item)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {type === "INVENTORY_ADJUSTMENT" ? (
                        <select
                          aria-label={`${tr("Adjustment direction")} ${i + 1}`}
                          value={l.description}
                          onChange={(e) =>
                            update(i, "description", e.target.value)
                          }
                        >
                          <option value="Increase">{tr("Increase")}</option>
                          <option value="Decrease">{tr("Decrease")}</option>
                        </select>
                      ) : (
                        <input
                          aria-label={`${tr("Description")} ${i + 1}`}
                          value={l.description}
                          readOnly={type === "STOCK_COUNT"}
                          onChange={(e) =>
                            update(i, "description", e.target.value)
                          }
                        />
                      )}
                    </td>
                    <td>
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`${tr(type === "STOCK_COUNT" ? "Counted" : "Quantity")} ${i + 1}`}
                        value={l.quantity}
                        onChange={(e) => update(i, "quantity", e.target.value)}
                        required
                      />
                    </td>
                    <td>
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`${tr("Unit price")} ${i + 1}`}
                        value={l.unitPrice}
                        placeholder={
                          calculations[i].known
                            ? decimal(defaultMinor(calculations[i].item))
                            : tr("Restricted")
                        }
                        readOnly={sales && !allowed("sales.price.edit")}
                        onChange={(e) => update(i, "unitPrice", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        aria-label={`${tr(sales && !existing ? "Discount %" : "Discount")} ${i + 1}`}
                        value={
                          sales && !existing ? l.discountPercent : l.discount
                        }
                        onChange={(e) =>
                          update(
                            i,
                            sales && !existing ? "discountPercent" : "discount",
                            e.target.value,
                          )
                        }
                      />
                    </td>
                    <td className="numeric">
                      {money(
                        calculations[i].known ? calculations[i].tax : undefined,
                        form.currency,
                      )}
                    </td>
                    <td className="numeric">
                      {money(
                        calculations[i].known
                          ? calculations[i].total
                          : undefined,
                        form.currency,
                      )}
                    </td>
                    <td>
                      <Button
                        aria-label={`${tr("Remove line")} ${i + 1}`}
                        disabled={lines.length <= 1}
                        onClick={() => {
                          setDirty(true);
                          setLines((rows) => rows.filter((_, j) => i !== j));
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="surface-body">
            <Button
              onClick={() => {
                setDirty(true);
                setLines((rows) => [...rows, newLine()]);
              }}
            >
              <Plus size={16} />
              {tr("Add line")}
            </Button>
          </div>
        </Panel>
        <div className="document-bottom">
          <Panel title="Notes and terms">
            <div className="surface-body">
              <Fields
                specs={[
                  spec("paymentTerms", "Payment terms", {
                    type: "textarea",
                    wide: true,
                  }),
                  ...(field("document", "notes") === "EDIT"
                    ? [spec("notes", "Notes", { type: "textarea", wide: true })]
                    : []),
                  ...(sales && allowed("sales.price.edit")
                    ? [
                        spec("priceOverrideReason", "Price override reason", {
                          required: override,
                          wide: true,
                        }),
                      ]
                    : []),
                ]}
                values={form}
                set={set}
              />
            </div>
          </Panel>
          <Panel title="Totals summary">
            <div className="totals">
              <div>
                <span>{tr("Net")}</span>
                <bdi>
                  {money(totalsKnown ? totals.net : undefined, form.currency)}
                </bdi>
              </div>
              <div>
                <span>{tr("Discount")}</span>
                <bdi>
                  {money(
                    totalsKnown ? totals.discount : undefined,
                    form.currency,
                  )}
                </bdi>
              </div>
              <div>
                <span>{tr("VAT")}</span>
                <bdi>
                  {money(totalsKnown ? totals.tax : undefined, form.currency)}
                </bdi>
              </div>
              <div>
                <span>{tr("Total")}</span>
                <bdi>
                  {money(totalsKnown ? totals.total : undefined, form.currency)}
                </bdi>
              </div>
            </div>
          </Panel>
        </div>
        {error ? <ErrorNotice message={error} /> : null}
        <footer className="editor-footer">
          <span>{tr("Draft")}</span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button
              type="submit"
              primary
              busy={busy}
              data-testid="save-document"
            >
              {tr(existing ? "Save changes" : "Save draft")}
            </Button>
            {sales && !existing ? (
              <Button
                type="submit"
                busy={busy}
                onClick={(e) => {
                  const f = e.currentTarget.form;
                  if (f?.reportValidity()) void persist(e, true);
                  else e.preventDefault();
                }}
              >
                {tr("Save & submit")}
              </Button>
            ) : null}
          </div>
        </footer>
      </form>
    </>
  );
}
