import { test, expect, type Page } from "@playwright/test";
import { login, ready } from "./helpers";
import { savedResponse } from "./workflow";

async function fillAccount(
  page: Page,
  name: string,
  posting = true,
) {
  await expect(page.getByLabel("Account code", { exact: false })).toHaveAttribute("readonly", "");
  await page.getByLabel("Account name", { exact: false }).fill(name);
  await page
    .getByRole("radio", { name: posting ? /Posting account/ : /Group account/ })
    .check();
}
async function openAccount(page: Page, account: any) {
  await page.goto(`/accounting/chart-of-accounts?account=${account.id}`);
  await ready(page);
  await expect(
    page.getByRole("complementary", { name: "Account details" }),
  ).toContainText(account.name);
}
async function api(page: Page, path: string, method = "GET", body?: any) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("odin_token")}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, method, body },
  );
}

test("account hierarchy creates real nested groups, edits a leaf, searches ancestors and archives safely", async ({
  page,
}) => {
  await login(page);
  await page.goto("/accounting/chart-of-accounts");
  await ready(page);
  const stamp = Date.now();
  await page.getByTestId("new-account").click();
  await expect(page.getByLabel("Place under (optional)")).toBeDisabled();
  await expect(page.getByLabel("Search parent accounts (optional)")).toBeDisabled();
  await page.getByLabel("Account type", { exact: true }).selectOption("ASSET");
  await expect(page.getByLabel("Search parent accounts (optional)")).toBeEnabled();
  await fillAccount(page, `QA parent ${stamp}`, false);
  await expect(page.getByRole("complementary", { name: "Account preview" }))
    .toContainText(`QA parent ${stamp}`);
  const root = await savedResponse(
    page,
    "Save account",
    "/accounting/accounts",
  );
  expect(root.parentId).toBeNull();
  expect(root.postingAllowed).toBe(false);
  await ready(page);
  await expect(
    page.getByRole("complementary", { name: "Account details" }),
  ).toContainText(root.name);
  await page
    .getByRole("button", { name: `Add child to ${root.code}`, exact: true })
    .click();
  await expect(page.getByLabel("Place under (optional)")).toHaveValue(
    root.id,
  );
  await page.getByLabel("Place under (optional)").selectOption("");
  await page.getByLabel("Search parent accounts (optional)").fill(root.code);
  await expect(page.getByLabel("Place under (optional)").locator("option")).toHaveCount(2);
  await page.getByLabel("Place under (optional)").selectOption(root.id);
  await expect(page.getByRole("complementary", { name: "Account preview" }))
    .toContainText(root.code);
  await fillAccount(page, `QA subgroup ${stamp}`, false);
  const subgroup = await savedResponse(
    page,
    "Save account",
    "/accounting/accounts",
  );
  expect(subgroup.parentId).toBe(root.id);
  await ready(page);
  await page
    .getByRole("button", { name: "Add child account", exact: true })
    .click();
  await expect(page.getByLabel("Place under (optional)")).toHaveValue(
    subgroup.id,
  );
  await fillAccount(page, `QA leaf ${stamp}`);
  const leaf = await savedResponse(
    page,
    "Save account",
    "/accounting/accounts",
  );
  expect(leaf.parentId).toBe(subgroup.id);
  expect(leaf.postingAllowed).toBe(true);
  await ready(page);
  await expect(page.locator(`[data-account-id="${root.id}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-account-id="${subgroup.id}"]`),
  ).toBeVisible();
  await expect(page.locator(`[data-account-id="${leaf.id}"]`)).toBeVisible();
  const depths = await page
    .locator(
      `[data-account-id="${root.id}"] .ac-tree-label, [data-account-id="${subgroup.id}"] .ac-tree-label, [data-account-id="${leaf.id}"] .ac-tree-label`,
    )
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        parseInt(getComputedStyle(node).paddingInlineStart, 10),
      ),
    );
  expect(depths).toEqual([0, 24, 48]);
  await page
    .getByRole("button", { name: `Collapse account ${root.code}`, exact: true })
    .click();
  await expect(page.locator(`[data-account-id="${leaf.id}"]`)).toHaveCount(0);
  await page
    .getByRole("button", { name: `Expand account ${root.code}`, exact: true })
    .click();
  await expect(page.locator(`[data-account-id="${leaf.id}"]`)).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search account code or name" })
    .fill(leaf.code);
  await expect(page.locator(`[data-account-id="${root.id}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-account-id="${subgroup.id}"]`),
  ).toBeVisible();
  await expect(page.locator(`[data-account-id="${leaf.id}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await page
    .getByLabel("Account name", { exact: false })
    .fill(`QA revised leaf ${stamp}`);
  leaf.name = `QA revised leaf ${stamp}`;
  const edited = await savedResponse(
    page,
    "Save account",
    `/accounting/accounts/${leaf.id}`,
    "PATCH",
  );
  expect(edited.name).toBe(leaf.name);
  expect(edited.parentId).toBe(subgroup.id);
  await openAccount(page, root);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await expect(
    page.getByLabel("Allow posting to this account", { exact: false }),
  ).toBeDisabled();
  await page.getByLabel("Active", { exact: true }).uncheck();
  const blocked = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/accounting/accounts/${root.id}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save account", exact: true }).click();
  expect((await blocked).status()).toBe(400);
  await expect(page.locator(".error-notice")).toContainText(
    "active child accounts",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const account of [leaf, subgroup, root]) {
    await openAccount(page, account);
    await page
      .getByRole("button", { name: "Edit account", exact: true })
      .click();
    await page.getByLabel("Active", { exact: true }).uncheck();
    const archived = await savedResponse(
      page,
      "Save account",
      `/accounting/accounts/${account.id}`,
      "PATCH",
    );
    expect(archived.active).toBe(false);
    await ready(page);
    await expect(
      page.locator(`[data-account-id="${account.id}"]`),
    ).toContainText(/inactive/i);
  }
  const bootstrap = await api(page, "/bootstrap");
  expect(
    bootstrap.body.accounts.some((account: any) => account.id === leaf.id),
  ).toBe(false);
});

test("existing posting or control accounts accept automatic-code children without changing the parent", async ({ page }) => {
  await login(page);
  const accounts = await api(page, "/accounting/accounts?includeInactive=true");
  const parent = accounts.body.rows.find((account: any) => account.active && account.controlType)
    || accounts.body.rows.find((account: any) => account.active && account.postingAllowed && account.hasActivity);
  expect(parent).toBeTruthy();
  await openAccount(page, parent);
  await page.getByRole("button", { name: "Add child account", exact: true }).click();
  await expect(page.getByLabel("Place under (optional)")).toHaveValue(parent.id);
  const codePattern = new RegExp("^" + parent.code.replace(/\./g, "\\.") + "\\.\\d{3,}$");
  await expect(page.getByLabel("Account code", { exact: false })).toHaveValue(codePattern);
  await fillAccount(page, `QA existing-account child ${Date.now()}`);
  const child = await savedResponse(page, "Save account", "/accounting/accounts");
  expect(child.parentId).toBe(parent.id);
  expect(child.code).toMatch(codePattern);
  const after = await api(page, "/accounting/accounts?includeInactive=true");
  const unchanged = after.body.rows.find((account: any) => account.id === parent.id);
  expect(unchanged.postingAllowed).toBe(parent.postingAllowed);
  expect(unchanged.controlType).toBe(parent.controlType);
});

test("account posting history protects identity and archival while auditor permissions remain read only", async ({
  page,
  browser,
}) => {
  await login(page);
  const accounts = await api(page, "/accounting/accounts?includeInactive=true");
  const used = accounts.body.rows.find(
    (account: any) => account.hasActivity && account.active,
  );
  expect(used).toBeTruthy();
  await openAccount(page, used);
  await page.getByRole("button", { name: "Edit account", exact: true }).click();
  await expect(
    page.getByLabel("Account code", { exact: false }),
  ).toHaveAttribute("readonly", "");
  await expect(
    page.getByLabel("Account type", { exact: false }),
  ).toBeDisabled();
  const protectedCode = await api(
    page,
    `/accounting/accounts/${used.id}`,
    "PATCH",
    { code: `FORBIDDEN-${Date.now()}` },
  );
  expect(protectedCode.status).toBe(400);
  const archive = await api(page, `/accounting/accounts/${used.id}`, "PATCH", {
    active: false,
  });
  expect(archive.status).toBe(400);
  const other = await browser.newContext();
  const auditor = await other.newPage();
  await login(auditor, "auditor@odin.demo");
  await auditor.goto("/accounting/chart-of-accounts");
  await ready(auditor);
  await expect(auditor.getByTestId("new-account")).toHaveCount(0);
  await expect(
    auditor.getByRole("button", { name: "Edit account", exact: true }),
  ).toHaveCount(0);
  const denied = await api(
    auditor,
    `/accounting/accounts/${used.id}`,
    "PATCH",
    { name: "Unauthorized edit" },
  );
  expect(denied.status).toBe(403);
  const hiddenCreate = await api(auditor, "/accounting/accounts", "POST", {
    companyId: used.companyIds[0],
    code: `DENIED-${Date.now()}`,
    name: "Unauthorized account",
    type: "ASSET",
  });
  expect(hiddenCreate.status).toBe(403);
  await auditor.goto("/accounting/journals?new=1");
  await ready(auditor);
  await expect(auditor.locator("main h1")).toHaveText("Journal Entries");
  await expect(
    auditor.getByRole("button", { name: "Create balanced draft", exact: true }),
  ).toHaveCount(0);
  await expect(auditor.getByLabel("Debit 1", { exact: true })).toHaveCount(0);
  await expect(
    auditor.getByRole("button", { name: "New manual journal", exact: true }),
  ).toHaveCount(0);
  await other.close();
});
