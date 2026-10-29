import { test, expect } from "@playwright/test";
import { reviewFixture } from "./fixtures";
import { t } from "../../apps/web/src/core/i18n";
import { evidencePath } from "./evidence";
for (const language of ["en", "ar"] as const)
  test(`light/dark mode persists without account writes, ${language}`, async ({
    page,
    context,
  }) => {
    await reviewFixture(page, language);
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/") && r.method() !== "GET")
        writes.push(new URL(r.url()).pathname);
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dashboard");
    await expect(page.locator(".glass-metric")).toHaveCount(4);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel(t("Account menu", language)).click();
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName(
      t("Switch to dark mode", language),
    );
    await page.getByLabel(t("Account menu", language)).click();
    await page.reload();
    await expect(page.locator(".glass-metric")).toHaveCount(4);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(
      await page.evaluate(() => getComputedStyle(document.body).color),
    ).toBe("rgb(21, 43, 73)");
    await page.screenshot({
      path: evidencePath("themes", `dashboard-light-${language}.png`),
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/av8/leads");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByLabel(t("Account menu", language)).click();
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-toggle").click();
    await page.getByLabel(t("Account menu", language)).click();
    await page
      .getByRole("button", { name: t("Capture lead", language), exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: evidencePath("themes", `form-light-${language}-360.png`),
    });
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await page.route("**/api/auth/me", (r) =>
      r.fulfill({ status: 401, json: { message: "Expired" } }),
    );
    await page.route("**/api/auth/refresh", (r) =>
      r.fulfill({ status: 401, json: { message: "Expired" } }),
    );
    await page.reload();
    await expect(page.locator("input[type=password]").first()).toBeVisible();
    await expect(page.getByTestId("theme-toggle")).toBeVisible();
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
