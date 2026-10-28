import { expect, Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { t } from "../../apps/web/src/core/i18n";
import {
  canAccess,
  displayPermissionsFor,
} from "../../apps/web/src/core/navigation";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatExchangeRate,
  formatInteger,
  formatNumber,
  formatPercentage,
  formatQuantity,
  localeFor,
  normalizeWesternDigits,
  normalizeWesternNumberInput,
} from "../../apps/web/src/core/formatters";

test("Arabic formatters enforce Western digits, separators, dates, currency and exact large values", () => {
  const outputs = [
    formatNumber("12345.67", "ar"),
    formatInteger(12345, "ar"),
    formatCurrency(12_545_075n, "EGP", "ar"),
    formatCurrency(900_719_925_474_099_312_345n, "EGP", "ar"),
    formatQuantity(1_234_567n, "ar"),
    formatPercentage("12.5", "ar"),
    formatExchangeRate(1_234_567n, "ar"),
    formatDate("2026-08-09T00:00:00.000Z", "ar"),
    formatDateTime("2026-08-09T13:45:00.000Z", "ar"),
    t("23 records", "ar"),
  ];

  expect(localeFor("ar")).toBe("ar-EG-u-nu-latn");
  expect(formatNumber("12345.67", "ar")).toBe("12,345.67");
  expect(formatCurrency(12_545_075n, "EGP", "ar")).toContain("125,450.75");
  expect(formatCurrency(900_719_925_474_099_312_345n, "EGP", "ar")).toContain(
    "9,007,199,254,740,993,123.45",
  );
  expect(formatQuantity(1_234_567n, "ar")).toBe("1,234.567");
  expect(formatExchangeRate(1_234_567n, "ar")).toBe("1.234567");
  expect(formatPercentage("12.5", "ar")).toContain("12.5");
  expect(formatDate("2026-08-09T00:00:00.000Z", "ar")).toContain("2026");
  expect(normalizeWesternDigits("طلب ١٢۳")).toBe("طلب 123");
  expect(normalizeWesternNumberInput("١٢٣٬٤٥٦٫٧٨")).toBe("123,456.78");
  for (const output of outputs) expect(output).not.toMatch(/[٠-٩۰-۹]/);
});

test("display permissions include company-scoped grants while explicit denials still win", () => {
  const permissions = displayPermissionsFor({
    permissions: ["dashboard.overview.view", "sales.*"],
    companyScopedPermissions: {
      "10": ["banking.account.view"],
      "20": ["reports.standard.view"],
    },
    deniedPermissions: ["sales.customer.view"],
  });

  expect(canAccess(permissions, "banking.account.view")).toBe(true);
  expect(canAccess(permissions, "reports.standard.view")).toBe(true);
  expect(canAccess(permissions, "sales.order.view")).toBe(true);
  expect(canAccess(permissions, "sales.customer.view")).toBe(false);
  expect(
    canAccess(permissions, ["sales.customer.view", "reports.standard.view"]),
  ).toBe(true);
  expect(
    canAccess(permissions, ["sales.customer.view", "settings.system.view"]),
  ).toBe(false);
  expect(canAccess(permissions, "settings.system.view")).toBe(false);
});

const password = "password";

test("Arabic and English report/PDF export endpoints honor the requested locale", async ({
  request,
}) => {
  const loginResponse = await request.post("/api/auth/login", {
    data: { email: "admin@odin.demo", password },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const token = (await loginResponse.json()).token as string;
  const authorization = { Authorization: `Bearer ${token}` };

  const arabicCsv = await request.get("/api/reports/reconciliation/csv", {
    headers: {
      ...authorization,
      "Accept-Language": "ar",
      "X-Odin-Language": "ar",
    },
  });
  expect(arabicCsv.ok()).toBeTruthy();
  const arabicCsvText = await arabicCsv.text();
  expect(arabicCsvText).toContain("حساب المراقبة");
  expect(arabicCsvText).toMatch(/[0-9]/);
  expect(arabicCsvText).not.toMatch(/[٠-٩۰-۹]/);

  const englishCsv = await request.get("/api/reports/reconciliation/csv", {
    headers: {
      ...authorization,
      "Accept-Language": "en",
      "X-Odin-Language": "en",
    },
  });
  expect(englishCsv.ok()).toBeTruthy();
  const englishCsvText = await englishCsv.text();
  expect(englishCsvText).toContain("Control");
  expect(englishCsvText).not.toContain("حساب المراقبة");

  const reportPdf = await request.get("/api/reports/reconciliation/pdf", {
    headers: {
      ...authorization,
      "Accept-Language": "ar",
      "X-Odin-Language": "ar",
    },
  });
  expect(reportPdf.ok()).toBeTruthy();
  expect(reportPdf.headers()["content-type"]).toContain("application/pdf");
  expect((await reportPdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  const documents = await request.get("/api/documents?type=PURCHASE_ORDER", {
    headers: authorization,
  });
  expect(documents.ok()).toBeTruthy();
  const documentId = String((await documents.json())[0].id);
  const documentPdf = await request.get(`/api/documents/${documentId}/pdf`, {
    headers: {
      ...authorization,
      "Accept-Language": "ar",
      "X-Odin-Language": "ar",
    },
  });
  expect(documentPdf.ok()).toBeTruthy();
  expect(documentPdf.headers()["content-type"]).toContain("application/pdf");
  expect((await documentPdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("numeric API strings keep arbitrary precision and reject malformed display grouping", async () => {
  const { canonicalNumericPayload } = await import(
    "../../apps/web/src/core/numeric-input"
  );
  const normalized = JSON.parse(
    canonicalNumericPayload(
      JSON.stringify({
        amount: "٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣٫٠١",
        lines: [{ quantity: "1,234.567", unitPrice: "12,34.00" }],
        notes: "١٢٣٬٤٥٦",
        reference: "1,234",
      }),
    ),
  );
  expect(normalized.amount).toBe("9007199254740993.01");
  expect(normalized.lines[0]).toEqual({
    quantity: "1234.567",
    unitPrice: "12,34.00",
  });
  expect(normalized.notes).toBe("١٢٣٬٤٥٦");
  expect(normalized.reference).toBe("1,234");
});
