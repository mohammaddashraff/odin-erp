import { expect, type Page } from "@playwright/test";
export async function login(page: Page, email = "admin@odin.demo") {
  page.on("response", async (response) => {
    if (response.status() !== 403) return;
    const body = await response.json().catch(() => null);
    if (body?.denial?.reason !== "STEP_UP_REQUIRED") return;
    const dialog = page.getByRole("dialog", {
      name: "Verify your identity",
      exact: true,
    });
    await dialog.getByLabel("Password", { exact: true }).fill("password");
    await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  });
  await page.goto("/dashboard");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill("password");
  await page.getByTestId("login-submit").click();
  await expect(page.locator(".context-bar")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
}
export async function ready(page: Page) {
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator(".error-notice")).toHaveCount(0);
}
