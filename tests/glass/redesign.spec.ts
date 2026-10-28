import { test, expect } from "@playwright/test";
import { allRoutes, legacyRedirects } from "../../apps/web/src/core/navigation";
import { fixture } from "./fixtures";
test("populated dashboard, navigation, filters, dialogs, RTL and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await page.goto("/dashboard");
  await expect(page.locator(".glass-metric")).toHaveCount(4);
  await expect(page.locator(".glass-revenue-svg")).toBeVisible();
  await page.screenshot({
    path: "docs/ui-dark/screenshots/dashboard-desktop.png",
  });
  await page.getByLabel("Currency", { exact: true }).selectOption("EGP");
  await page.getByTestId("nav-accounting").click();
  await expect(page.locator("#glass-module-pages")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#glass-module-pages")).toHaveCount(0);
  await page.getByRole("button", { name: "Search pages", exact: true }).click();
  await page.getByRole("dialog").getByRole("searchbox").fill("Users");
  await expect(
    page.getByRole("dialog").getByRole("link", { name: /Users/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByTestId("nav-av8").click();
  await page
    .getByRole("link", { name: "Daily workspace", exact: true })
    .click();
  await expect(page.locator(".glass-chart")).toBeVisible();
  await page.screenshot({ path: "docs/ui-dark/screenshots/av8-dashboard.png" });
  await page.goto("/av8/leads");
  await expect(
    page.getByRole("button", { name: "Review account A", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox").fill("account A");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Capture lead", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: false })
    .first()
    .fill("Review lead");
  await page.screenshot({ path: "docs/ui-dark/screenshots/lead-dialog.png" });
  await page
    .getByRole("dialog")
    .getByLabel("Phone", { exact: false })
    .fill("+20000000009");
  await page
    .getByRole("dialog")
    .getByLabel("Source / platform", { exact: false })
    .fill("UI test");
  const saved = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/av8/leads"),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  expect((await saved).postDataJSON()).toMatchObject({
    name: "Review lead",
    phone: "+20000000009",
    source: "UI test",
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox").fill("Review lead");
  await expect(
    page.getByRole("button", { name: "Review lead", exact: true }),
  ).toBeVisible();
  await page.goto("/settings/access/users");
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/ui-dark/screenshots/users-desktop.png" });
  await page.goto("/av8/students?student=1");
  await expect(
    page.getByRole("heading", { name: "Review account A" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Travel preparation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Documents", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/ui-dark/screenshots/student-detail.png",
  });
  await page.goto("/accounting/overview");
  await expect(
    page.getByRole("heading", { name: "Accounting Overview" }),
  ).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.screenshot({
    path: "docs/ui-dark/screenshots/accounting-desktop.png",
  });
  await page.getByTestId("language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.screenshot({
    path: "docs/ui-dark/screenshots/accounting-arabic.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Menu|القائمة/ }).click();
  await expect(page.locator(".glass-navigation.is-open")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".glass-navigation.is-open")).toHaveCount(0);
  await page.getByRole("button", { name: /Menu|القائمة/ }).click();
  await expect(page.locator(".glass-navigation")).toHaveAttribute(
    "aria-modal",
    "true",
  );
  await page.setViewportSize({ width: 1280, height: 941 });
  await expect(page.locator(".glass-navigation.is-open")).toHaveCount(0);
  await expect(page.locator(".glass-header")).not.toHaveAttribute("inert");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/ui-dark/screenshots/mobile-arabic.png" });
  expect(errors).toEqual([]);
});
test("all registered routes and nested entry points render a safe service-error state", async ({
  page,
}) => {
  await fixture(page, "error");
  const failures: string[] = [];
  for (const path of [
    ...allRoutes.map((r) => r.child.route),
    "/settings/access/users/1",
    "/av8/students?student=1",
    "/av8/leads?lead=1",
    "/sales/invoices?new=1",
    "/accounting/journals?new=1",
  ]) {
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(e.message);
    page.on("pageerror", onError);
    await page.goto(path);
    await expect(page.locator(".glass-header")).toBeVisible();
    await page.waitForTimeout(180);
    if (await page.locator(".glass-fallback").count())
      failures.push(path + ": render boundary");
    if (!(await page.locator(".glass-header").isVisible()))
      failures.push(path + ": shell disappeared");
    if (errors.length) failures.push(path + ": " + errors.join("; "));
    if ((await page.locator("main").innerText()) === "")
      failures.push(path + ": blank");
    page.off("pageerror", onError);
  }
  expect(failures).toEqual([]);
  await page.goto("/");
  await expect(page.locator(".glass-header")).toBeVisible();
  for (const [from, to] of Object.entries(legacyRedirects)) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(to + "$"));
    await expect(page.locator(".glass-header")).toBeVisible();
  }
});
test("permission-filtered menus and denied routes", async ({ page }) => {
  await fixture(page, "restricted");
  await page.goto("/settings/access/users");
  await expect(
    page.getByRole("heading", { name: "Access Denied" }),
  ).toBeVisible();
  await expect(page.getByTestId("nav-admin")).toHaveCount(0);
  await page.getByRole("button", { name: "Search pages", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Users", exact: true }),
  ).toHaveCount(0);
});
test("login validation and unknown route", async ({ page }) => {
  await page.context().addCookies([{name:"av8_language",value:"en",url:"http://127.0.0.1:8180"}]);
  await page.goto("/login");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.getByTestId("login-submit").click();
  expect(
    await page
      .getByTestId("login-email")
      .evaluate((e: HTMLInputElement) => e.validity.valid),
  ).toBe(false);
  await page.screenshot({ path: "docs/ui-dark/screenshots/login.png" });
  await page.goto("/no-such-odin-page");
  await expect(
    page.getByRole("heading", { name: /Page not found/ }),
  ).toBeVisible();
  await page.context().addCookies([{name:"av8_language",value:"ar",url:"http://127.0.0.1:8180"}]);
  await page.reload();
  await expect(page.getByRole("heading", {name:"الصفحة غير موجودة"})).toBeVisible();
});
test("student nested tabs, compact desktop, tablet and mobile remain usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  for (const tab of [
    "Admissions",
    "Medical",
    "Agreement",
    "Documents",
    "English",
    "Visa",
    "Travel",
    "Progress",
    "Payments",
    "Academy statement",
    "Guardian",
    "Tasks & exceptions",
    "Timeline",
  ]) {
    await page.goto("/av8/students?student=1&tab=" + encodeURIComponent(tab));
    await expect(
      page.getByRole("heading", { name: "Review account A" }),
    ).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    expect(await page.locator(".av8-workspace").innerText()).toContain(
      "Review account A",
    );
  }
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.locator(".glass-metric")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "overflow at " + width,
    ).toBe(true);
  }
  await page.screenshot({
    path: "docs/ui-dark/screenshots/dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("financial report print palette stays on paper", async ({ page }) => {
  await fixture(page);
  await page.goto("/accounting/overview");
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  expect(
    await page
      .locator("body")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe("rgb(255, 255, 255)");
  await expect(page.locator(".glass-header")).toBeHidden();
});
test("transactional modules share readable empty states and table styling", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  for (const [route, name] of [
    ["/sales/invoices", "sales-invoices"],
    ["/inventory/items", "inventory-items"],
    ["/hr/employees", "hr-employees"],
    ["/pos/workspace", "pos"],
    ["/banking/transactions", "banking"],
    ["/accounting/journals", "journals"],
  ]) {
    await page.goto(route);
    await expect(page.locator(".glass-header")).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator(".glass-header")).toBeVisible();
    await expect(page.locator(".glass-fallback")).toHaveCount(0);
    await page.screenshot({ path: `docs/ui-dark/screenshots/${name}.png` });
    await expect(page.locator(".glass-header")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("chart separates currencies, subtracts returns and protects restricted totals", async ({
  page,
}) => {
  await fixture(page);
  const year = new Date().getFullYear();
  const docs = [
    {
      id: "1",
      number: "QA-1",
      type: "SALES_INVOICE",
      status: "POSTED",
      currency: "EGP",
      documentDate: `${year}-01-01`,
      totalMinor: "10000",
    },
    {
      id: "2",
      number: "QA-2",
      type: "SALES_INVOICE",
      status: "POSTED",
      currency: "USD",
      documentDate: `${year}-01-01`,
      totalMinor: "5000",
    },
    {
      id: "3",
      number: "QA-3",
      type: "SALES_RETURN",
      status: "POSTED",
      currency: "EGP",
      documentDate: `${year}-01-01`,
      totalMinor: "2000",
    },
  ];
  await page.route("**/api/documents", (route) =>
    route.fulfill({ json: docs }),
  );
  await page.goto("/dashboard");
  await expect(page.locator(".glass-revenue-svg")).toBeVisible();
  expect(
    await page.locator(".glass-revenue-svg circle title").first().textContent(),
  ).toContain("80.00");
  await page.getByLabel("Currency", { exact: true }).selectOption("USD");
  expect(
    await page.locator(".glass-revenue-svg circle title").first().textContent(),
  ).toContain("50.00");
  await page.route("**/api/documents", (route) =>
    route.fulfill({ json: docs.map((d) => ({ ...d, totalMinor: null })) }),
  );
  await page.reload();
  await expect(page.locator(".glass-revenue .surface-body")).toHaveText(
    "Restricted",
  );
  await expect(page.locator(".glass-revenue-svg")).toHaveCount(0);
});
