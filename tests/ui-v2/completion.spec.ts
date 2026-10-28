import { test, expect } from "@playwright/test";
import { login, ready } from "./helpers";

test("unsaved POS cart survives cancelled navigation, language change and sign out", async ({
  page,
}) => {
  await login(page);
  await page.goto("/pos/workspace");
  await ready(page);
  await page.getByRole("searchbox").fill("MOU-WL");
  await page.getByRole("searchbox").press("Enter");
  await expect(page.locator(".cart-line")).toHaveCount(1);
  for (const action of [
    () => page.getByTestId("language-toggle").click(),
    async () => {
      await page.locator(".account-menu summary").click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    },
    async () => {
      await page.getByTestId("nav-sales").click();
      await page.getByTestId("nav-customers").click();
    },
  ]) {
    const prompt = page.waitForEvent("dialog");
    page.once("dialog", (dialog) => dialog.dismiss());
    await action();
    expect((await prompt).message()).toBe("Discard unsaved changes?");
    await expect(page).toHaveURL(/pos\/workspace$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".cart-line")).toHaveCount(1);
  }
  await page.getByTestId("nav-sales").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("nav-customers").click();
  await ready(page);
  await expect(page).toHaveURL(/sales\/customers$/);
  await page.locator(".glass-more").click();
  await page.getByTestId("nav-pos-workspace").click();
  await ready(page);
  await expect(page.locator(".cart-line")).toHaveCount(0);
});

test("mobile navigation contains keyboard focus, hides closed controls and restores focus in both languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const lang of ["en", "ar"]) {
    if (lang === "ar") {
      await page.getByTestId("language-toggle").click();
      await ready(page);
    }
    const navigation = page.locator(".glass-navigation");
    await expect(navigation).toBeHidden();
    const menu = page.locator(".glass-menu-toggle");
    await menu.click();
    await expect(navigation).toHaveAttribute("role", "dialog");
    await expect(navigation).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".glass-workspace")).toHaveAttribute("inert", "");
    const close = page.locator(".glass-mobile-title button");
    await expect(close).toBeFocused();
    await page.getByTestId("nav-admin").focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("nav-admin")).toBeFocused();
    await expect(navigation).toHaveCSS("inset-inline-start", "12px");
    const bounds = await navigation.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: `docs/ui-v2/screenshots/navigation-${lang}-390.png`,
    });
    await page.keyboard.press("Escape");
    await expect(navigation).not.toHaveClass(/is-open/);
    await expect(menu).toBeFocused();
    await expect(navigation).toBeHidden();
    await expect(page.locator(".glass-workspace")).not.toHaveAttribute("inert", "");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".glass-navigation")).toBeVisible();
});

test("200 percent desktop zoom equivalent keeps English and Arabic workflows operable", async ({
  browser,
}) => {
  // A 1440x900 desktop zoomed to 200% has a 720x450 CSS layout viewport.
  const context = await browser.newContext({
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await login(page);
    for (const lang of ["en", "ar"]) {
      if (lang === "ar") {
        await page.getByTestId("language-toggle").click();
        await ready(page);
      }
      await page.goto("/sales/quotations");
      await ready(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.getByTestId("new-document").click();
      await expect(page.locator("form")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("button", {
          name: lang === "en" ? "Save draft" : "حفظ المسودة",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/ui-v2/screenshots/editor-${lang}-zoom-200.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", {
          name: lang === "en" ? "Cancel" : "إلغاء",
          exact: true,
        })
        .click();
      await ready(page);
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
