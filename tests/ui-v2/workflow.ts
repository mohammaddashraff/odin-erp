import { expect, type Page } from "@playwright/test";
import { routeForDocumentType } from "../../apps/web/src/core/navigation";
import { ready } from "./helpers";
export async function openDocument(page: Page, d: any) {
  await page.goto(`${routeForDocumentType(d.type)}?document=${d.id}`);
  await ready(page);
  await expect(page.locator("main h1")).toHaveText(d.number);
}
export async function confirmed(
  page: Page,
  name: string,
  path: string,
  reason = true,
) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (reason)
    await dialog
      .getByRole("textbox", { name: /Reason/ })
      .fill("Isolated replacement QA");
  const response = page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  const r = await response;
  expect(r.ok(), await r.text()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await ready(page);
  return r.json();
}
export async function savedResponse(
  page: Page,
  button: string,
  path: string,
  method = "POST",
) {
  const response = page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api" + path) &&
      r.request().method() === method &&
      !(
        r.status() === 403 &&
        (await r.json().catch(() => null))?.denial?.reason ===
          "STEP_UP_REQUIRED"
      ),
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  const r = await response;
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
export async function convertDocument(
  page: Page,
  d: any,
  target: string,
  quantity?: string,
) {
  await openDocument(page, d);
  await page.getByTestId(`convert-${target}`).click();
  const dialog = page.getByRole("dialog");
  if (quantity)
    await dialog
      .getByRole("textbox", { name: /Convert now/ })
      .first()
      .fill(quantity);
  const r = await savedResponse(
    page,
    "Create linked draft",
    `/documents/${d.id}/convert`,
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveText(r.number);
  return r;
}
export async function approveDocument(
  maker: Page,
  checker: Page,
  d: any,
  post = false,
) {
  await openDocument(maker, d);
  await confirmed(maker, "Submit for approval", `/documents/${d.id}/submit`);
  await openDocument(checker, d);
  await confirmed(checker, "Approve", `/documents/${d.id}/approve`);
  if (post)
    await confirmed(checker, "Post effects", `/documents/${d.id}/post`, false);
}
