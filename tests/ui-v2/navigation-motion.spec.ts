import { test, expect } from "@playwright/test";
import { actor, bootstrap } from "../glass/fixtures";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() =>
    localStorage.setItem("av8_token", "navigation-fixture"),
  );
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json:
        path === "/api/auth/me"
          ? actor
          : path === "/api/bootstrap"
            ? bootstrap
            : { rows: [], total: 0, size: 25 },
    });
  });
});

for (const language of ["en", "ar"]) {
  test(`horizontal menus keep the page stable and mobile focus contained in ${language}`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "av8_language", value: language, url: baseURL! },
    ]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/av8/students");
    await expect(page.locator(".glass-navigation")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const before = await page.locator("main").boundingBox();
    await page.getByTestId("nav-av8").click();
    await expect(page.locator("#glass-module-pages")).toBeVisible();
    expect((await page.locator("main").boundingBox())!.y).toBe(before!.y);
    await expect(page.locator(".glass-header .brand-mark")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#glass-module-pages")).toHaveCount(0);
    await expect(page.getByTestId("nav-av8")).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    const menu = page.locator(".glass-menu-toggle"),
      close = page.locator(".glass-mobile-title button");
    await menu.click();
    await expect(close).toBeFocused();
    await expect(page.locator(".glass-navigation")).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await close.press("Shift+Tab");
    await expect(page.getByTestId("nav-admin")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".glass-navigation")).toBeHidden();
    await expect(menu).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator(".glass-navigation")).toBeVisible();
    await expect(page.locator(".glass-workspace")).not.toHaveAttribute(
      "inert",
      "",
    );
  });
}
