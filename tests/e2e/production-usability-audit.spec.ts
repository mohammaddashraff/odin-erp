import { expect, Page, test } from '@playwright/test';

const baseUrl = process.env.STAGING_BASE_URL?.replace(/\/$/, '');
const password = process.env.ODIN_DEMO_PASSWORD;

if (process.env.CI && (!baseUrl || !password)) {
  throw new Error('STAGING_BASE_URL and ODIN_DEMO_PASSWORD are required in CI.');
}

const routes = [
  '/dashboard',
  '/sales/overview', '/sales/customers', '/sales/quotations', '/sales/orders', '/sales/deliveries', '/sales/invoices', '/sales/returns', '/sales/credit-notes', '/sales/customer-balances',
  '/purchasing/overview', '/purchasing/suppliers', '/purchasing/requests', '/purchasing/rfqs', '/purchasing/orders', '/purchasing/receipts', '/purchasing/bills', '/purchasing/returns', '/purchasing/supplier-balances',
  '/inventory/overview', '/inventory/items', '/inventory/categories', '/inventory/units', '/inventory/warehouses', '/inventory/transfers', '/inventory/adjustments', '/inventory/counts', '/inventory/stock-card', '/inventory/valuation',
  '/hr/employees', '/pos/workspace',
  '/accounting/overview', '/accounting/chart-of-accounts', '/accounting/journals', '/accounting/periods', '/accounting/general-ledger', '/accounting/trial-balance', '/accounting/income-statement', '/accounting/balance-sheet',
  '/banking/overview', '/banking/accounts', '/banking/allocations', '/banking/transactions', '/banking/statements', '/banking/reconciliation',
  '/approvals/inbox',
  '/reports/overview', '/reports/sales', '/reports/purchasing', '/reports/inventory', '/reports/accounting', '/reports/banking', '/reports/pos',
  '/admin/overview', '/admin/audit', '/admin/system-health',
] as const;

async function login(page: Page, language: 'en' | 'ar' = 'en', email = 'admin@odin.demo') {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'odin_language', value: language, url: baseUrl! }]);
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password!);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 30_000 });
}

function observeRuntimeProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('400 (Bad Request)')) problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });

test.describe('production client-readiness usability audit', () => {
  test.skip(!baseUrl || !password, 'Production URL and demo password are required.');

  test('all registered business screens load directly in English without runtime failures', async ({ page }) => {
    test.setTimeout(300_000);
    const problems = observeRuntimeProblems(page);
    await login(page, 'en');
    for (const path of routes) {
      const response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} did not return HTTP 200`).toBe(200);
      await expect(page.getByTestId('account-menu'), `${path} lost the authenticated session`).toBeVisible();
      await expect(page.locator('.page-head h1, .sales-page-head h1').first(), `${path} has no visible page heading`).toBeVisible();
      await assertNoOverflow(page);
    }
    expect(problems).toEqual([]);
  });

  test('all registered screens preserve Arabic RTL and remain usable on mobile', async ({ page }) => {
    test.setTimeout(300_000);
    const problems = observeRuntimeProblems(page);
    await login(page, 'ar');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of routes) {
      const response = await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `${path} did not return HTTP 200 in Arabic`).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('account-menu')).toBeVisible();
      await expect(page.locator('.page-head h1, .sales-page-head h1').first()).toBeVisible();
      await assertNoOverflow(page);
    }
    expect(problems).toEqual([]);
  });

  test('cashier, warehouse and auditor see only their usable business areas', async ({ page }) => {
    const problems = observeRuntimeProblems(page);

    await login(page, 'en', 'cashier@odin.demo');
    await expect(page.getByTestId('nav-pos')).toBeVisible();
    for (const id of ['sales', 'purchasing', 'inventory', 'accounting', 'banking', 'approvals', 'reports', 'admin']) {
      await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
    }

    await login(page, 'en', 'warehouse@odin.demo');
    await expect(page.getByTestId('nav-inventory')).toBeVisible();
    await expect(page.getByTestId('nav-sales')).toHaveCount(0);

    await login(page, 'en', 'auditor@odin.demo');
    await expect(page.getByTestId('nav-accounting')).toBeVisible();
    await expect(page.getByTestId('nav-reports')).toBeVisible();
    await expect(page.getByTestId('nav-admin')).toBeVisible();
    await expect(page.getByTestId('nav-sales')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('desktop collapse, mobile menu, refresh and logout are straightforward', async ({ page }) => {
    const problems = observeRuntimeProblems(page);
    await login(page, 'en');

    await page.getByTestId('sidebar-collapse').click();
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
    expect(await page.evaluate(() => localStorage.getItem('odin_sidebar_collapsed'))).toBe('true');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('account-menu')).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/open/);
    await assertNoOverflow(page);

    await page.getByTestId('account-menu').click();
    const logout = page.waitForResponse((response) => response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign out' }).click();
    expect((await logout).ok()).toBeTruthy();
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('login-submit')).toBeVisible();
    expect(problems).toEqual([]);
  });
});
