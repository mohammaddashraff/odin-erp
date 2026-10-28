import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "av8_language", value: "en", url: baseURL! }]);
  await context.addInitScript(() => localStorage.setItem("av8_token", "navigation-fixture"));
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/auth/me"
      ? { id: "navigation-fixture", name: "Navigation QA", permissions: ["system.super_admin"] }
      : path === "/api/bootstrap"
        ? { tenant: { name: "AV8 QA" } }
        : { rows: [], total: 0, size: 25 },
    });
  });
});

async function sampleMotion(page: Page) {
  return page.evaluate(async () => {
    const samples: { linkHeights: number[]; logoVisible: boolean; homeY: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 550) {
      const nav = document.querySelector(".navigation")!.getBoundingClientRect();
      const logo = document.querySelector(".nav-brand .brand-mark")!.getBoundingClientRect();
      samples.push({
        linkHeights: [...document.querySelectorAll(".nav-pages a")].map(link => link.getBoundingClientRect().height),
        logoVisible: logo.left >= nav.left && logo.right <= nav.right,
        homeY: document.querySelector('[data-testid="nav-command"]')!.getBoundingClientRect().y,
      });
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
}

for (const language of ["en", "ar"]) {
  test(`sidebar hover keeps labels and logo stable in ${language}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "av8_language", value: language, url: baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/av8/students");
    await expect(page.locator(".navigation")).toHaveCSS("width", "72px");
    await page.evaluate(() => document.fonts.ready);
    const x = language === "en" ? 34 : 1406;
    const opening = sampleMotion(page);
    await page.mouse.move(x, 130);
    const opened = await opening;
    await expect(page.locator(".navigation")).toHaveCSS("width", "280px");
    for (const frame of opened) {
      expect(frame.linkHeights).toEqual(opened.at(-1)!.linkHeights);
      expect(frame.logoVisible).toBe(true);
    }
    for (let i = 1; i < opened.length; i++) {
      expect(opened[i].homeY).toBeGreaterThanOrEqual(opened[i - 1].homeY - 1);
    }
    const closing = sampleMotion(page);
    await page.mouse.move(600, 90);
    const closed = await closing;
    await expect(page.locator(".navigation")).toHaveCSS("width", "72px");
    for (const frame of closed) {
      expect(frame.linkHeights).toEqual(opened.at(-1)!.linkHeights);
      expect(frame.logoVisible).toBe(true);
    }
    for (let i = 1; i < closed.length; i++) {
      expect(closed[i].homeY).toBeLessThanOrEqual(closed[i - 1].homeY + 1);
    }
    await page.mouse.move(x, 130);
    await expect(page.locator(".navigation")).toHaveCSS("width", "280px");
    await page.mouse.move(600, 90);
    await page.waitForTimeout(40);
    await page.mouse.move(x, 130);
    await expect(page.locator(".erp-shell")).not.toHaveClass(/compact/);
    // Moving focus must not close a menu that the pointer is still using.
    await page.locator(".nav-brand").focus();
    await page.locator("h1").focus();
    await expect(page.locator(".erp-shell")).not.toHaveClass(/compact/);
  });
}
