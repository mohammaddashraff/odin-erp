// Presentation ordering only. Call after authorization/filtering and before pagination.
const av8SortKeys = [
  "name",
  "reference",
  "source",
  "status",
  "firstContactAt",
  "nextFollowUp",
  "date",
  "plannedAt",
  "amountMinor",
  "program",
  "admissions",
  "visa",
  "travel",
  "inquiryAt",
  "postingDate",
  "totalMinor",
  "paidMinor",
  "remainingMinor",
  "overdueMinor",
  "group",
  "totalLeads",
  "converted",
  "conversionPercent",
  "contacted",
  "averageResponseMinutes",
  "followUpsOverdue",
] as const;

type SortQuery = { sort?: unknown; direction?: unknown };
type SortableRow = Record<string, unknown>;

const sortKeySet = new Set<string>(av8SortKeys);
const databaseSortKeys = {
  leads: new Set([
    "name",
    "source",
    "status",
    "inquiryAt",
    "firstContactAt",
    "nextFollowUp",
  ]),
  applications: new Set([
    "name",
    "reference",
    "program",
    "admissions",
    "visa",
    "travel",
  ]),
};
const nullableDateKeys = new Set(["firstContactAt", "nextFollowUp"]);

function rowIdentity(row: SortableRow) {
  return String(
    row.id ??
      [
        row.applicationId,
        row.kind,
        row.reference,
        row.issue,
        row.key,
        row.group,
      ].join("|"),
  );
}

export function av8DatabaseOrder(
  kind: "leads" | "applications",
  query: SortQuery,
): any[] {
  const key = String(query.sort || "");
  const direction = query.direction === "desc" ? "desc" : "asc";
  if (!databaseSortKeys[kind].has(key)) {
    return kind === "leads"
      ? [{ inquiryAt: "desc" }, { id: "desc" }]
      : [{ id: "desc" }];
  }

  const order =
    key === "name"
      ? { customer: { name: direction } }
      : nullableDateKeys.has(key)
        ? { [key]: { sort: direction, nulls: "last" } }
        : { [key]: direction };
  return [order, { id: "asc" }];
}

export function orderAv8Rows<T extends SortableRow>(
  rows: T[],
  query: SortQuery,
): T[] {
  const key = String(query.sort || "");
  if (!sortKeySet.has(key)) return rows;

  const direction = query.direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = a.row[key];
      const right = b.row[key];
      if (left == null && right != null) return 1;
      if (right == null && left != null) return -1;

      let comparison = 0;
      if (left != null && right != null) {
        if (key.endsWith("Minor")) {
          const leftMinor = BigInt(String(left));
          const rightMinor = BigInt(String(right));
          comparison =
            leftMinor < rightMinor ? -1 : leftMinor > rightMinor ? 1 : 0;
        } else if (typeof left === "number" || key === "conversionPercent") {
          comparison = Number(left) - Number(right);
        } else {
          comparison = String(left).localeCompare(String(right), undefined, {
            numeric: true,
          });
        }
      }

      return (
        comparison * direction ||
        rowIdentity(a.row).localeCompare(rowIdentity(b.row), undefined, {
          numeric: true,
        }) ||
        a.index - b.index
      );
    })
    .map(({ row }) => row);
}
