"use client";
import Link from "next/link";
import {
  ArrowUpRight,
  Users,
  FileCheck2,
  Clock3,
  Wallet,
  ChartNoAxesCombined,
  ArrowRightLeft,
  ChevronRight,
  Plane,
  ClipboardCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useERP } from "../core/erp-context";
import { Panel, Empty, Status } from "./ui";

export function GlassMetric({
  label,
  value,
  icon,
  detail,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  detail: string;
  onClick?: () => void;
}) {
  const { tr } = useERP();
  const body = (
    <>
      <span className="glass-metric-heading">
        <span className="glass-icon">{icon}</span>
        <span>{tr(label)}</span>
        {onClick ? (
          <ArrowUpRight className="glass-metric-arrow" size={17} />
        ) : null}
      </span>
      <strong className="glass-metric-value">{value}</strong>
      <span className="glass-metric-note">{tr("Current company")}</span>
      <span className="glass-metric-footer">
        {tr(detail)}
        <span className="glass-spark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="glass-metric" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="glass-metric">{body}</div>
  );
}

type Queue = {
  kind: string;
  applicationId: string;
  reference: string;
  name: string;
  issue: string;
  date?: string;
  status?: string;
};
export function QueueDashboard({
  data,
  select,
  navigate,
}: {
  data: { counts?: Record<string, number | null>; rows?: Queue[] };
  select: (key: string) => void;
  navigate: (path: string) => void;
}) {
  const { tr, allowed } = useERP();
  const counts = data.counts || {};
  const metrics = [
    {
      key: "uncontacted",
      label: "Uncontacted leads",
      icon: Users,
      detail: "Leads & follow-ups",
      action: () => navigate("/av8/leads?queue=uncontacted"),
      permission: "av8.leads.view",
    },
    {
      key: "applications",
      label: "Applications & students",
      icon: FileCheck2,
      detail: "Student recruitment & admissions",
      action: () => navigate("/av8/students"),
      permission: "av8.applications.view",
    },
    {
      key: "visa",
      label: "Visa follow-up",
      icon: Clock3,
      detail: "Outstanding requirements",
      action: () => select("visa"),
      permission: "av8.applications.view",
    },
    {
      key: "academy",
      label: "Awaiting academy transfer",
      icon: Wallet,
      detail: "Collections & academy",
      action: () => select("academy"),
      permission: "av8.finance.view",
    },
  ].filter((m) => allowed(m.permission) && counts[m.key] != null);
  const categories = [
    ["documents", "Documents"],
    ["visa", "Visa"],
    ["progress", "Progress"],
    ["departures", "Departures"],
    ...(allowed("av8.finance.view")
      ? [
          ["arrears", "Arrears"],
          ["academy", "Academy"],
        ]
      : []),
  ];
  const maximum = Math.max(
    1,
    ...categories.map(([key]) => Number(counts[key] || 0)),
  );
  return (
    <section className="glass-dashboard" aria-label={tr("Dashboard Overview")}>
      <h1 className="sr-only">{tr("Dashboard Overview")}</h1>
      <div className="glass-metrics">
        {metrics.map((m) => (
          <GlassMetric
            key={m.key}
            label={m.label}
            value={counts[m.key]}
            detail={m.detail}
            icon={<m.icon size={25} />}
            onClick={m.action}
          />
        ))}
      </div>
      <div className="glass-dashboard-grid">
        <Panel
          className="glass-analytics"
          title="Outstanding requirements"
          actions={
            <ChartNoAxesCombined className="glass-section-icon" size={23} />
          }
        >
          <div
            className="glass-chart"
            role="group"
            aria-label={tr("Outstanding requirements")}
          >
            <div className="glass-chart-grid" aria-hidden="true">
              {[4, 3, 2, 1, 0].map((n) => (
                <div key={n}>
                  <span>{Math.ceil((maximum * n) / 4)}</span>
                </div>
              ))}
            </div>
            <div className="glass-chart-bars">
              {categories.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-label={tr(label) + ": " + (counts[key] || 0)}
                  onClick={() => select(key)}
                >
                  <span className="glass-bar-track">
                    <span
                      className="glass-bar"
                      style={{
                        height: `${(Number(counts[key] || 0) / maximum) * 100}%`,
                      }}
                    />
                    <b>{counts[key] || 0}</b>
                  </span>
                  <span>{tr(label)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="glass-chart-caption">
            {tr("Follow-up queue")} · {tr("Current company")}
          </p>
        </Panel>
        <Panel
          className="glass-activity"
          title="Follow-up queue"
          actions={<ArrowRightLeft className="glass-section-icon" size={23} />}
        >
          {data.rows?.length ? (
            <div className="glass-transaction-list">
              {data.rows.slice(0, 5).map((row, i) => (
                <Link
                  href={`/av8/students?student=${row.applicationId}`}
                  className="glass-transaction"
                  key={row.applicationId + "-" + i}
                >
                  <span className="glass-avatar">{row.name.slice(0, 2)}</span>
                  <span className="glass-transaction-name">
                    <strong>{row.name}</strong>
                    <small>
                      {row.reference} · {tr(row.issue)}
                    </small>
                  </span>
                  <span className="glass-transaction-date">
                    {row.date?.slice(0, 10) || "—"}
                  </span>
                  {row.status ? (
                    <Status value={row.status} />
                  ) : (
                    <span className="status neutral">{tr(row.kind)}</span>
                  )}
                  <ChevronRight size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Panel>
        <Panel
          title="Student affairs"
          actions={<ClipboardCheck className="glass-section-icon" size={23} />}
        >
          <div className="glass-shortcuts">
            {categories.slice(0, 3).map(([key, label]) => (
              <button key={key} onClick={() => select(key)}>
                <span>{tr(label)}</span>
                <strong>{counts[key] || 0}</strong>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Panel>
        <Panel
          title="Next steps"
          actions={<Plane className="glass-section-icon" size={23} />}
        >
          <div className="glass-shortcuts">
            {[
              ["/av8/appointments", "Appointment calendar", "av8.leads.view"],
              [
                "/av8/students",
                "Applications & students",
                "av8.applications.view",
              ],
              ["/av8/finance", "Collections & academy", "av8.finance.view"],
            ]
              .filter(([, , permission]) => allowed(permission))
              .map(([href, label]) => (
                <Link key={href} href={href}>
                  <span>{tr(label)}</span>
                  <ChevronRight size={16} />
                </Link>
              ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
