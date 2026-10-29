import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { reviewFixture } from "./fixtures";
import { allRoutes, legacyRedirects } from "../../apps/web/src/core/navigation";
import { t } from "../../apps/web/src/core/i18n";
import { av8ReportSchemas } from "../../apps/web/src/core/av8-report-schema";
import { evidencePath } from "./evidence";
const sizes = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
];
async function settled(page: any) {
  await expect(page.locator(".glass-header")).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await expect(page.locator("main")).not.toBeEmpty();
}
for (const language of ["en", "ar"] as const) {
  test(`all authorized routes and redirects ${language}`, async ({ page }) => {
    test.setTimeout(600000);
    await reviewFixture(page, language);
    const ledger: any[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of [
      ...new Set([
        ...allRoutes.map((x) => x.child.route),
        "/settings/access/users/new",
        "/settings/access/users/1",
        "/av8/students?student=1",
        "/av8/leads?lead=1",
        "/dashboard?view=daily",
      ]),
    ]) {
      const failed: string[] = [];
      const response = (r: any) => {
        if (r.url().includes("/api/") && r.status() >= 400)
          failed.push(new URL(r.url()).pathname + ":" + r.status());
      };
      page.on("response", response);
      await page.goto(route);
      await settled(page);
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      const name = route.replace(/[^a-z0-9]+/gi, "_");
      await page.screenshot({
        path: evidencePath("routes", language, `${name}.png`),
        fullPage: true,
      });
      ledger.push({
        route,
        language,
        viewport: "1440x900",
        state: failed.length
          ? "service-error fixture"
          : (await page.locator("tbody tr").count())
            ? "table rendered"
            : "rendered",
        failedRequests: failed,
        overflow,
        headings: await page.locator("main h1").allTextContents(),
        screenshot: `routes/${language}/${name}.png`,
      });
      page.removeListener("response", response);
      expect(overflow, route).toBe(false);
    }
    for (const [from, to] of Object.entries(legacyRedirects)) {
      await page.goto(from);
      await settled(page);
      expect(new URL(page.url()).pathname).toBe(to);
      ledger.push({ route: from, redirect: to, language });
    }
    writeFileSync(
      evidencePath(`route-coverage-${language}.json`),
      JSON.stringify({ ledger, errors }, null, 2),
    );
    expect(errors).toEqual([]);
  });
  for (const [width, height] of sizes)
    test(`responsive templates ${language} ${width}x${height}`, async ({
      page,
    }) => {
      test.setTimeout(180000);
      await reviewFixture(page, language);
      await page.setViewportSize({ width, height });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const facts: any[] = [];
      for (const [name, url] of [
        ["daily", "/dashboard?view=daily"],
        ["financial", "/dashboard"],
        ["list", "/av8/affairs"],
        ["detail", "/av8/leads?lead=1"],
        ["form", "/av8/leads"],
        ["student", "/av8/students?student=1"],
        ["report", "/av8/reports"],
        ["admin", "/settings/access/users"],
      ]) {
        await page.goto(url);
        await settled(page);
        if (name === "form") {
          await page
            .getByRole("button", {
              name: t("Capture lead", language),
              exact: true,
            })
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
        }
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          h1: document.querySelector("main h1")
            ? getComputedStyle(document.querySelector("main h1")!).fontSize
            : null,
          dialog: [...document.querySelectorAll("dialog")].map((d) => ({
            height: d.getBoundingClientRect().height,
            scroll: d.scrollHeight,
            client: d.clientHeight,
          })),
        }));
        expect(dimensions.scroll, name).toBeLessThanOrEqual(width + 1);
        expect(
          await page.getByTestId("language-toggle").getAttribute("aria-label"),
        ).toBeTruthy();
        if (name === "form") {
          const footer = page.locator(".av8-form-actions");
          await expect(footer).toBeInViewport();
          await page
            .locator(".av8-form-content")
            .evaluate((e) => (e.scrollTop = e.scrollHeight));
          await expect(
            page.getByRole("dialog").getByRole("checkbox"),
          ).toBeInViewport();
        }
        const screenshot = `matrix/${name}-${language}-${width}x${height}.png`;
        await page.screenshot({
          path: evidencePath(screenshot),
          fullPage: true,
        });
        facts.push({
          template: name,
          url,
          language,
          viewport: { width, height },
          dimensions,
          screenshot,
        });
        if (name === "form") await page.keyboard.press("Escape");
      }
      if (width <= 768) {
        await page
          .getByRole("button", { name: t("Menu", language), exact: true })
          .click();
        await expect(page.locator(".glass-navigation")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".glass-menu-toggle")).toBeFocused();
      }
      writeFileSync(
        evidencePath(`matrix-${language}-${width}.json`),
        JSON.stringify({ facts, errors }, null, 2),
      );
      expect(errors).toEqual([]);
    });
  test(`student, administration, access and report tabs ${language}`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await reviewFixture(page, language);
    const states: any[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const tab of [
      "Admissions",
      "Medical",
      "Agreement",
      "Documents",
      "English",
      "Visa",
      "Travel",
      "Progress",
      "Payments",
      "Academy statement",
      "Guardian",
      "Tasks & exceptions",
      "Timeline",
    ]) {
      await page.goto("/av8/students?student=1&tab=" + encodeURIComponent(tab));
      await settled(page);
      await expect(
        page.getByRole("heading", { name: "Review account A" }),
      ).toBeVisible();
      await expect(page.locator(".av8-subtabs [aria-current=page]")).toHaveText(
        t(tab, language),
      );
      states.push({ route: "/av8/students?student=1", tab, language });
    }
    await page.goto("/settings/access/users/1");
    await settled(page);
    for (const tab of ["Details", "Access", "Account & Security", "Activity"]) {
      const control = page.getByRole("button", {
        name: t(tab, language),
        exact: true,
      });
      if (await control.count()) {
        await control.click();
        await settled(page);
        states.push({ route: "/settings/access/users/1", tab, language });
      }
    }
    await page.goto("/settings/access/roles");
    await settled(page);
    await page
      .getByRole("button", { name: t("Edit", language), exact: true })
      .click();
    for (const tab of [
      "Actions",
      "Which records can this user access?",
      "Sensitive information",
      "Financial limits",
    ]) {
      await page
        .getByRole("button", { name: t(tab, language), exact: true })
        .click();
      await settled(page);
      states.push({ route: "/settings/access/roles", tab, language });
    }
    await page.goto("/av8/reports");
    await settled(page);
    for (const report of Object.keys(av8ReportSchemas).filter(
      (r) => r !== "arrears",
    )) {
      await page
        .getByLabel(t("Report", language), { exact: true })
        .selectOption(report);
      await settled(page);
      expect(await page.locator("thead th").count()).toBe(
        av8ReportSchemas[report].length,
      );
      states.push({ route: "/av8/reports", report, language });
    }
    writeFileSync(
      evidencePath(`tab-coverage-${language}.json`),
      JSON.stringify({ states, errors }, null, 2),
    );
    expect(errors).toEqual([]);
  });
}
