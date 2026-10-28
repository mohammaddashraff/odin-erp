import { allRoutes } from "./navigation";
export const accountTypes = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "COGS",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
] as const;
export type AccountType = (typeof accountTypes)[number];
export const accountTypeLabels: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  COGS: "Cost of sales",
  EXPENSE: "Operating expenses",
  OTHER_INCOME: "Other income",
  OTHER_EXPENSE: "Other expenses",
};
export interface AccountingAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  postingAllowed: boolean;
  controlType: string | null;
  active: boolean;
  hasActivity?: boolean;
  editable?: boolean;
  hasChildren?: boolean;
  linkedBank?: boolean;
  companyIds?: string[];
}
export interface JournalLine {
  id?: string;
  accountId: string;
  account?: AccountingAccount;
  description: string;
  debitMinor: string;
  creditMinor: string;
  costCenter?: string | null;
}
export interface Journal {
  id: string;
  number: string;
  description: string;
  postingDate: string;
  branchId: string;
  status: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  currency: string;
  lines?: JournalLine[];
  createdById: string;
  submittedById?: string;
  createdBy?: { name: string };
  submittedBy?: { name: string };
  approvedBy?: { name: string };
  postedBy?: { name: string };
  createdAt?: string;
  submittedAt?: string;
  approvedAt?: string;
  postedAt?: string;
  reversesEntry?: { id: string; number: string } | null;
  reversedBy?: { id: string; number: string } | null;
  reversesEntryId?: string;
  reversalReason?: string;
}
export interface Paged<T> {
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
export function inputMinor(value: string): bigint | null {
  const raw = value.trim();
  if (raw && !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(raw))
    return null;
  const canonical = raw.replace(/,/g, "");
  if (!canonical) return 0n;
  if (!/^\d+(?:\.\d{0,2})?$/.test(canonical)) return null;
  const [whole, fraction = ""] = canonical.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function journalTotals(lines?: JournalLine[]) {
  if (!Array.isArray(lines)) return null;
  return lines.reduce(
    (sum, line) => ({
      debit: sum.debit + BigInt(line.debitMinor),
      credit: sum.credit + BigInt(line.creditMinor),
    }),
    { debit: 0n, credit: 0n },
  );
}
export function sourceDocumentLink(sourceType: string, sourceId: string) {
  const route = allRoutes.find(({ child }) => child.documentType === sourceType)
    ?.child.route;
  return route && sourceId
    ? `${route}?document=${encodeURIComponent(sourceId)}`
    : null;
}
export function debitNature(type: AccountType) {
  return ["ASSET", "COGS", "EXPENSE", "OTHER_EXPENSE"].includes(type);
}
