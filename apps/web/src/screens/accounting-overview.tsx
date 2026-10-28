"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Plus,
  CalendarDays,
  BookOpen,
  ListTree,
  FileSpreadsheet,
} from "lucide-react";
import { useERP, useResource, today } from "../core/erp-context";
import {
  PageHeader,
  Panel,
  Button,
  Resource,
  Table,
  Status,
} from "../components/ui";
import type { Journal, Paged } from "../core/accounting";
export default function AccountingOverview() {
  const { tr, refs, allowed, field, money, date } = useERP();
  const canView = allowed("accounting.journal.view");
  const submitted = useResource<Paged<Journal>>(
    canView ? "/accounting/journals?status=SUBMITTED&pageSize=6" : null,
  );
  const drafts = useResource<Paged<Journal>>(
    canView ? "/accounting/journals?status=DRAFT&pageSize=1" : null,
  );
  const approved = useResource<Paged<Journal>>(
    canView ? "/accounting/journals?status=APPROVED&pageSize=1" : null,
  );
  const period = refs.periods.find(
    (p: any) =>
      p.startDate.slice(0, 10) <= today() && p.endDate.slice(0, 10) >= today(),
  );
  const counter = (state: any) =>
    !canView
      ? tr("Restricted")
      : state.loading
        ? "—"
        : state.error
          ? tr("Unavailable")
          : (state.data?.pagination.total ?? "—");
  return (
    <>
      <PageHeader
        title="Accounting Overview"
        subtitle="Keep the ledger current, review pending entries and control the close."
      >
        {allowed("accounting.journal.create") &&
        field("journal", "lines") === "EDIT" ? (
          <Link className="btn primary" href="/accounting/journals?new=1">
            <Plus size={16} />
            {tr("New manual journal")}
          </Link>
        ) : null}
      </PageHeader>
      <div className="ac-work-queue">
        {[
          { label: "Draft journals", state: drafts, status: "DRAFT" },
          { label: "Awaiting approval", state: submitted, status: "SUBMITTED" },
          { label: "Ready to post", state: approved, status: "APPROVED" },
        ].map((item) => (
          <div key={item.status}>
            <span>{tr(item.label)}</span>
            <strong>
              <bdi>{counter(item.state)}</bdi>
            </strong>
            {canView ? (
              <Link href={`/accounting/journals?status=${item.status}`}>
                {tr("Review entries")}
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
          </div>
        ))}
        <div>
          <span>{tr("Current period")}</span>
          <strong>{period ? tr(period.name) : tr("No fiscal period")}</strong>
          {period ? <Status value={period.status} /> : null}
        </div>
      </div>
      <div className="ac-overview-grid">
        <Panel
          title="Entries awaiting approval"
          actions={
            canView ? (
              <Link href="/accounting/journals?status=SUBMITTED">
                {tr("View all")}
                <ArrowUpRight size={14} />
              </Link>
            ) : null
          }
        >
          {canView ? (
            <Resource state={submitted}>
              <Table
                caption="Entries awaiting approval"
                rows={submitted.data?.rows || []}
                columns={[
                  {
                    key: "number",
                    label: "Journal",
                    render: (j) => (
                      <Link href={`/accounting/journals?journal=${j.id}`}>
                        <bdi>{j.number}</bdi>
                      </Link>
                    ),
                  },
                  {
                    key: "date",
                    label: "Posting date",
                    render: (j) => <bdi>{date(j.postingDate)}</bdi>,
                  },
                  { key: "description", label: "Description" },
                  {
                    key: "author",
                    label: "Prepared by",
                    render: (j) => j.createdBy?.name || "—",
                  },
                ]}
              />
            </Resource>
          ) : (
            <p className="surface-body">{tr("Restricted")}</p>
          )}
        </Panel>
        <section className="surface">
          <div className="surface-heading">
            <h2>{tr("Accounting workspace")}</h2>
          </div>
          <div className="ac-task-links">
            {allowed("accounting.account.view") ? (
              <Link href="/accounting/chart-of-accounts">
                <ListTree size={20} />
                <div>
                  <strong>{tr("Chart of Accounts")}</strong>
                  <span>{tr("Account hierarchy and posting controls")}</span>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
            {canView ? (
              <Link href="/accounting/general-ledger">
                <BookOpen size={20} />
                <div>
                  <strong>{tr("General Ledger")}</strong>
                  <span>
                    {tr("Opening balances, movements and source records")}
                  </span>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
            {allowed("reports.standard.view") ? (
              <Link href="/accounting/trial-balance">
                <FileSpreadsheet size={20} />
                <div>
                  <strong>{tr("Trial Balance")}</strong>
                  <span>
                    {tr("Review opening, movement and closing balances")}
                  </span>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
            {allowed("accounting.period.view") ? (
              <Link href="/accounting/periods">
                <CalendarDays size={20} />
                <div>
                  <strong>{tr("Fiscal Periods")}</strong>
                  <span>{tr("Manage open, closed and locked periods")}</span>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ) : null}
          </div>
        </section>
      </div>
      <section className="surface ac-close-guide">
        <div>
          <h2>{tr("Period review")}</h2>
          <p>
            {tr(
              "Resolve pending entries, reconcile the ledger and review the financial statements before closing a period.",
            )}
          </p>
        </div>
        <div className="actions">
          {allowed("reports.profitability.view") ? (
            <>
              <Link className="btn" href="/accounting/income-statement">
                {tr("Income Statement")}
              </Link>
              <Link className="btn" href="/accounting/balance-sheet">
                {tr("Balance Sheet")}
              </Link>
            </>
          ) : null}
          {allowed("accounting.period.view") ? (
            <Link className="btn primary" href="/accounting/periods">
              {tr("Review fiscal periods")}
            </Link>
          ) : null}
        </div>
      </section>
    </>
  );
}
