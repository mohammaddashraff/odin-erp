import { test, expect } from "@playwright/test";
import { login, ready } from "./helpers";
const dir = "docs/ui-v2/screenshots/";
async function noOverflow(page: any) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
}
test("visual viewport and Arabic acceptance with real screenshots", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.screenshot({ path: dir + "login-en.png" });
  await login(page);
  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");
    await ready(page);
    await noOverflow(page);
    await page.screenshot({ path: dir + `dashboard-en-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sales/quotations");
  await ready(page);
  await page.screenshot({ path: dir + "listing-en-1440.png" });
  await page.getByTestId("new-document").click();
  await expect(page.getByLabel("Product 1")).toBeVisible();
  await page.screenshot({ path: dir + "editor-en-1440.png", fullPage: true });
  await page
    .getByLabel("Product 1")
    .evaluate((n) => n.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: dir + "editor-lines-en-1440.png" });
  await page.goto("/sales/invoices");
  await ready(page);
  await page.locator("tbody button.link").first().click();
  await ready(page);
  await page.screenshot({ path: dir + "detail-en-1440.png", fullPage: true });
  await page.goto("/dashboard");
  await ready(page);
  await page.getByTestId("language-toggle").click();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.locator("body").evaluate((n) => getComputedStyle(n).fontFamily),
  ).toContain("Noto Sans Arabic");
  await noOverflow(page);
  await page.screenshot({ path: dir + "dashboard-ar-1440.png" });
  await page.goto("/sales/quotations");
  await ready(page);
  await noOverflow(page);
  await page.screenshot({ path: dir + "listing-ar-1440.png" });
  await page.getByTestId("new-document").click();
  await page.screenshot({ path: dir + "editor-ar-1440.png", fullPage: true });
  await page
    .getByLabel("الصنف 1")
    .evaluate((n) => n.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: dir + "editor-lines-ar-1440.png" });
  for (const [width, height] of [
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/sales/quotations");
    await ready(page);
    await noOverflow(page);
    await page.screenshot({ path: dir + `listing-ar-${width}.png` });
    await page.getByTestId("language-toggle").click();
    await ready(page);
    await noOverflow(page);
    await page.screenshot({ path: dir + `listing-en-${width}.png` });
    await page.getByTestId("language-toggle").click();
    await ready(page);
  }
  expect(errors).toEqual([]);
});
test("keyboard dialog focus, error/retry/loading states and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page);
  await page.goto("/sales/quotations");
  await ready(page);
  await page.locator("tbody button.link").first().click();
  await ready(page);
  const sourceButton = page
    .locator(".page-heading button")
    .filter({ hasText: /Convert to/ })
    .first();
  await expect(sourceButton).toBeVisible();
  {
    await sourceButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
    await page.screenshot({ path: dir + "dialog-en-1440.png" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(sourceButton).toBeFocused();
  }
  let release: () => void = () => {};
  const blocked = new Promise<void>((r) => (release = r));
  await page.route("**/api/sales/documents?**", async (route) => {
    await blocked;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "QA controlled service unavailable" }),
    });
  });
  await page.goto("/sales/quotations");
  await expect(page.locator(".loading")).toBeVisible();
  await page.screenshot({ path: dir + "loading-en.png" });
  release();
  await expect(page.locator(".error-notice")).toBeVisible();
  await page.screenshot({ path: dir + "error-en.png" });
  await page.unroute("**/api/sales/documents?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await ready(page);
  await page.getByRole("searchbox").fill("no-such-document-ui-qa");
  await expect(
    page.getByText("No matching records", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: dir + "empty-en.png" });
});

test("horizontal navigation, mobile navigation and browser print", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator(".glass-navigation")).toBeVisible();
  const before = await page.locator("main").boundingBox();
  await page.getByTestId("nav-purchasing").click();
  await expect(page.getByTestId("nav-purchase-orders")).toBeVisible();
  expect((await page.locator("main").boundingBox())!.y).toBe(before!.y);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByTestId("nav-purchase-orders").click();
  await ready(page);
  await expect(page).toHaveURL(/purchasing\/orders$/);
  await expect(page.locator(".glass-navigation")).not.toHaveClass(/is-open/);
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/reports/overview");
  await ready(page);
  await page.evaluate(() => {
    (window as any).__printed = false;
    window.print = () => {
      (window as any).__printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Browser print", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".glass-navigation")).toBeHidden();
  await page.screenshot({ path: dir + "report-print.png", fullPage: true });
});
