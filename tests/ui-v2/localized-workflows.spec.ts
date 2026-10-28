import { test, expect } from "@playwright/test";
import { allRoutes, legacyRedirects } from "../../apps/web/src/core/navigation";
import { login, ready } from "./helpers";
import { savedResponse, openDocument, confirmed } from "./workflow";
test("all Arabic routes, canonical bookmarks, Western input digits and guarded language switch", async ({
  page,
}) => {
  test.setTimeout(180000);
  await login(page);
  await page.getByTestId("language-toggle").click();
  await ready(page);
  for (const { child } of allRoutes) {
    await page.goto(child.route);
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.locator("main h1").innerText(), child.route).toMatch(
      /[\u0600-\u06ff]/,
    );
    expect(await page.locator("body").innerText()).not.toMatch(/[٠-٩۰-۹]/);
  }
  await page.goto("/sales/customers");
  await ready(page);
  await page.getByTestId("new-customer").click();
  await page.getByTestId("master-customer-name").fill("عميل ١٢۳");
  await expect(page.getByTestId("master-customer-name")).toHaveValue(
    "عميل 123",
  );
  const limit = page.getByRole("textbox", { name: /الحد الائتماني/ });
  await limit.fill("١٢٣٬٤٥٦٫٧٨");
  await expect(limit).toHaveValue("123,456.78");
  expect(
    await page
      .locator(
        'input[inputmode="decimal"],input[type="date"],input[type="number"]',
      )
      .evaluateAll((ns) =>
        ns.every(
          (n) =>
            n.getAttribute("lang") === "en" && n.getAttribute("dir") === "ltr",
        ),
      ),
  ).toBe(true);
  page.once("dialog", (d) => d.dismiss());
  await page.getByTestId("language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("master-customer-name")).toHaveValue(
    "عميل 123",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  for (const [from, to] of Object.entries(legacyRedirects)) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(to + "$"));
    await ready(page);
  }
});
test("password visibility, manual exchange-rate validation, foreign-currency draft and review decisions", async ({
  page,
  browser,
}) => {
  await page.goto("/dashboard");
  await page.getByTestId("login-password").fill("VisiblePasswordExample!");
  await expect(page.getByTestId("login-password")).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByTestId("show-password").check();
  await expect(page.getByTestId("login-password")).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByTestId("show-password").uncheck();
  await login(page);
  await page.goto("/sales/quotations");
  await ready(page);
  await page.getByTestId("new-document").click();
  await page.getByLabel("Currency").selectOption("USD");
  await expect(
    page.getByLabel("Exchange rate *", { exact: true }),
  ).not.toHaveValue("");
  await page.getByLabel("Override system exchange rate").check();
  await page.getByLabel("Exchange rate *", { exact: true }).fill("49.123456");
  await page.getByTestId("save-document").click();
  expect(
    await page
      .getByLabel("Exchange rate override reason")
      .evaluate((n: HTMLInputElement) => n.validity.valueMissing),
  ).toBe(true);
  await page
    .getByLabel("Exchange rate override reason")
    .fill("Isolated QA negotiated rate");
  const foreign = await savedResponse(page, "Save draft", "/documents");
  expect(foreign.currency).toBe("USD");
  expect(foreign.exchangeRateMicros).toBe("49123456");
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, "branch@odin.demo");
  await page.goto("/sales/orders");
  await ready(page);
  await page.getByTestId("new-document").click();
  const d = await savedResponse(page, "Save draft", "/documents");
  await confirmed(page, "Submit for approval", `/documents/${d.id}/submit`);
  await openDocument(checker, d);
  await confirmed(checker, "Add Comment", `/documents/${d.id}/comment`);
  await confirmed(
    checker,
    "Request Changes",
    `/documents/${d.id}/request-changes`,
  );
  await openDocument(page, d);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await confirmed(page, "Submit for approval", `/documents/${d.id}/submit`);
  await openDocument(checker, d);
  await confirmed(checker, "Reject", `/documents/${d.id}/reject`);
  await expect(checker.locator(".page-heading .status")).toHaveText(
    /REJECTED/i,
  );
  await context.close();
});

test("Arabic form defaults, persisted normalized input, dynamic messages and conversion dialog", async ({
  page,
}) => {
  await login(page);
  await page.getByTestId("language-toggle").click();
  await ready(page);
  await page.goto("/sales/customers");
  await ready(page);
  await page.getByTestId("new-customer").click();
  await page
    .getByTestId("master-customer-name")
    .fill("عميل تحقق " + Date.now() + " ١٢۳");
  await page
    .getByRole("textbox", { name: /الحد الائتماني/ })
    .fill("١٢٣٬٤٥٦٫٧٨");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/masters/customers") && r.request().method() === "POST",
  );
  await page.getByTestId("save-customer").click();
  const result = await saved;
  expect(result.ok(), await result.text()).toBe(true);
  const customer = await result.json();
  expect(customer.name).toMatch(/123$/);
  expect(customer.creditLimitMinor).toBe("12345678");
  await page.goto("/accounting/journals");
  await ready(page);
  await page
    .getByRole("button", { name: "قيد يومية يدوي جديد", exact: true })
    .click();
  // A real manual journal starts empty; all controls and validation remain localized.
  await expect(page.getByRole("textbox", { name: /^البيان/ })).toHaveValue("");
  await expect(page.getByLabel("بيان البند 1", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("بيان البند 2", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("حساب الترحيل 1", { exact: true })).toHaveValue("");
  await page.getByLabel("مدين 1", { exact: true }).fill("١٢٣٬٤٥٦٫٧٨");
  await expect(page.getByLabel("مدين 1", { exact: true })).toHaveValue("123,456.78");
  await expect(page.getByRole("button", { name: "إنشاء مسودة قيد متوازن", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.goto("/banking/transactions");
  await ready(page);
  await page.getByRole("button", { name: "حركة بنكية", exact: true }).click();
  await expect(page.locator('input[value="حركة بنكية"]')).toHaveCount(1);
  await page.goto("/banking/statements");
  await ready(page);
  await page
    .getByRole("button", { name: "استيراد حركة كشف حساب", exact: true })
    .click();
  await expect(
    page.locator('input[value="حركة مستوردة من كشف الحساب"]'),
  ).toHaveCount(1);
  await page.goto("/sales/quotations");
  await ready(page);
  await page.getByTestId("new-document").click();
  const draft = page.waitForResponse(
    (r) => r.url().endsWith("/documents") && r.request().method() === "POST",
  );
  await page.getByTestId("save-document").click();
  expect((await draft).ok()).toBe(true);
  await ready(page);
  await expect(page.locator(".notices .notice").last()).toContainText("كمسودة");
  await page.getByTestId("convert-SALES_ORDER").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("الكمية المتبقية", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "إنشاء مسودة مرتبطة", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("redacted master prices remain restricted until an explicit known price is entered", async ({
  page,
}) => {
  // The actual field-projection API omits hidden purchasePriceMinor. Exercise
  // precisely that response shape without changing any QA user's policy.
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const item of body.items || []) delete item.purchasePriceMinor;
    await route.fulfill({ response, json: body });
  });
  await login(page);
  await page.goto("/purchasing/rfqs");
  await ready(page);
  await page.getByTestId("new-document").click();
  await expect(
    page.getByLabel("Unit price 1", { exact: true }),
  ).toHaveAttribute("placeholder", "Restricted");
  await expect(page.locator(".totals")).not.toContainText("0.00");
  await expect(page.locator(".totals")).toContainText("Restricted");
  await page.screenshot({path:"docs/ui-v2/screenshots/restricted-price-en.png",fullPage:true});
  await page.getByLabel("Unit price 1", { exact: true }).fill("150.00");
  await expect(page.locator(".totals")).toContainText("171.00");
  await expect(page.locator(".totals")).not.toContainText("Restricted");
});
