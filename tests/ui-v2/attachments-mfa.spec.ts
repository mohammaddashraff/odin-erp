import { test, expect } from "@playwright/test";
import { totpCode } from "../../apps/api/src/mfa-security";
import { login, ready } from "./helpers";
// MFA setup secrets must never enter screenshots or traces, including failures.
test.use({ screenshot: "off", trace: "off" });
test("private attachment type/signature disclosure and ticketed byte-identical download", async ({
  page,
}) => {
  await login(page);
  await page.goto("/sales/invoices");
  await ready(page);
  await page.locator("tbody button.link").first().click();
  await ready(page);
  await page.getByRole("button", { name: "Attachments", exact: true }).click();
  await ready(page);
  const filename = "ui-qa-" + Date.now() + ".pdf";
  const pdf = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  );
  await page.getByLabel("File", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdf,
  });
  const uploaded = page.waitForResponse((r) =>
    r.url().endsWith("/private-attachments/upload"),
  );
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  expect((await uploaded).status()).toBe(201);
  const row = page.locator("tbody tr").filter({ hasText: filename });
  await expect(row).toContainText("Malware scanning is not configured");
  await expect(row).toContainText("1 KB");
  await expect(row).toContainText("application/pdf");
  const download = page.waitForEvent("download");
  await row.getByRole("button", { name: "Download", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(filename);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const part of stream!) chunks.push(Buffer.from(part));
  expect(Buffer.concat(chunks)).toEqual(pdf);
});
test("MFA enrollment, authenticator login and single-use recovery preserve the auth contract", async ({
  page,
  browser,
}) => {
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem("odin_token"));
  const step = await page.request.post("/api/auth/step-up", {
    headers: { Authorization: "Bearer " + token },
    data: { password: "password" },
  });
  expect(step.ok()).toBe(true);
  const headers = {
    Authorization: "Bearer " + token,
    "X-Odin-Step-Up": (await step.json()).stepUpToken,
  };
  const access = await (
    await page.request.get("/api/access", { headers })
  ).json();
  const user = access.users.find((u: any) => u.email === "hr@odin.demo");
  const context = await browser.newContext();
  const mfa = await context.newPage();
  try {
    expect(
      (
        await page.request.patch(`/api/access/users/${user.id}`, {
          headers,
          data: { mfaRequired: true },
        })
      ).ok(),
    ).toBe(true);
    await mfa.goto("/dashboard");
    await mfa.getByTestId("login-email").fill(user.email);
    await mfa.getByTestId("login-password").fill("password");
    const challengeResponse = mfa.waitForResponse((r) =>
      r.url().endsWith("/auth/login"),
    );
    await mfa.getByTestId("login-submit").click();
    const challenge = await (await challengeResponse).json();
    expect(challenge.mfaEnrollmentRequired).toBe(true);
    expect(challenge.recoveryCodes.length).toBeGreaterThan(0);
    await expect(
      mfa.getByText("Authenticator setup key", { exact: true }),
    ).toBeVisible();
    await mfa.getByTestId("mfa-code").fill(totpCode(challenge.secret));
    await mfa.getByTestId("login-submit").click();
    await expect(mfa.locator(".context-bar")).toBeVisible();
    await mfa.getByRole("button", { name: "Sign out", exact: true }).click();
    await mfa.getByTestId("login-email").fill(user.email);
    await mfa.getByTestId("login-password").fill("password");
    await mfa.getByTestId("login-submit").click();
    await expect(mfa.getByTestId("mfa-code")).toBeVisible();
    await mfa
      .getByLabel("Recovery code", { exact: true })
      .fill(challenge.recoveryCodes[0]);
    await mfa.getByTestId("login-submit").click();
    await expect(mfa.locator(".context-bar")).toBeVisible();
    await mfa.getByRole("button", { name: "Sign out", exact: true }).click();
    await mfa.getByTestId("login-email").fill(user.email);
    await mfa.getByTestId("login-password").fill("password");
    await mfa.getByTestId("login-submit").click();
    await mfa
      .getByLabel("Recovery code", { exact: true })
      .fill(challenge.recoveryCodes[0]);
    await mfa.getByTestId("login-submit").click();
    await expect(mfa.locator(".form-error")).toBeVisible();
    await expect(mfa.locator(".context-bar")).toHaveCount(0);
  } finally {
    await context.close();
    expect(
      (
        await page.request.post(`/api/access/users/${user.id}/mfa-reset`, {
          headers,
          data: {
            reason: "Restore isolated QA MFA fixture after enrollment test",
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.patch(`/api/access/users/${user.id}`, {
          headers,
          data: { mfaRequired: user.mfaRequired },
        })
      ).ok(),
    ).toBe(true);
  }
});
