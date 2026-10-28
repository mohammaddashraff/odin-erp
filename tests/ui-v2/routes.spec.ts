import { test, expect } from "@playwright/test";
import { allRoutes } from "../../apps/web/src/core/navigation";
import { login, ready } from "./helpers";
test("every retained route loads real data without runtime errors", async ({
  page,
}) => {
  test.setTimeout(360000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  for (const { child: route } of allRoutes) {
    await test.step(route.route, async () => {
      await page.goto(route.route);
      await ready(page);
      await expect(page.locator("main h1")).not.toHaveText(/Access Denied|404/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        route.route + " page overflow",
      ).toBe(false);
      expect(errors, route.route).toEqual([]);
    });
  }
});
test("customer create, edit, search, required validation and unsaved navigation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sales/customers");
  await ready(page);
  await page.getByTestId("new-customer").click();
  await page.getByTestId("save-customer").click();
  expect(
    await page
      .getByTestId("master-customer-name")
      .evaluate((n: HTMLInputElement) => n.validity.valueMissing),
  ).toBe(true);
  const name = "UI replacement QA " + Date.now();
  await page.getByTestId("master-customer-name").fill(name);
  page.once("dialog", (d) => d.dismiss());
  await page.locator(".glass-brand-link").click();
  await expect(page.getByTestId("master-customer-name")).toHaveValue(name);
  await page.getByTestId("save-customer").click();
  await expect(page.locator("main h1")).toHaveText(name);
  await page
    .getByRole("button", { name: "Edit Customer", exact: true })
    .click();
  await page.getByLabel("Phone", { exact: true }).fill("+20 123456789");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("+20 123456789", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("searchbox").fill(name);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText(name);
  await page.getByRole("searchbox").fill("no-such-customer-zxy");
  await expect(
    page.getByText("No matching records", { exact: true }),
  ).toBeVisible();
});
