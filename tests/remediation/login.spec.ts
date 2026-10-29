import { test, expect } from "@playwright/test";
import { evidencePath } from "./evidence";

async function hideDevelopmentChrome(page: import("@playwright/test").Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

async function expireSession(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("av8_token", "expired.review.token");
    localStorage.setItem("av8_refresh_hint", "1");
    localStorage.setItem("odin-theme", "light");
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, json: { message: "Expired" } }),
  );
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "Expired" } }),
  );
}

test("desktop login matches the ODIN auth system and preserves submission behavior", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([
    { name: "av8_language", value: "en", url: "http://127.0.0.1:8180" },
  ]);
  await expireSession(page);
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/auth/login", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 401,
      json: { message: "Sign in failed" },
    });
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByText("Your session has expired. Sign in to continue."),
  ).toBeVisible();
  await expect(page.getByTestId("theme-selector")).toBeVisible();
  await expect(page.getByTestId("language-toggle")).toBeVisible();
  const panel = await page.locator(".auth-identity").boundingBox();
  expect(panel?.width).toBeGreaterThanOrEqual(605);
  expect(panel?.width).toBeLessThanOrEqual(620);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);

  await hideDevelopmentChrome(page);
  await page.screenshot({
    path: evidencePath("login", "login-light-1440x900.png"),
  });

  await page
    .getByTestId("theme-selector")
    .getByRole("button", { name: "Dark" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: evidencePath("login", "login-dark-1440x900.png"),
  });

  await page.getByTestId("login-email").fill("review@example.test");
  await page.getByTestId("login-password").fill("review-password");
  await page.getByTestId("show-password").click();
  await expect(page.getByTestId("login-password")).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByTestId("login-submit").click();
  await expect(page.locator(".form-error")).toHaveText("Sign in failed");
  expect(submitted).toEqual({
    email: "review@example.test",
    password: "review-password",
    rememberMe: true,
  });
});

test("mobile Arabic login is compact, RTL and language-safe", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([
    { name: "av8_language", value: "ar", url: "http://127.0.0.1:8180" },
  ]);
  await expireSession(page);
  await page.goto("/dashboard");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await expect(page.getByTestId("theme-selector")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect((await page.locator(".auth-identity").boundingBox())?.height).toBe(132);
  await hideDevelopmentChrome(page);
  await page.screenshot({
    path: evidencePath("login", "login-ar-mobile-390x844.png"),
  });

  await page.getByTestId("language-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("login-email")).toBeVisible();
  await page.screenshot({
    path: evidencePath("login", "login-mobile-390x844.png"),
  });
});

test("login retains the MFA challenge workflow", async ({ page, context }) => {
  await context.addCookies([
    { name: "av8_language", value: "en", url: "http://127.0.0.1:8180" },
  ]);
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: { mfaRequired: true, challengeToken: "challenge-review" },
    }),
  );
  await page.goto("/dashboard");
  await page.getByTestId("login-email").fill("review@example.test");
  await page.getByTestId("login-password").fill("review-password");
  await page.getByTestId("login-submit").click();
  await expect(
    page.getByRole("heading", { name: "Verify your identity" }),
  ).toBeVisible();
  await expect(page.getByTestId("mfa-code")).toBeVisible();
  await expect(page.getByTestId("login-submit")).toHaveText(/Verify/);
});
