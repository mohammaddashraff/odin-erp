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

async function login(page: Page, email = 'admin@odin.demo', language: 'en' | 'ar' = 'en') {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'odin_language', value: language, url: 'http://127.0.0.1:8080' }]);
  await page.goto('/dashboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'مركز الإدارة' : 'Command Center', exact: true })).toBeVisible();
}

const modules = [
  ['command', 'Command Center'],
  ['sales', 'Sales'],
  ['purchasing', 'Purchasing & Suppliers'],
  ['inventory', 'Inventory & Products'],
  ['hr', 'Human Resources'],
  ['pos', 'Point of Sale'],
  ['accounting', 'Accounting & Finance'],
  ['banking', 'Cash & Banking'],
  ['approvals', 'Approvals & Workflow'],
  ['reports', 'Reports & Analytics'],
  ['admin', 'Administration & Control'],
] as const;

const routes = [
  ['/dashboard', 'Command Center', 'Command Center', 'Executive Dashboard'],
  ['/sales/overview', 'Sales Overview', 'Sales', 'Sales Overview'],
  ['/sales/customers', 'Customers', 'Sales', 'Customers'],
  ['/sales/quotations', 'Quotations', 'Sales', 'Quotations'],
  ['/sales/orders', 'Sales Orders', 'Sales', 'Sales Orders'],
  ['/sales/deliveries', 'Deliveries', 'Sales', 'Deliveries'],
  ['/sales/invoices', 'Invoices', 'Sales', 'Invoices'],
  ['/sales/returns', 'Returns', 'Sales', 'Returns'],
  ['/sales/credit-notes', 'Credit Notes', 'Sales', 'Credit Notes'],
  ['/sales/customer-balances', 'Customer Balances', 'Sales', 'Customer Balances'],
  ['/purchasing/overview', 'Purchasing & Suppliers', 'Purchasing & Suppliers', 'Purchasing Overview'],
  ['/purchasing/suppliers', 'Suppliers', 'Purchasing & Suppliers', 'Suppliers'],
  ['/purchasing/requests', 'Purchase Requests', 'Purchasing & Suppliers', 'Purchase Requests'],
  ['/purchasing/rfqs', 'Requests for Quotation', 'Purchasing & Suppliers', 'Requests for Quotation'],
  ['/purchasing/orders', 'Purchase Orders', 'Purchasing & Suppliers', 'Purchase Orders'],
  ['/purchasing/receipts', 'Goods Receipts', 'Purchasing & Suppliers', 'Goods Receipts'],
  ['/purchasing/bills', 'Supplier Bills', 'Purchasing & Suppliers', 'Supplier Bills'],
  ['/purchasing/returns', 'Purchase Returns', 'Purchasing & Suppliers', 'Purchase Returns'],
  ['/purchasing/supplier-balances', 'Supplier Balances', 'Purchasing & Suppliers', 'Supplier Balances'],
  ['/inventory/overview', 'Inventory & Products', 'Inventory & Products', 'Inventory Overview'],
  ['/inventory/items', 'Items', 'Inventory & Products', 'Items'],
  ['/inventory/categories', 'Categories', 'Inventory & Products', 'Categories'],
  ['/inventory/units', 'Units of Measurement', 'Inventory & Products', 'Units of Measurement'],
  ['/inventory/warehouses', 'Warehouses', 'Inventory & Products', 'Warehouses'],
  ['/inventory/transfers', 'Warehouse Transfers', 'Inventory & Products', 'Warehouse Transfers'],
  ['/inventory/adjustments', 'Stock Adjustments', 'Inventory & Products', 'Stock Adjustments'],
  ['/inventory/counts', 'Stock Counts', 'Inventory & Products', 'Stock Counts'],
  ['/inventory/stock-card', 'Stock Card', 'Inventory & Products', 'Stock Card'],
  ['/inventory/valuation', 'Inventory Valuation', 'Inventory & Products', 'Inventory Valuation'],
  ['/hr/employees', 'Employees', 'Human Resources', 'Employees'],
  ['/pos/workspace', 'Point of sale', 'Point of Sale', 'POS Workspace'],
  ['/accounting/overview', 'Accounting & Finance', 'Accounting & Finance', 'Accounting Overview'],
  ['/accounting/chart-of-accounts', 'Chart of Accounts', 'Accounting & Finance', 'Chart of Accounts'],
  ['/accounting/journals', 'Journal Entries', 'Accounting & Finance', 'Journal Entries'],
  ['/accounting/periods', 'Fiscal Periods', 'Accounting & Finance', 'Fiscal Periods'],
  ['/accounting/general-ledger', 'General Ledger', 'Accounting & Finance', 'General Ledger'],
  ['/accounting/trial-balance', 'Trial Balance', 'Accounting & Finance', 'Trial Balance'],
  ['/accounting/income-statement', 'Income Statement', 'Accounting & Finance', 'Income Statement'],
  ['/accounting/balance-sheet', 'Balance Sheet', 'Accounting & Finance', 'Balance Sheet'],
  ['/banking/overview', 'Cash & Banking', 'Cash & Banking', 'Cash & Bank Overview'],
  ['/banking/accounts', 'Cash & Bank Accounts', 'Cash & Banking', 'Cash & Bank Accounts'],
  ['/banking/allocations', 'Receipts & Payments', 'Cash & Banking', 'Receipts & Payments'],
  ['/banking/transactions', 'Bank Transactions & Transfers', 'Cash & Banking', 'Bank Transactions & Transfers'],
  ['/banking/statements', 'Bank Statements', 'Cash & Banking', 'Bank Statements'],
  ['/banking/reconciliation', 'Bank Reconciliation', 'Cash & Banking', 'Bank Reconciliation'],
  ['/approvals/inbox', 'Approval Inbox', 'Approvals & Workflow', 'Approval Inbox'],
  ['/reports/overview', 'Report Library', 'Reports & Analytics', 'Report Library'],
  ['/reports/sales', 'Sales Reports', 'Reports & Analytics', 'Sales Reports'],
  ['/reports/purchasing', 'Purchasing Reports', 'Reports & Analytics', 'Purchasing Reports'],
  ['/reports/inventory', 'Inventory Reports', 'Reports & Analytics', 'Inventory Reports'],
  ['/reports/accounting', 'Accounting Reports', 'Reports & Analytics', 'Accounting Reports'],
  ['/reports/banking', 'Cash & Bank Reports', 'Reports & Analytics', 'Cash & Bank Reports'],
  ['/reports/pos', 'POS Reports', 'Reports & Analytics', 'POS Reports'],
  ['/admin/overview', 'Administration & Control', 'Administration & Control', 'Administration Overview'],
  ['/admin/audit', 'Audit Log', 'Administration & Control', 'Audit Log'],
  ['/admin/system-health', 'System Health', 'Administration & Control', 'System Health'],
] as const;

test('the sidebar has exactly eleven role-aware business modules and only one expanded module', async ({ page }) => {
  await login(page);
  for (const [id, label] of modules) await expect(page.getByTestId(`nav-${id}`)).toContainText(label);
  await expect(page.locator('.nav-parent')).toHaveCount(11);

  await page.getByTestId('nav-sales').click();
  await expect(page.getByTestId('nav-sales')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('nav-customers')).toBeVisible();
  await page.getByTestId('nav-purchasing').click();
  await expect(page.getByTestId('nav-purchasing')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('nav-sales')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('nav-customers')).toHaveCount(0);
  await expect(page.getByTestId('nav-purchase-requests')).toBeVisible();
  await expect(page.getByTestId('nav-purchase-rfqs')).toBeVisible();

  await page.getByTestId('nav-suppliers').click();
  await expect(page).toHaveURL(/\/purchasing\/suppliers$/);
  await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible();
  await expect(page.locator('.nav-module.active')).toContainText('Purchasing & Suppliers');
  await expect(page.getByTestId('nav-suppliers')).toHaveClass(/active/);
});

test('authenticated route changes never render the login screen', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const marker = document.createElement('div');
    marker.id = 'login-screen-observer';
    marker.dataset.count = '0';
    document.body.append(marker);
    new MutationObserver(() => {
      if (document.querySelector('.login-screen')) marker.dataset.count = String(Number(marker.dataset.count || '0') + 1);
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByTestId('nav-purchasing').click();
  await page.getByTestId('nav-suppliers').click();
  await expect(page).toHaveURL(/\/purchasing\/suppliers$/);
  await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible();
  await page.getByTestId('nav-inventory').click();
  await page.getByTestId('nav-items').click();
  await expect(page).toHaveURL(/\/inventory\/items$/);
  await expect(page.getByRole('heading', { name: 'Items', exact: true })).toBeVisible();
  await expect(page.locator('.login-screen')).toHaveCount(0);
  await expect(page.locator('#login-screen-observer')).toHaveAttribute('data-count', '0');
});

test('every registered route opens directly with the correct heading and breadcrumb', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  for (const [path, heading, parent, child] of routes) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
    await expect(page.locator('.page-head h1, .sales-page-head h1')).toHaveText(heading);
    const breadcrumb = page.locator('.breadcrumbs');
    await expect(breadcrumb).toContainText(parent);
    await expect(breadcrumb).toContainText(child);
  }
});

test('every registered route resolves its Arabic heading and breadcrumb during direct navigation', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'admin@odin.demo', 'ar');
  for (const [path, heading, parent, child] of routes) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.page-head h1, .sales-page-head h1')).toHaveText(t(heading, 'ar'));
    const breadcrumb = page.locator('.breadcrumbs');
    await expect(breadcrumb).toContainText(t(parent, 'ar'));
    await expect(breadcrumb).toContainText(t(child, 'ar'));
    expect(t(heading, 'ar')).not.toBe(heading);
  }
});

test('legacy bookmarks redirect to the new canonical routes', async ({ page }) => {
  await login(page);
  const redirects = [
    ['/sales', '/sales/overview'],
    ['/purchases', '/purchasing/overview'],
    ['/inventory', '/inventory/overview'],
    ['/pos', '/pos/workspace'],
    ['/payments', '/banking/allocations'],
    ['/accounting', '/accounting/general-ledger'],
    ['/banking', '/banking/overview'],
    ['/approvals', '/approvals/inbox'],
    ['/reports', '/reports/overview'],
    ['/audit', '/admin/audit'],
  ] as const;
  for (const [from, to] of redirects) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replaceAll('/', '\\/')}$`));
  }
});

test('collapsed desktop and mobile navigation remain usable without horizontal overflow', async ({ page }) => {
  await login(page);
  await page.getByTestId('sidebar-collapse').click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
  await expect(page.getByTestId('nav-purchasing')).toHaveAttribute('title', 'Purchasing & Suppliers');
  expect(await page.evaluate(() => localStorage.getItem('odin_sidebar_collapsed'))).toBe('true');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
  await page.screenshot({ path: resolve(screenshots, 'navigation-collapsed-en.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await page.getByTestId('nav-purchasing').click();
  await expect(page).toHaveURL(/\/purchasing\/overview$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(screenshots, 'navigation-mobile-en.png'), fullPage: true });
});

test('role-based navigation exposes business domains instead of disabled unauthorized links', async ({ page }) => {
  await login(page, 'cashier@odin.demo');
  await expect(page.getByTestId('nav-command')).toBeVisible();
  await expect(page.getByTestId('nav-pos')).toBeVisible();
  for (const id of ['sales', 'purchasing', 'inventory', 'accounting', 'banking', 'approvals', 'reports', 'admin']) {
    await expect(page.getByTestId(`nav-${id}`)).toHaveCount(0);
  }

  await login(page, 'warehouse@odin.demo');
  await expect(page.getByTestId('nav-inventory')).toBeVisible();
  await expect(page.getByTestId('nav-sales')).toHaveCount(0);
  await expect(page.getByTestId('nav-purchasing')).toHaveCount(0);

  await login(page, 'accountant@odin.demo');
  await expect(page.getByTestId('nav-accounting')).toBeVisible();
  await expect(page.getByTestId('nav-banking')).toBeVisible();
  await expect(page.getByTestId('nav-reports')).toBeVisible();
  await expect(page.getByTestId('nav-sales')).toHaveCount(0);
  await expect(page.getByTestId('nav-purchasing')).toHaveCount(0);
});

test('Purchase Request and supplier RFQ are distinct routes and document types', async ({ page, request }) => {
  await login(page);
  await page.goto('/purchasing/requests');
  await page.getByTestId('new-document').click();
  await expect(page.getByRole('heading', { name: 'New Purchase Request' })).toBeVisible();
  await expect(page.locator('.modal').getByLabel('Supplier')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.goto('/purchasing/rfqs');
  await page.getByTestId('new-document').click();
  await expect(page.getByRole('heading', { name: 'New Request for Quotation' })).toBeVisible();
  await expect(page.locator('.modal').getByLabel('Supplier')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const loginResponse = await request.post('/api/auth/login', { data: { email: 'admin@odin.demo', password } });
  const token = (await loginResponse.json()).token as string;
  const bootstrap = await request.get('/api/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
  expect(bootstrap.ok()).toBeTruthy();
  expect((await bootstrap.json()).documentTypes).toEqual(expect.arrayContaining(['PURCHASE_REQUEST', 'PURCHASE_RFQ']));
});

test('English desktop and Arabic RTL module landing pages are captured as completion evidence', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-page .primary-kpis')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'dashboard-en.png'), fullPage: true });
  await page.goto('/inventory/overview');
  await expect(page.locator('.domain-overview.inventory-overview')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'inventory-overview-en.png'), fullPage: true });
  await page.goto('/purchasing/overview');
  await expect(page.locator('.domain-overview.purchasing-overview')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'purchasing-overview-en.png'), fullPage: true });

  await login(page, 'admin@odin.demo', 'ar');
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.dashboard-page .primary-kpis')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'dashboard-ar.png'), fullPage: true });
  await page.goto('/purchasing/overview');
  await expect(page.locator('.domain-overview.purchasing-overview')).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'purchasing-overview-ar.png'), fullPage: true });
});

test('customer creation generates the code server-side and keeps credit settings optional', async ({ page }) => {
  await login(page);
  await page.goto('/sales/customers?new=1');
  await expect(page.getByRole('heading', { name: 'New Customer', exact: true })).toBeVisible();
  await expect(page.getByLabel('Customer code')).toHaveCount(0);
  const customerName = `Browser Customer ${Date.now()}`;
  await page.getByTestId('master-customer-name').fill(customerName);
  await page.getByLabel('City').fill('Cairo');
  await page.getByTestId('save-customer').click();
  await expect(page.getByRole('heading', { name: customerName, exact: true })).toBeVisible();
  await expect(page.locator('.sales-heading p')).toContainText(/CUS-\d{6}/);
  await expect(page.getByText('No credit limit configured', { exact: true })).toBeVisible();
  await expect(page.getByText('Not specified', { exact: true }).first()).toBeVisible();
});

test('guided quotation enforces branch warehouse and active HR salesperson references with a dated exchange rate', async ({ page }) => {
  await login(page);
  await page.goto('/sales/quotations?new=1');
  await expect(page.getByRole('heading', { name: 'New Quotation', exact: true })).toBeVisible();
  const salesperson = page.getByLabel('Salesperson');
  await expect(salesperson.getByRole('option', { name: /Youssef Hamdy/ })).toHaveCount(0);
  await page.getByLabel('Branch').selectOption({ label: 'Alexandria Branch' });
  const warehouse = page.getByLabel('Warehouse');
  await expect(warehouse.getByRole('option', { name: 'Alexandria Warehouse' })).toHaveCount(1);
  await expect(warehouse.getByRole('option', { name: 'Cairo Main Warehouse' })).toHaveCount(0);
  await warehouse.selectOption({ label: 'Alexandria Warehouse' });
  await page.getByRole('button', { name: /Continue to Products & Pricing/ }).click();
  await expect(page.locator('.quotation-lines')).toBeVisible();
  await page.getByRole('button', { name: /Continue to Payment & Delivery/ }).click();
  await page.getByLabel('Currency').first().selectOption('USD');
  await expect(page.getByLabel('Exchange rate')).toHaveValue('49.250000');
  await expect(page.getByText(/18 Jul 2026/)).toBeVisible();
  await page.getByRole('button', { name: /Review Quotation/ }).click();
  await expect(page.locator('.document-paper')).toBeVisible();
  await page.getByRole('button', { name: /Submit for Approval/ }).click();
  await expect(page.locator('.document-detail')).toBeVisible();
  await expect(page.locator('.sales-status.SUBMITTED')).toContainText('Pending Approval');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
});

test('approval decisions use an explicit required-reason dialog instead of browser prompts', async ({ page }) => {
  await login(page, 'cfo@odin.demo');
  await page.goto('/approvals/inbox');
  await expect(page.getByRole('heading', { name: 'Approvals', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add Comment', exact: true }).click();
  const commentDialog = page.getByRole('dialog');
  await expect(commentDialog.getByRole('button', { name: 'Add Comment', exact: true })).toBeDisabled();
  await commentDialog.getByLabel('Reason or requested changes').fill('Commercial context confirmed for the next reviewer.');
  await commentDialog.getByRole('button', { name: 'Add Comment', exact: true }).click();
  await expect(page.getByText('Commercial context confirmed for the next reviewer.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Request Changes', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Send Back for Changes', exact: true })).toBeDisabled();
  await dialog.getByLabel('Reason or requested changes').fill('Please confirm the delivery cost and resubmit.');
  await expect(dialog.getByRole('button', { name: 'Send Back for Changes', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('Sales remains localized, responsive, and free of horizontal page overflow in Arabic RTL', async ({ page }) => {
  await login(page, 'admin@odin.demo', 'ar');
  await page.goto('/sales/overview');
  await expect(page.getByRole('heading', { name: 'نظرة عامة على المبيعات', exact: true })).toBeVisible();
  await expect(page.getByText('Recent sales activity', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(screenshots, 'sales-overview-mobile-ar.png'), fullPage: true });
});
