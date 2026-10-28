"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useERP, useResource, decimal } from "../core/erp-context";
import { routeForDocumentType } from "../core/navigation";
import {
  PageHeader,
  Panel,
  Table,
  Resource,
  SearchField,
  Fields,
  type FieldSpec,
  Button,
  AddButton,
  Pagination,
  Status,
  Tabs,
  Details,
  useUnsaved,
  ErrorNotice,
} from "../components/ui";
const collections: any = {
  supplier: "suppliers",
  item: "items",
  category: "categories",
  unit: "units",
  warehouse: "warehouses",
  bank: "bankAccounts",
  account: "accounts",
};
const permissions: any = {
  customer: "sales.customer.create",
  supplier: "purchasing.supplier.create",
  item: "inventory.item.create",
  category: "inventory.item.create",
  unit: "inventory.item.create",
  warehouse: "inventory.warehouse.create",
  bank: "banking.account.create",
};
const endpoints: any = {
  customer: "customers",
  supplier: "suppliers",
  item: "items",
  category: "categories",
  unit: "units",
  warehouse: "warehouses",
  bank: "bank-accounts",
};
export default function Masters({
  kind,
  title,
}: {
  kind: string;
  title: string;
}) {
  const { tr, refs, allowed, name, money, quantity } = useERP();
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState({ status: "ACTIVE", branchId: "" });
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState(
    params.get("new") === "1" ? "create" : "list",
  );
  const [selected, setSelected] = useState(params.get("customer") || "");
  const search = new URLSearchParams({
    page: String(page),
    pageSize: "15",
    search: query,
    ...filter,
  });
  const remote = useResource(
    kind === "customer"
      ? `/sales/customers?${search}`
      : kind === "employee"
        ? `/hr/employees?${search}`
        : null,
  );
  const all =
    kind === "customer"
      ? remote.data?.rows || []
      : kind === "employee"
        ? remote.data || []
        : refs[collections[kind]] || [];
  const rows =
    kind === "customer" || kind === "employee"
      ? all
      : all.filter((r: any) =>
          [r.name, r.nameAr, r.code, r.sku, r.barcode, r.city]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        );
  const clear = () => {
    setMode("list");
    setSelected("");
    router.replace(window.location.pathname);
  };
  if (mode === "create" && allowed(permissions[kind]))
    return (
      <MasterEditor
        kind={kind}
        close={clear}
        saved={(r: any) => {
          remote.reload();
          clear();
          if (kind === "customer") setSelected(r.id);
        }}
      />
    );
  if (selected && kind === "customer")
    return <CustomerDetail id={selected} close={clear} />;
  const columns: any[] = [
    {
      key: "code",
      label: kind === "item" ? "SKU" : "Code",
      render: (r: any) =>
        kind === "customer" ? (
          <button className="link" onClick={() => setSelected(r.id)}>
            <bdi>{r.code}</bdi>
          </button>
        ) : (
          <bdi>{r.code || r.sku}</bdi>
        ),
    },
    {
      key: "name",
      label: "Name",
      render: (r: any) => (
        <>
          <strong>{name(r)}</strong>
          <small>{r.city || r.department?.name || ""}</small>
        </>
      ),
    },
    {
      key: "type",
      label: kind === "employee" ? "Department" : "Details",
      render: (r: any) =>
        kind === "employee"
          ? name(r.department)
          : r.phone ||
            r.category?.name ||
            r.type ||
            r.controlType ||
            r.currency ||
            "—",
    },
    {
      key: "active",
      label: "Status",
      render: (r: any) => (
        <Status value={r.active === false ? "INACTIVE" : "ACTIVE"} />
      ),
    },
  ];
  if (!["customer", "employee"].includes(kind))
    columns.push({
      key: "reference",
      label:
        kind === "item"
          ? "Barcode"
          : kind === "warehouse"
            ? "Branch"
            : "Details",
      render: (r: any) => (
        <bdi>
          {r.barcode ||
            r.currency ||
            r.branch?.name ||
            r.controlType ||
            r.city ||
            "—"}
        </bdi>
      ),
    });
  if (kind === "customer")
    columns.push(
      {
        key: "outstanding",
        label: "Outstanding balance",
        numeric: true,
        render: (r: any) => money(r.outstandingMinor),
      },
      {
        key: "actions",
        label: "Actions",
        render: (r: any) => (
          <Button className="small" onClick={() => setSelected(r.id)}>
            {tr("View")}
          </Button>
        ),
      },
    );
  if (kind === "employee")
    columns.push(
      { key: "branch", label: "Branch", render: (r: any) => name(r.branch) },
      { key: "jobTitle", label: "Job title" },
      {
        key: "salesEligible",
        label: "Sales role",
        render: (r: any) => tr(r.salesEligible ? "Yes" : "No"),
      },
      { key: "email", label: "Email" },
    );
  return (
    <>
      <PageHeader
        title={title}
        subtitle="Search, review and maintain the master records used by operational workflows"
      >
        {permissions[kind] && allowed(permissions[kind]) ? (
          <AddButton testId={`new-${kind}`} onClick={() => setMode("create")}>
            {tr(`New ${kind[0].toUpperCase() + kind.slice(1)}`)}
          </AddButton>
        ) : null}
      </PageHeader>
      <Panel>
        <div className="toolbar">
          <SearchField
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            label={
              kind === "customer" ? "Search customers" : "Search master data…"
            }
          />
          {["customer", "employee"].includes(kind) ? (
            <>
              <label className="field">
                {tr("Status")}
                <select
                  value={filter.status}
                  onChange={(e) => {
                    setFilter({ ...filter, status: e.target.value });
                    setPage(1);
                  }}
                >
                  {["ACTIVE", "INACTIVE", "ALL"].map((s) => (
                    <option key={s} value={s}>
                      {s === "ALL" ? tr("All statuses") : tr(s)}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "customer" ? (
                <label className="field">
                  {tr("Branch")}
                  <select
                    value={filter.branchId}
                    onChange={(e) => {
                      setFilter({ ...filter, branchId: e.target.value });
                      setPage(1);
                    }}
                  >
                    <option value="">{tr("All branches")}</option>
                    {refs.branches.map((b: any) => (
                      <option key={b.id} value={b.id}>
                        {name(b)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
          <span className="toolbar-count">
            {remote.data?.pagination?.total ?? rows.length} {tr("records")}
          </span>
        </div>
        <Resource
          state={
            ["customer", "employee"].includes(kind)
              ? remote
              : { loading: false, error: "" }
          }
        >
          <Table
            caption={title}
            testId={
              kind === "customer" ? "customer-table" : "master-data-table"
            }
            rows={
              kind === "customer"
                ? rows
                : rows.slice((page - 1) * 15, page * 15)
            }
            columns={columns}
            filtered={!!query}
          />
          <Pagination
            page={page}
            total={remote.data?.pagination?.total ?? rows.length}
            onPage={setPage}
          />
        </Resource>
      </Panel>
    </>
  );
}
export function MasterEditor({
  kind,
  customer,
  close,
  saved,
}: {
  kind: string;
  customer?: any;
  close: () => void;
  saved: (r: any) => void;
}) {
  const { tr, refs, field, request, refreshRefs, notify } = useERP();
  const defaults =
    kind === "customer"
      ? {
          name: "",
          customerType: "BUSINESS",
          city: "Cairo",
          phone: "",
          email: "",
          taxNumber: "",
          registrationNumber: "",
          defaultBranchId: refs.branches[0]?.id || "",
          billingAddress: "",
          shippingAddress: "",
          paymentTermsDays: "",
          creditLimit: "",
          defaultCurrency: "",
          taxTreatment: "STANDARD",
          creditHold: false,
        }
      : {
          code: "",
          name: "",
          city: "Cairo",
          taxNumber: "",
          email: "",
          phone: "",
          address: "",
          paymentTermsDays: "30",
          precision: "3",
          branchId: refs.branches[0]?.id || "",
          categoryId: refs.categories[0]?.id || "",
          uomId: refs.units[0]?.id || "",
          sku: "",
          barcode: "",
          nameAr: "",
          purchasePrice: "100.00",
          salePrice: "150.00",
          taxRatePercent: "14",
          reorderLevel: "5.000",
          type: "BANK",
          currency: refs.tenant.baseCurrency,
          glAccountId:
            refs.accounts.find((a: any) => a.code === "1010")?.id || "",
          bankName: "",
          accountNumber: "",
        };
  const [form, setForm] = useState<any>({
    ...defaults,
    ...customer,
    ...(customer
      ? {
          creditLimit: decimal(customer.creditLimitMinor),
          paymentTermsDays: customer.paymentTermsDays ?? "",
        }
      : {}),
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useUnsaved(dirty);
  const set = (key: string, value: any) => {
    setDirty(true);
    setForm((f: any) => ({ ...f, [key]: value }));
  };
  const fieldSpec = (key: string, label: string, options: any = {}) => ({
    key,
    label,
    ...options,
  });
  let identity: FieldSpec[] = [
    ...(kind !== "customer" && kind !== "item"
      ? [
          fieldSpec("code", "Code", {
            required: true,
            testId: `master-${kind}-code`,
          }),
        ]
      : []),
    fieldSpec("name", kind === "customer" ? "Customer name" : "Name", {
      required: true,
      testId: `master-${kind}-name`,
    }),
  ];
  let commercial: FieldSpec[] = [];
  if (["customer", "supplier"].includes(kind)) {
    identity.push(
      ...(kind === "customer"
        ? [
            fieldSpec("customerType", "Customer type", {
              options: [
                { value: "BUSINESS", label: "Business" },
                { value: "INDIVIDUAL", label: "Individual" },
              ],
            }),
            fieldSpec("defaultBranchId", "Default branch", {
              options: [{ value: "", label: "Not assigned" }, ...refs.branches],
            }),
          ]
        : []),
      fieldSpec("phone", "Phone"),
      fieldSpec("email", "Email", { type: "email" }),
      fieldSpec("city", "City", { required: true }),
    );
    if (field("party", "taxNumber") !== "HIDDEN")
      identity.push(
        fieldSpec("taxNumber", "Tax number", {
          readOnly: field("party", "taxNumber") !== "EDIT",
        }),
        ...(kind === "customer"
          ? [
              fieldSpec("registrationNumber", "Registration number", {
                readOnly: field("party", "taxNumber") !== "EDIT",
              }),
            ]
          : []),
      );
    identity.push(
      ...(kind === "customer"
        ? [
            fieldSpec("billingAddress", "Billing address", {
              type: "textarea",
              wide: true,
            }),
            fieldSpec("shippingAddress", "Shipping address", {
              type: "textarea",
              wide: true,
            }),
          ]
        : [fieldSpec("address", "Address", { wide: true })]),
    );
    if (
      kind === "supplier" ||
      field("customer", "paymentTermsDays") !== "HIDDEN"
    )
      commercial.push(
        fieldSpec("paymentTermsDays", "Payment terms (days)", {
          type: "number",
          min: "0",
          readOnly:
            kind === "customer" &&
            field("customer", "paymentTermsDays") !== "EDIT",
        }),
      );
    if (kind === "customer") {
      if (field("customer", "creditLimitMinor") !== "HIDDEN")
        commercial.push(
          fieldSpec("creditLimit", "Credit limit", {
            type: "decimal",
            readOnly: field("customer", "creditLimitMinor") !== "EDIT",
            hint: "Blank is different from a zero credit limit.",
          }),
          fieldSpec("creditHold", "Place customer on credit hold", {
            type: "checkbox",
            readOnly: field("customer", "creditLimitMinor") !== "EDIT",
          }),
        );
      commercial.push(
        fieldSpec("defaultCurrency", "Default currency", {
          options: [
            { value: "", label: "Not specified" },
            ...refs.currencies.map((c: any) => ({
              value: c.code,
              label: c.code,
            })),
          ],
        }),
        fieldSpec("taxTreatment", "Tax treatment", {
          options: [
            { value: "STANDARD", label: "Standard taxable" },
            { value: "EXEMPT", label: "Tax exempt" },
          ],
        }),
      );
    }
  }
  if (kind === "unit")
    identity.push(
      fieldSpec("precision", "Decimal precision", {
        type: "number",
        min: "0",
        max: "6",
        required: true,
      }),
    );
  if (kind === "warehouse")
    identity.push(
      fieldSpec("branchId", "Branch", {
        options: refs.branches,
        required: true,
      }),
    );
  if (kind === "item") {
    identity.push(
      fieldSpec("sku", "SKU", { required: true, testId: "master-item-sku" }),
      fieldSpec("barcode", "Barcode", { required: true }),
      fieldSpec("nameAr", "Arabic name"),
      fieldSpec("categoryId", "Category", { options: refs.categories }),
      fieldSpec("uomId", "Unit of measure", { options: refs.units }),
    );
    commercial = [
      fieldSpec("purchasePrice", "Purchase price", {
        type: "decimal",
        required: true,
      }),
      fieldSpec("salePrice", "Sales price", {
        type: "decimal",
        required: true,
      }),
      fieldSpec("taxRatePercent", "VAT %", { type: "decimal", required: true }),
      fieldSpec("reorderLevel", "Reorder level", {
        type: "decimal",
        required: true,
      }),
    ];
  }
  if (kind === "bank") {
    identity.push(
      fieldSpec("type", "Type", { options: ["CASH", "BANK", "CARD_CLEARING"] }),
      fieldSpec("currency", "Currency", { required: true }),
      fieldSpec("bankName", "Bank name"),
    );
    if (field("bankAccount", "accountNumber") !== "HIDDEN")
      identity.push(
        fieldSpec("accountNumber", "Account number", {
          readOnly: field("bankAccount", "accountNumber") !== "EDIT",
        }),
      );
    commercial.push(
      fieldSpec("glAccountId", "GL asset account", {
        options: refs.accounts.filter(
          (a: any) => a.type === "ASSET" && a.postingAllowed && !a.controlType,
        ),
        required: true,
      }),
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body: any = {};
    [...identity, ...commercial]
      .filter((f) => !f.readOnly)
      .forEach((f) => (body[f.key] = form[f.key]));
    try {
      const r = await request(
        `/masters/${endpoints[kind]}${customer ? `/${customer.id}` : ""}`,
        { method: customer ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setDirty(false);
      await refreshRefs();
      notify(
        customer
          ? "Customer details updated"
          : `${r.code || r.sku} · ${r.name} created`,
      );
      saved(r);
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
          customer
            ? "Edit Customer"
            : `New ${kind === "bank" ? "Bank account" : kind[0].toUpperCase() + kind.slice(1)}`
        }
        back={() => guard(close)}
        subtitle={
          kind === "customer"
            ? "Customer code is generated automatically after saving"
            : undefined
        }
      />
      <form onSubmit={submit}>
        <Panel>
          <div className="form-section">
            <h2>{tr("Basic information")}</h2>
            <Fields specs={identity} values={form} set={set} />
          </div>
          {commercial.length ? (
            <div className="form-section">
              <h2>{tr("Financial settings")}</h2>
              <Fields specs={commercial} values={form} set={set} />
            </div>
          ) : null}
        </Panel>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <span>{customer?.code || tr("New record")}</span>
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button
              type="submit"
              primary
              busy={busy}
              data-testid={`save-${kind}`}
            >
              {tr(
                customer
                  ? "Save changes"
                  : `Create ${kind[0].toUpperCase() + kind.slice(1)}`,
              )}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
function CustomerDetail({ id, close }: { id: string; close: () => void }) {
  const { tr, money, date, name, allowed, field } = useERP();
  const state = useResource(`/sales/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("Overview");
  const c = state.data;
  if (editing && c)
    return (
      <MasterEditor
        kind="customer"
        customer={c}
        close={() => setEditing(false)}
        saved={() => {
          setEditing(false);
          state.reload();
        }}
      />
    );
  const tabs = [
    "Overview",
    ...(Array.isArray(c?.documents) ? ["Documents"] : []),
    ...(Array.isArray(c?.payments) ? ["Payments"] : []),
    ...(Array.isArray(c?.statement) ? ["Statement"] : []),
    ...(Array.isArray(c?.ageing) ? ["Ageing"] : []),
    ...(Array.isArray(c?.audit) ? ["Activity"] : []),
  ];
  const rows =
    tab === "Documents"
      ? c?.documents
      : tab === "Payments"
        ? c?.payments
        : tab === "Statement"
          ? c?.statement
          : tab === "Ageing"
            ? c?.ageing
            : c?.audit;
  return (
    <Resource state={state}>
      {c ? (
        <>
          <PageHeader title={name(c)} subtitle={c.code} back={close}>
            {allowed("sales.customer.edit") ? (
              <Button onClick={() => setEditing(true)}>
                {tr("Edit Customer")}
              </Button>
            ) : null}
            {allowed("sales.quotation.create") ? (
              <Link
                className="btn primary"
                href={`/sales/quotations?new=1&customer=${id}`}
              >
                {tr("New Quotation")}
              </Link>
            ) : null}
          </PageHeader>
          <Panel>
            <Details
              values={[
                ["Phone", c.phone],
                ["Email", c.email],
                ["Default branch", c.defaultBranch?.name],
                ["Outstanding balance", money(c.outstandingMinor)],
              ]}
            />
          </Panel>
          <Tabs tabs={tabs} value={tab} set={setTab} />
          {tab === "Overview" ? (
            <Panel title="Customer information">
              <Details
                values={[
                  ["Customer type", tr(c.customerType)],
                  ["City", c.city],
                  ["Billing address", c.billingAddress],
                  ["Shipping address", c.shippingAddress],
                  ...(field("party", "taxNumber") !== "HIDDEN"
                    ? ([
                        ["Tax number", c.taxNumber],
                        ["Registration number", c.registrationNumber],
                      ] as [string, any][])
                    : []),
                  ["Default currency", c.defaultCurrency],
                  ...(field("customer", "creditLimitMinor") !== "HIDDEN"
                    ? ([
                        [
                          "Credit limit",
                          c.creditLimitMinor === null
                            ? tr("No credit limit configured")
                            : money(
                                c.creditLimitMinor,
                                c.defaultCurrency || undefined,
                              ),
                        ],
                        [
                          "Credit hold",
                          tr(c.creditHold ? "Active" : "Not active"),
                        ],
                      ] as [string, any][])
                    : []),
                  ...(field("customer", "paymentTermsDays") !== "HIDDEN"
                    ? ([
                        [
                          "Payment terms",
                          c.paymentTermsDays ?? tr("Not specified"),
                        ],
                      ] as [string, any][])
                    : []),
                ]}
              />
            </Panel>
          ) : (
            <Panel>
              <Table
                rows={rows || []}
                columns={
                  tab === "Statement"
                    ? [
                        {
                          key: "date",
                          label: "Date",
                          render: (r) => date(r.date),
                        },
                        { key: "documentNumber", label: "Document" },
                        { key: "reference", label: "Reference" },
                        { key: "currency", label: "Currency" },
                        {
                          key: "debitMinor",
                          label: "Debit",
                          numeric: true,
                          render: (r) => money(r.debitMinor, r.baseCurrency),
                        },
                        {
                          key: "creditMinor",
                          label: "Credit",
                          numeric: true,
                          render: (r) => money(r.creditMinor, r.baseCurrency),
                        },
                        {
                          key: "runningBalanceMinor",
                          label: "Running balance",
                          numeric: true,
                          render: (r) =>
                            money(r.runningBalanceMinor, r.baseCurrency),
                        },
                      ]
                    : tab === "Ageing"
                      ? [
                          { key: "number", label: "Document" },
                          {
                            key: "dueDate",
                            label: "Due date",
                            render: (r) => date(r.dueDate),
                          },
                          { key: "bucket", label: "Bucket" },
                          {
                            key: "outstandingMinor",
                            label: "Outstanding",
                            numeric: true,
                            render: (r) => money(r.outstandingMinor),
                          },
                        ]
                      : tab === "Activity"
                        ? [
                            {
                              key: "createdAt",
                              label: "Date",
                              render: (r) => date(r.createdAt),
                            },
                            { key: "action", label: "Action" },
                            {
                              key: "user",
                              label: "Actor",
                              render: (r) => name(r.user || r.actor),
                            },
                          ]
                        : [
                            {
                              key: "number",
                              label: "Document",
                              render: (r) =>
                                r.type ? (
                                  <Link
                                    href={`${routeForDocumentType(r.type)}?document=${r.id}`}
                                  >
                                    {r.number}
                                  </Link>
                                ) : (
                                  r.number
                                ),
                            },
                            {
                              key: "date",
                              label: "Date",
                              render: (r) =>
                                date(r.documentDate || r.postingDate),
                            },
                            {
                              key: "status",
                              label: "Status",
                              render: (r) => <Status value={r.status} />,
                            },
                            {
                              key: "totalMinor",
                              label: "Total",
                              numeric: true,
                              render: (r) =>
                                money(
                                  r.totalMinor ?? r.amountMinor,
                                  r.currency,
                                ),
                            },
                          ]
                }
              />
            </Panel>
          )}
        </>
      ) : null}
    </Resource>
  );
}
