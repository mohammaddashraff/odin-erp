import { expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { t } from '../../apps/web/src/app/i18n';
import { canAccess, displayPermissionsFor } from '../../apps/web/src/app/navigation';
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
} from '../../apps/web/src/app/formatters';

const password = 'password';
const screenshots = resolve(process.cwd(), 'artifacts/screenshots');
mkdirSync(screenshots, { recursive: true });

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  problems.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('400 (Bad Request)')) errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
});

test.afterEach(async ({ page }) => expect(problems.get(page) || []).toEqual([]));

async function login(page: Page, language: 'ar' | 'en' = 'ar') {
  if (/^https?:/.test(page.url())) await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'odin_language', value: language, url: 'http://127.0.0.1:8080' }]);
  const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `dashboard bootstrap returned ${response?.status() ?? 'no response'}`).toBeTruthy();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill('admin@odin.demo');
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'مركز الإدارة' : 'Command Center', exact: true })).toBeVisible();
}

async function toggleLanguage(page: Page) {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('language-toggle').click();
}

test('Arabic formatters enforce Western digits, separators, dates, currency and exact large values', () => {
  const outputs = [
    formatNumber('12345.67', 'ar'),
    formatInteger(12345, 'ar'),
    formatCurrency(12_545_075n, 'EGP', 'ar'),
    formatCurrency(900_719_925_474_099_312_345n, 'EGP', 'ar'),
    formatQuantity(1_234_567n, 'ar'),
    formatPercentage('12.5', 'ar'),
    formatExchangeRate(1_234_567n, 'ar'),
    formatDate('2026-08-09T00:00:00.000Z', 'ar'),
    formatDateTime('2026-08-09T13:45:00.000Z', 'ar'),
    t('23 records', 'ar'),
  ];

  expect(localeFor('ar')).toBe('ar-EG-u-nu-latn');
  expect(formatNumber('12345.67', 'ar')).toBe('12,345.67');
  expect(formatCurrency(12_545_075n, 'EGP', 'ar')).toContain('125,450.75');
  expect(formatCurrency(900_719_925_474_099_312_345n, 'EGP', 'ar')).toContain('9,007,199,254,740,993,123.45');
  expect(formatQuantity(1_234_567n, 'ar')).toBe('1,234.567');
  expect(formatExchangeRate(1_234_567n, 'ar')).toBe('1.234567');
  expect(formatPercentage('12.5', 'ar')).toContain('12.5');
  expect(formatDate('2026-08-09T00:00:00.000Z', 'ar')).toContain('2026');
  expect(normalizeWesternDigits('طلب ١٢۳')).toBe('طلب 123');
  expect(normalizeWesternNumberInput('١٢٣٬٤٥٦٫٧٨')).toBe('123,456.78');
  for (const output of outputs) expect(output).not.toMatch(/[٠-٩۰-۹]/);
});

test('display permissions include company-scoped grants while explicit denials still win', () => {
  const permissions = displayPermissionsFor({
    permissions: ['dashboard.overview.view', 'sales.*'],
    companyScopedPermissions: { '10': ['banking.account.view'], '20': ['reports.standard.view'] },
    deniedPermissions: ['sales.customer.view'],
  });

  expect(canAccess(permissions, 'banking.account.view')).toBe(true);
  expect(canAccess(permissions, 'reports.standard.view')).toBe(true);
  expect(canAccess(permissions, 'sales.order.view')).toBe(true);
  expect(canAccess(permissions, 'sales.customer.view')).toBe(false);
  expect(canAccess(permissions, ['sales.customer.view', 'reports.standard.view'])).toBe(true);
  expect(canAccess(permissions, ['sales.customer.view', 'settings.system.view'])).toBe(false);
  expect(canAccess(permissions, 'settings.system.view')).toBe(false);
});

test('Arabic rendered UI and typed or pasted values never retain Arabic or Persian digit glyphs', async ({ page }) => {
  await login(page, 'ar');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-module', 'command');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-module-tone', 'brand');
  await expect(page.locator('.primary-kpis .metric')).toHaveCount(6);
  await expect(page.locator('.primary-kpis .metric[data-tone="success"]')).toHaveCount(1);
  await expect(page.locator('.composition-chart')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[٠-٩۰-۹]/);
  expect(await page.locator('.primary-kpis .western-digits').first().evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');

  await page.goto('/sales/customers');
  await expect(page.getByRole('heading', { name: 'العملاء', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/[٠-٩۰-۹]/);
  await page.getByTestId('new-customer').click();
  const name = page.getByTestId('master-customer-name');
  await name.fill('عميل ١٢۳');
  await expect(name).toHaveValue('عميل 123');
  const creditLimit = page.getByLabel('الحد الائتماني');
  const westernControls = page.locator('input[type="number"], input[type="date"], input[type="datetime-local"], input[type="month"], input[type="week"], input[type="time"], input[type="tel"], input[inputmode="numeric"], input[inputmode="decimal"], input[inputmode="tel"]');
  expect(await westernControls.count()).toBeGreaterThan(0);
  expect(await westernControls.evaluateAll((controls) => controls.filter((control) => control.getAttribute('lang') !== 'en' || control.getAttribute('dir') !== 'ltr').length)).toBe(0);
  await creditLimit.fill('١٢٣٬٤٥٦٫٧٨');
  await expect(creditLimit).toHaveValue('123,456.78');
});

test('Arabic purchasing is complete across the route, RFQ form, supplier form, validation, dialogs and reload', async ({ page }) => {
  await login(page, 'ar');
  await page.goto('/purchasing/rfqs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  for (const text of [
    'المشتريات والموردون',
    'طلبات عروض الأسعار',
    'طلب عرض سعر جديد',
    'مورد جديد',
    'إجمالي السجلات',
    'مسودة',
    'بانتظار الاعتماد',
    'السجلات المرحلة',
    'لا توجد طلبات عروض أسعار',
    'أنشئ أول طلب عرض سعر من هذه الشاشة.',
    'الأحدث أولًا',
  ]) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();

  await page.getByTestId('account-menu').click();
  await expect(page.getByText('المسؤول العام', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('تسجيل الخروج', { exact: true })).toBeVisible();
  await expect(page.getByText('Super Admin', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Sign out', { exact: true })).toHaveCount(0);
  await page.getByTestId('account-menu').click();

  for (const english of [
    'Odin Administrator',
    'Super Admin',
    'Sign out',
    'New Quotation',
    'New Request for Quotation',
    'Supplier',
    'Purchasing documents',
    'Create, approve, convert and post from the same persisted workflow',
    'Purchase Request',
    'Purchase Order',
    'Goods Receipt',
    'Purchase Bill',
    'Purchase Return',
    'persisted records',
    'newest first',
    'No quotation records',
    'Create the first one from this screen',
  ]) await expect(page.getByText(english, { exact: false })).toHaveCount(0);

  await page.getByTestId('new-document').click();
  const rfq = page.locator('.modal');
  await expect(rfq.getByRole('heading', { name: 'طلب عرض سعر جديد' })).toBeVisible();
  const nativeLocaleControls = rfq.locator('input[type="date"], input[type="number"], input[type="tel"], input[inputmode="numeric"], input[inputmode="decimal"]');
  expect(await nativeLocaleControls.count()).toBeGreaterThan(0);
  expect(await nativeLocaleControls.evaluateAll((controls) => controls.filter((control) => control.getAttribute('lang') !== 'en' || control.getAttribute('dir') !== 'ltr').length)).toBe(0);
  await expect(rfq.getByLabel('المورد')).toBeVisible();
  await expect(rfq.getByRole('option', { name: /دلتا لاستيراد التكنولوجيا/ })).toHaveCount(1);
  await expect(rfq.getByRole('option', { name: /سفنكس للأنظمة المكتبية/ })).toHaveCount(1);
  await expect(rfq.getByRole('option', { name: /Delta Technology Imports/ })).toHaveCount(0);
  await rfq.getByLabel('السطر 1 الكمية').fill('0');
  await page.getByTestId('save-document').click();
  await expect(rfq.locator('.form-message')).toContainText('الكمية غير صالحة');
  await page.getByRole('button', { name: 'إغلاق مربع الحوار' }).click();

  await page.getByTestId('new-supplier').click();
  const supplier = page.locator('.modal');
  await expect(supplier.getByRole('heading', { name: 'مورد جديد' })).toBeVisible();
  await expect(supplier).toContainText('الرقم الضريبي');
  await expect(supplier).toContainText('مدة السداد');
  await page.getByTestId('master-supplier-code').fill('SUP-001');
  await page.getByTestId('master-supplier-name').fill('اختبار التحقق');
  await page.getByTestId('save-supplier').click();
  await expect(supplier.locator('.form-message')).toContainText('المرجع أو الرمز مستخدم بالفعل');
  await page.getByRole('button', { name: 'إغلاق مربع الحوار' }).click();

  for (const [path, heading] of [
    ['/purchasing/requests', 'طلبات الشراء'],
    ['/purchasing/rfqs', 'طلبات عروض الأسعار'],
    ['/purchasing/orders', 'أوامر الشراء'],
    ['/purchasing/receipts', 'أذون الاستلام'],
    ['/purchasing/bills', 'فواتير الموردين'],
    ['/purchasing/returns', 'مرتجعات المشتريات'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }

  await page.goto('/purchasing/rfqs');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'طلبات عروض الأسعار', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'purchasing-rfq-ar.png'), fullPage: true });
});

test('English performs the inverse localization and persists on direct reload', async ({ page }) => {
  await login(page, 'ar');
  await toggleLanguage(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.goto('/purchasing/rfqs');
  await expect(page.getByRole('heading', { name: 'Requests for Quotation', exact: true })).toBeVisible();
  await expect(page.getByTestId('new-document')).toContainText('New Request for Quotation');
  await expect(page.getByTestId('new-supplier')).toContainText('New Supplier');

  await page.getByTestId('account-menu').click();
  await expect(page.getByText('Super Admin', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sign out', { exact: true })).toBeVisible();
  await expect(page.getByText('المسؤول العام', { exact: true })).toHaveCount(0);
  await expect(page.getByText('تسجيل الخروج', { exact: true })).toHaveCount(0);
  await page.getByTestId('account-menu').click();

  await page.getByTestId('new-document').click();
  const rfq = page.locator('.modal');
  await expect(rfq.getByRole('heading', { name: 'New Request for Quotation' })).toBeVisible();
  await expect(rfq.getByRole('option', { name: /Delta Technology Imports/ })).toHaveCount(1);
  await expect(rfq.getByRole('option', { name: /دلتا لاستيراد التكنولوجيا/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  for (const arabic of [
    'المشتريات والموردون',
    'طلبات عروض الأسعار',
    'طلب عرض سعر جديد',
    'مورد جديد',
    'السجلات المحفوظة',
    'الأحدث أولًا',
    'المسؤول العام',
    'تسجيل الخروج',
  ]) await expect(page.getByText(arabic, { exact: false })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Requests for Quotation', exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'purchasing-rfq-en.png'), fullPage: true });
});

test('Arabic dynamic values, finance forms, audit entities, technical labels and toasts are localized', async ({ page }) => {
  await login(page, 'ar');

  await page.goto('/accounting/journals');
  await page.getByRole('button', { name: 'قيد يومية يدوي', exact: true }).click();
  const journal = page.locator('.modal');
  await expect(journal.getByRole('heading', { name: 'قيد يومية يدوي جديد' })).toBeVisible();
  await expect(journal.locator('input[value="تسوية استحقاق"]')).toHaveCount(1);
  await expect(journal.locator('input[value="سطر مدين"]')).toHaveCount(1);
  await expect(journal.locator('input[value="سطر دائن"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'إغلاق مربع الحوار' }).click();

  await page.goto('/banking/transactions');
  await page.getByRole('button', { name: 'حركة بنكية', exact: true }).click();
  const transaction = page.locator('.modal');
  await expect(transaction.getByRole('heading', { name: 'ترحيل حركة بنكية' })).toBeVisible();
  await expect(transaction.getByLabel('البيان')).toHaveValue('حركة بنكية');
  await page.getByRole('button', { name: 'إغلاق مربع الحوار' }).click();

  await page.goto('/banking/statements');
  await page.getByRole('button', { name: 'استيراد حركة كشف حساب', exact: true }).click();
  const statement = page.locator('.modal');
  await expect(statement.getByRole('heading', { name: 'استيراد كشف حساب بنكي' })).toBeVisible();
  await expect(statement.getByLabel('البيان')).toHaveValue('حركة مستوردة من كشف الحساب');
  await page.getByRole('button', { name: 'إغلاق مربع الحوار' }).click();

  await page.goto('/admin/system-health');
  for (const text of ['واجهة خدمات التطبيق', 'طبقة الوصول إلى البيانات', 'تطبيق الويب', 'حدود عزل الشركة', 'أمان على مستوى الصفوف']) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
  for (const english of ['Application API', 'Data access', 'Web application', 'Tenant boundary', 'Row-level security']) {
    await expect(page.getByText(english, { exact: true })).toHaveCount(0);
  }

  await page.goto('/admin/audit');
  await expect(page.getByText('وردية نقطة البيع', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('إغلاق الوردية', { exact: false }).first()).toBeVisible();

  expect(t('RFQ-2026-00001 saved as draft', 'ar')).toBe('تم حفظ RFQ-2026-00001 كمسودة');
  expect(t('JE-2026-00006 created and balanced', 'ar')).toBe('تم إنشاء JE-2026-00006 والتحقق من توازنه');
  const localizedDifference = t('Shift closed · difference ‏٠٫٠٠ ج.م.‏', 'ar');
  expect(localizedDifference).toContain('تم إغلاق الوردية');
  expect(localizedDifference.match(/[0-9]/g)?.join('')).toBe('000');
  expect(localizedDifference).not.toMatch(/[٠-٩۰-۹]/);
  expect(t('Bank statement line imported and awaiting match', 'ar')).toBe('تم استيراد حركة كشف الحساب وهي بانتظار المطابقة');
});

test('Arabic localizes the sales-delivery conversion dialog shown in the document workspace', async ({ page }) => {
  await login(page, 'ar');
  await page.goto('/sales/deliveries');
  await page.getByRole('button', { name: 'DN-2026-00001', exact: true }).click();
  await page.getByRole('button', { name: 'تحويل إلى فاتورة مبيعات', exact: true }).click();

  const dialog = page.locator('.modal');
  await expect(dialog.getByRole('heading', { name: 'تحويل DN-2026-00001 إلى فاتورة مبيعات', exact: true })).toBeVisible();
  for (const arabic of [
    'أدخل كمية لا تتجاوز الكمية المتبقية في المستند المصدر. يمنع النظام تجاوز الكمية ويحافظ على ارتباط كل سطر بمصدره.',
    'الكمية الأصلية',
    'الكمية المتبقية',
    'كمية التحويل',
    'لا توجد كمية متبقية للتحويل.',
    'إلغاء',
    'إنشاء مسودة مرتبطة',
  ]) await expect(dialog.getByText(arabic, { exact: true })).toBeVisible();

  for (const english of [
    'Convert DN-2026-00001 to Sales Invoice',
    'Enter a quantity up to the remaining source quantity. The backend rejects over-conversion and preserves every source-line link.',
    'Original',
    'Remaining',
    'Convert now',
    'No quantity remains to convert.',
    'Cancel',
    'Create linked draft',
  ]) await expect(dialog.getByText(english, { exact: true })).toHaveCount(0);
});

test('Arabic and English report/PDF export endpoints honor the requested locale', async ({ request }) => {
  const loginResponse = await request.post('/api/auth/login', { data: { email: 'admin@odin.demo', password } });
  expect(loginResponse.ok()).toBeTruthy();
  const token = (await loginResponse.json()).token as string;
  const authorization = { Authorization: `Bearer ${token}` };

  const arabicCsv = await request.get('/api/reports/reconciliation/csv', { headers: { ...authorization, 'Accept-Language': 'ar', 'X-Odin-Language': 'ar' } });
  expect(arabicCsv.ok()).toBeTruthy();
  const arabicCsvText = await arabicCsv.text();
  expect(arabicCsvText).toContain('حساب المراقبة');
  expect(arabicCsvText).toMatch(/[0-9]/);
  expect(arabicCsvText).not.toMatch(/[٠-٩۰-۹]/);

  const englishCsv = await request.get('/api/reports/reconciliation/csv', { headers: { ...authorization, 'Accept-Language': 'en', 'X-Odin-Language': 'en' } });
  expect(englishCsv.ok()).toBeTruthy();
  const englishCsvText = await englishCsv.text();
  expect(englishCsvText).toContain('Control');
  expect(englishCsvText).not.toContain('حساب المراقبة');

  const reportPdf = await request.get('/api/reports/reconciliation/pdf', { headers: { ...authorization, 'Accept-Language': 'ar', 'X-Odin-Language': 'ar' } });
  expect(reportPdf.ok()).toBeTruthy();
  expect(reportPdf.headers()['content-type']).toContain('application/pdf');
  expect((await reportPdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  const documents = await request.get('/api/documents?type=PURCHASE_ORDER', { headers: authorization });
  expect(documents.ok()).toBeTruthy();
  const documentId = String((await documents.json())[0].id);
  const documentPdf = await request.get(`/api/documents/${documentId}/pdf`, { headers: { ...authorization, 'Accept-Language': 'ar', 'X-Odin-Language': 'ar' } });
  expect(documentPdf.ok()).toBeTruthy();
  expect(documentPdf.headers()['content-type']).toContain('application/pdf');
  expect((await documentPdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});
