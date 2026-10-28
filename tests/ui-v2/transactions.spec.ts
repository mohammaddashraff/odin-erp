import { test, expect, type Page } from "@playwright/test";
import { login, ready } from "./helpers";
const route: Record<string, string> = {
  QUOTATION: "/sales/quotations",
  SALES_ORDER: "/sales/orders",
  DELIVERY_NOTE: "/sales/deliveries",
  SALES_INVOICE: "/sales/invoices",
  SALES_RETURN: "/sales/returns",
  CREDIT_NOTE: "/sales/credit-notes",
};
async function open(page: Page, d: any) {
  await page.goto(`${route[d.type]}?document=${d.id}`);
  await ready(page);
  await expect(page.locator("main h1")).toHaveText(d.number);
}
async function action(page: Page, name: string, path: string, comment = true) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (comment)
    await dialog.getByLabel("Reason").fill("Isolated UI parity verification");
  const response = page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await ready(page);
}
async function convert(page: Page, d: any, target: string, quantity?: string) {
  await open(page, d);
  await page.getByTestId(`convert-${target}`).click();
  const dialog = page.getByRole("dialog");
  if (quantity)
    await dialog
      .getByRole("textbox", { name: /Convert now/ })
      .first()
      .fill(quantity);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/documents/${d.id}/convert`) &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create linked draft" }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBe(true);
  const created = await result.json();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveText(created.number);
  return created;
}
test("quotation edit, independent approval, order, delivery, invoice, receipt, return and credit", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  await login(page);
  const context = await browser.newContext();
  const checker = await context.newPage();
  await login(checker, "branch@odin.demo");
  await page.goto("/sales/quotations");
  await ready(page);
  await page.getByTestId("new-document").click();
  await page.getByLabel("Quantity 1", { exact: true }).fill("4.000");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Isolated replacement UI workflow");
  const create = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/documents") && r.request().method() === "POST",
  );
  await page.getByTestId("save-document").click();
  let quote = await (await create).json();
  await expect(page.locator("main h1")).toHaveText(quote.number);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Edited in the replacement frontend");
  await page.getByTestId("save-document").click();
  await expect(
    page.getByText("Edited in the replacement frontend", { exact: true }),
  ).toBeVisible();
  // Quotations retain direct conversion from draft; order approval remains independent.
  const order = await convert(page, quote, "SALES_ORDER");
  async function approve(d: any, post = false) {
    await open(page, d);
    await action(page, "Submit for approval", `/documents/${d.id}/submit`);
    await expect(page.getByTestId("approval-waiting")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve", exact: true }),
    ).toHaveCount(0);
    await open(checker, d);
    await action(checker, "Approve", `/documents/${d.id}/approve`);
    if (post)
      await action(checker, "Post effects", `/documents/${d.id}/post`, false);
  }
  await approve(order);
  const delivery = await convert(page, order, "DELIVERY_NOTE");
  await approve(delivery, true);
  await checker
    .getByRole("button", { name: "Inventory effect", exact: true })
    .click();
  await expect(checker.locator("tbody tr")).not.toHaveCount(0);
  const invoice = await convert(page, delivery, "SALES_INVOICE");
  await approve(invoice, true);
  await open(page, invoice);
  await page
    .getByRole("button", { name: "Accounting effect", exact: true })
    .click();
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await open(page, invoice);
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print / PDF" }).click();
  const file = await pdf;
  expect(file.suggestedFilename()).toBe(invoice.number + ".pdf");
  expect(await file.failure()).toBeNull();
  await page.goto("/banking/allocations");
  await ready(page);
  await page
    .getByRole("button", { name: "Allocate payment", exact: true })
    .click();
  await page.getByLabel("Open document").selectOption(invoice.id);
  await page.getByLabel("Allocation amount").fill("1.00");
  const receipt = page.waitForResponse(
    (r) => r.url().endsWith("/api/payments") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Post and allocate" }).click();
  const received = await receipt;
  expect(received.ok(), await received.text()).toBe(true);
  const returned = await convert(page, invoice, "SALES_RETURN", "1.000");
  await approve(returned, true);
  const credit = await convert(page, invoice, "CREDIT_NOTE", "1.000");
  await approve(credit, true);
  await open(page, invoice);
  await expect(page.locator(".document-chain")).toContainText(returned.number);
  await expect(page.locator(".document-chain")).toContainText(credit.number);
  const token = await page.evaluate(() => localStorage.getItem("odin_token"));
  const detail = async (d: any) => {
    const response = await page.request.get(`/api/documents/${d.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  for (const d of [delivery, invoice, returned, credit]) {
    const posted = await detail(d);
    expect(posted.status).toBe("POSTED");
    expect(
      posted.journalEntry.lines.reduce(
        (n: bigint, l: any) => n + BigInt(l.debitMinor) - BigInt(l.creditMinor),
        0n,
      ),
    ).toBe(0n);
    expect(posted.journalEntry.sourceType).toBe(d.type);
    expect(String(posted.journalEntry.sourceId)).toBe(String(d.id));
  }
  const settled = await detail(invoice),
    returnedDetail = await detail(returned),
    creditDetail = await detail(credit);
  expect(BigInt(settled.returnedMinor)).toBe(BigInt(returnedDetail.totalMinor));
  expect(BigInt(settled.creditedMinor)).toBe(BigInt(creditDetail.totalMinor));
  expect(BigInt(settled.remainingMinor)).toBe(
    BigInt(settled.totalMinor) -
      BigInt(returnedDetail.totalMinor) -
      BigInt(creditDetail.totalMinor) -
      100n,
  );
  const deliveryDetail = await detail(delivery);
  expect(
    deliveryDetail.stockMovements.reduce(
      (n: bigint, m: any) => n + BigInt(m.quantityOutMilli),
      0n,
    ),
  ).toBe(4000n);
  await context.close();
});
