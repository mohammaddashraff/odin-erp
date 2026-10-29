import { test, expect } from "@playwright/test";
import { reviewFixture } from "./fixtures";
import { t } from "../../apps/web/src/core/i18n";
const document = {
  id: "1",
  number: "DISPOSABLE-UI-01",
  type: "PURCHASE_REQUEST",
  status: "APPROVED",
  branchId: "1",
  branch: { id: "1", name: "Review branch" },
  customer: { name: "Review customer" },
  documentDate: "2026-10-28",
  currency: "EGP",
  exchangeRateMicros: "1000000",
  exchangeRateDate: "2026-10-28",
  subtotalMinor: "0",
  discountMinor: "0",
  taxMinor: "0",
  totalMinor: "0",
  lines: [],
  approvals: [],
  audit: [],
  stockMovements: [],
  targetDocuments: [],
};
for (const language of ["en", "ar"] as const)
  test(`document, customer and activity detail tabs ${language}`, async ({
    page,
  }) => {
    await reviewFixture(page, language);
    const errors: string[] = [],
      states: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/documents/1", (r) =>
      r.fulfill({ json: document }),
    );
    await page.route("**/api/private-attachments?**", (r) =>
      r.fulfill({ json: [] }),
    );
    await page.goto("/purchasing/requests?document=1");
    await expect(
      page.getByRole("heading", { name: "DISPOSABLE-UI-01" }),
    ).toBeVisible();
    for (const tab of [
      "Document details",
      "Accounting effect",
      "Inventory effect",
      "Terms",
      "Approvals",
      "Activity",
      "Attachments",
    ]) {
      await page
        .getByRole("button", { name: t(tab, language), exact: true })
        .click();
      await expect(page.locator(".loading")).toHaveCount(0);
      states.push("document:" + tab);
    }
    await page.route("**/api/sales/customers/1", (r) =>
      r.fulfill({
        json: {
          id: "1",
          name: "Disposable customer",
          code: "UI-C1",
          customerType: "BUSINESS",
          defaultCurrency: "EGP",
          creditLimitMinor: null,
          outstandingMinor: "0",
          documents: [],
          payments: [],
          statement: [],
          ageing: [],
          audit: [],
        },
      }),
    );
    await page.goto("/sales/customers?customer=1");
    await expect(
      page.getByRole("heading", { name: "Disposable customer" }),
    ).toBeVisible();
    for (const tab of [
      "Overview",
      "Documents",
      "Payments",
      "Statement",
      "Ageing",
      "Activity",
    ]) {
      await page
        .getByRole("button", { name: t(tab, language), exact: true })
        .click();
      states.push("customer:" + tab);
    }
    await page.goto("/admin/audit");
    for (const tab of ["General activity", "Account & access"]) {
      await page
        .getByRole("button", { name: t(tab, language), exact: true })
        .click();
      await expect(page.locator(".loading")).toHaveCount(0);
      states.push("activity:" + tab);
    }
    expect(states).toHaveLength(15);
    expect(errors).toEqual([]);
  });
test("document conversion retains only the source supplier and warehouse", async ({
  page,
}) => {
  await reviewFixture(page);
  await page.route("**/api/documents/1", (r) => r.fulfill({ json: document }));
  await page.goto("/purchasing/requests?document=1");
  await page.getByTestId("convert-PURCHASE_RFQ").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByLabel("Supplier", { exact: false }),
  ).toHaveValue("");
  await expect(
    page.getByRole("dialog").getByLabel("Warehouse", { exact: false }),
  ).toHaveValue("");
});
