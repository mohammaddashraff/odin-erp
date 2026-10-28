"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { useERP, useResource } from "../core/erp-context";
import { routeEntry, routeForDocumentType } from "../core/navigation";
import { Button, PageHeader, Resource, Pagination } from "../components/ui";

type Minor = string | number | bigint | null | undefined;
type ReportKind = "trial-balance" | "income-statement" | "balance-sheet";
type Filters = {
  from: string;
  to: string;
  companyId: string;
  branchId: string;
  accountId: string;
  costCenter: string;
  search: string;
  includeZero: boolean;
};
type ReportRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId?: string | null;
  postingAllowed?: boolean;
  openingDebitMinor?: Minor;
  openingCreditMinor?: Minor;
  movementDebitMinor?: Minor;
  movementCreditMinor?: Minor;
  closingDebitMinor?: Minor;
  closingCreditMinor?: Minor;
  amountMinor?: Minor;
  balanceMinor?: Minor;
};
type LedgerRow = {
  id: string;
  journalId: string;
  journal: string;
  date: string;
  accountId: string;
  code: string;
  account: string;
  description: string;
  debitMinor: Minor;
  creditMinor: Minor;
  runningBalanceMinor: Minor;
  source: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  branchId: string;
  costCenter: string;
};
type ReportData<T> = {
  name: string;
  currency: string;
  filters: Filters;
  generatedAt: string;
  basis: string;
  rows: T[];
  totals: Record<string, Minor>;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  searchAffectsBalances?: boolean;
  reportContext?: { company: string; branch: string };
};

const reportLabels: Record<string, string> = {
  "trial-balance": "Trial balance",
  "general-ledger": "General ledger",
  "account-ledger": "Account ledger",
  "income-statement": "Income statement",
  "balance-sheet": "Balance sheet",
};
const filterKeys = [
  "from",
  "to",
  "companyId",
  "branchId",
  "accountId",
  "costCenter",
  "search",
  "includeZero",
] as const;
const blankFilters: Filters = {
  from: "",
  to: "",
  companyId: "",
  branchId: "",
  accountId: "",
  costCenter: "",
  search: "",
  includeZero: false,
};

function integer(value: Minor): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}
function exactAmount(value: bigint, language: string) {
  const positive = value < 0n ? -value : value;
  const locale = language === "ar" ? "ar-EG-u-nu-latn" : "en-EG-u-nu-latn";
  const whole = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(positive / 100n);
  return `${value < 0n ? "−" : ""}${whole}.${String(positive % 100n).padStart(2, "0")}`;
}
function Amount({
  value,
  balance = false,
}: {
  value: Minor;
  balance?: boolean;
}) {
  const { tr, language } = useERP();
  const n = integer(value);
  if (n === null) return <span className="ar-unknown">{tr("Restricted")}</span>;
  return (
    <bdi className={`ar-amount ${n === 0n ? "ar-zero" : ""}`} dir="ltr">
      {exactAmount(balance && n < 0n ? -n : n, language)}
      {balance && n !== 0n ? <small> {tr(n > 0n ? "Dr" : "Cr")}</small> : null}
    </bdi>
  );
}
function queryFor(filters: Filters) {
  const query = new URLSearchParams();
  for (const key of filterKeys) {
    if (key === "includeZero") {
      if (filters.includeZero) query.set(key, "true");
    } else if (filters[key]) query.set(key, filters[key]);
  }
  return query;
}
function useFilters(balanceSheet = false) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const applied: Filters = {
    from: balanceSheet ? "" : params.get("from") || "",
    to: params.get("to") || "",
    companyId: params.get("companyId") || "",
    branchId: params.get("branchId") || "",
    accountId: params.get("accountId") || "",
    costCenter: params.get("costCenter") || "",
    search: params.get("search") || "",
    includeZero: params.get("includeZero") === "true",
  };
  const signature = queryFor(applied).toString();
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(applied);
    setError("");
  }, [signature]); // Applied URL is the shareable report state.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = [25, 50, 100].includes(Number(params.get("pageSize")))
    ? Number(params.get("pageSize"))
    : 50;
  const replace = (filters: Filters, nextPage = 1, nextSize = pageSize) => {
    const query = new URLSearchParams(params.toString());
    for (const key of filterKeys) query.delete(key);
    queryFor(filters).forEach((value, key) => query.set(key, value));
    query.delete("page");
    query.delete("pageSize");
    if (nextPage > 1) query.set("page", String(nextPage));
    if (nextSize !== 50) query.set("pageSize", String(nextSize));
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, {
      scroll: false,
    });
  };
  return {
    applied,
    draft,
    setDraft,
    error,
    page,
    pageSize,
    apply: (event: FormEvent) => {
      event.preventDefault();
      if (draft.from && draft.to && draft.from > draft.to) {
        setError("Start date must not be after end date.");
        return;
      }
      setError("");
      replace({
        ...draft,
        from: balanceSheet ? "" : draft.from,
        costCenter: draft.costCenter.trim(),
        search: draft.search.trim(),
      });
    },
    reset: () => {
      setDraft(blankFilters);
      setError("");
      replace(blankFilters);
    },
    setPage: (value: number) => replace(applied, value),
    setPageSize: (value: number) => replace(applied, 1, value),
  };
}
type FilterState = ReturnType<typeof useFilters>;

function FilterBar({
  state,
  ledger = false,
  balanceSheet = false,
  busy = false,
}: {
  state: FilterState;
  ledger?: boolean;
  balanceSheet?: boolean;
  busy?: boolean;
}) {
  const { tr, refs, name } = useERP();
  const set = (key: keyof Filters, value: string | boolean) =>
    state.setDraft((current) => ({ ...current, [key]: value }));
  const relevantFilter = state.applied.accountId && !ledger;
  const company = (refs.companies || []).find(
    (item: any) => String(item.id) === state.draft.companyId,
  );
  const branchOptions = (refs.branches || []).filter(
    (branch: any) =>
      !Array.isArray(company?.branchIds) ||
      company.branchIds.map(String).includes(String(branch.id)),
  );
  return (
    <form
      className={`ar-filter-bar ${ledger ? "ar-ledger-filters" : ""}`}
      onSubmit={state.apply}
      aria-label={tr("Accounting report filters")}
    >
      <div className="ar-filter-fields">
        {ledger ? (
          <label className="field ar-account-filter">
            <span>{tr("Account")}</span>
            <select
              value={state.draft.accountId}
              onChange={(event) => set("accountId", event.target.value)}
              aria-label={tr("Ledger account")}
            >
              <option value="">{tr("All accessible accounts")}</option>
              {(refs.accounts || []).map((account: any) => (
                <option key={account.id} value={String(account.id)}>
                  {account.code} · {name(account)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {(refs.companies || []).length ? (
          <label className="field">
            <span>{tr("Company")}</span>
            <select
              value={state.draft.companyId}
              aria-label={tr("Company")}
              onChange={(event) =>
                state.setDraft((current) => ({
                  ...current,
                  companyId: event.target.value,
                  branchId: "",
                  accountId: "",
                }))
              }
            >
              <option value="">{tr("All accessible companies")}</option>
              {refs.companies.map((item: any) => (
                <option key={item.id} value={String(item.id)}>
                  {name(item)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!balanceSheet ? (
          <label className="field">
            <span>{tr("From date")}</span>
            <input
              type="date"
              value={state.draft.from}
              onChange={(event) => set("from", event.target.value)}
            />
          </label>
        ) : null}
        <label className="field">
          <span>{tr(balanceSheet ? "As of date" : "To date")}</span>
          <input
            type="date"
            value={state.draft.to}
            onChange={(event) => set("to", event.target.value)}
          />
        </label>
        <label className="field">
          <span>{tr("Branch")}</span>
          <select
            value={state.draft.branchId}
            aria-label={tr("Branch")}
            onChange={(event) => set("branchId", event.target.value)}
          >
            <option value="">{tr("All accessible branches")}</option>
            {branchOptions.map((branch: any) => (
              <option key={branch.id} value={String(branch.id)}>
                {name(branch)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Cost center")}</span>
          <input
            value={state.draft.costCenter}
            onChange={(event) => set("costCenter", event.target.value)}
            placeholder={tr("All cost centers")}
            maxLength={100}
          />
        </label>
        {ledger ? (
          <label className="field ar-search-filter">
            <span>{tr("Search ledger entries")}</span>
            <input
              type="search"
              value={state.draft.search}
              onChange={(event) => set("search", event.target.value)}
              placeholder={tr("Journal, source or description")}
              maxLength={200}
            />
          </label>
        ) : null}
      </div>
      <div className="ar-filter-bottom">
        <span className="ar-scope-note">
          {tr("Posted entries only")}
          {relevantFilter ? <> · {tr("Selected account scope")}</> : null}
        </span>
        <div className="ar-filter-actions">
          {!ledger ? (
            <label className="ar-checkbox">
              <input
                type="checkbox"
                checked={state.draft.includeZero}
                onChange={(event) => set("includeZero", event.target.checked)}
              />
              {tr("Include zero-balance accounts")}
            </label>
          ) : null}
          <Button onClick={state.reset}>{tr("Reset filters")}</Button>
          <Button primary type="submit" busy={busy}>
            {tr("Apply filters")}
          </Button>
        </div>
      </div>
      {state.error ? (
        <p className="ar-filter-error" role="alert">
          {tr(state.error)}
        </p>
      ) : null}
    </form>
  );
}

function ExportActions({
  report,
  filters,
  ready,
  browserPrint = true,
}: {
  report: string;
  filters: Filters;
  ready: boolean;
  browserPrint?: boolean;
}) {
  const { tr, allowed, download, notify } = useERP();
  const [busy, setBusy] = useState("");
  const permission = ["income-statement", "balance-sheet"].includes(report)
    ? "profitability"
    : "standard";
  const save = async (format: string) => {
    setBusy(format);
    try {
      await download(
        `/reports/${report}/${format}?${queryFor(filters)}`,
        `${report}.${format}`,
      );
    } catch (error: any) {
      notify(error.message, true);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="actions ar-export-actions">
      {allowed(`reports.${permission}.view`) &&
      allowed(`reports.${permission}.export`) ? (
        <Button
          disabled={!ready || !!busy}
          busy={busy === "csv"}
          onClick={() => void save("csv")}
        >
          <Download size={15} />
          {tr("Export CSV")}
        </Button>
      ) : null}
      {allowed(`reports.${permission}.view`) &&
      allowed(`reports.${permission}.print`) ? (
        <Button
          disabled={!ready || !!busy}
          busy={busy === "pdf"}
          onClick={() => void save("pdf")}
        >
          <Download size={15} />
          {tr("Print PDF")}
        </Button>
      ) : null}
      {browserPrint &&
      allowed(`reports.${permission}.view`) &&
      allowed(`reports.${permission}.print`) ? (
        <Button disabled={!ready} onClick={() => window.print()}>
          <Printer size={15} />
          {tr("Browser print")}
        </Button>
      ) : null}
    </div>
  );
}
function ReportNavigation({
  active,
  filters,
}: {
  active: string;
  filters: Filters;
}) {
  const { tr, allowed } = useERP();
  return (
    <nav className="ar-report-nav" aria-label={tr("Financial reports")}>
      {Object.entries(reportLabels)
        .filter(([key]) =>
          allowed(
            ["income-statement", "balance-sheet"].includes(key)
              ? "reports.profitability.view"
              : ["general-ledger", "account-ledger"].includes(key)
                ? "accounting.journal.view"
                : "reports.standard.view",
          ),
        )
        .map(([key, label]) => {
          const query = queryFor({ ...filters, search: "" });
          if (key === "account-ledger") query.set("view", "account");
          const route = ["general-ledger", "account-ledger"].includes(key)
            ? "/accounting/general-ledger"
            : `/accounting/${key}`;
          return (
            <Link
              key={key}
              href={`${route}${query.size ? `?${query}` : ""}`}
              aria-current={active === key ? "page" : undefined}
            >
              {tr(label)}
            </Link>
          );
        })}
    </nav>
  );
}
function PeriodLabel({
  filters,
  balanceSheet = false,
}: {
  filters: Filters;
  balanceSheet?: boolean;
}) {
  const { tr, date } = useERP();
  if (balanceSheet)
    return (
      <>
        {tr("As of date")}:{" "}
        <bdi>{filters.to ? date(filters.to) : tr("Latest posted date")}</bdi>
      </>
    );
  if (!filters.from && !filters.to) return <>{tr("All posted history")}</>;
  return (
    <>
      <span>
        {filters.from ? (
          <bdi>{date(filters.from)}</bdi>
        ) : (
          tr("Beginning of records")
        )}
      </span>
      <span aria-hidden="true"> – </span>
      <span>
        {filters.to ? <bdi>{date(filters.to)}</bdi> : tr("Latest posted date")}
      </span>
    </>
  );
}
function ReportHeading({
  report,
  filters,
  kind,
}: {
  report: ReportData<ReportRow>;
  filters: Filters;
  kind: ReportKind;
}) {
  const { tr, refs, name, dateTime } = useERP();
  const branch = (refs.branches || []).find(
    (item: any) => String(item.id) === filters.branchId,
  );
  return (
    <header className="ar-sheet-heading">
      <div className="ar-sheet-basis">{tr("Posted entries only")}</div>
      <p className="ar-company-name">
        {report.reportContext?.company
          ? tr(report.reportContext.company)
          : name(refs.tenant)}
      </p>
      <h2>{tr(reportLabels[kind])}</h2>
      <p className="ar-report-period">
        <PeriodLabel
          filters={filters}
          balanceSheet={kind === "balance-sheet"}
        />{" "}
        ·{" "}
        {report.reportContext?.branch
          ? tr(report.reportContext.branch)
          : branch
            ? name(branch)
            : tr("All accessible branches")}{" "}
        · <bdi>{report.currency}</bdi>
      </p>
      {filters.costCenter ? (
        <p>
          {tr("Cost center")}: <bdi>{filters.costCenter}</bdi>
        </p>
      ) : null}
      <p className="ar-generated">
        {tr("Generated")}: <bdi>{dateTime(report.generatedAt)}</bdi>
      </p>
    </header>
  );
}
function ledgerHref(accountId: string, filters: Filters) {
  const query = queryFor({
    ...filters,
    accountId: String(accountId),
    search: "",
  });
  query.set("view", "account");
  return `/accounting/general-ledger?${query}`;
}
function AccountLink({ row, filters }: { row: ReportRow; filters: Filters }) {
  const { tr } = useERP();
  return (
    <Link className="ar-account-link" href={ledgerHref(row.id, filters)}>
      <span>{tr(row.name)}</span>
      <ArrowRight size={13} aria-hidden="true" />
    </Link>
  );
}
function BalanceCheck({
  difference,
  label = "Debit equals credit",
}: {
  difference: Minor;
  label?: string;
}) {
  const { tr } = useERP();
  const n = integer(difference);
  if (n === null)
    return (
      <p className="ar-balance-check ar-unavailable">
        {tr("Reconciliation unavailable")}
      </p>
    );
  return (
    <p
      className={`ar-balance-check ${n === 0n ? "ar-balanced" : "ar-difference"}`}
      role="status"
    >
      {n === 0n ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
      <span>{tr(n === 0n ? label : "Difference in selected scope")}</span>
      {n !== 0n ? <Amount value={n} /> : null}
    </p>
  );
}
const trialColumns = [
  "openingDebitMinor",
  "openingCreditMinor",
  "movementDebitMinor",
  "movementCreditMinor",
  "closingDebitMinor",
  "closingCreditMinor",
] as const;
function TrialBalance({
  report,
  filters,
}: {
  report: ReportData<ReportRow>;
  filters: Filters;
}) {
  const { tr } = useERP();
  return (
    <>
      <div
        className="ar-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={tr("Trial balance")}
      >
        <table
          className="ar-report-table ar-trial-table"
          data-testid="accounting-trial-balance"
        >
          <caption className="sr-only">{tr("Trial balance")}</caption>
          <thead>
            <tr>
              <th rowSpan={2} scope="col">
                {tr("Account code")}
              </th>
              <th rowSpan={2} scope="col">
                {tr("Account name")}
              </th>
              {["Opening balance", "Period movements", "Closing balance"].map(
                (label) => (
                  <th
                    key={label}
                    colSpan={2}
                    scope="colgroup"
                    className="ar-column-group"
                  >
                    {tr(label)}
                  </th>
                ),
              )}
            </tr>
            <tr>
              {trialColumns.map((key, index) => (
                <th key={key} scope="col" className="numeric">
                  {tr(index % 2 === 0 ? "Debit" : "Credit")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.length ? (
              report.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <bdi>{row.code}</bdi>
                  </td>
                  <th scope="row">
                    <AccountLink row={row} filters={filters} />
                  </th>
                  {trialColumns.map((key) => (
                    <td className="numeric" key={key}>
                      <Amount value={row[key]} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="ar-empty-cell">
                  {tr("No posted movements match these filters.")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                {tr("Total")}
              </th>
              {trialColumns.map((key) => (
                <td key={key} className="numeric">
                  <Amount value={report.totals[key]} />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <BalanceCheck difference={report.totals.differenceMinor} />
    </>
  );
}
function StatementSection({
  label,
  rows,
  total,
  filters,
  children,
}: {
  label: string;
  rows: ReportRow[];
  total: Minor;
  filters: Filters;
  children?: ReactNode;
}) {
  const { tr } = useERP();
  return (
    <tbody className="ar-statement-section">
      <tr className="ar-statement-heading">
        <th colSpan={2} scope="rowgroup">
          {tr(label)}
        </th>
        <td className="numeric">
          <Amount value={total} />
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td className="ar-statement-code">
            <bdi>{row.code}</bdi>
          </td>
          <th scope="row">
            <AccountLink row={row} filters={filters} />
          </th>
          <td className="numeric">
            <Amount value={row.amountMinor} />
          </td>
        </tr>
      ))}
      {children}
    </tbody>
  );
}
function StatementSubtotal({
  label,
  amount,
  major = false,
}: {
  label: string;
  amount: Minor;
  major?: boolean;
}) {
  const { tr } = useERP();
  return (
    <tbody>
      <tr
        className={`ar-statement-subtotal ${major ? "ar-statement-result" : ""}`}
      >
        <th colSpan={2} scope="row">
          {tr(label)}
        </th>
        <td className="numeric">
          <Amount value={amount} />
        </td>
      </tr>
    </tbody>
  );
}
function IncomeStatement({
  report,
  filters,
}: {
  report: ReportData<ReportRow>;
  filters: Filters;
}) {
  const { tr } = useERP();
  const rows = (type: string) => report.rows.filter((row) => row.type === type);
  const totals = report.totals;
  return (
    <div
      className="ar-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={tr("Income statement")}
    >
      <table
        className="ar-report-table ar-statement-table"
        data-testid="accounting-income-statement"
      >
        <caption className="sr-only">{tr("Income statement")}</caption>
        <thead>
          <tr>
            <th scope="col">{tr("Account code")}</th>
            <th scope="col">{tr("Account name")}</th>
            <th scope="col" className="numeric">
              {tr("Amount")} <bdi>({report.currency})</bdi>
            </th>
          </tr>
        </thead>
        <StatementSection
          label="Revenue"
          rows={rows("REVENUE")}
          total={totals.revenueMinor}
          filters={filters}
        />
        <StatementSection
          label="Cost of sales"
          rows={rows("COGS")}
          total={totals.costOfSalesMinor}
          filters={filters}
        />
        <StatementSubtotal
          label="Gross profit"
          amount={totals.grossProfitMinor}
        />
        <StatementSection
          label="Operating expenses"
          rows={rows("EXPENSE")}
          total={totals.operatingExpenseMinor}
          filters={filters}
        />
        <StatementSubtotal
          label="Operating profit"
          amount={totals.operatingProfitMinor}
        />
        <StatementSection
          label="Other income"
          rows={rows("OTHER_INCOME")}
          total={totals.otherIncomeMinor}
          filters={filters}
        />
        <StatementSection
          label="Other expenses"
          rows={rows("OTHER_EXPENSE")}
          total={totals.otherExpenseMinor}
          filters={filters}
        />
        <StatementSubtotal
          label="Net profit / loss"
          amount={totals.profitMinor}
          major
        />
      </table>
    </div>
  );
}
function BalanceSheet({
  report,
  filters,
}: {
  report: ReportData<ReportRow>;
  filters: Filters;
}) {
  const { tr } = useERP();
  const rows = (type: string) => report.rows.filter((row) => row.type === type);
  const totals = report.totals;
  return (
    <>
      <div
        className="ar-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={tr("Balance sheet")}
      >
        <table
          className="ar-report-table ar-statement-table"
          data-testid="accounting-balance-sheet"
        >
          <caption className="sr-only">{tr("Balance sheet")}</caption>
          <thead>
            <tr>
              <th scope="col">{tr("Account code")}</th>
              <th scope="col">{tr("Account name")}</th>
              <th scope="col" className="numeric">
                {tr("Amount")} <bdi>({report.currency})</bdi>
              </th>
            </tr>
          </thead>
          <StatementSection
            label="Assets"
            rows={rows("ASSET")}
            total={totals.assetsMinor}
            filters={filters}
          />
          <StatementSubtotal
            label="Total assets"
            amount={totals.assetsMinor}
            major
          />
          <StatementSection
            label="Liabilities"
            rows={rows("LIABILITY")}
            total={totals.liabilitiesMinor}
            filters={filters}
          />
          <StatementSection
            label="Equity"
            rows={rows("EQUITY")}
            total={totals.equityMinor}
            filters={filters}
          >
            <tr className="ar-current-result">
              <td />
              <th scope="row">
                {tr("Accumulated current earnings")}
                <small>
                  {tr("Posted income and expenses included in equity")}
                </small>
              </th>
              <td className="numeric">
                <Amount value={totals.currentEarningsMinor} />
              </td>
            </tr>
          </StatementSection>
          <StatementSubtotal
            label="Total equity including earnings"
            amount={totals.equityIncludingEarningsMinor}
          />
          <StatementSubtotal
            label="Total liabilities and equity"
            amount={totals.liabilitiesAndEquityMinor}
            major
          />
        </table>
      </div>
      <BalanceCheck
        difference={totals.differenceMinor}
        label="Assets equal liabilities and equity"
      />
    </>
  );
}

export default function AccountingReports({
  initialReport = "trial-balance",
  title,
  embedded = false,
}: {
  initialReport?: string;
  title?: string;
  embedded?: boolean;
}) {
  const kind: ReportKind =
    initialReport === "income-statement" || initialReport === "balance-sheet"
      ? initialReport
      : "trial-balance";
  const { tr } = useERP();
  const canonical = usePathname().startsWith("/accounting/");
  const filters = useFilters(kind === "balance-sheet");
  const query = queryFor(filters.applied);
  const state = useResource<ReportData<ReportRow>>(`/reports/${kind}?${query}`);
  const report = state.data;
  const actions = (
    <ExportActions
      report={kind}
      filters={filters.applied}
      ready={!!report && !state.loading}
    />
  );
  return (
    <section className={`ar-workspace ${embedded ? "ar-embedded" : ""}`}>
      {!embedded ? (
        <>
          <PageHeader
            title={title || reportLabels[kind]}
            subtitle="Financial statements from posted entries within your access scope"
          >
            {actions}
          </PageHeader>
          {!canonical ? (
            <ReportNavigation active={kind} filters={filters.applied} />
          ) : null}
        </>
      ) : (
        <div className="ar-embedded-heading">
          <h2>{tr(reportLabels[kind])}</h2>
          {actions}
        </div>
      )}
      <FilterBar
        state={filters}
        balanceSheet={kind === "balance-sheet"}
        busy={state.loading}
      />
      <Resource state={state}>
        {report ? (
          <article className="ar-report-sheet">
            <ReportHeading
              report={report}
              filters={filters.applied}
              kind={kind}
            />
            <p className="ar-scroll-hint">
              {tr("Scroll horizontally to view all columns.")}
            </p>
            {kind === "trial-balance" ? (
              <TrialBalance report={report} filters={filters.applied} />
            ) : kind === "income-statement" ? (
              <IncomeStatement report={report} filters={filters.applied} />
            ) : (
              <BalanceSheet report={report} filters={filters.applied} />
            )}
            <footer className="ar-sheet-footer">
              <span>
                {tr("All amounts in")} <bdi>{report.currency}</bdi>
              </span>
              <span>
                {tr("Accounts")}: <bdi>{report.rows.length}</bdi> ·{" "}
                {tr("Posted entries only")}
              </span>
            </footer>
          </article>
        ) : null}
      </Resource>
    </section>
  );
}

function LedgerReference({ row }: { row: LedgerRow }) {
  const { tr, allowed } = useERP();
  const sourceRoute = routeForDocumentType(row.sourceType);
  const canOpenSource =
    sourceRoute !== "/dashboard" &&
    row.sourceId &&
    allowed(routeEntry(sourceRoute).child.permission);
  return (
    <div className="ar-ledger-reference">
      <Link href={`/accounting/journals?journal=${row.journalId}`}>
        <bdi>{row.journal}</bdi>
      </Link>
      {row.source && row.source !== row.journal ? (
        canOpenSource ? (
          <Link href={`${sourceRoute}?document=${row.sourceId}`}>
            <bdi>{row.source}</bdi>
          </Link>
        ) : (
          <small>
            <bdi>{row.source}</bdi>
          </small>
        )
      ) : (
        <small>{tr(row.sourceType || row.sourceModule)}</small>
      )}
    </div>
  );
}
function LedgerStrip({
  report,
  combined,
}: {
  report: ReportData<LedgerRow>;
  combined: boolean;
}) {
  const { tr } = useERP();
  const values = [
    ["Opening balance", "openingBalanceMinor", true],
    ["Debit movement", "debitMinor", false],
    ["Credit movement", "creditMinor", false],
    ["Closing balance", "closingBalanceMinor", true],
  ] as const;
  return (
    <>
      <div className="ar-ledger-summary" aria-label={tr("Ledger balances")}>
        {values.map(([label, key, balance]) => (
          <div key={key}>
            <span>
              {tr(label)} <bdi>{report.currency}</bdi>
            </span>
            <strong>
              <Amount value={report.totals[key]} balance={balance} />
            </strong>
          </div>
        ))}
      </div>
      {combined ? (
        <p className="ar-ledger-explanation">
          {tr("Combined debit less credit across all selected accounts.")}
        </p>
      ) : null}
    </>
  );
}
export function GeneralLedger({
  initialReport = "general-ledger",
  title,
  embedded = false,
}: {
  initialReport?: string;
  title?: string;
  embedded?: boolean;
}) {
  const { tr, refs, name, date } = useERP();
  const params = useSearchParams();
  const canonical = usePathname().startsWith("/accounting/");
  const accountMode =
    initialReport === "account-ledger" || params.get("view") === "account";
  const filters = useFilters();
  const query = queryFor(filters.applied);
  query.set("page", String(filters.page));
  query.set("pageSize", String(filters.pageSize));
  const state = useResource<ReportData<LedgerRow>>(
    `/accounting/ledger?${query}`,
  );
  const report = state.data;
  const selectedAccount = (refs.accounts || []).find(
    (account: any) => String(account.id) === filters.applied.accountId,
  );
  const reportKey = accountMode ? "account-ledger" : "general-ledger";
  const actions = (
    <ExportActions
      report={reportKey}
      filters={filters.applied}
      ready={!!report && !state.loading}
      browserPrint={false}
    />
  );
  const accountHref = (row: LedgerRow) =>
    ledgerHref(row.accountId, filters.applied);
  return (
    <section className={`ar-workspace ${embedded ? "ar-embedded" : ""}`}>
      {!embedded ? (
        <>
          <PageHeader
            title={
              accountMode
                ? reportLabels[reportKey]
                : title || reportLabels[reportKey]
            }
            subtitle="Posted movements, source documents and running balance"
          >
            {actions}
          </PageHeader>
          {!canonical ? (
            <ReportNavigation active={reportKey} filters={filters.applied} />
          ) : null}
        </>
      ) : (
        <div className="ar-embedded-heading">
          <h2>{tr(reportLabels[reportKey])}</h2>
          {actions}
        </div>
      )}
      <FilterBar state={filters} ledger busy={state.loading} />
      <Resource state={state}>
        {report ? (
          <>
            <div className="ar-ledger-context">
              <h2>
                {selectedAccount ? (
                  <>
                    <bdi>{selectedAccount.code}</bdi> · {name(selectedAccount)}
                  </>
                ) : filters.applied.accountId ? (
                  <>
                    {tr("Selected account")}{" "}
                    <bdi>{filters.applied.accountId}</bdi>
                  </>
                ) : (
                  tr("All accessible accounts")
                )}
              </h2>
              <span>
                <PeriodLabel filters={filters.applied} />
              </span>
            </div>
            {accountMode && !filters.applied.accountId ? (
              <p className="ar-account-prompt">
                {tr(
                  "Choose an account to review its opening balance and movements.",
                )}
              </p>
            ) : null}
            <LedgerStrip
              report={report}
              combined={!filters.applied.accountId}
            />
            {filters.applied.search ? (
              <p className="ar-ledger-explanation">
                {tr(
                  "Search narrows displayed entries; balances include every movement in the applied period and scope.",
                )}
              </p>
            ) : null}
            <div className="ar-ledger-sheet">
              <p className="ar-scroll-hint">
                {tr("Scroll horizontally to view all columns.")}
              </p>
              <div
                className="ar-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={tr("Ledger movements")}
              >
                <table
                  className="ar-report-table ar-ledger-table"
                  data-testid="accounting-ledger"
                >
                  <caption className="sr-only">
                    {tr("Ledger movements")}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{tr("Date")}</th>
                      <th scope="col">{tr("Journal / source")}</th>
                      <th scope="col">{tr("Account / description")}</th>
                      <th scope="col" className="numeric">
                        {tr("Debit")} <bdi>({report.currency})</bdi>
                      </th>
                      <th scope="col" className="numeric">
                        {tr("Credit")} <bdi>({report.currency})</bdi>
                      </th>
                      <th scope="col" className="numeric">
                        {tr("Running balance")} <bdi>({report.currency})</bdi>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filters.page === 1 && !filters.applied.search ? (
                      <tr className="ar-opening-row">
                        <td>
                          <bdi>
                            {filters.applied.from
                              ? date(filters.applied.from)
                              : "—"}
                          </bdi>
                        </td>
                        <td>—</td>
                        <th scope="row">{tr("Opening balance")}</th>
                        <td className="numeric">—</td>
                        <td className="numeric">—</td>
                        <td className="numeric">
                          <Amount
                            value={report.totals.openingBalanceMinor}
                            balance
                          />
                        </td>
                      </tr>
                    ) : null}
                    {report.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="ar-ledger-date">
                          <bdi>{date(row.date)}</bdi>
                        </td>
                        <td>
                          <LedgerReference row={row} />
                        </td>
                        <td className="ar-ledger-description">
                          <Link href={accountHref(row)}>
                            <bdi>{row.code}</bdi> · {tr(row.account)}
                          </Link>
                          <span>{tr(row.description)}</span>
                          {row.costCenter ? (
                            <small>
                              {tr("Cost center")}: <bdi>{row.costCenter}</bdi>
                            </small>
                          ) : null}
                        </td>
                        <td className="numeric">
                          <Amount value={row.debitMinor} />
                        </td>
                        <td className="numeric">
                          <Amount value={row.creditMinor} />
                        </td>
                        <td className="numeric ar-running">
                          <Amount value={row.runningBalanceMinor} balance />
                        </td>
                      </tr>
                    ))}
                    {!report.rows.length ? (
                      <tr>
                        <td colSpan={6} className="ar-empty-cell">
                          {tr("No posted movements match these filters.")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3} scope="row">
                        {tr("Full period totals")}
                      </th>
                      <td className="numeric">
                        <Amount value={report.totals.debitMinor} />
                      </td>
                      <td className="numeric">
                        <Amount value={report.totals.creditMinor} />
                      </td>
                      <td className="numeric">
                        <Amount
                          value={report.totals.closingBalanceMinor}
                          balance
                        />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="ar-ledger-pagination">
                <label>
                  {tr("Rows per page")}
                  <select
                    value={filters.pageSize}
                    aria-label={tr("Rows per page")}
                    onChange={(event) =>
                      filters.setPageSize(Number(event.target.value))
                    }
                  >
                    {[25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <Pagination
                  page={report.pagination?.page || filters.page}
                  total={report.pagination?.total || 0}
                  pageSize={filters.pageSize}
                  onPage={filters.setPage}
                />
              </div>
            </div>
            <p className="ar-export-note">
              {tr(
                "CSV and PDF include all matching entries across every page.",
              )}
            </p>
          </>
        ) : null}
      </Resource>
    </section>
  );
}
