import { test, expect } from "@playwright/test";
import { login, ready } from "./helpers";
import { reportCatalog } from "../../apps/web/src/screens/reports";
const roles = [
  "admin",
  "cfo",
  "finance",
  "accountant",
  "auditor",
  "sales",
  "sales.employee",
  "purchasing",
  "warehouse",
  "cashier",
  "hr",
  "branch",
];
test("all twelve seeded roles, denied navigation, invalid login, refresh and cross-tab logout", async ({
  browser,
}) => {
  test.setTimeout(120000);
  for (const role of roles) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, role + "@odin.demo");
    await ready(page);
    expect(errors, role).toEqual([]);
    if (role === "purchasing") {
      await page.getByTestId("nav-banking").click();
      // A module with one permitted page navigates directly to that page.
      await expect(page).toHaveURL(/banking\/allocations$/);
      await ready(page);
      await expect(page.locator("main h1")).toHaveText("Receipts & Payments");
    }
    if (role === "cashier") {
      await expect(page.getByTestId("nav-pos")).toBeVisible();
      for (const id of [
        "sales",
        "purchasing",
        "inventory",
        "accounting",
        "banking",
        "approvals",
        "reports",
        "admin",
      ])
        await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    }
    if (role === "warehouse" || role === "accountant") {
      const destinations =
        role === "warehouse"
          ? [
              ["sales", "deliveries", "/sales/deliveries", "sales-orders"],
              [
                "purchasing",
                "goods-receipts",
                "/purchasing/receipts",
                "purchase-orders",
              ],
            ]
          : [
              ["sales", "sales-invoices", "/sales/invoices", "sales-orders"],
              [
                "purchasing",
                "supplier-bills",
                "/purchasing/bills",
                "purchase-orders",
              ],
            ];
      for (const [module, child, path, forbidden] of destinations) {
        await page.getByTestId(`nav-${module}`).click();
        const childLink = page.getByTestId(`nav-${child}`);
        if (await childLink.count()) await childLink.click();
        await expect(page).toHaveURL(new RegExp(path + "$"));
        await ready(page);
        await expect(page.getByTestId(`nav-${forbidden}`)).toHaveCount(0);
      }
    }
    if (role === "sales.employee") {
      await page.goto("/settings/access/roles");
      await expect(
        page.getByRole("heading", { name: "Access Denied" }),
      ).toBeVisible();
      const denied = await page.evaluate(async () => {
        const r = await fetch("/api/access", {
          headers: {
            Authorization: "Bearer " + localStorage.getItem("odin_token"),
          },
        });
        return r.status;
      });
      expect(denied).toBe(403);
    }
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/dashboard");
  await page.getByTestId("login-email").fill("admin@odin.demo");
  await page.getByTestId("login-password").fill("incorrect-test-password");
  await page.getByTestId("login-submit").click();
  await expect(page.locator(".form-error")).toContainText(/Invalid|incorrect/i);
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await expect(page.locator(".context-bar")).toBeVisible();
  await ready(page);
  await page.evaluate(() =>
    localStorage.setItem("odin_token", "expired-test-token"),
  );
  await page.reload();
  await ready(page);
  await expect(page.locator(".context-bar")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/sales/customers");
  await ready(second);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(second.getByTestId("login-email")).toBeVisible();
  await context.close();
});
test("all report choices, CSV/PDF download, ledger drillthrough and source evidence dialog", async ({
  page,
}) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto("/reports/overview");
  await ready(page);
  for (const [key, label] of reportCatalog) {
    await page
      .locator(".report-menu")
      .getByRole("button", { name: label, exact: true })
      .click();
    await ready(page);
    for (const name of ["Export CSV", "Print PDF"]) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name, exact: true }).click();
      const file = await download;
      expect(await file.failure()).toBeNull();
      expect(file.suggestedFilename()).toBe(
        key + (name === "Export CSV" ? ".csv" : ".pdf"),
      );
    }
  }
  await page
    .locator(".report-menu")
    .getByRole("button", { name: "General ledger", exact: true })
    .click();
  await ready(page);
  const journalLink = page.locator('.ar-ledger-reference a[href*="/accounting/journals?"]').first();
  const journalNumber = (await journalLink.innerText()).trim();
  await journalLink.click();
  await expect(page).toHaveURL(/accounting\/journals\?journal=/);
  await ready(page);
  await expect(page.locator("main h1")).toHaveText(journalNumber);
  await page.goto("/reports/overview");
  await ready(page);
  await page.locator(".report-menu").getByRole("button", { name: "Stock movements", exact: true }).click();
  await ready(page);
  await page.locator("tbody button.link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".loading")).toHaveCount(0);
  await expect(page.getByRole("dialog").locator(".error-notice")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("governance context, safe preview, review and role lifecycle", async ({
  page,
}) => {
  await login(page);
  page.on("dialog", (d) => d.accept("password"));
  await page.goto("/settings/access/governance");
  await ready(page);
  await page.getByRole("button", { name: "Run safe preview" }).click();
  await expect(page.getByTestId("access-safe-preview")).toContainText(
    "SAFE PREVIEW",
  );
  const member = page.getByLabel("Company member");
  const values = await member
    .locator("option")
    .evaluateAll((ns) => ns.map((n) => (n as HTMLOptionElement).value));
  if (values.length > 1) {
    await member.selectOption(values[1]);
    await expect(page.getByTestId("access-safe-preview")).toHaveCount(0);
    await ready(page);
  }
  await page
    .getByRole("textbox", { name: /Reason/ })
    .fill("UI replacement access review");
  const reviewed = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/access/reviews") &&
      r.request().method() === "POST" &&
      r.status() !== 403,
  );
  await page.getByRole("button", { name: "Record access review" }).click();
  expect((await reviewed).ok()).toBe(true);
  await expect(page.locator("tbody").last()).toContainText(
    "UI replacement access review",
  );
  await page.goto("/settings/access/roles");
  await ready(page);
  await page.getByRole("button", { name: "Create Role", exact: true }).click();
  const role = "UI QA " + Date.now();
  await page.getByLabel("Role Name").fill(role);
  await page.getByRole("button", { name: "Fields", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Access customer.creditLimitMinor",
      exact: true,
    })
    .selectOption("VIEW");
  await page.getByRole("button", { name: "Scopes", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Data scopes customer", exact: true })
    .selectOption("OWN");
  await page.getByRole("button", { name: "Save Role", exact: true }).click();
  await expect(page.locator("tbody")).toContainText(role);
  const row = page.locator("tbody tr").filter({ hasText: role });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("QA persisted field and scope policy");
  await page.getByRole("button", { name: "Save Role" }).click();
  await expect(row).toContainText("QA persisted");
  await row.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("tbody")).toContainText(role + " Copy");
  await page
    .locator("tbody tr")
    .filter({ hasText: role + " Copy" })
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("user access editor persists MFA requirements and explicit permission overrides", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/access/users");
  await ready(page);
  const row = () =>
    page.locator("tbody tr").filter({ hasText: "hr@odin.demo" });
  await row()
    .getByRole("button", { name: "Edit User Access", exact: true })
    .click();
  const original = await page
    .getByLabel("Require MFA", { exact: true })
    .isChecked();
  try {
    await page.getByLabel("Require MFA", { exact: true }).setChecked(!original);
    await page
      .getByRole("combobox", { name: "Select permission", exact: true })
      .selectOption("inventory.item.view");
    await expect(
      page.getByRole("combobox", { name: "Select permission", exact: true }),
    ).toHaveValue("inventory.item.view");
    await page
      .getByRole("button", { name: "Add Override", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Remove", exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Isolated UI access review");
    await page
      .getByRole("button", { name: "Save User Access", exact: true })
      .click();
    await ready(page);
    await row()
      .getByRole("button", { name: "Edit User Access", exact: true })
      .click();
    expect(
      await page.getByLabel("Require MFA", { exact: true }).isChecked(),
    ).toBe(!original);
    await expect(
      page.getByRole("textbox", { name: "Reason", exact: true }),
    ).toHaveValue("Isolated UI access review");
    await expect(
      page.getByRole("combobox", { name: "Effect", exact: true }),
    ).toHaveValue("DENY");
  } finally {
    await page.getByLabel("Require MFA", { exact: true }).setChecked(original);
    if (await page.getByRole("button", { name: "Remove", exact: true }).count())
      await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("button", { name: "Save User Access", exact: true })
      .click();
    await ready(page);
  }
});

test("signing into another account clears the previous account notifications", async ({
  page,
}) => {
  await login(page);
  await page.goto("/reports/overview");
  await ready(page);
  await page.route("**/api/reports/*/csv*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Prior account export unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  await expect(page.locator(".notices")).toContainText(
    "Prior account export unavailable",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, "purchasing@odin.demo");
  await ready(page);
  await expect(page.locator(".notices .notice")).toHaveCount(0);
});
