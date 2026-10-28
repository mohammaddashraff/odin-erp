import { test, expect, type Page } from "@playwright/test";
import { login, ready } from "./helpers";
import { savedResponse } from "./workflow";
test("manual journal validation, full draft edit, independent approval, posting, reversal and periods", async ({
  page,
  browser,
}) => {
  await login(page);
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, "cfo@odin.demo");
  const refs = await page.evaluate(async () =>
    (
      await fetch("/api/bootstrap", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("odin_token")}`,
        },
      })
    ).json(),
  );
  const accounts = refs.accounts.filter(
    (account: any) =>
      account.active && account.postingAllowed && !account.controlType,
  );
  expect(accounts.length).toBeGreaterThan(1);
  await page.goto("/accounting/journals");
  await ready(page);
  await page
    .getByRole("button", { name: "New manual journal", exact: true })
    .click();
  for (const label of [
    "Debit 1",
    "Credit 1",
    "Debit 2",
    "Credit 2",
    "Cost center 1",
    "Cost center 2",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Posting account 1", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Create balanced draft" }),
  ).toBeDisabled();
  const description = "UI QA journal " + Date.now();
  await page
    .getByRole("textbox", { name: "Description", exact: false })
    .first()
    .fill(description);
  await page
    .getByLabel("Posting account 1", { exact: true })
    .selectOption(accounts[0].id);
  await page
    .getByLabel("Posting account 2", { exact: true })
    .selectOption(accounts[1].id);
  await page.getByLabel("Debit 1", { exact: true }).fill("100.00");
  await page.getByLabel("Credit 2", { exact: true }).fill("99.00");
  await expect(
    page.getByRole("button", { name: "Create balanced draft" }),
  ).toBeDisabled();
  await expect(page.locator(".ac-totals-band")).toContainText(
    "Entry needs attention",
  );
  await page.getByLabel("Credit 2", { exact: true }).fill("100.001");
  await expect(
    page.getByRole("button", { name: "Create balanced draft" }),
  ).toBeDisabled();
  await page.getByLabel("Credit 2", { exact: true }).fill("-100.00");
  await expect(
    page.getByRole("button", { name: "Create balanced draft" }),
  ).toBeDisabled();
  await page.getByLabel("Credit 2", { exact: true }).fill("100.00");
  await expect(page.locator(".ac-totals-band")).toContainText("Balanced entry");
  const journal = await savedResponse(
    page,
    "Create balanced draft",
    "/journals",
  );
  await ready(page);
  await expect(page.locator("main h1")).toHaveText(journal.number);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Description", exact: false })
    .first()
    .fill(description + " revised");
  await page
    .getByLabel("Posting account 1", { exact: true })
    .selectOption(accounts[0].id);
  await page
    .getByLabel("Posting account 2", { exact: true })
    .selectOption(accounts[1].id);
  await page.getByLabel("Debit 1", { exact: true }).fill("125.75");
  await page.getByLabel("Credit 1", { exact: true }).fill("0");
  await page.getByLabel("Debit 2", { exact: true }).fill("0");
  await page.getByLabel("Credit 2", { exact: true }).fill("125.75");
  await page
    .getByLabel("Line description 1", { exact: true })
    .fill("Revised debit detail");
  const edited = await savedResponse(
    page,
    "Save changes",
    `/journals/${journal.id}`,
    "PATCH",
  );
  expect(
    edited.lines.reduce(
      (sum: bigint, line: any) => sum + BigInt(line.debitMinor),
      0n,
    ),
  ).toBe(12575n);
  await ready(page);
  await expect(
    page.getByText("Revised debit detail", { exact: true }),
  ).toBeVisible();
  async function journalAction(p: Page, d: any, action: string) {
    await p.goto(`/accounting/journals?journal=${d.id}`);
    await ready(p);
    await p.getByRole("button", { name: action, exact: true }).click();
    const response = p.waitForResponse(
      (r) =>
        r.url().endsWith(`/journals/${d.id}/${action.toLowerCase()}`) &&
        r.request().method() === "POST",
    );
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    const result = await response;
    expect(result.ok(), await result.text()).toBe(true);
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await ready(p);
  }
  await journalAction(page, journal, "Submit");
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toHaveCount(0);
  await journalAction(checker, journal, "Approve");
  await journalAction(checker, journal, "Post");
  await page.goto(`/accounting/journals?journal=${journal.id}`);
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reverse", exact: true }).click();
  await page
    .getByRole("textbox", { name: /Reversal reason/ })
    .fill("Isolated UI reversal test");
  const reversed = await savedResponse(
    page,
    "Create balanced draft",
    `/journals/${journal.id}/reverse/create`,
  );
  expect(reversed.reversesEntryId).toBe(journal.id);
  await journalAction(page, reversed, "Submit");
  await journalAction(checker, reversed, "Approve");
  await journalAction(checker, reversed, "Post");
  const ledger = await page.evaluate(
    async ({ accountId, reference }) => {
      const response = await fetch(
        `/api/accounting/ledger?accountId=${accountId}&search=${encodeURIComponent(reference)}&pageSize=500`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("odin_token")}`,
          },
        },
      );
      return response.json();
    },
    { accountId: accounts[0].id, reference: "Revised debit detail" },
  );
  expect(ledger.rows.some((line: any) => line.journalId === journal.id)).toBe(
    true,
  );
  expect(ledger.rows.some((line: any) => line.journalId === reversed.id)).toBe(
    true,
  );
  expect(
    ledger.rows
      .filter((line: any) => [journal.id, reversed.id].includes(line.journalId))
      .reduce(
        (sum: bigint, line: any) =>
          sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
        0n,
      ),
  ).toBe(0n);
  await page.goto("/accounting/periods");
  await ready(page);
  const existing = refs.periods.map(
    (period: any) => `${period.year}-${period.month}`,
  );
  const year = Array.from({ length: 170 }, (_, i) => 2030 + i).find(
    (candidate) => !existing.includes(`${candidate}-1`),
  )!;
  await page
    .getByRole("button", { name: "Create fiscal period", exact: true })
    .click();
  await page.getByLabel("Year", { exact: false }).fill(String(year));
  await page.getByLabel("Month", { exact: false }).fill("1");
  await page.getByLabel("Period name", { exact: false }).fill(`UI QA ${year}`);
  await page.getByLabel("Start date").fill(`${year}-01-01`);
  await page.getByLabel("End date").fill(`${year}-01-31`);
  const period = await savedResponse(page, "Create open period", "/periods");
  await ready(page);
  for (const action of ["Close period", "Lock period", "Reopen period"]) {
    const row = page.locator("tbody tr").filter({ hasText: `UI QA ${year}` });
    await row.getByRole("button", { name: action, exact: true }).click();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/periods/${period.id}`) &&
        r.request().method() === "PATCH" &&
        r.status() !== 403,
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toContainText(
      action === "Reopen period" ? "Posting permitted" : "Posting blocked",
    );
  }
  await context.close();
});
test("bank movement, statement import and reconciliation", async ({ page }) => {
  await login(page);
  const ref = "UI-QA-" + Date.now();
  await page.goto("/banking/reconciliation");
  await ready(page);
  await page
    .getByRole("button", { name: "Bank transaction", exact: true })
    .click();
  await page.getByLabel("Reference", { exact: true }).fill(ref);
  const tx = await savedResponse(
    page,
    "Post transaction",
    "/banking/transactions",
  );
  await ready(page);
  await page.getByRole("button", { name: "Import statement line" }).click();
  await page.getByLabel("Bank reference").fill(ref);
  const statement = await savedResponse(
    page,
    "Import statement",
    "/banking/statements",
  );
  await ready(page);
  const row = page
    .locator("tbody tr")
    .filter({ hasText: ref })
    .filter({ has: page.getByRole("combobox") });
  await row.getByRole("combobox").selectOption(tx.id);
  const response = page.waitForResponse(
    (r) => r.url().includes("/match") && r.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator("tbody tr").filter({ hasText: ref }).last(),
  ).toContainText("Matched");
});
test("POS barcode, split tender, hold, resume, receipt, return and shift close", async ({
  page,
}) => {
  await login(page);
  await page.goto("/pos/workspace");
  await ready(page);
  // Other security fixtures can open a retail register with no stock. Close
  // leftover QA shifts through the UI before opening the stocked main register.
  while (
    await page.getByRole("button", { name: "Close shift", exact: true }).count()
  ) {
    await page
      .getByRole("button", { name: "Close shift", exact: true })
      .click();
    const closed = page.waitForResponse(
      (r) => r.url().endsWith("/close") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Close shift", exact: true })
      .click();
    expect((await closed).ok()).toBe(true);
    await ready(page);
  }
  if (
    await page
      .getByRole("button", { name: "Open register shift", exact: true })
      .count()
  ) {
    await page
      .getByRole("button", { name: "Open register shift", exact: true })
      .click();
    await savedResponse(page, "Open register shift", "/pos/shifts");
    await ready(page);
  }
  await page.getByRole("searchbox").fill("MOU-WL");
  await page.getByRole("searchbox").press("Enter");
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await page.getByTestId("split-tender").click();
  const sale = await savedResponse(page, "Complete split tender", "/pos/sales");
  await ready(page);
  const row = () => page.locator("tbody tr").filter({ hasText: sale.number });
  await expect(row()).toContainText("CASH");
  await expect(row()).toContainText("CARD");
  const download = page.waitForEvent("download");
  await row().getByRole("button", { name: "Receipt", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(sale.number + ".pdf");
  await row().getByRole("button", { name: "Return", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /Reason/ })
    .fill("Isolated UI return");
  const refund = page.waitForResponse((r) =>
    r.url().endsWith(`/pos/sales/${sale.id}/return`),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  expect((await refund).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox").fill("MOU-WL");
  await page.getByRole("searchbox").press("Enter");
  const held = await savedResponse(page, "Hold", "/pos/sales");
  await ready(page);
  await page
    .locator("tbody tr")
    .filter({ hasText: held.number })
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  const resume = page.waitForResponse((r) =>
    r.url().endsWith(`/pos/sales/${held.id}/resume`),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  expect((await resume).ok()).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Close shift", exact: true }).click();
  const closed = page.waitForResponse(
    (r) => r.url().includes("/pos/shifts/") && r.url().endsWith("/close"),
  );
  await page.getByRole("button", { name: "Close shift", exact: true }).click();
  expect((await closed).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Open register shift", exact: true }),
  ).toBeVisible();
});
