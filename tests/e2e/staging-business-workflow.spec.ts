import { APIRequestContext, APIResponse, expect, request, test } from '@playwright/test';

type Session = { context: APIRequestContext; token: string };

const stagingBaseUrl = process.env.STAGING_BASE_URL?.replace(/\/$/, '');
const localPassword = process.env.NODE_ENV !== 'production' && !process.env.CI ? 'OdinLocalOnly2026!' : undefined;
const demoPassword = process.env.ODIN_DEMO_PASSWORD || localPassword;

if (process.env.CI && (!stagingBaseUrl || !process.env.ODIN_DEMO_PASSWORD)) {
  throw new Error('STAGING_BASE_URL and ODIN_DEMO_PASSWORD must be configured in CI.');
}

async function json(response: APIResponse, action: string) {
  const text = await response.text();
  expect(response.ok(), `${action} failed (${response.status()}): ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function login(email: string): Promise<Session> {
  const context = await request.newContext({ baseURL: stagingBaseUrl });
  const session = await json(await context.post('/api/auth/login', {
    data: { email, password: demoPassword!, rememberMe: false },
  }), `login ${email}`);
  return { context, token: session.accessToken };
}

const headers = (session: Session) => ({ Authorization: `Bearer ${session.token}` });
const detail = async (session: Session, id: string) => json(await session.context.get(`/api/documents/${id}`, { headers: headers(session) }), `load document ${id}`);
const submit = async (session: Session, id: string, comment: string) => json(await session.context.post(`/api/documents/${id}/submit`, { headers: headers(session), data: { comment } }), `submit document ${id}`);
const approve = async (session: Session, id: string, comment: string) => json(await session.context.post(`/api/documents/${id}/approve`, { headers: headers(session), data: { comment } }), `approve document ${id}`);
const post = async (session: Session, id: string) => json(await session.context.post(`/api/documents/${id}/post`, { headers: headers(session) }), `post document ${id}`);

async function convert(
  session: Session,
  sourceId: string,
  targetType: string,
  sourceLineId: string,
  quantity: string,
  warehouseId: string,
  documentDate: string,
) {
  return json(await session.context.post(`/api/documents/${sourceId}/convert`, {
    headers: headers(session),
    data: {
      targetType,
      documentDate,
      warehouseId,
      lines: [{ sourceLineId, quantity }],
    },
  }), `convert ${sourceId} to ${targetType}`);
}

const journalBalance = (document: any) => document.journalEntry.lines.reduce(
  (sum: bigint, line: any) => sum + BigInt(line.debitMinor) - BigInt(line.creditMinor),
  0n,
);

function openPostingDate(periods: any[]) {
  const today = new Date().toISOString().slice(0, 10);
  const openPeriods = periods
    .filter((period) => period.status === 'OPEN')
    .sort((left, right) => String(right.startDate).localeCompare(String(left.startDate)));
  const coveringPeriod = openPeriods.find((period) =>
    String(period.startDate).slice(0, 10) <= today && String(period.endDate).slice(0, 10) >= today);
  const selectedPeriod = coveringPeriod || openPeriods[0];
  if (!selectedPeriod) throw new Error('Staging has no open fiscal period for workflow posting.');
  return coveringPeriod ? today : String(selectedPeriod.startDate).slice(0, 10);
}

function expectJournalSource(document: any) {
  expect(document.journalEntry).toMatchObject({
    sourceType: document.type,
    sourceNumber: document.number,
  });
  expect(String(document.journalEntry.sourceId)).toBe(String(document.id));
}

test.use({ trace: 'off' });

test.describe('deployed Odin ERP business workflow', () => {
  test.skip(!stagingBaseUrl || !demoPassword, 'STAGING_BASE_URL and ODIN_DEMO_PASSWORD are required for deployed workflow testing.');

  test('Customer → Quotation → Approval → Order → Delivery → Invoice → Payment → Return/Credit Note', async () => {
    const [sales, cfo, admin] = await Promise.all([
      login('sales@odin.demo'),
      login('cfo@odin.demo'),
      login('admin@odin.demo'),
    ]);
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
    try {
      const bootstrap = await json(await sales.context.get('/api/bootstrap', { headers: headers(sales) }), 'load bootstrap');
      const branch = bootstrap.branches.find((row: any) => row.code === 'CAI') || bootstrap.branches[0];
      const warehouse = bootstrap.warehouses.find((row: any) => row.branchId === branch.id) || bootstrap.warehouses[0];
      const item = bootstrap.items.find((row: any) => BigInt(row.salePriceMinor) > 0n);
      const salesperson = bootstrap.salesEmployees.find((row: any) => (row.branchIds || []).includes(branch.id));
      const bank = bootstrap.bankAccounts.find((row: any) => row.currency === bootstrap.tenant.baseCurrency && row.type === 'BANK')
        || bootstrap.bankAccounts.find((row: any) => row.currency === bootstrap.tenant.baseCurrency);
      for (const reference of [branch, warehouse, item, salesperson, bank]) expect(reference).toBeTruthy();

      const customer = await json(await sales.context.post('/api/masters/customers', {
        headers: headers(sales),
        data: {
          name: `Staging AR workflow ${unique}`,
          city: 'Cairo',
          defaultBranchId: String(branch.id),
          defaultCurrency: bootstrap.tenant.baseCurrency,
          creditLimit: '',
          paymentTermsDays: '',
        },
      }), 'create customer');
      expect(customer.code).toMatch(/^[A-Z0-9-]+-\d{6}$/);
      expect(customer.creditLimitMinor).toBeNull();
      expect(customer.paymentTermsDays).toBeNull();

      const today = openPostingDate(bootstrap.periods);
      const quotation = await json(await sales.context.post('/api/documents', {
        headers: headers(sales),
        data: {
          type: 'QUOTATION',
          branchId: String(branch.id),
          warehouseId: String(warehouse.id),
          customerId: String(customer.id),
          salespersonId: String(salesperson.id),
          documentDate: today,
          dueDate: today,
          currency: bootstrap.tenant.baseCurrency,
          taxMode: 'EXCLUSIVE',
          notes: 'Automated deployed staging workflow test',
          lines: [{ itemId: String(item.id), quantity: '2', discount: '0' }],
        },
      }), 'create quotation');
      expect(quotation.status).toBe('DRAFT');

      await submit(sales, String(quotation.id), 'Ready for commercial approval.');
      const makerCheckerAttempt = await sales.context.post(`/api/documents/${quotation.id}/approve`, {
        headers: headers(sales),
        data: { comment: 'Submitter should not approve.' },
      });
      expect(makerCheckerAttempt.status()).toBe(403);
      await approve(cfo, String(quotation.id), 'Commercial terms approved.');

      const approvedQuotation = await detail(sales, String(quotation.id));
      const order = await convert(sales, String(quotation.id), 'SALES_ORDER', String(approvedQuotation.lines[0].id), '2', String(warehouse.id), today);
      await submit(sales, String(order.id), 'Order ready for approval.');
      await approve(cfo, String(order.id), 'Order approved.');

      const approvedOrder = await detail(sales, String(order.id));
      const orderLineId = String(approvedOrder.lines[0].id);
      const delivery = await convert(sales, String(order.id), 'DELIVERY_NOTE', orderLineId, '1', String(warehouse.id), today);
      const overConversion = await sales.context.post(`/api/documents/${order.id}/convert`, {
        headers: headers(sales),
        data: { targetType: 'DELIVERY_NOTE', documentDate: today, warehouseId: String(warehouse.id), lines: [{ sourceLineId: orderLineId, quantity: '2' }] },
      });
      expect(overConversion.status()).toBe(400);
      expect(await overConversion.text()).toMatch(/exceeds remaining/i);

      await submit(sales, String(delivery.id), 'Partial delivery prepared.');
      await approve(cfo, String(delivery.id), 'Partial delivery approved.');
      await post(cfo, String(delivery.id));
      const deliveryDetail = await detail(cfo, String(delivery.id));
      expect(deliveryDetail.stockMovements).toHaveLength(1);
      expect(BigInt(deliveryDetail.stockMovements[0].quantityOutMilli)).toBe(1_000n);
      expect(journalBalance(deliveryDetail)).toBe(0n);
      expect(deliveryDetail.journalEntry.lines.map((line: any) => line.account.code)).toEqual(expect.arrayContaining(['1200', '5000']));
      expectJournalSource(deliveryDetail);

      const invoice = await convert(sales, String(delivery.id), 'SALES_INVOICE', String(deliveryDetail.lines[0].id), '1', String(warehouse.id), today);
      await submit(sales, String(invoice.id), 'Invoice ready for finance approval.');
      await approve(cfo, String(invoice.id), 'Invoice approved.');
      await post(cfo, String(invoice.id));
      const invoiceDetail = await detail(cfo, String(invoice.id));
      expect(journalBalance(invoiceDetail)).toBe(0n);
      expect(invoiceDetail.journalEntry.lines.map((line: any) => line.account.code)).toEqual(expect.arrayContaining(['1100', '2200', '4000']));
      expect(BigInt(invoiceDetail.remainingMinor)).toBe(BigInt(invoiceDetail.grossInvoiceMinor));
      expectJournalSource(invoiceDetail);

      const halfAmountMinor = BigInt(invoiceDetail.totalMinor) / 2n;
      const halfAmount = `${halfAmountMinor / 100n}.${(halfAmountMinor % 100n).toString().padStart(2, '0')}`;
      await json(await cfo.context.post('/api/payments', {
        headers: headers(cfo),
        data: {
          kind: 'RECEIPT',
          branchId: String(branch.id),
          bankAccountId: String(bank.id),
          customerId: String(customer.id),
          postingDate: today,
          amount: halfAmount,
          method: 'BANK',
          reference: `E2E-${unique}`,
          allocations: [{ documentId: String(invoice.id), amount: halfAmount }],
        },
      }), 'create partial receipt');
      const invoiceAfterPayment = await detail(cfo, String(invoice.id));
      expect(invoiceAfterPayment.paymentStatus).toBe('PARTIALLY_PAID');
      expect(BigInt(invoiceAfterPayment.remainingMinor)).toBe(BigInt(invoiceAfterPayment.totalMinor) - halfAmountMinor);

      const invoiceLineId = String(invoiceAfterPayment.lines[0].id);
      const excessReturnQuantity = await sales.context.post(`/api/documents/${invoice.id}/convert`, {
        headers: headers(sales),
        data: { targetType: 'SALES_RETURN', documentDate: today, warehouseId: String(warehouse.id), lines: [{ sourceLineId: invoiceLineId, quantity: '2' }] },
      });
      expect(excessReturnQuantity.status()).toBe(400);
      expect(await excessReturnQuantity.text()).toMatch(/exceeds remaining/i);

      const salesReturn = await convert(sales, String(invoice.id), 'SALES_RETURN', invoiceLineId, '0.25', String(warehouse.id), today);
      await submit(sales, String(salesReturn.id), 'Physical return submitted.');
      await approve(cfo, String(salesReturn.id), 'Return approved.');
      await post(cfo, String(salesReturn.id));
      const returnDetail = await detail(cfo, String(salesReturn.id));
      expect(journalBalance(returnDetail)).toBe(0n);
      expect(returnDetail.journalEntry.lines.map((line: any) => line.account.code)).toEqual(expect.arrayContaining(['1100', '1200', '2200', '4000', '5000']));
      expectJournalSource(returnDetail);

      const creditNote = await convert(sales, String(invoice.id), 'CREDIT_NOTE', invoiceLineId, '0.25', String(warehouse.id), today);
      await submit(sales, String(creditNote.id), 'Commercial credit submitted.');
      await approve(cfo, String(creditNote.id), 'Credit note approved.');
      await post(cfo, String(creditNote.id));
      const creditDetail = await detail(cfo, String(creditNote.id));
      expect(journalBalance(creditDetail)).toBe(0n);
      expect(creditDetail.journalEntry.lines.map((line: any) => line.account.code)).toEqual(expect.arrayContaining(['1100', '2200', '4000']));
      expectJournalSource(creditDetail);

      const settledInvoice = await detail(cfo, String(invoice.id));
      expect(BigInt(settledInvoice.returnedMinor)).toBe(BigInt(returnDetail.totalMinor));
      expect(BigInt(settledInvoice.creditedMinor)).toBe(BigInt(creditDetail.totalMinor));
      expect(BigInt(settledInvoice.netReceivableMinor)).toBe(halfAmountMinor);
      expect(BigInt(settledInvoice.remainingMinor)).toBe(0n);
      expect(settledInvoice.paymentStatus).toBe('PAID');

      const excessCredit = await sales.context.post(`/api/documents/${invoice.id}/convert`, {
        headers: headers(sales),
        data: { targetType: 'CREDIT_NOTE', documentDate: today, warehouseId: String(warehouse.id), lines: [{ sourceLineId: invoiceLineId, quantity: '0.1' }] },
      });
      expect(excessCredit.status()).toBe(400);
      expect(await excessCredit.text()).toMatch(/exceeds the remaining receivable|explicit credit\/refund workflow/i);

      const customerDetail = await json(await sales.context.get(`/api/sales/customers/${customer.id}`, { headers: headers(sales) }), 'customer detail');
      expect(BigInt(customerDetail.outstandingMinor)).toBe(0n);
      const relatedStatement = customerDetail.statement.filter((row: any) =>
        [invoiceDetail.number, returnDetail.number, creditDetail.number].includes(row.documentNumber) || row.transaction === 'RECEIPT');
      expect(relatedStatement.map((row: any) => row.transaction)).toEqual(expect.arrayContaining(['SALES_INVOICE', 'RECEIPT', 'SALES_RETURN', 'CREDIT_NOTE']));
      expect(BigInt(relatedStatement.at(-1).runningBalanceMinor)).toBe(0n);
      expect(customerDetail.ageing).toHaveLength(0);

      const reconciliation = await json(await cfo.context.get('/api/reports/reconciliation', { headers: headers(cfo) }), 'control reconciliation');
      for (const control of ['Accounts receivable', 'Accounts payable', 'Inventory']) {
        const row = reconciliation.rows.find((entry: any) => entry.control === control);
        expect(row, `${control} reconciliation row is missing`).toBeTruthy();
        expect(BigInt(row.differenceMinor), `${control} difference`).toBe(0n);
      }

      const audit = await json(await admin.context.get('/api/audit', { headers: headers(admin) }), 'audit log');
      const relatedIds = new Set([customer.id, quotation.id, order.id, delivery.id, invoice.id, salesReturn.id, creditNote.id].map(String));
      const relatedAudit = audit.filter((event: any) => relatedIds.has(String(event.entityId)));
      expect(relatedAudit.map((event: any) => event.action)).toEqual(expect.arrayContaining(['CREATE', 'SUBMIT', 'APPROVE', 'CONVERT', 'POST']));
    } finally {
      await Promise.all([sales.context.dispose(), cfo.context.dispose(), admin.context.dispose()]);
    }
  });

  test('authenticated invoice and customer statement refresh, then logout', async ({ page }) => {
    const invoicePage = await page.goto(`${stagingBaseUrl}/sales/invoices`, { waitUntil: 'domcontentloaded' });
    expect(invoicePage?.status()).toBe(200);
    await page.getByTestId('login-email').fill('admin@odin.demo');
    await page.getByTestId('login-password').fill(demoPassword!);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 30_000 });

    const refreshedInvoicePage = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(refreshedInvoicePage?.status()).toBe(200);
    await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/sales\/invoices$/);

    const statementPage = await page.goto(`${stagingBaseUrl}/reports/sales`, { waitUntil: 'domcontentloaded' });
    expect(statementPage?.status()).toBe(200);
    await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Customer statement/ }).click();
    await expect(page.getByRole('heading', { name: 'Customer statement' })).toBeVisible();

    const refreshedStatementPage = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(refreshedStatementPage?.status()).toBe(200);
    await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/reports\/sales$/);

    const logoutResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST');
    await page.getByTestId('account-menu').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    expect((await logoutResponse).ok()).toBeTruthy();
    await expect(page.getByTestId('login-submit')).toBeVisible();

    const loggedOutRefresh = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(loggedOutRefresh?.status()).toBe(200);
    await expect(page.getByTestId('login-submit')).toBeVisible();
    await expect(page.locator('.session-restoring')).toBeHidden();
  });
});
