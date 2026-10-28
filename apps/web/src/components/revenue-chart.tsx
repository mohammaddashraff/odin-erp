"use client";
import { useId, useState } from "react";
import { useERP } from "../core/erp-context";
import { Panel, Empty } from "./ui";
import { ChartNoAxesCombined } from "lucide-react";

// Presentation-only aggregation of the same posted documents used by the dashboard.
// Keep currencies separate and exact minor units until normalizing SVG coordinates.
export function RevenueChart({ documents }: { documents: any[] }) {
  const { tr, language, money, refs } = useERP();
  const id = useId().replace(/:/g, "");
  const [currency, setCurrency] = useState(refs.tenant.baseCurrency);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const rows = documents.filter(
    (d) =>
      d.status === "POSTED" &&
      ["SALES_INVOICE", "SALES_RETURN", "CREDIT_NOTE"].includes(d.type),
  );
  const currencies = [
    ...new Set<string>([
      refs.tenant.baseCurrency,
      ...rows.map((d) => d.currency),
    ]),
  ];
  const years = [
    ...new Set<string>([
      String(new Date().getFullYear()),
      ...rows.map((d) => String(d.documentDate || d.createdAt).slice(0, 4)),
    ]),
  ]
    .sort()
    .reverse();
  const totals = Array<bigint>(12).fill(0n);
  for (const d of rows) {
    const date = String(d.documentDate || d.createdAt);
    if (
      d.currency !== currency ||
      !date.startsWith(year) ||
      d.totalMinor == null
    )
      continue;
    const month = Number(date.slice(5, 7)) - 1;
    if (month >= 0 && month < 12)
      totals[month] +=
        BigInt(d.totalMinor) * (d.type === "SALES_INVOICE" ? 1n : -1n);
  }
  const min = totals.reduce((a, b) => (b < a ? b : a), 0n),
    max = totals.reduce((a, b) => (b > a ? b : a), 1n);
  const range = max - min;
  const points = totals.map((v, i) => ({
    x: 64 + i * 55,
    y: 236 - Number(((v - min) * 19000n) / range) / 100,
  }));
  const line = points
    .map((p, i) =>
      i
        ? `C${points[i - 1].x + 27.5},${points[i - 1].y} ${p.x - 27.5},${p.y} ${p.x},${p.y}`
        : `M${p.x},${p.y}`,
    )
    .join(" ");
  const baseline = 236 - Number((-min * 19000n) / range) / 100;
  return (
    <Panel
      className="glass-revenue"
      title="Revenue Analytics"
      actions={
        <div className="actions">
          <ChartNoAxesCombined className="glass-section-icon" size={21} />
          <select
            aria-label={tr("Currency")}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label={tr("Year")}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
      }
    >
      {rows.some((d) => d.totalMinor == null) ? (
        <p className="surface-body">{tr("Restricted")}</p>
      ) : rows.length ? (
        <div
          className="glass-revenue-plot"
          tabIndex={0}
          role="region"
          aria-label={tr("Revenue Analytics")}
        >
          <svg
            className="glass-revenue-svg"
            viewBox="0 0 700 285"
            role="img"
            aria-label={tr("Net sales") + " · " + currency + " · " + year}
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#329bff" stopOpacity=".65" />
                <stop offset="100%" stopColor="#329bff" stopOpacity=".02" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((i) => (
              <g key={i}>
                <line
                  x1="64"
                  x2="669"
                  y1={46 + i * 47.5}
                  y2={46 + i * 47.5}
                  stroke="#8eb8ea26"
                  strokeDasharray="3 3"
                />
                <text
                  x="56"
                  y={50 + i * 47.5}
                  textAnchor="end"
                  fill="#a9bbd5"
                  fontSize="9"
                >
                  {money(max - (range * BigInt(i)) / 4n, currency)}
                </text>
              </g>
            ))}
            <path
              d={`${line} L669,${baseline} L64,${baseline} Z`}
              fill={`url(#${id})`}
            />
            <path d={line} fill="none" stroke="#70c0ff" strokeWidth="2.5" />
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r="3.5" fill="#eefaff">
                  <title>{money(totals[i], currency)}</title>
                </circle>
                <text
                  x={p.x}
                  y="263"
                  textAnchor="middle"
                  fill="#b7cbe4"
                  fontSize="10"
                >
                  {new Intl.DateTimeFormat(
                    language === "ar" ? "ar-EG" : "en-GB",
                    { month: "short", timeZone: "UTC" },
                  ).format(new Date(Date.UTC(2026, i, 1)))}
                </text>
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <Empty />
      )}
      <p className="glass-chart-caption">
        {tr("Latest 200 accessible documents · posted amounts by currency")}
      </p>
    </Panel>
  );
}
