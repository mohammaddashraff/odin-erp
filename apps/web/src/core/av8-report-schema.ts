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
  "bank-fees": [...base,field("status","Status","status"),field("fundId","Original academy transfer"),field("feeOriginalMinor","Actual transfer fee","money"),field("currency","Currency"),field("usdMinor","USD equivalent","money"),field("cashReimbursedUsdMinor","Reimbursed (USD)","money"),field("remainingUsdMinor","Remaining reimbursement (USD)","money"),field("postingDate","Posting date","date")],
  services: [...base, field("kind","Type","message"),field("status","Status","status"),field("provider","Provider"),field("period","Monthly period"),field("date","Date","date"),field("amountMinor","Amount","money"),field("currency","Currency"),field("remainingMinor","Remaining","money")],
  insurance: [...base,field("status","Status","status"),field("date","Payment date","date"),field("invoiceReference","Insurance policy / invoice reference"),field("amountMinor","Expense amount (USD)","money"),field("refundEligible","Approved as eligible refund expense","boolean")],
  "academic-delivery": [...base,field("period","Reporting period"),field("recipientKind","Recipient","message"),field("address","Email"),field("status","Status","status"),field("date","Date","date"),field("providerReference","Provider message reference")],
  training: [...base,field("status","Training event","status"),field("date","Event date","date"),field("reason","Reason / notes")],
  graduation: [...base,field("status","Status","status"),field("date","Graduation date","date"),field("notes","Outstanding follow-up actions")],
  refunds: [...base,field("status","Status","status"),field("terminationDate","Termination date","date"),field("deadline","Refund deadline","date"),field("deadlineBreached","Deadline breached","boolean"),field("approvedMinor","Calculated entitlement","money"),field("paidMinor","Paid","money"),field("remainingMinor","Remaining","money"),field("recoveryStatus","Academy recovery status","status"),field("recoveredMinor","Academy reimbursement received","money")],
  cheques: [...base,field("chequeNumber","Cheque number"),field("status","Status","status"),field("amountMinor","Original amount","money"),field("currency","Currency"),field("receivedDate","Received date","date"),field("dueDate","Cheque due date","date"),field("clearedDate","Clearance date","date"),field("returnedDate","Return date","date")],
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
    field("dueDate", "Due date", "date"),field("status", "Status", "status"),field("availableFundingMinor", "Available funding", "money"),
    field("predeparture", "Before departure", "boolean"),
  ],
  collections: [
    ...base,
    field("externalReference", "Payment reference"),
    field("branchId", "Application branch"),
    field("collectionBranchId", "Collection branch"),
    field("resourceBranchId", "Resource branch"),
    field("bankAccountId", "Account"),
    field("method", "Payment method", "message"),
    field("feeOriginalMinor", "Bank fee deducted", "money"),
    field("kind", "Type", "status"),
    field("status", "Status", "status"),
    field("amountMinor", "Net original amount", "money"),
    field("usdMinor", "USD equivalent", "money"),
    field("postingDate", "Posting date", "date"),
  ],
  commission: [
    ...base,
    field("contractualCommissionMinor", "Contractual commission", "money"),
    field("basis", "Terms basis", "message"),
    field("netCashRetainedMinor", "Student funds retained before other operating expenses", "money"),
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
