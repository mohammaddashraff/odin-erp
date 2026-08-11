import { expect, Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { t } from '../../apps/web/src/app/i18n';

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

async function login(page: Page, email = 'admin@odin.demo', language: 'en' | 'ar' = 'en') {
  if (/^https?:/.test(page.url())) await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'odin_language', value: language, url: 'http://127.0.0.1:8080' }]);
  const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `dashboard bootstrap returned ${response?.status() ?? 'no response'}`).toBeTruthy();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('heading', { name: language === 'ar' ? 'مركز الإدارة' : 'Command Center', exact: true })).toBeVisible();
}

test('login password visibility is opt-in', async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `dashboard bootstrap returned ${response?.status() ?? 'no response'}`).toBeTruthy();

  const passwordInput = page.getByTestId('login-password');
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill('VisiblePasswordExample!');
  await expect(passwordInput).toHaveAttribute('type', 'password');

  await page.getByTestId('show-password').check();
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await expect(passwordInput).toHaveValue('VisiblePasswordExample!');

  await page.getByTestId('show-password').uncheck();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});

test('loading states preserve action geometry, expose dashboard skeletons, and honor reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  let releaseLogin!: () => void;
  let markLoginSeen!: () => void;
  const loginRelease = new Promise<void>((resolve) => { releaseLogin = resolve; });
  const loginSeen = new Promise<void>((resolve) => { markLoginSeen = resolve; });
  await page.route('**/api/auth/login', async (route) => {
    markLoginSeen();
    await loginRelease;
    await route.continue();
  });

  let releaseBootstrap!: () => void;
  let markBootstrapSeen!: () => void;
  const bootstrapRelease = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
  const bootstrapSeen = new Promise<void>((resolve) => { markBootstrapSeen = resolve; });
  await page.route('**/api/bootstrap', async (route) => {
    markBootstrapSeen();
    await bootstrapRelease;
    await route.continue();
  });

  await page.context().clearCookies();
  const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  expect(response?.ok(), `dashboard bootstrap returned ${response?.status() ?? 'no response'}`).toBeTruthy();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill('admin@odin.demo');
  await page.getByTestId('login-password').fill(password);

  const submit = page.getByTestId('login-submit');
  const idleWidth = await submit.evaluate((element) => element.getBoundingClientRect().width);
  await submit.click();
  await loginSeen;
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  await expect(submit.locator('.loading-button-busy')).toContainText('Authenticating…');
  const busyWidth = await submit.evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(busyWidth - idleWidth)).toBeLessThanOrEqual(1);
  await expect(submit.locator('.inline-spinner')).toHaveCSS('animation-name', 'none');

  releaseLogin();
  await bootstrapSeen;
  const skeleton = page.getByRole('status', { name: 'Loading secured company data…' });
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator('.skeleton-card')).toHaveCount(6);
  await expect(skeleton.locator('.skeleton-block').first()).toHaveCSS('animation-name', 'none');
  const skeletonColumns = await skeleton.locator('.skeleton-metric-grid').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
  );
  expect(skeletonColumns).toBe(6);

  releaseBootstrap();
  await expect(page.getByRole('heading', { name: 'Command Center', exact: true })).toBeVisible();
  await expect(page.locator('.route-transition')).toHaveCSS('animation-name', 'none');
});

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
  ['/settings/access/users', 'Users & Access', 'Administration & Control', 'Users'],
  ['/settings/access/governance', 'Users & Access', 'Administration & Control', 'Access Governance'],
  ['/settings/access/roles', 'Users & Access', 'Administration & Control', 'Roles'],
  ['/settings/access/permissions', 'Users & Access', 'Administration & Control', 'Permissions'],
  ['/settings/access/audit', 'Users & Access', 'Administration & Control', 'Access Audit Log'],
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
    expect(await page.locator('body').innerText(), `${path} rendered Arabic-Indic or Persian digit glyphs`).not.toMatch(/[٠-٩۰-۹]/);
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
  await expect(page.getByTestId('nav-sales')).toBeVisible();
  await page.getByTestId('nav-sales').click();
  await expect(page.getByTestId('nav-deliveries')).toBeVisible();
  await expect(page.getByTestId('nav-customers')).toHaveCount(0);
  await expect(page.getByTestId('nav-sales-orders')).toHaveCount(0);
  await expect(page.getByTestId('nav-sales-invoices')).toHaveCount(0);
  await page.getByTestId('nav-purchasing').click();
  await expect(page.getByTestId('nav-goods-receipts')).toBeVisible();
  await expect(page.getByTestId('nav-suppliers')).toHaveCount(0);
  await expect(page.getByTestId('nav-purchase-orders')).toHaveCount(0);
  await expect(page.getByTestId('nav-supplier-bills')).toHaveCount(0);

  await login(page, 'sales@odin.demo');
  await expect(page.getByTestId('nav-sales')).toBeVisible();
  await expect(page.getByTestId('nav-hr')).toHaveCount(0);
  await page.goto('/hr/employees');
  await expect(page.locator('.access-denied')).toContainText('403');

  await login(page, 'accountant@odin.demo');
  await expect(page.getByTestId('nav-accounting')).toBeVisible();
  await expect(page.getByTestId('nav-banking')).toBeVisible();
  await expect(page.getByTestId('nav-reports')).toBeVisible();
  await expect(page.getByTestId('nav-sales')).toBeVisible();
  await page.getByTestId('nav-sales').click();
  await expect(page.getByTestId('nav-sales-invoices')).toBeVisible();
  await expect(page.getByTestId('nav-sales-orders')).toHaveCount(0);
  await expect(page.getByTestId('nav-deliveries')).toHaveCount(0);
  await expect(page.getByTestId('nav-purchasing')).toBeVisible();
  await page.getByTestId('nav-purchasing').click();
  await expect(page.getByTestId('nav-supplier-bills')).toBeVisible();
  await expect(page.getByTestId('nav-purchase-orders')).toHaveCount(0);
  await expect(page.getByTestId('nav-goods-receipts')).toHaveCount(0);
});

test('outgoing-payment-only users can reach their authorized payment workspace', async ({ page }) => {
  await login(page, 'purchasing@odin.demo');
  await expect(page.getByTestId('nav-banking')).toBeVisible();
  await page.getByTestId('nav-banking').click();
  await expect(page.getByTestId('nav-payment-allocations')).toBeVisible();
  await page.getByTestId('nav-payment-allocations').click();
  await expect(page).toHaveURL(/\/banking\/allocations$/);
  await expect(page.getByRole('heading', { name: 'Receipts & Payments', exact: true })).toBeVisible();
  await expect(page.locator('.access-denied')).toHaveCount(0);
});

test('Users & Access is complete for Super Admin and denied in both UI and API for other roles', async ({ page, request }) => {
  await login(page);
  await page.goto('/settings/access/roles');
  await expect(page.getByRole('heading', { name: 'Users & Access', exact: true })).toBeVisible();
  await expect(page.locator('.access-role-card')).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Create Role', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Role', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create Role', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modules', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scopes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fields', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Limits', exact: true })).toBeVisible();
  const closeDialog = page.getByRole('button', { name: 'Close dialog' });
  await expect(closeDialog).toBeVisible();
  expect(await closeDialog.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return hit?.closest('[aria-label="Close dialog"]') === button;
  })).toBe(true);
  await closeDialog.click();
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);

  await login(page, 'sales.employee@odin.demo');
  await expect(page.getByTestId('nav-access-roles')).toHaveCount(0);
  await page.goto('/settings/access/roles');
  await expect(page.locator('.access-denied')).toBeVisible();
  await expect(page.locator('.access-denied')).toContainText('403');

  const loginResponse = await request.post('/api/auth/login', { data: { email: 'sales.employee@odin.demo', password } });
  expect(loginResponse.status()).toBe(201);
  const token = (await loginResponse.json()).token as string;
  const accessResponse = await request.get('/api/access', { headers: { Authorization: `Bearer ${token}` } });
  expect(accessResponse.status()).toBe(403);
});

test('Users & Access remains usable in dark theme, Arabic RTL, tablet, and mobile layouts', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/settings/access/permissions');
  await expect(page.locator('.access-permission-groups')).toBeVisible();
  await page.getByTestId('account-menu').click();
  await page.locator('.account-menu > button').filter({ hasText: 'Toggle light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('language-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/settings/access/governance');
  await expect(page.locator('.governance-layout')).toBeVisible();
  await expect(page.locator('.governance-layout')).toHaveCSS('grid-template-columns', /\S+\s+\S+/);
  await page.getByRole('button', { name: 'تشغيل المعاينة الآمنة', exact: true }).click();
  const preview = page.getByTestId('access-safe-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('معاينة آمنة · بلا تعديل');
  await expect(preview.locator('.status')).toHaveAttribute('data-tone', 'success');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'المستخدمون والصلاحيات', exact: true })).toBeVisible();
  await expect(page.locator('.access-tabs')).toBeVisible();
  await expect(page.locator('.governance-layout')).toHaveCSS('grid-template-columns', /^(?!.*\s).*$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: resolve(screenshots, 'access-governance-mobile-ar-dark.png'), fullPage: true });
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

test('Sales creates and converts a quotation before the sales order approval step', async ({ page }) => {
  await login(page, 'sales@odin.demo');
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
  await expect(page.getByText(/Jul 18, 2026/)).toBeVisible();
  await page.getByRole('button', { name: /Review Quotation/ }).click();
  await expect(page.locator('.document-paper')).toBeVisible();
  await page.getByRole('button', { name: 'Create Quotation', exact: true }).click();
  await expect(page.locator('.document-detail')).toBeVisible();
  await expect(page.locator('.sales-status.DRAFT')).toContainText('Draft');
  await page.getByRole('button', { name: 'Convert to Sales Order', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create linked draft', exact: true }).click();
  await expect(page).toHaveURL(/\/sales\/orders\?document=/);
  await expect(page.locator('.document-detail')).toBeVisible();
  await expect(page.locator('.sales-status.DRAFT')).toContainText('Draft');
  await page.getByRole('button', { name: 'Submit for Approval', exact: true }).click();
  await expect(page.locator('.sales-status.SUBMITTED')).toContainText('Pending Approval');
  await expect(page.getByTestId('approval-waiting')).toContainText('Awaiting approval from another authorized user');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('private sales attachments upload with scan disclosure and download through a ticket', async ({ page }) => {
  await login(page);
  await page.goto('/sales/invoices');
  const documentTable = page.getByTestId('document-table');
  await expect(documentTable).toBeVisible();
  await documentTable.locator('.sales-link').first().click();
  await expect(page.locator('.document-detail')).toBeVisible();
  const initialListPromise = page.waitForResponse((response) => response.url().includes('/api/private-attachments?documentId=') && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Attachments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private attachments', exact: true })).toBeVisible();
  expect((await initialListPromise).status()).toBe(200);

  const filename = `browser-evidence-${Date.now()}.pdf`;
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  await page.getByTestId('private-attachment-file').setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: pdf });
  const uploadResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/private-attachments/upload') && response.request().method() === 'POST');
  const refreshedListPromise = page.waitForResponse((response) => response.url().includes('/api/private-attachments?documentId=') && response.request().method() === 'GET');
  await page.getByTestId('private-attachment-upload').click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  // The browser-facing multipart rewrite can expose the upstream headers before
  // its response stream is closed. The automatically refreshed list is the
  // persisted, user-visible representation and is safe to consume here.
  const refreshedList = await refreshedListPromise;
  expect(refreshedList.status()).toBe(200);
  const metadata = (await refreshedList.json()).find((row: { filename?: string }) => row.filename === filename);
  expect(metadata).toMatchObject({ filename, contentType: 'application/pdf', sizeBytes: String(pdf.length), scanStatus: 'NOT_CONFIGURED' });
  expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);

  const attachment = page.locator('.related-documents > div').filter({ hasText: filename }).first();
  await expect(attachment.getByText(filename, { exact: true })).toBeVisible();
  await expect(attachment).toContainText('1 KB');
  await expect(attachment).toContainText('Malware scanning is not configured. The file passed type and signature validation only.');

  const ticketResponsePromise = page.waitForResponse((response) => /\/api\/private-attachments\/[0-9a-f-]+\/ticket$/.test(response.url()) && response.request().method() === 'POST');
  const downloadResponsePromise = page.waitForResponse((response) => /\/api\/private-attachments\/[0-9a-f-]+\/download\?ticket=/.test(response.url()));
  const browserDownloadPromise = page.waitForEvent('download');
  await attachment.getByRole('button', { name: 'Download', exact: true }).click();
  const [ticketResponse, downloadResponse, browserDownload] = await Promise.all([ticketResponsePromise, downloadResponsePromise, browserDownloadPromise]);
  expect(ticketResponse.status()).toBe(201);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-type']).toContain('application/pdf');
  expect(browserDownload.suggestedFilename()).toBe(filename);
  const stream = await browserDownload.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(pdf);
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
  await expect(commentDialog).toHaveCount(0);
  await expect(page.locator('.approval-steps p').filter({ hasText: 'Commercial context confirmed for the next reviewer.' }).last()).toBeVisible();
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
