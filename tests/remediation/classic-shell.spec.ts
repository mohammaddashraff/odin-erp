import { test, expect } from "@playwright/test";
import { reviewFixture } from "./fixtures";
import { t } from "../../apps/web/src/core/i18n";
import { evidencePath } from "./evidence";

test("desktop sidebar preserves routes, active parents and collapse preference", async ({
  page,
}) => {
  await reviewFixture(page);
  await page.addInitScript(() => localStorage.setItem("odin-theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/sales/invoices");

  const sidebar = page.locator(".classic-sidebar");
  await expect(sidebar).toBeVisible();
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(236);
  await expect(page.getByTestId("nav-sales")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("nav-sales-invoices")).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByTestId("sidebar-toggle").click();
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())!.width))
    .toBe(72);
  expect(
    await page.evaluate(() => localStorage.getItem("odin-sidebar-collapsed")),
  ).toBe("true");
  await page.reload();
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox())!.width))
    .toBe(72);
  await expect(page.getByTestId("nav-sales")).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  await page.getByTestId("sidebar-toggle").click();
  await page.goto("/settings/access/users");
  await expect(page.getByTestId("nav-admin")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("nav-access-users")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
  await page.screenshot({
    path: evidencePath("classic-shell", "users-settings-light-1440.png"),
  });
});

test("mobile RTL drawer traps focus, dismisses and restores the menu control", async ({
  page,
}) => {
  await reviewFixture(page, "ar");
  await page.addInitScript(() => localStorage.setItem("odin-theme", "light"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/av8/leads");
  const menu = page.getByLabel(t("Menu", "ar"), { exact: true });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: t("ERP modules", "ar") });
  await expect(drawer).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const box = await drawer.boundingBox();
  expect(box!.x + box!.width).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.screenshot({
    path: evidencePath("classic-shell", "arabic-mobile-drawer-390.png"),
  });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("classic shell stays within representative desktop and mobile widths", async ({
  page,
}) => {
  await reviewFixture(page);
  await page.addInitScript(() => localStorage.setItem("odin-theme", "light"));
  for (const width of [1920, 1440, 1366, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width > 800 ? 900 : 800 });
    await page.goto("/dashboard");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `dashboard overflow at ${width}px`,
    ).toBe(true);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  }
});

test("dashboard uses specific empty states and real financial shortcuts", async ({
  page,
}) => {
  await reviewFixture(page);
  await page.addInitScript(() => localStorage.setItem("odin-theme", "light"));
  await page.route("**/api/documents", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/dashboard");
  await expect(page.getByText("No posted sales yet")).toBeVisible();
  await expect(page.getByText("No transactions yet")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Financial overview" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Invoices/ })).toHaveAttribute(
    "href",
    "/sales/invoices",
  );
  await expect(page.getByRole("link", { name: /Cash & Bank/ })).toHaveAttribute(
    "href",
    "/banking/overview",
  );
  await expect(
    page.getByRole("link", { name: /Customer balances/ }),
  ).toHaveAttribute("href", "/sales/customer-balances");
  await page.screenshot({
    path: evidencePath("classic-shell", "dashboard-light-empty-1440.png"),
  });
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: evidencePath("classic-shell", "dashboard-dark-empty-1440.png"),
  });
});
