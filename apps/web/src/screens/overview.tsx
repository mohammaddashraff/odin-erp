"use client";
import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Wallet,
  Package,
  ReceiptText,
  ArrowRightLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import { GlassMetric } from "../components/glass-dashboard";
import { RevenueChart } from "../components/revenue-chart";
import { useRouter } from "next/navigation";
import { useERP, useResource } from "../core/erp-context";
import { modules, routeEntry, routeForDocumentType } from "../core/navigation";
import {
  PageHeader,
  Panel,
  Stats,
  Table,
  Resource,
  Status,
  Details,
  Empty,
} from "../components/ui";
export function Dashboard() {
  const router = useRouter();
  const { tr, money, quantity, name, dateTime, allowed, field, refs } =
    useERP();
  const state = useResource("/dashboard");
  const data = state.data;
  // The legacy KPI API sums some source amounts across currencies. Read the
  // existing scoped documents and keep each currency separate in this new view.
  const summaries = useResource(
    allowed(["sales.invoice.view", "purchasing.bill.view"])
      ? "/documents"
      : null,
  );
  const inventoryAccess = allowed([
    "inventory.overview.view",
    "inventory.item.view",
  ]);
  const visible: Record<string, boolean> = {
    salesMinor:
      allowed("sales.invoice.view") &&
      allowed("sales.return.view") &&
      allowed("sales.credit_note.view"),
    purchasesMinor:
      allowed("purchasing.bill.view") && allowed("purchasing.return.view"),
    payablesMinor: allowed("purchasing.bill.view"),
    cashMinor:
      allowed(["banking.account.view", "accounting.journal.view"]) &&
      field("bankAccount", "accountNumber") !== "HIDDEN",
    receivablesMinor:
      allowed([
        "sales.customer.view",
        "sales.invoice.view",
        "sales.overview.view",
      ]) && field("customer", "balanceMinor") !== "HIDDEN",
    inventoryMinor:
      inventoryAccess &&
      (field("document", "costMinor") !== "HIDDEN" ||
        field("item", "costPriceMinor") !== "HIDDEN"),
  };
  const grouped = (key: string) => {
    if (!visible[key]) return tr("Restricted");
    if (!["salesMinor", "purchasesMinor", "payablesMinor"].includes(key))
      return <bdi>{money(data?.kpis[key])}</bdi>;
    if (summaries.loading) return tr("Loading…");
    if (summaries.error || !summaries.data) return tr("Unavailable");
    const types =
      key === "salesMinor"
        ? ["SALES_INVOICE", "SALES_RETURN", "CREDIT_NOTE"]
        : key === "purchasesMinor"
          ? ["PURCHASE_BILL", "PURCHASE_RETURN"]
          : ["PURCHASE_BILL"];
    const rows = summaries.data.filter(
      (d: any) =>
        d.status === "POSTED" &&
        types.includes(d.type) &&
        (key !== "purchasesMinor" ||
          d.type !== "PURCHASE_RETURN" ||
          d.sourceDocument?.type === "PURCHASE_BILL"),
    );
    const totals = new Map<string, bigint>();
    for (const d of rows) {
      const amount = key === "payablesMinor" ? d.remainingMinor : d.totalMinor;
      if (amount == null) return tr("Restricted");
      const sign =
        key !== "payablesMinor" &&
        ["SALES_RETURN", "CREDIT_NOTE", "PURCHASE_RETURN"].includes(d.type)
          ? -1n
          : 1n;
      totals.set(
        d.currency,
        (totals.get(d.currency) || 0n) + BigInt(amount) * sign,
      );
    }
    if (!totals.size) totals.set(refs.tenant.baseCurrency, 0n);
    return (
      <>
        {[...totals].map(([currency, amount]) => (
          <bdi className="currency-total" key={currency}>
            {money(amount, currency)}
          </bdi>
        ))}
      </>
    );
  };
  const metrics = [
    ["Net sales", "salesMinor", "/sales/invoices"],
    ["Cash & Bank", "cashMinor", "/banking/overview"],
    ["Customer balances", "receivablesMinor", "/sales/customer-balances"],
    ["Payables", "payablesMinor", "/purchasing/supplier-balances"],
    ["Net purchases", "purchasesMinor", "/purchasing/bills"],
    ["Inventory value", "inventoryMinor", "/inventory/valuation"],
  ];
  const financialLinks = [
    {
      label: "Invoices",
      description: "Create and manage sales invoices",
      href: "/sales/invoices",
      icon: ReceiptText,
    },
    {
      label: "Cash & Bank",
      description: "View bank accounts and transactions",
      href: "/banking/overview",
      icon: Wallet,
    },
    {
      label: "Customer balances",
      description: "View customer balances and statements",
      href: "/sales/customer-balances",
      icon: Users,
    },
  ].filter(({ href }) => allowed(routeEntry(href).child.permission));
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your business"
        showGuide={false}
      />
      <Resource state={state}>
        {data ? (
          <>
            <div className="glass-metrics">
              {metrics
                .filter(([, key]) =>
                  [
                    "salesMinor",
                    "cashMinor",
                    "receivablesMinor",
                    "inventoryMinor",
                  ].includes(key),
                )
                .map(([label, key, href], i) => {
                  const Icon = [Coins, Wallet, ReceiptText, Package][i];
                  return (
                    <GlassMetric
                      key={key}
                      label={label}
                      value={grouped(key)}
                      icon={<Icon size={25} />}
                      detail={tr(routeEntry(href).child.label)}
                      onClick={
                        visible[key] &&
                        allowed(routeEntry(href).child.permission)
                          ? () => router.push(href)
                          : undefined
                      }
                    />
                  );
                })}
            </div>
            <div className="glass-dashboard-grid">
              {visible.salesMinor && summaries.data ? (
                <RevenueChart documents={summaries.data} />
              ) : (
                <Panel title="Revenue Analytics">
                  <p className="surface-body">
                    {tr(summaries.error ? "Unavailable" : "Restricted")}
                  </p>
                </Panel>
              )}
              <Panel
                title="Recent transactions"
                actions={
                  <ArrowRightLeft className="glass-section-icon" size={23} />
                }
              >
                <div className="glass-transaction-list">
                  {(summaries.data || []).slice(0, 5).map((d: any) => (
                    <Link
                      className="glass-transaction"
                      key={d.id}
                      href={routeForDocumentType(d.type) + "?document=" + d.id}
                    >
                      <span className="glass-avatar">
                        <ReceiptText size={22} />
                      </span>
                      <span className="glass-transaction-name">
                        <strong>
                          {name(d.customer || d.supplier) || tr(d.type)}
                        </strong>
                        <small>
                          {tr(d.type)} · {d.number}
                        </small>
                      </span>
                      <span className="glass-transaction-date">
                        {dateTime(d.documentDate || d.createdAt)}
                      </span>
                      <strong>
                        {d.totalMinor == null
                          ? tr("Restricted")
                          : money(d.totalMinor, d.currency)}
                      </strong>
                      <Status value={d.status} />
                      <ChevronRight size={16} />
                    </Link>
                  ))}
                </div>
                {!summaries.data?.length ? (
                  <div className="classic-dashboard-empty">
                    <div>
                      <span className="classic-dashboard-empty-icon">
                        <ReceiptText size={21} />
                      </span>
                      <Empty
                        title={summaries.error ? "Unavailable" : "No transactions yet"}
                        description="Your latest transactions will appear here when you start using the system."
                      />
                    </div>
                  </div>
                ) : null}
              </Panel>
            </div>
            <Panel
              className="classic-financial-overview"
              title="Financial overview"
              actions={<span className="classic-quick-actions">{tr("Quick actions")}</span>}
            >
              <div className="classic-financial-links">
                {financialLinks.map(({ label, description, href, icon: Icon }) => (
                  <Link href={href} key={href}>
                    <span className="glass-icon"><Icon size={18} /></span>
                    <span>
                      <strong>{tr(label)}</strong>
                      <small>{tr(description)}</small>
                    </span>
                    <ChevronRight size={15} />
                  </Link>
                ))}
              </div>
            </Panel>
            <div className="glass-dashboard-grid">
              <Panel
                title="Inventory attention"
                actions={
                  allowed("inventory.item.view") ? (
                    <Link href="/inventory/items">
                      {tr("View all")} <ArrowRight size={13} />
                    </Link>
                  ) : null
                }
              >
                {!inventoryAccess ? (
                  <p className="surface-body">{tr("Restricted")}</p>
                ) : (
                  <Table
                    caption="Inventory attention"
                    rows={data.lowStock || []}
                    columns={[
                      {
                        key: "sku",
                        label: "SKU",
                        render: (r) => <bdi>{r.item.sku}</bdi>,
                      },
                      {
                        key: "item",
                        label: "Item",
                        render: (r) => name(r.item),
                      },
                      {
                        key: "warehouse",
                        label: "Warehouse",
                        render: (r) => name(r.warehouse),
                      },
                      {
                        key: "qty",
                        label: "On hand",
                        numeric: true,
                        render: (r) => quantity(r.quantityMilli),
                      },
                      {
                        key: "signal",
                        label: "Signal",
                        render: (r) => (
                          <span
                            className={`status ${BigInt(r.quantityMilli) <= BigInt(r.item.reorderMilli) ? "warning" : "success"}`}
                          >
                            {tr(
                              BigInt(r.quantityMilli) <=
                                BigInt(r.item.reorderMilli)
                                ? "Reorder"
                                : "Healthy",
                            )}
                          </span>
                        ),
                      },
                    ]}
                  />
                )}
              </Panel>
              <Panel title="Working capital">
                <Stats
                  items={metrics
                    .filter(([, key]) =>
                      ["payablesMinor", "purchasesMinor"].includes(key),
                    )
                    .map(([label, key, href]) => ({
                      label,
                      value: grouped(key),
                      href:
                        visible[key] &&
                        allowed(routeEntry(href).child.permission)
                          ? href
                          : undefined,
                    }))}
                />
              </Panel>
            </div>
            <div className="glass-dashboard-grid">
              <Panel title="Pending approvals">
                <div className="surface-body">
                  <div className="attention-count">
                    <bdi>
                      {allowed("approvals.queue.view")
                        ? (data.kpis.pendingApprovals ?? "—")
                        : tr("Restricted")}
                    </bdi>
                  </div>
                  <p>{tr("Approval queue")}</p>
                  <div className="quick-list">
                    {allowed("approvals.queue.view") ? (
                      <Link href="/approvals/inbox">
                        {tr("Open approval queue")}
                        <ArrowRight size={16} />
                      </Link>
                    ) : null}
                    {modules
                      .flatMap((m) => m.children)
                      .filter(
                        (c) =>
                          [
                            "sales-quotations",
                            "purchase-requests",
                            "journals",
                            "counts",
                          ].includes(c.id) && allowed(c.permission),
                      )
                      .map((c) => (
                        <Link key={c.id} href={c.route}>
                          {tr(c.label)}
                          <ArrowRight size={15} />
                        </Link>
                      ))}
                  </div>
                </div>
              </Panel>
              <Panel title="Recent business activity">
                <Table
                  rows={data.activity || []}
                  columns={[
                    {
                      key: "createdAt",
                      label: "Date",
                      render: (r) => <bdi>{dateTime(r.createdAt)}</bdi>,
                    },
                    {
                      key: "action",
                      label: "Action",
                      render: (r) => tr(r.action),
                    },
                    { key: "entityType", label: "Entity" },
                    {
                      key: "actor",
                      label: "Actor",
                      render: (r) => tr(r.user?.name || r.actor?.name || "—"),
                    },
                    {
                      key: "reference",
                      label: "Reference",
                      render: (r) => (
                        <bdi>{r.postingReference || r.entityId}</bdi>
                      ),
                    },
                  ]}
                />
              </Panel>
            </div>
          </>
        ) : null}
      </Resource>
    </>
  );
}
export function Overview({ moduleId }: { moduleId: string }) {
  const { tr, allowed, refs, money, date, name } = useERP();
  const definition = modules.find((m) => m.id === moduleId)!;
  const state = useResource(
    moduleId === "sales"
      ? "/sales/overview"
      : moduleId === "accounting"
        ? "/journals"
        : moduleId === "banking"
          ? "/banking"
          : moduleId === "admin"
            ? "/audit"
            : "/documents",
  );
  const data = state.data;
  const types = definition.children.map((c) => c.documentType).filter(Boolean);
  const rows =
    moduleId === "sales"
      ? data?.recent
      : moduleId === "banking"
        ? data?.transactions
        : (Array.isArray(data) ? data : []).filter(
            (r: any) => !types.length || types.includes(r.type),
          );
  const links = definition.children.filter(
    (c) => c.route !== definition.route && allowed(c.permission),
  );
  const stats =
    moduleId === "sales" && data
      ? [
          { label: "Awaiting approval", value: data.metrics.awaitingApproval },
          { label: "Expiring soon", value: data.metrics.expiringSoon },
          { label: "Unpaid invoices", value: money(data.metrics.unpaidMinor) },
          {
            label: "Sales this month",
            value: money(data.metrics.salesMonthMinor),
          },
        ]
      : [
          { label: "Total records", value: rows?.length ?? "—" },
          {
            label: "Draft",
            value: rows?.filter((r: any) => r.status === "DRAFT").length ?? "—",
          },
          {
            label: "Awaiting approval",
            value:
              rows?.filter((r: any) => r.status === "SUBMITTED").length ?? "—",
          },
          {
            label: "Posted records",
            value:
              rows?.filter((r: any) => r.status === "POSTED").length ?? "—",
          },
        ];
  return (
    <>
      <PageHeader
        title={moduleId === "sales" ? "Sales Overview" : definition.label}
        subtitle="Business records and workflows organized by domain"
      />
      <Resource state={state}>
        {data ? (
          <>
            <Stats items={stats} />
            <div className="dashboard-columns">
              <Panel title="Recent documents">
                <Table
                  rows={(rows || []).slice(0, 12)}
                  columns={[
                    {
                      key: "number",
                      label: "Reference",
                      render: (r) =>
                        r.type ? (
                          <Link
                            href={`${routeForDocumentType(r.type)}?document=${r.id}`}
                          >
                            <bdi>{r.number}</bdi>
                          </Link>
                        ) : (
                          <bdi>{r.number || r.postingReference || r.id}</bdi>
                        ),
                    },
                    {
                      key: "description",
                      label: "Description",
                      render: (r) =>
                        r.description ||
                        name(r.customer || r.supplier) ||
                        tr(r.type || r.entityType),
                    },
                    {
                      key: "date",
                      label: "Date",
                      render: (r) =>
                        date(r.documentDate || r.postingDate || r.createdAt),
                    },
                    {
                      key: "status",
                      label: "Status",
                      render: (r) =>
                        r.status ? (
                          <Status value={r.status} />
                        ) : (
                          tr(r.action || "—")
                        ),
                    },
                    {
                      key: "amount",
                      label: "Total",
                      numeric: true,
                      render: (r) =>
                        r.totalMinor != null
                          ? money(r.totalMinor, r.currency)
                          : r.amountMinor != null
                            ? money(r.amountMinor)
                            : "—",
                    },
                  ]}
                />
              </Panel>
              <Panel title="Quick access">
                <div className="surface-body quick-list">
                  {links.map((c) => (
                    <Link href={c.route} key={c.id}>
                      {tr(c.label)}
                      <ArrowRight size={15} />
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
          </>
        ) : null}
      </Resource>
    </>
  );
}
export function Health() {
  const { tr, dateTime, language } = useERP();
  const state = useResource("/administration/diagnostics");
  return (
    <>
      <PageHeader
        title="System diagnostics"
        subtitle="Technical diagnostics are restricted to administrators."
      />
      <Resource state={state}>
        <Panel title="Application services">
          <Details
            values={[
              ["API", state.data?.api?.[language] || tr("Not available")],
              [
                "Database",
                state.data?.database?.[language] || tr("Not available"),
              ],
              [
                "Last checked",
                state.data?.checkedAt
                  ? dateTime(state.data.checkedAt)
                  : tr("Not available"),
              ],
            ]}
          />
        </Panel>
      </Resource>
    </>
  );
}
