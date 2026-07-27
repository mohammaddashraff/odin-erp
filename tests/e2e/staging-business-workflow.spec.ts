import { expect, request, test, type APIRequestContext } from '@playwright/test';

const baseURL = process.env.STAGING_BASE_URL || 'https://odin-erp-web.vercel.app';
const password = process.env.ODIN_DEMO_PASSWORD || 'OdinDemo2026!';
const today = '2026-07-27';
const dueDate = '2026-08-10';

type Session = {
  context: APIRequestContext;
  token: string;
  user: any;
};

async function login(email: string): Promise<Session> {
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Accept: 'application/json' } });
  const response = await context.post('/api/auth/login', {
    data: { email, password, rememberMe: true },
  });
  expect(response.status(), `login failed for ${email}: ${await response.text()}`).toBe(201);
  const body = await response.json();
  expect(body.token).toBeTruthy();
  return { context, token: body.token, user: body.user };
}

function headers(session: Session) {
  return { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
}

async function json(response: any, label: string) {
  const text = await response.text();
  expect(response.ok(), `${label} failed (${response.status()}): ${text}`).toBeTruthy();
  return text ? JSON.parse(text) : null;
}

async function submit(session: Session, id: string, comment: string) {
  return json(await session.context.post(`/api/documents/${id}/submit`, { headers: headers(session), data: { comment } }), `submit ${id}`);
}

async function approve(session: Session, id: string, comment: string) {
  return json(await session.context.post(`/api/documents/${id}/approve`, { headers: headers(session), data: { comment } }), `approve ${id}`);
}

async function post(session: Session, id: string) {
  return json(await session.context.post(`/api/documents/${id}/post`, { headers: headers(session) }), `post ${id}`);
}

async function detail(session: Session, id: string) {
  return json(await session.context.get(`/api/documents/${id}`, { headers: headers(session) }), `document detail ${id}`);
}

async function convert(
  session: Session,
  sourceId: string,
  targetType: string,
  sourceLineId: string,
  quantity: string,
  warehouseId?: string,
) {
  return json(await session.context.post(`/api/documents/${sourceId}/convert`, {
    headers: headers(session),
    data: {
      targetType,
      documentDate: today,
      dueDate,
      ...(warehouseId ? { warehouseId } : {}),
      lines: [{ sourceLineId, quantity }],
    },
  }), `convert ${sourceId} to ${targetType}`);
}

test.describe.serial('deployed Odin ERP business workflow', () => {
  test.setTimeout(240_000);

  test('Customer → Quotation → Approval → Order → Delivery → Invoice → Payment → Return/Credit Note', async () => {
    const sales = await login('sales@odin.demo');
    const cfo = await login('cfo@odin.demo');
    const admin = await login('admin@odin.demo');

    try {
      const health = await json(await admin.context.get('/api/health'), 'health');
      expect(health.status).toBe('ok');

      const bootstrap = await json(await sales.context.get('/api/bootstrap', { headers: headers(sales) }), 'bootstrap');
      const branch = bootstrap.branches.find((row: any) => row.code === 'CAI') || bootstrap.branches[0];
      const warehouse = bootstrap.warehouses.find((row: any) => row.code === 'CAI-MAIN') || bootstrap.warehouses[0];
      const item = bootstrap.items.find((row: any) => row.sku === 'LAP-14') || bootstrap.items[0];
      const salesperson = bootstrap.salesEmployees.find((row: any) => row.active && (row.salesEligible || row.department?.code === 'SALES'));
      const bank = bootstrap.bankAccounts.find((row: any) => row.code === 'CIB-EGP') || bootstrap.bankAccounts[0];

      expect(branch).toBeTruthy();
      expect(warehouse).toBeTruthy();
      expect(item).toBeTruthy();
      expect(salesperson).toBeTruthy();
      expect(bank).toBeTruthy();

      const unique = Date.now();
      const customer = await json(await sales.context.post('/api/masters/customers', {
        headers: headers(sales),
        data: {
          name: `Staging E2E Customer ${unique}`,
          city: 'Cairo',
          email: `e2e-${unique}@odin.demo`,
          phone: '+20 100 000 0000',
          defaultBranchId: String(branch.id),
          defaultCurrency: 'EGP',
          paymentTermsDays: '',
          creditLimit: '',
        },
      }), 'create customer');
      expect(customer.code).toMatch(/^CUS-\d{6}$/);
      expect(customer.paymentTermsDays).toBeNull();
      expect(customer.creditLimitMinor).toBeNull();

      const quotation = await json(await sales.context.post('/api/documents', {
        headers: headers(sales),
        data: {
          type: 'QUOTATION',
          branchId: String(branch.id),
          warehouseId: String(warehouse.id),
          customerId: String(customer.id),
          salespersonId: String(salesperson.id),
          documentDate: today,
          dueDate,
          currency: 'EGP',
          taxMode: 'EXCLUSIVE',
          paymentTerms: '14 days net',
          notes: 'Automated deployed staging workflow test',
          lines: [{ itemId: String(item.id), quantity: '2', discount: '0' }],
        },
      }), 'create quotation');
      expect(quotation.status).toBe('DRAFT');
      expect(BigInt(quotation.totalMinor)).toBeGreaterThan(0n);

      await submit(sales, String(quotation.id), 'Ready for commercial approval.');

      const makerCheckerAttempt = await sales.context.post(`/api/documents/${quotation.id}/approve`, {
        headers: headers(sales),
        data: { comment: 'Submitter should not approve.' },
      });
      expect(makerCheckerAttempt.status()).toBe(403);

      await approve(cfo, String(quotation.id), 'Commercial terms approved.');
      const approvedQuotation = await detail(sales, String(quotation.id));
      expect(approvedQuotation.status).toBe('APPROVED');
      expect(approvedQuotation.approvals.map((event: any) => event.action)).toEqual(expect.arrayContaining(['SUBMIT', 'APPROVE']));

      const quotationLineId = String(approvedQuotation.lines[0].id);
      const order = await convert(sales, String(quotation.id), 'SALES_ORDER', quotationLineId, '2', String(warehouse.id));
      await submit(sales, String(order.id), 'Order ready for approval.');
      await approve(cfo, String(order.id), 'Order approved.');

      const approvedOrder = await detail(sales, String(order.id));
      const orderLineId = String(approvedOrder.lines[0].id);
      const delivery = await convert(sales, String(order.id), 'DELIVERY_NOTE', orderLineId, '1', String(warehouse.id));
      await submit(sales, String(delivery.id), 'Partial delivery prepared.');
      await approve(cfo, String(delivery.id), 'Partial delivery approved.');
      const postedDelivery = await post(cfo, String(delivery.id));
      expect(postedDelivery.status).toBe('POSTED');
      expect(postedDelivery.journal).toBeTruthy();

      const orderAfterPartial = await detail(sales, String(order.id));
      const consumedOrderQuantity = orderAfterPartial.lines[0].targetLines
        .filter((line: any) => !['REJECTED', 'CANCELLED'].includes(line.document.status))
        .reduce((sum: bigint, line: any) => sum + BigInt(line.quantityMilli), 0n);
      expect(consumedOrderQuantity).toBe(1000n);

      const deliveryDetail = await detail(sales, String(delivery.id));
      const deliveryLineId = String(deliveryDetail.lines[0].id);
      const invoice = await convert(sales, String(delivery.id), 'SALES_INVOICE', deliveryLineId, '1', String(warehouse.id));
      await submit(sales, String(invoice.id), 'Invoice ready for finance approval.');
      await approve(cfo, String(invoice.id), 'Invoice approved.');
      const postedInvoice = await post(cfo, String(invoice.id));
      expect(postedInvoice.status).toBe('POSTED');
      expect(postedInvoice.journal).toBeTruthy();

      const invoiceDetail = await detail(cfo, String(invoice.id));
      expect(invoiceDetail.journalEntry).toBeTruthy();
      expect(BigInt(invoiceDetail.remainingMinor)).toBe(BigInt(invoiceDetail.totalMinor));

      const halfAmountMinor = BigInt(invoiceDetail.totalMinor) / 2n;
      const halfAmount = `${halfAmountMinor / 100n}.${(halfAmountMinor % 100n).toString().padStart(2, '0')}`;
      const receipt = await json(await cfo.context.post('/api/payments', {
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
      expect(receipt.journalEntry).toBeTruthy();

      const invoiceAfterPayment = await detail(cfo, String(invoice.id));
      expect(BigInt(invoiceAfterPayment.paidMinor)).toBe(halfAmountMinor);
      expect(BigInt(invoiceAfterPayment.remainingMinor)).toBe(BigInt(invoiceAfterPayment.totalMinor) - halfAmountMinor);

      const invoiceLineId = String(invoiceAfterPayment.lines[0].id);
      const salesReturn = await convert(sales, String(invoice.id), 'SALES_RETURN', invoiceLineId, '0.5', String(warehouse.id));
      await submit(sales, String(salesReturn.id), 'Physical return submitted.');
      await approve(cfo, String(salesReturn.id), 'Return approved.');
      const postedReturn = await post(cfo, String(salesReturn.id));
      expect(postedReturn.status).toBe('POSTED');
      expect(postedReturn.journal).toBeTruthy();

      const creditNote = await convert(sales, String(invoice.id), 'CREDIT_NOTE', invoiceLineId, '0.5', String(warehouse.id));
      await submit(sales, String(creditNote.id), 'Commercial credit submitted.');
      await approve(cfo, String(creditNote.id), 'Credit note approved.');
      const postedCredit = await post(cfo, String(creditNote.id));
      expect(postedCredit.status).toBe('POSTED');
      expect(postedCredit.journal).toBeTruthy();

      const customerDetail = await json(await sales.context.get(`/api/sales/customers/${customer.id}`, { headers: headers(sales) }), 'customer detail');
      const expectedNetOutstanding = BigInt(invoiceAfterPayment.totalMinor)
        - halfAmountMinor
        - BigInt(postedReturn.totalMinor)
        - BigInt(postedCredit.totalMinor);

      // This assertion intentionally validates the correct business outcome. If it fails,
      // customer balances are ignoring posted sales returns and credit notes.
      expect(BigInt(customerDetail.outstandingMinor), 'Customer outstanding must net posted returns and credit notes against the invoice').toBe(expectedNetOutstanding);

      const audit = await json(await admin.context.get('/api/audit', { headers: headers(admin) }), 'audit log');
      const relatedAudit = audit.filter((event: any) => [String(customer.id), String(quotation.id), String(order.id), String(delivery.id), String(invoice.id), String(salesReturn.id), String(creditNote.id)].includes(String(event.entityId)));
      expect(relatedAudit.length).toBeGreaterThan(8);
    } finally {
      await Promise.all([sales.context.dispose(), cfo.context.dispose(), admin.context.dispose()]);
    }
  });
});
