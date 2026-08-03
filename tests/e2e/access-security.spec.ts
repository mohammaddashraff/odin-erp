import { APIRequestContext, expect, Page, test } from '@playwright/test';

const password = 'password';
const authorization = (token: string) => ({ Authorization: `Bearer ${token}` });

async function loginApi(request: APIRequestContext, email: string) {
  const response = await request.post('/api/auth/login', { data: { email, password, rememberMe: true } });
  expect(response.status(), `login ${email}: ${await response.text()}`).toBe(201);
  const result = await response.json();
  expect(result.token).toBeTruthy();
  return result.token as string;
}

async function loginUi(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/dashboard');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('account-menu')).toBeVisible();
}

test('login session restores through the rotated HttpOnly session and logout revokes it', async ({ page }) => {
  await loginUi(page, 'admin@odin.demo');
  await page.evaluate(() => localStorage.removeItem('odin_token'));
  await page.reload();
  await expect(page.getByTestId('account-menu')).toBeVisible();
  await expect(page.getByTestId('login-email')).toHaveCount(0);

  await page.getByTestId('account-menu').click();
  const logout = page.waitForResponse((response) => response.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect((await logout).status()).toBe(201);
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('login-email')).toBeVisible();
});

test('branch, warehouse, auditor, accountant, sales and POS restrictions survive direct API requests', async ({ request }) => {
  const [adminToken, branchToken, warehouseToken, auditorToken, accountantToken, salesToken, cashierToken] = await Promise.all([
    loginApi(request, 'admin@odin.demo'),
    loginApi(request, 'branch@odin.demo'),
    loginApi(request, 'warehouse@odin.demo'),
    loginApi(request, 'auditor@odin.demo'),
    loginApi(request, 'accountant@odin.demo'),
    loginApi(request, 'sales.employee@odin.demo'),
    loginApi(request, 'cashier@odin.demo'),
  ]);

  const branchDocuments = await request.get('/api/documents?type=SALES_ORDER', { headers: authorization(branchToken) });
  expect(branchDocuments.status()).toBe(200);
  expect((await branchDocuments.json()).every((document: any) => document.branch.code === 'CAI')).toBe(true);

  const warehouseBootstrap = await request.get('/api/bootstrap', { headers: authorization(warehouseToken) });
  expect(warehouseBootstrap.status()).toBe(200);
  const warehouseRefs = await warehouseBootstrap.json();
  const assignedWarehouses = new Set(warehouseRefs.warehouses.map((warehouse: any) => String(warehouse.id)));
  const deliveries = await request.get('/api/documents?type=DELIVERY_NOTE', { headers: authorization(warehouseToken) });
  expect(deliveries.status()).toBe(200);
  expect((await deliveries.json()).every((document: any) => !document.warehouse || assignedWarehouses.has(String(document.warehouse.id)))).toBe(true);

  expect((await request.post('/api/masters/customers', { headers: authorization(auditorToken), data: { name: 'Denied auditor write' } })).status()).toBe(403);
  expect((await request.get('/api/documents?type=SALES_ORDER', { headers: authorization(accountantToken) })).status()).toBe(403);
  expect((await request.get('/api/access', { headers: authorization(salesToken) })).status()).toBe(403);

  const adminBootstrap = await request.get('/api/bootstrap', { headers: authorization(adminToken) });
  const allRefs = await adminBootstrap.json();
  const alexandria = allRefs.branches.find((branch: any) => branch.code === 'ALX');
  const alexandriaWarehouse = allRefs.warehouses.find((warehouse: any) => String(warehouse.branchId) === String(alexandria.id));
  const modifiedPosRequest = await request.post('/api/pos/shifts', {
    headers: authorization(cashierToken),
    data: { branchId: alexandria.id, warehouseId: alexandriaWarehouse.id, registerCode: 'E2E-ALX-DENIED', openingCash: 0 },
  });
  expect(modifiedPosRequest.status()).toBe(403);

  const cashierBootstrap = await request.get('/api/bootstrap', { headers: authorization(cashierToken) });
  const cashierRefs = await cashierBootstrap.json();
  expect(cashierRefs.branches.map((branch: any) => branch.code)).toEqual(['CAI']);
  expect(cashierRefs.warehouses.map((warehouse: any) => warehouse.code)).toEqual(['CAI-RTL']);
  const shift = await request.post('/api/pos/shifts', {
    headers: authorization(cashierToken),
    data: { branchId: cashierRefs.branches[0].id, warehouseId: cashierRefs.warehouses[0].id, registerCode: 'E2E-CAI-POS', openingCash: 0 },
  });
  expect(shift.status(), await shift.text()).toBe(201);
  const pos = await request.get('/api/pos', { headers: authorization(cashierToken) });
  expect(pos.status()).toBe(200);
  const posState = await pos.json();
  expect(posState.shifts.length).toBeGreaterThan(0);
  expect(posState.shifts.every((row: any) => String(row.branchId) === String(cashierRefs.branches[0].id) && String(row.warehouseId) === String(cashierRefs.warehouses[0].id))).toBe(true);
});

test('administrator policy enforces financial assignment, explicit DENY, field redaction, scoped output and approval scope', async ({ request }) => {
  const adminToken = await loginApi(request, 'admin@odin.demo');
  const stepUpResponse = await request.post('/api/auth/step-up', { headers: authorization(adminToken), data: { password } });
  expect(stepUpResponse.status(), await stepUpResponse.text()).toBe(201);
  const stepUpToken = (await stepUpResponse.json()).stepUpToken as string;
  const adminHeaders = { ...authorization(adminToken), 'X-Odin-Step-Up': stepUpToken };

  const overviewResponse = await request.get('/api/access', { headers: authorization(adminToken) });
  expect(overviewResponse.status()).toBe(200);
  const overview = await overviewResponse.json();
  const target = overview.users.find((user: any) => user.email === 'accountant@odin.demo');
  const bankAccounts = overview.configuration.assignableResources.bank_account;
  const account1100 = overview.configuration.assignableResources.account.find((account: any) => account.code === '1100');
  expect(bankAccounts.length).toBeGreaterThan(1);
  expect(target).toBeTruthy();
  expect(account1100).toBeTruthy();

  const original = {
    primaryRoleId: target.primaryRole.id,
    additionalRoleIds: target.additionalRoles.map((role: any) => role.id),
    branchIds: target.branchIds,
    warehouseIds: target.warehouseIds,
    overrides: target.overrides.map((override: any) => ({ permissionKey: override.permissionKey, effect: override.effect, reason: override.reason })),
    active: target.active,
    mfaRequired: target.mfaRequired,
  };
  let roleId = '';
  let targetChanged = false;

  try {
    const roleResponse = await request.post('/api/access/roles', {
      headers: adminHeaders,
      data: {
        name: 'E2E Scoped Accountant',
        description: 'Disposable browser verification policy',
        permissionKeys: [
          'sales.customer.view', 'accounting.journal.view',
          'reports.standard.view', 'reports.standard.export', 'reports.standard.print',
          'approvals.queue.view', 'sales.invoice.view', 'sales.invoice.approve', 'sales.invoice.reject',
          'banking.transaction.create',
        ],
        dataScopes: [
          { resource: 'customer', scope: 'ALL' },
          { resource: 'journal', scope: 'ALL' },
          { resource: 'report', scope: 'ALL' },
          { resource: 'export', scope: 'ALL' },
          { resource: 'print', scope: 'ALL' },
          { resource: 'approval_queue', scope: 'ALL' },
          { resource: 'invoice', scope: 'NONE' },
          { resource: 'bank_account', scope: 'ASSIGNED', config: { resourceIds: [bankAccounts[0].id] } },
          { resource: 'account', scope: 'ASSIGNED', config: { resourceIds: [account1100.id] } },
        ],
        fieldPermissions: [
          { resource: 'customer', field: 'creditLimitMinor', access: 'HIDDEN' },
          { resource: 'customer', field: 'paymentTermsDays', access: 'HIDDEN' },
          { resource: 'customer', field: 'balanceMinor', access: 'HIDDEN' },
          { resource: 'party', field: 'taxNumber', access: 'HIDDEN' },
          { resource: 'journal', field: 'lines', access: 'VIEW' },
        ],
        limits: [],
      },
    });
    expect(roleResponse.status(), await roleResponse.text()).toBe(201);
    roleId = String((await roleResponse.json()).id);

    const applyPolicy = async (overrides: any[]) => {
      const response = await request.patch(`/api/access/users/${target.id}`, {
        headers: adminHeaders,
        data: { ...original, primaryRoleId: roleId, additionalRoleIds: [], overrides },
      });
      expect(response.status(), await response.text()).toBe(200);
      targetChanged = true;
    };
    await applyPolicy([{ permissionKey: 'reports.standard.export', effect: 'DENY', reason: 'E2E verifies deny precedence' }]);

    let scopedToken = await loginApi(request, 'accountant@odin.demo');
    const customers = await request.get('/api/sales/customers', { headers: authorization(scopedToken) });
    expect(customers.status()).toBe(200);
    const customerRows = (await customers.json()).rows;
    expect(customerRows.length).toBeGreaterThan(0);
    for (const row of customerRows) {
      expect(row).not.toHaveProperty('creditLimitMinor');
      expect(row).not.toHaveProperty('paymentTermsDays');
      expect(row).not.toHaveProperty('outstandingMinor');
      expect(row).not.toHaveProperty('taxNumber');
    }

    const unassignedBank = await request.post('/api/banking/transactions', {
      headers: authorization(scopedToken),
      data: { branchId: target.branchIds[0], bankAccountId: bankAccounts[1].id, counterpartyAccountId: account1100.id, kind: 'PAYMENT', postingDate: '2026-08-03', amount: 1, description: 'Must be denied' },
    });
    expect(unassignedBank.status()).toBe(403);

    const trialBalance = await request.get('/api/reports/trial-balance', { headers: authorization(scopedToken) });
    expect(trialBalance.status(), await trialBalance.text()).toBe(200);
    expect((await trialBalance.json()).rows.map((row: any) => row.code)).toEqual(['1100']);
    expect((await request.get('/api/reports/trial-balance/csv', { headers: authorization(scopedToken) })).status()).toBe(403);
    const pdf = await request.get('/api/reports/trial-balance/pdf', { headers: authorization(scopedToken) });
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    const approvals = await request.get('/api/approvals', { headers: authorization(scopedToken) });
    expect(approvals.status()).toBe(200);
    expect(await approvals.json()).toEqual({ documents: [], journals: [] });

    await applyPolicy([]);
    scopedToken = await loginApi(request, 'accountant@odin.demo');
    const scopedCsv = await request.get('/api/reports/trial-balance/csv', { headers: authorization(scopedToken) });
    expect(scopedCsv.status()).toBe(200);
    const csv = await scopedCsv.text();
    expect(csv).toContain('1100');
    expect(csv).not.toContain('4000');
  } finally {
    if (targetChanged) {
      const restore = await request.patch(`/api/access/users/${target.id}`, { headers: adminHeaders, data: original });
      expect(restore.status(), await restore.text()).toBe(200);
    }
    if (roleId) {
      const archive = await request.post(`/api/access/roles/${roleId}/archive`, { headers: adminHeaders });
      expect(archive.status(), await archive.text()).toBe(201);
    }
  }
});

test('web and API responses emit the production security-header baseline', async ({ request }) => {
  const web = await request.get('/dashboard');
  expect(web.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(web.headers()['strict-transport-security']).toContain('max-age=31536000');
  expect(web.headers()['x-content-type-options']).toBe('nosniff');
  expect(web.headers()['x-frame-options']).toBe('DENY');

  const api = await request.get('/api/health');
  expect(api.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(api.headers()['cache-control']).toBe('no-store');
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
  expect(api.headers()['x-frame-options']).toBe('DENY');
});
