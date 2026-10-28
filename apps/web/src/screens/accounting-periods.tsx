"use client";
import { useState } from "react";
import { Plus, CalendarDays, LockKeyhole } from "lucide-react";
import { useERP, today } from "../core/erp-context";
import {
  PageHeader,
  Button,
  Table,
  Status,
  Fields,
  ErrorNotice,
  Confirm,
  useUnsaved,
} from "../components/ui";
type Period = {
  id: string;
  year: number;
  month: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
};
export default function FiscalPeriods() {
  const { tr, refs, allowed, date, request, refreshRefs, notify } = useERP();
  const periods: Period[] = refs.periods;
  const years = [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState<{
    period: Period;
    status: string;
  } | null>(null);
  const rows = periods
    .filter((p) => !year || p.year === Number(year))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const current = periods.find(
    (p) =>
      p.startDate.slice(0, 10) <= today() && p.endDate.slice(0, 10) >= today(),
  );
  if (create)
    return (
      <PeriodEditor
        periods={periods}
        year={Number(year) || new Date().getFullYear()}
        close={() => setCreate(false)}
        saved={async (record) => {
          await refreshRefs();
          setYear(String(record.year));
          setCreate(false);
          notify("Fiscal period created");
        }}
      />
    );
  return (
    <section className="ac-workbench">
      <PageHeader
        title="Fiscal Periods"
        subtitle="Control the dates available for financial posting."
      >
        {allowed("accounting.period.manage") ? (
          <Button primary onClick={() => setCreate(true)}>
            <Plus size={16} />
            {tr("Create fiscal period")}
          </Button>
        ) : null}
      </PageHeader>
      <div className="ac-period-context">
        <CalendarDays size={21} />
        <div>
          <span>{tr("Current period")}</span>
          <strong>{current ? tr(current.name) : tr("No fiscal period")}</strong>
        </div>
        {current ? <Status value={current.status} /> : null}
        <p>
          {tr(
            "Closed and locked periods block posting. Authorized users can reopen them.",
          )}
        </p>
      </div>
      <div className="ac-toolbar">
        <label className="ac-filter">
          <span>{tr("Fiscal year")}</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">{tr("All years")}</option>
            {[...new Set([...years, Number(year) || new Date().getFullYear()])]
              .sort((a, b) => b - a)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        </label>
        <span className="ac-muted">
          <bdi>{rows.length}</bdi> {tr("periods")}
        </span>
      </div>
      <Table
        caption="Fiscal calendar"
        rows={rows}
        columns={[
          {
            key: "name",
            label: "Period",
            render: (p) => <strong>{tr(p.name)}</strong>,
          },
          {
            key: "startDate",
            label: "Start date",
            render: (p) => <bdi>{date(p.startDate)}</bdi>,
          },
          {
            key: "endDate",
            label: "End date",
            render: (p) => <bdi>{date(p.endDate)}</bdi>,
          },
          {
            key: "status",
            label: "Status",
            render: (p) => <Status value={p.status} />,
          },
          {
            key: "posting",
            label: "Posting",
            render: (p) => (
              <span className="ac-posting-rule">
                {p.status !== "OPEN" ? <LockKeyhole size={14} /> : null}
                {tr(
                  p.status === "OPEN" ? "Posting permitted" : "Posting blocked",
                )}
              </span>
            ),
          },
          {
            key: "actions",
            label: "Control",
            render: (p) =>
              allowed("accounting.period.manage") ? (
                <div className="actions">
                  {p.status !== "OPEN" ? (
                    <Button
                      className="small"
                      onClick={() => setAction({ period: p, status: "OPEN" })}
                    >
                      {tr("Reopen period")}
                    </Button>
                  ) : null}
                  {p.status === "OPEN" ? (
                    <Button
                      className="small"
                      onClick={() => setAction({ period: p, status: "CLOSED" })}
                    >
                      {tr("Close period")}
                    </Button>
                  ) : null}
                  {p.status !== "LOCKED" ? (
                    <Button
                      className="small"
                      onClick={() => setAction({ period: p, status: "LOCKED" })}
                    >
                      {tr("Lock period")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                tr("Read only")
              ),
          },
        ]}
      />
      {action ? (
        <Confirm
          title={
            action.status === "OPEN"
              ? "Reopen period"
              : action.status === "CLOSED"
                ? "Close period"
                : "Lock period"
          }
          reason={false}
          dangerous={action.status !== "OPEN"}
          close={() => setAction(null)}
          action={async () => {
            await request(`/periods/${action.period.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: action.status }),
            });
            await refreshRefs();
            notify("Period status updated");
          }}
        />
      ) : null}
    </section>
  );
}
function PeriodEditor({
  periods,
  year,
  close,
  saved,
}: {
  periods: Period[];
  year: number;
  close: () => void;
  saved: (period: Period) => Promise<void>;
}) {
  const { tr, language, request } = useERP();
  const month =
    Array.from({ length: 12 }, (_, i) => i + 1).find(
      (m) => !periods.some((p) => p.year === year && p.month === m),
    ) || 1;
  const initialYear = periods.some((p) => p.year === year && p.month === month)
    ? year + 1
    : year;
  const calendar = (y: number, m: number) => ({
    name: new Intl.DateTimeFormat(
      language === "ar" ? "ar-EG-u-nu-latn" : "en-GB",
      { month: "long", year: "numeric", timeZone: "UTC" },
    ).format(new Date(Date.UTC(y, m - 1, 1))),
    startDate: `${y}-${String(m).padStart(2, "0")}-01`,
    endDate: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  });
  const [data, setData] = useState({
    year: String(initialYear),
    month: String(month),
    ...calendar(initialYear, month),
  });
  const [dirty, setDirty] = useState(false);
  const guard = useUnsaved(dirty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const duplicate = periods.some(
    (p) => p.year === Number(data.year) && p.month === Number(data.month),
  );
  const set = (key: string, value: string) => {
    setDirty(true);
    setData((d) => {
      const next = { ...d, [key]: value };
      const y = Number(next.year),
        m = Number(next.month);
      return (key === "year" || key === "month") &&
        y >= 2000 &&
        y <= 2200 &&
        m >= 1 &&
        m <= 12
        ? { ...next, ...calendar(y, m) }
        : next;
    });
  };
  return (
    <>
      <PageHeader
        title="Create fiscal period"
        subtitle="Choose the month and verify the posting date range."
        back={() => guard(close)}
      />
      <form
        className="ac-editor"
        onSubmit={async (e) => {
          e.preventDefault();
          if (data.endDate < data.startDate) {
            setError(tr("End date must be on or after start date."));
            return;
          }
          setBusy(true);
          setError("");
          try {
            const result = await request("/periods", {
              method: "POST",
              body: JSON.stringify(data),
            });
            setDirty(false);
            await saved(result);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="surface">
          <div className="form-section">
            <Fields
              specs={[
                {
                  key: "year",
                  label: "Year",
                  type: "number",
                  min: "2000",
                  max: "2200",
                  required: true,
                },
                {
                  key: "month",
                  label: "Month",
                  type: "number",
                  min: "1",
                  max: "12",
                  required: true,
                },
                {
                  key: "name",
                  label: "Period name",
                  required: true,
                  wide: true,
                },
                {
                  key: "startDate",
                  label: "Start date",
                  type: "date",
                  required: true,
                },
                {
                  key: "endDate",
                  label: "End date",
                  type: "date",
                  required: true,
                  min: data.startDate,
                },
              ]}
              values={data}
              set={set}
            />
            {duplicate ? (
              <p className="ac-validation">
                {tr("A period already exists for this year and month.")}
              </p>
            ) : null}
            <p className="ac-explanation">
              {tr(
                "New periods start open. Close or lock them after the accounting review.",
              )}
            </p>
          </div>
        </section>
        {error ? <ErrorNotice message={error} /> : null}
        <div className="editor-footer">
          <Status value="OPEN" />
          <div className="actions">
            <Button onClick={() => guard(close)}>{tr("Cancel")}</Button>
            <Button primary type="submit" busy={busy} disabled={duplicate}>
              {tr("Create open period")}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
