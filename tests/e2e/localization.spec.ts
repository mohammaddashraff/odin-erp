import { expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { t } from '../../apps/web/src/app/i18n';

const password = process.env.ODIN_DEMO_PASSWORD
  || (process.env.NODE_ENV !== 'production' && !process.env.CI ? 'OdinLocalOnly2026!' : '');
if (!password) throw new Error('ODIN_DEMO_PASSWORD is required for browser tests in production or CI.');
const screenshots = resolve(process.cwd(), 'artifacts/screenshots');
mkdirSync(screenshots, { recursive: true });

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  problems.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('400 (Bad Request)')) errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
});

test.afterEach(async ({ page }) => expect(problems.get(page) || []).toEqual([]));

async function login(page: Page, language: 'ar' | 'en' = 'ar') {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'odin_language', value: language, url: 'http://127.0.0.1:8080' }]);
  await page.goto('/dashboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  await page.getByTestId('login-email').fill('admin@odin.demo');
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'مركز الإدارة' : 'Command Center', exact: true })).toBeVisible();
}

async function toggleLanguage(page: Page) {
  await page.getByTestId('account-menu').click();
  await page.getByTestId('language-toggle').click();
}

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
  await expect(page.getByText('مسؤول الشركة', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('تسجيل الخروج', { exact: true })).toBeVisible();
  await expect(page.getByText('Company Administrator', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Sign out', { exact: true })).toHaveCount(0);
  await page.getByTestId('account-menu').click();

  for (const english of [
    'Odin Administrator',
    'Company Administrator',
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
  await expect(page.getByText('Company Administrator', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sign out', { exact: true })).toBeVisible();
  await expect(page.getByText('مسؤول الشركة', { exact: true })).toHaveCount(0);
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
    'مسؤول الشركة',
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
  expect(t('Shift closed · difference ‏٠٫٠٠ ج.م.‏', 'ar')).toContain('تم إغلاق الوردية');
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
  expect(await arabicCsv.text()).toContain('حساب المراقبة');

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
