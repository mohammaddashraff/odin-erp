import { type Page } from "@playwright/test";
export const actor = {
  id: "1",
  userId: "1",
  name: "Design Review",
  email: "review@example.test",
  permissions: ["system.super_admin"],
  fieldPermissions: [],
  companyIds: ["1"],
  branchIds: ["1"],
};
const branch = { id: "1", name: "Cairo", active: true, operational: true };
const role = {
  id: "1",
  name: "Administrator",
  displayName: { en: "Administrator", ar: "مدير النظام" },
  active: true,
};
const person = {
  ...actor,
  primaryRole: role,
  additionalRoles: [],
  branches: [branch],
  branchIds: ["1"],
  active: true,
  canManage: true,
  activity: [],
  homeBranchId: "1",
  profileVersion: 1,
  revision: "test",
  authVersion: 1,
};
const names = [
  "Review account A",
  "Review account B",
  "Review account C",
  "Review account D",
  "Review account E",
];
const documents = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  number: "INV-QA-" + (101 + i),
  type: "SALES_INVOICE",
  status: "POSTED",
  currency: "EGP",
  documentDate: "2026-" + String(i + 1).padStart(2, "0") + "-12",
  createdAt: "2026-10-12T10:00:00Z",
  totalMinor: String(
    [
      28000000, 42000000, 36000000, 51000000, 46000000, 63000000, 94000000,
      72000000, 69000000, 57000000, 65000000, 82000000,
    ][i],
  ),
  remainingMinor: "1200000",
  customer: { id: "1", name: names[i % 5] },
  branch,
  lines: [],
  workflow: {},
}));
export const bootstrap = {
  tenant: { id: "1", name: "ODIN · isolated UI review", baseCurrency: "EGP" },
  branches: [branch],
  users: [person],
  roles: [role],
  companies: [{ id: "1", name: "ODIN" }],
  customers: [],
  suppliers: [],
  items: [],
  categories: [],
  units: [],
  warehouses: [],
  bankAccounts: [],
  accounts: [],
  periods: [],
  costCenters: [],
  taxes: [],
  permissions: [],
  salesEmployees: [],
  employees: [],
  departments: [],
  exchangeRates: [],
  currencies: [
    { code: "EGP", decimals: 2 },
    { code: "USD", decimals: 2 },
  ],
};
const refs = {
  branches: [branch],
  users: [actor],
  academies: [{ id: "1", name: "Review academy" }],
  banks: [],
  policies: [],
  baseCurrency: "EGP",
};
const queueRows = names.map((name, i) => ({
  kind: "documents",
  applicationId: String(i + 1),
  reference: "AV8-QA-" + (101 + i),
  name,
  issue: "Document review",
  date: "2026-10-28",
  status: "PENDING",
}));
const leads = names.map((name, i) => ({
  id: String(i + 1),
  customer: { id: String(i + 1), name, phone: "+2000000000" + i },
  source: "UI review fixture",
  status: "NEW",
  nextFollowUp: "2026-10-28T10:00:00Z",
  version: 1,
}));
export async function fixture(
  page: Page,
  mode: "populated" | "error" | "restricted" = "populated",
) {
  const records = [...leads];
  await page
    .context()
    .addCookies([
      { name: "av8_language", value: "en", url: "http://127.0.0.1:8180" },
    ]);
  await page.addInitScript(() =>
    localStorage.setItem("av8_token", "test-only-ui-session"),
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname.replace(/^\/api/, "");
    const json = (body: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/auth/me")
      return json(
        mode === "restricted"
          ? { ...actor, permissions: ["av8.workspace.view"] }
          : actor,
      );
    if (p === "/bootstrap") return json(bootstrap);
    if (mode === "error")
      return json({ message: "UI test: service unavailable" }, 503);
    if (p === "/dashboard")
      return json({
        kpis: {
          cashMinor: "48230000",
          receivablesMinor: "102460000",
          inventoryMinor: "273542000",
          pendingApprovals: 3,
        },
        lowStock: [],
        activity: [],
      });
    if (p === "/documents") return json(documents);
    if (p === "/sales/documents")
      return json({
        rows: documents.filter((d) => d.type === url.searchParams.get("type")),
        total: 12,
        page: 1,
        pageSize: 15,
        metrics: {},
        pagination: { page: 1, pageSize: 15, total: 12, totalPages: 1 },
      });
    if (p === "/sales/overview")
      return json({
        recent: documents,
        metrics: {
          awaitingApproval: 3,
          expiringSoon: 2,
          unpaidMinor: "1200000",
          salesMonthMinor: "45000000",
        },
      });
    if (p === "/sales/customers")
      return json({ rows: [], total: 0, page: 1, pageSize: 15 });
    if (p === "/av8/refs") return json(refs);
    if (p === "/av8/queues")
      return json({
        rows: queueRows,
        total: 5,
        size: 25,
        page: 1,
        counts: {
          uncontacted: 24,
          applications: 148,
          visa: 12,
          academy: 8,
          documents: 18,
          progress: 7,
          departures: 9,
          arrears: 4,
        },
      });
    if (p === "/av8/leads") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        records.push({
          ...leads[0],
          id: "100",
          customer: { id: "100", name: body.name, phone: body.phone },
          source: body.source,
        });
        return json({ id: "100" });
      }
      const search = url.searchParams.get("search") || "";
      return json({
        rows: records.filter((l) =>
          l.customer.name.toLowerCase().includes(search.toLowerCase()),
        ),
        total: records.length,
        page: 1,
        size: 25,
      });
    }
    if (/^\/av8\/leads\/\d+$/.test(p))
      return json({ ...leads[0], records: [], timeline: [] });
    if (p === "/av8/applications")
      return json({ rows: [], total: 0, size: 25, page: 1 });
    if (/^\/av8\/applications\/\d+$/.test(p))
      return json({
        id: "1",
        reference: "AV8-QA-101",
        customer: { name: names[0], phone: "+20000000001" },
        academy: refs.academies[0],
        program: "Flight training",
        admissions: "CAPTURED",
        medical: "PENDING",
        visa: "NOT_STARTED",
        travel: "NOT_STARTED",
        records: [],
        attachments: [],
        timeline: [],
        readiness: { issues: [], ready: false },
        guardian: {},
        version: 1,
      });
    if (p === "/av8/appointments" || p.startsWith("/av8/reports/"))
      return json({ rows: [], total: 0, page: 1, size: 25 });
    if (p === "/av8/funds")
      return json({ rows: [], total: 0, page: 1, size: 25 });
    if (p === "/av8/policies") return json([]);
    if (p === "/administration")
      return json({
        users: [person],
        roles: [role],
        branches: [branch],
        counts: { active: 1, inactive: 0, groups: 1 },
        canManage: true,
        activity: [],
      });
    if (p === "/profile" || p === "/administration/users/1")
      return json(person);
    if (p === "/administration/diagnostics")
      return json({
        api: { en: "Available", ar: "متاح" },
        database: { en: "UI fixture", ar: "بيانات اختبار" },
        checkedAt: "2026-10-28T10:00:00Z",
      });
    if (p === "/accounting/journals")
      return json({
        rows: [],
        pagination: { page: 1, pageSize: 15, total: 0, totalPages: 1 },
      });
    if (p === "/accounting/accounts")
      return json({
        rows: [],
        companies: bootstrap.companies,
        pagination: { page: 1, pageSize: 15, total: 0, totalPages: 1 },
      });
    if (
      p === "/hr/employees" ||
      p === "/hr/departments" ||
      p.startsWith("/hr/records/")
    )
      return json([]);
    if (
      p === "/audit" ||
      p === "/payments" ||
      p === "/approvals" ||
      p === "/access/companies"
    )
      return json([]);
    if (p === "/banking")
      return json({ accounts: [], transactions: [], statements: [] });
    if (p === "/pos") return json({ shifts: [], sales: [] });
    if (p.startsWith("/master/")) return json([]);
    return json(
      { message: "UI fixture does not emulate this backend operation" },
      503,
    );
  });
}
