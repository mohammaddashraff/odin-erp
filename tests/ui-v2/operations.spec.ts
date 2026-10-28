import { test, expect } from "@playwright/test";
import { login, ready } from "./helpers";
import {
  savedResponse,
  convertDocument,
  approveDocument,
  openDocument,
} from "./workflow";
test("purchase request through RFQ, order, receipt, bill, payment and return", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await login(page);
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, "branch@odin.demo");
  await page.goto("/purchasing/requests");
  await ready(page);
  await page.getByTestId("new-document").click();
  await page.getByLabel("Quantity 1", { exact: true }).fill("5.000");
  const request = await savedResponse(page, "Save draft", "/documents");
  await approveDocument(page, checker, request);
  const rfq = await convertDocument(page, request, "PURCHASE_RFQ");
  await approveDocument(page, checker, rfq);
  const order = await convertDocument(page, rfq, "PURCHASE_ORDER");
  await approveDocument(page, checker, order);
  const receipt = await convertDocument(page, order, "GOODS_RECEIPT");
  await approveDocument(page, checker, receipt, true);
  const bill = await convertDocument(page, receipt, "PURCHASE_BILL");
  await approveDocument(page, checker, bill, true);
  await page.goto("/banking/allocations");
  await ready(page);
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  await page.getByLabel("Direction").selectOption("PAYMENT");
  await page.getByLabel("Open document").selectOption(bill.id);
  await page.getByLabel("Allocation amount").fill("1.00");
  const payment = await savedResponse(page, "Submit for approval", "/payments");
  expect(payment.status).toBe("SUBMITTED");
  const financeContext = await browser.newContext();
  const finance = await financeContext.newPage();
  await login(finance, "cfo@odin.demo");
  await finance.goto("/banking/allocations");
  await ready(finance);
  const row = finance.locator("tbody tr").filter({ hasText: payment.number });
  await row.getByRole("button", { name: "Approve and post" }).click();
  const response = finance.waitForResponse((r) =>
    r.url().includes(`/payments/${payment.id}/approve`),
  );
  await finance
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(finance.getByRole("dialog")).toHaveCount(0);
  await financeContext.close();
  const returned = await convertDocument(
    page,
    bill,
    "PURCHASE_RETURN",
    "1.000",
  );
  await approveDocument(page, checker, returned, true);
  await context.close();
});
test("inventory adjustment, transfer and physical stock count", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page);
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, "branch@odin.demo");
  for (const [path, quantity] of [
    ["/inventory/adjustments", "2.000"],
    ["/inventory/transfers", "1.000"],
    ["/inventory/counts", "50.000"],
  ]) {
    await page.goto(path);
    await ready(page);
    await page.getByTestId("new-document").click();
    await page
      .getByRole("textbox", {
        name: path.endsWith("counts") ? "Counted 1" : "Quantity 1",
        exact: true,
      })
      .fill(quantity);
    if (path.endsWith("adjustments"))
      await page.getByLabel("Adjustment direction 1").selectOption("Increase");
    const d = await savedResponse(page, "Save draft", "/documents");
    await approveDocument(page, checker, d, true);
    await checker
      .getByRole("button", { name: "Inventory effect", exact: true })
      .click();
    await expect(checker.locator("tbody tr")).not.toHaveCount(0);
  }
  await context.close();
});
test("all supported master creation forms persist complete records", async ({
  page,
}) => {
  await login(page);
  const stamp = Date.now();
  for (const [kind, path, end] of [
    ["supplier", "/purchasing/suppliers", "suppliers"],
    ["category", "/inventory/categories", "categories"],
    ["unit", "/inventory/units", "units"],
    ["warehouse", "/inventory/warehouses", "warehouses"],
    ["item", "/inventory/items", "items"],
    ["bank", "/banking/accounts", "bank-accounts"],
  ]) {
    await page.goto(path);
    await ready(page);
    await page.getByTestId(`new-${kind}`).click();
    await page
      .getByTestId(`master-${kind}-name`)
      .fill(`UI QA ${kind} ${stamp}`);
    if (kind === "item") {
      await page.getByTestId("master-item-sku").fill(`QA-${stamp}`);
      await page.getByLabel("Barcode", { exact: false }).fill(`QA${stamp}`);
    } else
      await page.getByTestId(`master-${kind}-code`).fill(`QA-${kind}-${stamp}`);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/masters/${end}`) &&
        r.request().method() === "POST",
    );
    await page.getByTestId(`save-${kind}`).click();
    const r = await response;
    expect(r.ok(), await r.text()).toBe(true);
    await ready(page);
    await page.getByRole("searchbox").fill(`UI QA ${kind} ${stamp}`);
    await expect(page.locator("tbody")).toContainText(`UI QA ${kind} ${stamp}`);
  }
});
