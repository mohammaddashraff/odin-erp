import { type Page } from "@playwright/test";
import { fixture, bootstrap, actor } from "../glass/fixtures";
import { orderAv8Rows } from "../../apps/api/src/av8-list-order";
export const branches = [
  { id: "1", name: "Review branch A", active: true, operational: true },
  { id: "2", name: "Review branch B", active: true, operational: true },
];
const staff = [
  actor,
  { ...actor, id: "2", userId: "2", name: "Review colleague" },
];
const mixedQueue = Array.from({ length: 31 }, (_, i) => ({
  applicationId: String(i + 1),
  reference: `AV8-REVIEW-${i + 1}`,
  name: `UI Review student ${String(i + 1).padStart(2, "0")}`,
  kind: i % 2 ? "arrears" : "documents",
  issue: i % 2 ? "Overdue student balance" : "Passport",
  status: i % 2 ? "OVERDUE" : "PENDING",
  date: "2026-10-28",
  ...(i % 2 ? { amountMinor: String(i * 10000), currency: "USD" } : {}),
}));
const leads = Array.from({ length: 31 }, (_, i) => ({
  id: String(i + 1),
  customer: {
    id: String(i + 1),
    name: `UI Review lead ${String(i + 1).padStart(2, "0")}`,
    phone: "+20000000" + String(i).padStart(3, "0"),
  },
  source: i % 2 ? "Facebook" : "Referral",
  program: "Flight training",
  ownerId: "1",
  branchId: "1",
  status: i % 2 ? "CONTACTED" : "NEW",
  nextFollowUp: "2026-10-29T10:00:00Z",
  inquiryAt: "2026-10-20T10:00:00Z",
  version: 1,
}));
export async function reviewFixture(page: Page, language = "en") {
  await fixture(page);
  if (process.env.REVIEW_THEME)
    await page.addInitScript(
      (theme) => localStorage.setItem("odin-theme", theme),
      process.env.REVIEW_THEME,
    );
  await page
    .context()
    .addCookies([
      { name: "av8_language", value: language, url: "http://127.0.0.1:8180" },
    ]);
  await page.route("**/api/bootstrap", (r) =>
    r.fulfill({
      json: {
        ...bootstrap,
        branches,
        customers: [{ id: "1", name: "Review customer", currency: "EGP" }],
        suppliers: [{ id: "1", name: "Review supplier" }],
        salesEmployees: staff,
      },
    }),
  );
  await page.route("**/api/av8/refs", (r) =>
    r.fulfill({
      json: {
        branches,
        users: staff,
        academies: [{ id: "1", name: "Review academy" }],
        banks: [],
        policies: [],
      },
    }),
  );
  await page.route("**/api/av8/queues?**", (r) => {
    const q = new URL(r.request().url()).searchParams,
      p = Number(q.get("page") || 1),
      rows = mixedQueue.filter(
        (x) =>
          (!q.get("kind") || x.kind === q.get("kind")) &&
          x.name.toLowerCase().includes((q.get("search") || "").toLowerCase()),
      );
    return r.fulfill({
      json: {
        rows: orderAv8Rows(rows, Object.fromEntries(q)).slice(
          (p - 1) * 25,
          p * 25,
        ),
        total: rows.length,
        page: p,
        size: 25,
        counts: {
          documents: 2,
          visa: 1,
          progress: 0,
          departures: 3,
          arrears: 1,
          academy: 0,
          applications: 31,
          uncontacted: 16,
        },
      },
    });
  });
  await page.route("**/api/av8/leads?**", (r) => {
    const q = new URL(r.request().url()).searchParams,
      p = Number(q.get("page") || 1),
      rows = leads.filter(
        (x) =>
          x.customer.name
            .toLowerCase()
            .includes((q.get("search") || "").toLowerCase()) &&
          (!q.get("status") || x.status === q.get("status")),
      );
    const sorted = orderAv8Rows(
      rows.map((r) => ({ ...r, name: r.customer.name })),
      Object.fromEntries(q),
    );
    return r.fulfill({
      json: {
        rows: sorted.slice((p - 1) * 25, p * 25),
        total: rows.length,
        page: p,
        size: 25,
      },
    });
  });
  await page.route(/\/api\/av8\/leads\/\d+$/, (r) =>
    r.fulfill({
      json: {
        ...leads[Number(r.request().url().split("/").at(-1)) - 1],
        records: [
          {
            id: "event-1",
            kind: "appointment",
            status: "SCHEDULED",
            createdAt: "2026-10-22T08:00:00Z",
            data: {
              reason: "Review appointment",
              plannedAt: "2026-10-30T09:00:00Z",
            },
          },
        ],
        timeline: [
          {
            id: "audit-1",
            action: "AV8_CREATED",
            createdAt: "2026-10-20T10:00:00Z",
            user: { name: "Review colleague" },
            newValues: { reason: "Review inquiry" },
          },
          {
            id: "audit-2",
            action: "AV8_STATUS",
            createdAt: "2026-10-24T10:00:00Z",
            user: { name: "Review colleague" },
            newValues: { reason: "Review follow-up" },
          },
        ],
      },
    }),
  );
  await page.route("**/api/access", (r) =>
    r.fulfill({
      json: {
        roles: [
          {
            id: "1",
            name: "Review team",
            displayName: { en: "Review team", ar: "فريق المراجعة" },
            descriptionLabel: { en: "Student operations", ar: "شؤون الطلاب" },
            active: true,
            userCount: 1,
            permissionKeys: ["av8.leads.view"],
            dataScopes: [],
            limits: [],
            fieldPermissions: [],
          },
        ],
        permissions: [],
        users: staff,
        configuration: {
          scopeDefinitions: [],
          limits: [],
          fields: [],
          assignableResources: {},
        },
      },
    }),
  );
  await page.route("**/api/reports/*", (r) =>
    r.fulfill({ json: { rows: [], totals: {} } }),
  );
  await page.route("**/api/administration/authority-limits", (r) =>
    r.fulfill({
      json: {
        canManage: true,
        policies: [],
        definitions: [],
        currencies: [],
        companies: [],
        roles: [],
      },
    }),
  );
}
