type ReportField = {
  key: string;
  label: string;
  type?: "status" | "money" | "date" | "number" | "boolean" | "message";
};
const field = (
  key: string,
  label: string,
  type?: ReportField["type"],
): ReportField => ({ key, label, type });
const base = [
  field("reference", "Reference"),
  field("name", "Name"),
  field("academy", "Academy"),
];
const queue = [
  field("reference", "Application"),
  field("name", "Name"),
  field("issue", "Outstanding requirements", "message"),
  field("date", "Date", "date"),
  field("status", "Status", "status"),
  field("amountMinor", "Amount", "money"),
];
const leads = [
  field("name", "Name"),
  field("source", "Inquiry source"),
  field("owner", "Owner ID"),
  field("status", "Status", "status"),
  field("inquiryAt", "Inquiry date", "date"),
  field("firstContactAt", "First contact", "date"),
  field("responseMinutes", "Response time (minutes)", "number"),
  field("nextFollowUp", "Next follow-up", "date"),
  field("overdue", "Overdue", "boolean"),
];
const performance = [
  field("group", "Group"),
  field("totalLeads", "Total leads", "number"),
  field("converted", "Converted", "number"),
  field("conversionPercent", "Conversion (%)", "number"),
  field("contacted", "Contacted", "number"),
  field("averageResponseMinutes", "Average response (minutes)", "number"),
  field("followUpsOverdue", "Overdue follow-ups", "number"),
];
export const av8ReportSchemas: Record<string, ReportField[]> = {
  applications: [
    ...base,
    field("admissions", "Admissions", "status"),
    field("visa", "Visa", "status"),
    field("travel", "Travel", "status"),
  ],
  documents: queue,
  visa: queue,
  departures: queue,
  progress: queue,
  arrears: queue,
  leads,
  response: leads,
  "source-performance": performance,
  "owner-performance": performance,
  medical: [
    ...base,
    field("medical", "Medical", "status"),
    field("refund", "Refund", "status"),
  ],
  "student-balances": [
    ...base,
    ...[
      ["totalMinor", "Total"],
      ["paidMinor", "Paid"],
      ["remainingMinor", "Remaining"],
      ["overdueMinor", "Overdue"],
      ["unappliedMinor", "Unapplied credit"],
      ["refundedMinor", "Refunded"],
    ].map(([key, label]) => field(key, label, "money")),
  ],
  academy: [
    ...base,
    field("key", "Obligation"),
    field("obligationMinor", "Obligation amount", "money"),
    field("remittedMinor", "Remitted", "money"),
    field("remainingMinor", "Remaining", "money"),
    field("predeparture", "Before departure", "boolean"),
  ],
  collections: [
    ...base,
    field("kind", "Type", "status"),
    field("status", "Status", "status"),
    field("amountMinor", "Original amount", "money"),
    field("usdMinor", "USD equivalent", "money"),
    field("postingDate", "Posting date", "date"),
  ],
  commission: [
    ...base,
    field("contractualCommissionMinor", "Contractual commission", "money"),
    field("basis", "Terms basis", "message"),
    field("netCashRetainedMinor", "Net cash retained", "money"),
    field("academyHeldDeferredMinor", "Academy funds held", "money"),
    field("accountingProfit", "Accounting profit", "message"),
  ],
};
export const leadSources = [
  "Facebook",
  "Instagram",
  "Website",
  "Referral",
  "Walk-in",
  "Phone",
  "WhatsApp",
];
export const leadPrograms = ["Flight training"];
// Canonicalize only known input labels. Historic/custom business values remain intact.
export function canonicalLeadInput(value: any) {
  const normalize = (input: any, known: string[]) =>
    known.find(
      (label) =>
        label.toLocaleLowerCase() ===
        String(input || "")
          .normalize("NFKC")
          .trim()
          .toLocaleLowerCase(),
    ) || String(input || "").trim();
  return {
    ...value,
    source: normalize(value.source, leadSources),
    program: normalize(value.program, leadPrograms),
  };
}
