import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountType, BankAccountType, BankTransactionKind, DocumentType, JournalStatus, PaymentKind, PaymentMethod,
  PosSaleStatus, PosShiftStatus, Prisma, WorkflowStatus,
} from '@prisma/client';
import { compare } from 'bcryptjs';
import { Actor, requirePermission } from './auth';
import { CustomerReceivablesService, receivableBaseMinor, receivableJournalAmounts } from './customer-receivables';
import { money, parseFixed, quantity, roundDiv, serialize } from './money';
import { PrismaService } from './prisma.service';
import { seed } from '../prisma/seed';

type Tx = Prisma.TransactionClient;
type JournalLineInput = { code: string; debit?: bigint; credit?: bigint; description: string };
const publicUser = { select: { id: true, name: true, email: true } } as const;

const SALES_TYPES = new Set<DocumentType>([
  DocumentType.QUOTATION, DocumentType.SALES_ORDER, DocumentType.DELIVERY_NOTE,
  DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE,
]);
const PURCHASE_TYPES = new Set<DocumentType>([
  DocumentType.PURCHASE_REQUEST, DocumentType.PURCHASE_RFQ, DocumentType.PURCHASE_ORDER, DocumentType.GOODS_RECEIPT,
  DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN,
]);
const CONVERSIONS: Partial<Record<DocumentType, DocumentType[]>> = {
  QUOTATION: [DocumentType.SALES_ORDER],
  SALES_ORDER: [DocumentType.DELIVERY_NOTE],
  DELIVERY_NOTE: [DocumentType.SALES_INVOICE],
  SALES_INVOICE: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE],
  PURCHASE_REQUEST: [DocumentType.PURCHASE_RFQ],
  PURCHASE_RFQ: [DocumentType.PURCHASE_ORDER],
  PURCHASE_ORDER: [DocumentType.GOODS_RECEIPT],
  GOODS_RECEIPT: [DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN],
  PURCHASE_BILL: [DocumentType.PURCHASE_RETURN],
};

export function calculateDocumentLine(quantityMilli: bigint, unitPriceMinor: bigint, discountMinor: bigint, taxRateBps: bigint, taxMode: string) {
  if (quantityMilli <= 0n) throw new BadRequestException('Quantity must be greater than zero');
  if (unitPriceMinor < 0n) throw new BadRequestException('Unit price cannot be negative');
  const gross = roundDiv(quantityMilli * unitPriceMinor, 1000n);
  if (discountMinor < 0n || discountMinor > gross) throw new BadRequestException('Discount is invalid');
  if (taxRateBps < 0n || taxRateBps > 10_000n) throw new BadRequestException('Tax rate must be between 0 and 100');
  const charged = gross - discountMinor;
  const taxableMinor = taxMode === 'INCLUSIVE' ? roundDiv(charged * 10_000n, 10_000n + taxRateBps) : charged;
  const taxMinor = taxMode === 'EXEMPT' ? 0n : taxMode === 'INCLUSIVE' ? charged - taxableMinor : roundDiv(taxableMinor * taxRateBps, 10_000n);
  const totalMinor = taxMode === 'INCLUSIVE' ? charged : taxableMinor + taxMinor;
  return { grossMinor: gross, taxableMinor, taxMinor, totalMinor };
}

export function documentEditState(status: WorkflowStatus, hasOperationalEffects: boolean) {
  if (hasOperationalEffects || status === WorkflowStatus.POSTED || status === WorkflowStatus.CANCELLED) {
    return { editable: false, reason: 'This document can no longer be edited because operational or accounting effects already exist.' };
  }
  if (status === WorkflowStatus.SUBMITTED) return { editable: false, reason: 'This document is locked while approval is pending.' };
  if (status === WorkflowStatus.APPROVED) return { editable: false, reason: 'Create a revision to change an approved document.' };
  return { editable: status === WorkflowStatus.DRAFT || status === WorkflowStatus.REJECTED, reason: null };
}

@Injectable()
export class ErpService {
  constructor(
    private readonly db: PrismaService,
    private readonly receivables: CustomerReceivablesService = new CustomerReceivablesService(),
  ) {}

  async withTenant<T>(actor: Actor, work: (tx: Tx) => Promise<T>) {
    return serialize(await this.db.tenant(actor.tenantId, work));
  }

  async health() {
    await this.db.healthCheck();
    return { api: 'ok', database: 'ok', timestamp: new Date().toISOString() };
  }

  private assertBranch(actor: Actor, branchId: bigint) {
    if (!actor.permissions.includes('*') && !actor.branchIds.includes(branchId.toString())) throw new ForbiddenException('Branch is outside your access scope');
  }

  private assertWarehouse(actor: Actor, warehouseId?: bigint | null) {
    if (warehouseId && !actor.permissions.includes('*') && !actor.warehouseIds.includes(warehouseId.toString())) throw new ForbiddenException('Warehouse is outside your access scope');
  }

  private requireAny(actor: Actor, ...permissions: string[]) {
    if (!actor.permissions.includes('*') && !permissions.some((permission) => actor.permissions.includes(permission))) {
      throw new ForbiddenException(`Permission required: ${permissions[0]}`);
    }
  }

  private customerForActor(actor: Actor, customer: any) {
    if (actor.permissions.includes('*') || actor.permissions.includes('customers.view-credit')) return customer;
    const { creditLimitMinor: _creditLimit, paymentTermsDays: _paymentTerms, creditHold: _creditHold, ...visible } = customer;
    return visible;
  }

  private async assertBranchWarehouse(tx: Tx, actor: Actor, branchId: bigint, warehouseId?: bigint | null) {
    this.assertBranch(actor, branchId);
    this.assertWarehouse(actor, warehouseId);
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new BadRequestException('The selected branch is not available.');
    if (!warehouseId) return;
    const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || !warehouse.active || warehouse.branchId !== branchId) {
      throw new BadRequestException(`The selected warehouse is not available for the ${branch.name} branch.`);
    }
  }

  private date(value: unknown, field = 'date') {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BadRequestException(`${field} must use YYYY-MM-DD`);
    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }

  private async audit(tx: Tx, actor: Actor, action: string, entityType: string, entityId: bigint | string, details: Record<string, unknown> = {}, previousValues?: Record<string, unknown>) {
    await tx.auditEvent.create({ data: {
      tenantId: actor.tenantId, userId: actor.userId, action, entityType, entityId: entityId.toString(),
      previousValues: previousValues as Prisma.InputJsonValue | undefined,
      newValues: details as Prisma.InputJsonValue,
      postingReference: typeof details.postingReference === 'string' ? details.postingReference : null,
      approvalReference: typeof details.approvalReference === 'string' ? details.approvalReference : null,
    } });
  }

  private async sequence(tx: Tx, actor: Actor, branchId: bigint, type: string, date: Date) {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { code: true } });
    if (!branch) throw new BadRequestException('Branch is invalid');
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO document_sequences (tenant_id, branch_id, document_type, fiscal_year, next_value)
      VALUES (${actor.tenantId}, ${branchId}, ${type}, ${date.getUTCFullYear()}, 2)
      ON CONFLICT (tenant_id, branch_id, document_type, fiscal_year)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value - 1 AS value`;
    const prefix: Record<string, string> = {
      QUOTATION: 'QT', SALES_ORDER: 'SO', DELIVERY_NOTE: 'DN', SALES_INVOICE: 'SI', SALES_RETURN: 'SR', CREDIT_NOTE: 'CN',
      PURCHASE_REQUEST: 'PR', PURCHASE_RFQ: 'RFQ', PURCHASE_ORDER: 'PO', GOODS_RECEIPT: 'GR', PURCHASE_BILL: 'PB', PURCHASE_RETURN: 'RT',
      WAREHOUSE_TRANSFER: 'WT', INVENTORY_ADJUSTMENT: 'IA', STOCK_COUNT: 'SC', JOURNAL: 'JE', RECEIPT: 'RC', PAYMENT: 'PY',
      POS: 'PS', POS_RETURN: 'PX', BANK: 'BT', SHIFT: 'SH',
    };
    return `${prefix[type] || type.slice(0, 3)}-${branch.code}-${date.getUTCFullYear()}-${rows[0].value.toString().padStart(5, '0')}`;
  }

  private async customerCode(tx: Tx, actor: Actor) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { customerCodePrefix: true } });
    const prefix = tenant.customerCodePrefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'CUS';
    const rows = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO master_sequences (tenant_id, key, prefix, next_value)
      VALUES (${actor.tenantId}, 'CUSTOMER', ${prefix}, 2)
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET next_value = master_sequences.next_value + 1, prefix = EXCLUDED.prefix
      RETURNING next_value - 1 AS value`;
    return `${prefix}-${rows[0].value.toString().padStart(6, '0')}`;
  }

  private async assertOpenPeriod(tx: Tx, actor: Actor, postingDate: Date) {
    const period = await tx.fiscalPeriod.findFirst({ where: { tenantId: actor.tenantId, startDate: { lte: postingDate }, endDate: { gte: postingDate } } });
    if (!period) throw new BadRequestException('No fiscal period covers this posting date');
    if (period.status !== 'OPEN') throw new BadRequestException(`Fiscal period ${period.name} is ${period.status}`);
  }

  private async postedJournal(tx: Tx, actor: Actor, input: {
    branchId: bigint; date: Date; description: string; module: string; sourceType: string; sourceId: bigint; sourceNumber: string; lines: JournalLineInput[];
  }) {
    await this.assertOpenPeriod(tx, actor, input.date);
    const debit = input.lines.reduce((sum, line) => sum + (line.debit || 0n), 0n);
    const credit = input.lines.reduce((sum, line) => sum + (line.credit || 0n), 0n);
    if (input.lines.length < 2 || debit <= 0n || debit !== credit) throw new BadRequestException(`Journal is unbalanced: ${debit} / ${credit}`);
    const codes = [...new Set(input.lines.map((line) => line.code))];
    const accounts = await tx.account.findMany({ where: { tenantId: actor.tenantId, code: { in: codes }, active: true } });
    const map = new Map(accounts.map((account) => [account.code, account]));
    for (const code of codes) if (!map.get(code)?.postingAllowed) throw new BadRequestException(`Account ${code} is unavailable for posting`);
    const number = await this.sequence(tx, actor, input.branchId, 'JOURNAL', input.date);
    const journal = await tx.journalEntry.create({ data: {
      tenantId: actor.tenantId, branchId: input.branchId, number, postingDate: input.date,
      description: input.description, status: JournalStatus.DRAFT, sourceModule: input.module,
      sourceType: input.sourceType, sourceId: input.sourceId, sourceNumber: input.sourceNumber,
      createdById: actor.userId, submittedById: actor.userId, approvedById: actor.userId, postedById: actor.userId,
      submittedAt: new Date(), approvedAt: new Date(), postedAt: new Date(),
      lines: { create: input.lines.map((line) => ({
        tenantId: actor.tenantId, accountId: map.get(line.code)!.id, description: line.description,
        debitMinor: line.debit || 0n, creditMinor: line.credit || 0n,
      })) },
    } });
    await tx.journalEntry.update({ where: { id: journal.id }, data: { status: JournalStatus.POSTED } });
    return { ...journal, status: JournalStatus.POSTED };
  }

  private async stock(tx: Tx, actor: Actor, input: {
    branchId: bigint; warehouseId: bigint; itemId: bigint; qtyMilli: bigint; direction: 'IN' | 'OUT'; unitCostMinor?: bigint;
    date: Date; sourceType: string; sourceId: bigint; sourceNumber: string;
  }) {
    const current = await tx.stockBalance.findUnique({ where: { tenantId_warehouseId_itemId: {
      tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId,
    } } });
    const beforeQty = current?.quantityMilli || 0n;
    const beforeValue = current?.valueMinor || 0n;
    if (input.qtyMilli <= 0n) throw new BadRequestException('Stock quantity must be greater than zero');
    let cost = input.unitCostMinor || 0n;
    let total = roundDiv(input.qtyMilli * cost, 1000n);
    if (input.direction === 'OUT') {
      if (beforeQty < input.qtyMilli) throw new BadRequestException('Insufficient stock; negative inventory is disabled');
      cost = beforeQty === 0n ? 0n : roundDiv(beforeValue * 1000n, beforeQty);
      total = input.qtyMilli === beforeQty ? beforeValue : roundDiv(input.qtyMilli * cost, 1000n);
    }
    const afterQty = input.direction === 'IN' ? beforeQty + input.qtyMilli : beforeQty - input.qtyMilli;
    const afterValue = input.direction === 'IN' ? beforeValue + total : beforeValue - total;
    await tx.stockBalance.upsert({
      where: { tenantId_warehouseId_itemId: { tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId } },
      create: { tenantId: actor.tenantId, warehouseId: input.warehouseId, itemId: input.itemId, quantityMilli: afterQty, valueMinor: afterValue },
      update: { quantityMilli: afterQty, valueMinor: afterValue },
    });
    await tx.stockMovement.create({ data: {
      tenantId: actor.tenantId, branchId: input.branchId, warehouseId: input.warehouseId, itemId: input.itemId,
      postingDate: input.date, quantityInMilli: input.direction === 'IN' ? input.qtyMilli : 0n,
      quantityOutMilli: input.direction === 'OUT' ? input.qtyMilli : 0n, unitCostMinor: cost, totalCostMinor: total,
      runningQuantityMilli: afterQty, runningValueMinor: afterValue, sourceType: input.sourceType,
      sourceId: input.sourceId, sourceNumber: input.sourceNumber, createdById: actor.userId,
    } });
    return { unitCostMinor: cost, totalCostMinor: total, afterQty, afterValue };
  }

  async bootstrap(actor: Actor) {
    return this.withTenant(actor, async (tx) => ({
      tenant: await tx.tenant.findUnique({ where: { id: actor.tenantId } }),
      branches: await tx.branch.findMany({ where: actor.permissions.includes('*') ? {} : { id: { in: actor.branchIds.map(BigInt) } }, orderBy: { code: 'asc' } }),
      warehouses: await tx.warehouse.findMany({ where: { active: true, ...(actor.permissions.includes('*') ? {} : { id: { in: actor.warehouseIds.map(BigInt) } }) }, orderBy: { code: 'asc' } }),
      customers: (await tx.customer.findMany({ where: {
        active: true,
        ...(actor.permissions.includes('*') ? {} : { defaultBranchId: { in: actor.branchIds.map(BigInt) } }),
      }, orderBy: { code: 'asc' } })).map((customer) => this.customerForActor(actor, customer)),
      suppliers: await tx.supplier.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      categories: await tx.itemCategory.findMany({ orderBy: { code: 'asc' } }),
      units: await tx.unitOfMeasure.findMany({ orderBy: { code: 'asc' } }),
      items: await tx.item.findMany({ where: { active: true }, include: { category: true, uom: true }, orderBy: { sku: 'asc' } }),
      accounts: await tx.account.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      bankAccounts: await tx.bankAccount.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      periods: await tx.fiscalPeriod.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] }),
      departments: await tx.department.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      salesEmployees: await tx.employee.findMany({
        where: { active: true, OR: [{ salesEligible: true }, { department: { code: 'SALES' } }] },
        include: { department: true },
        orderBy: { name: 'asc' },
      }),
      currencies: await tx.currency.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
      documentTypes: Object.values(DocumentType),
    }));
  }

  private requiredText(value: unknown, field: string) {
    const text = String(value || '').trim();
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private async masterCreate<T>(actor: Actor, entityType: string, create: (tx: Tx) => Promise<T>) {
    try {
      return await this.withTenant(actor, async (tx) => {
        const result: any = await create(tx);
        await this.audit(tx, actor, 'CREATE', entityType, result.id, { code: result.code, name: result.name });
        return result;
      });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new BadRequestException(`${entityType.toLowerCase().replaceAll('_', ' ')} code, SKU, or barcode already exists`);
      throw error;
    }
  }

  async createCustomer(actor: Actor, body: any) {
    this.requireAny(actor, 'customers.create', 'sales.write');
    if ((body.creditLimit !== '' && body.creditLimit !== null && body.creditLimit !== undefined)
      || (body.paymentTermsDays !== '' && body.paymentTermsDays !== null && body.paymentTermsDays !== undefined)
      || body.creditHold === true) {
      this.requireAny(actor, 'customers.edit-credit');
    }
    return this.masterCreate(actor, 'CUSTOMER', async (tx) => {
      const defaultBranchId = body.defaultBranchId ? BigInt(body.defaultBranchId) : null;
      if (defaultBranchId) {
        this.assertBranch(actor, defaultBranchId);
        if (!await tx.branch.findUnique({ where: { id: defaultBranchId } })) throw new BadRequestException('The selected default branch is not available.');
      }
      const defaultCurrency = body.defaultCurrency ? String(body.defaultCurrency).toUpperCase() : null;
      if (defaultCurrency && !await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: defaultCurrency } } })) {
        throw new BadRequestException('The selected default currency is not registered.');
      }
      const paymentTermsDays = body.paymentTermsDays === '' || body.paymentTermsDays === null || body.paymentTermsDays === undefined
        ? null
        : Number(body.paymentTermsDays);
      if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) {
        throw new BadRequestException('Payment terms must be a whole number of days.');
      }
      const creditLimitMinor = body.creditLimit === '' || body.creditLimit === null || body.creditLimit === undefined
        ? null
        : money(body.creditLimit, 'credit limit');
      if (creditLimitMinor !== null && creditLimitMinor < 0n) throw new BadRequestException('Credit limit cannot be negative.');
      const code = await this.customerCode(tx, actor);
      return tx.customer.create({ data: {
        tenantId: actor.tenantId,
        code,
        name: this.requiredText(body.name, 'Customer name'),
        customerType: String(body.customerType || 'BUSINESS'),
        taxNumber: body.taxNumber || null,
        registrationNumber: body.registrationNumber || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.billingAddress || body.address || null,
        billingAddress: body.billingAddress || body.address || null,
        shippingAddress: body.shippingAddress || null,
        city: this.requiredText(body.city, 'City'),
        defaultBranchId,
        creditLimitMinor,
        paymentTermsDays,
        defaultCurrency,
        taxTreatment: String(body.taxTreatment || 'STANDARD'),
        creditHold: Boolean(body.creditHold),
      } });
    });
  }

  async listCustomers(actor: Actor, query: any = {}) {
    this.requireAny(actor, 'customers.view', 'sales.write');
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize || 20)));
    const search = String(query.search || '').trim();
    return this.withTenant(actor, async (tx) => {
      const where: Prisma.CustomerWhereInput = {
        ...(String(query.status || 'ACTIVE') === 'ALL' ? {} : { active: String(query.status || 'ACTIVE') === 'ACTIVE' }),
        ...(query.branchId ? { defaultBranchId: BigInt(query.branchId) } : actor.permissions.includes('*') ? {} : { defaultBranchId: { in: actor.branchIds.map(BigInt) } }),
        ...(search ? { OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { taxNumber: { contains: search, mode: 'insensitive' } },
        ] } : {}),
      };
      const [total, customers] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({ where, include: { defaultBranch: true }, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      const ids = customers.map((customer) => customer.id);
      const branchIds = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
      const outstanding = await this.receivables.customerBalances(tx, ids, branchIds);
      return {
        rows: customers.map((customer) => this.customerForActor(actor, { ...customer, outstandingMinor: outstanding.get(customer.id.toString()) || 0n })),
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    });
  }

  async customerDetail(actor: Actor, customerId: bigint) {
    this.requireAny(actor, 'customers.view', 'sales.write');
    return this.withTenant(actor, async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, include: {
        defaultBranch: true,
        documents: { include: { branch: true, salesEmployee: true }, orderBy: { createdAt: 'desc' }, take: 50 },
        payments: { include: { allocations: { include: { document: true } } }, orderBy: { createdAt: 'desc' }, take: 30 },
      } });
      if (!customer) throw new NotFoundException('Customer not found');
      if (customer.defaultBranchId) this.assertBranch(actor, customer.defaultBranchId);
      const branchIds = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
      const [balances, statement, ageing, audit, documents] = await Promise.all([
        this.receivables.customerBalances(tx, [customerId], branchIds),
        this.receivables.customerStatement(tx, { customerId, branchIds }),
        this.receivables.ageing(tx, { customerId, branchIds }),
        tx.auditEvent.findMany({ where: { entityType: 'CUSTOMER', entityId: customerId.toString() }, include: { user: publicUser }, orderBy: { createdAt: 'desc' } }),
        this.receivables.decorateInvoices(tx, customer.documents),
      ]);
      return this.customerForActor(actor, {
        ...customer,
        documents,
        outstandingMinor: balances.get(customerId.toString()) || 0n,
        statement,
        ageing,
        audit,
      });
    });
  }

  async updateCustomer(actor: Actor, customerId: bigint, body: any) {
    this.requireAny(actor, 'customers.edit', 'sales.write');
    return this.withTenant(actor, async (tx) => {
      const current = await tx.customer.findUnique({ where: { id: customerId } });
      if (!current) throw new NotFoundException('Customer not found');
      const editingCredit = body.creditLimit !== undefined || body.paymentTermsDays !== undefined || body.creditHold !== undefined;
      if (editingCredit) this.requireAny(actor, 'customers.edit-credit');
      const creditLimitMinor = body.creditLimit === undefined ? current.creditLimitMinor
        : body.creditLimit === '' || body.creditLimit === null ? null : money(body.creditLimit, 'credit limit');
      const paymentTermsDays = body.paymentTermsDays === undefined ? current.paymentTermsDays
        : body.paymentTermsDays === '' || body.paymentTermsDays === null ? null : Number(body.paymentTermsDays);
      const defaultBranchId = body.defaultBranchId === undefined ? current.defaultBranchId
        : body.defaultBranchId ? BigInt(body.defaultBranchId) : null;
      if (defaultBranchId) {
        this.assertBranch(actor, defaultBranchId);
        if (!await tx.branch.findUnique({ where: { id: defaultBranchId } })) throw new BadRequestException('The selected default branch is not available.');
      }
      const defaultCurrency = body.defaultCurrency === undefined ? current.defaultCurrency
        : body.defaultCurrency ? String(body.defaultCurrency).toUpperCase() : null;
      if (defaultCurrency && !await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: defaultCurrency } } })) {
        throw new BadRequestException('The selected default currency is not registered.');
      }
      if (creditLimitMinor !== null && creditLimitMinor < 0n) throw new BadRequestException('Credit limit cannot be negative.');
      if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) throw new BadRequestException('Payment terms must be a whole number of days.');
      const updated = await tx.customer.update({ where: { id: customerId }, data: {
        name: body.name === undefined ? current.name : this.requiredText(body.name, 'Customer name'),
        customerType: body.customerType ?? current.customerType,
        taxNumber: body.taxNumber === undefined ? current.taxNumber : body.taxNumber || null,
        registrationNumber: body.registrationNumber === undefined ? current.registrationNumber : body.registrationNumber || null,
        email: body.email === undefined ? current.email : body.email || null,
        phone: body.phone === undefined ? current.phone : body.phone || null,
        city: body.city === undefined ? current.city : this.requiredText(body.city, 'City'),
        billingAddress: body.billingAddress === undefined ? current.billingAddress : body.billingAddress || null,
        shippingAddress: body.shippingAddress === undefined ? current.shippingAddress : body.shippingAddress || null,
        defaultBranchId,
        creditLimitMinor,
        paymentTermsDays,
        defaultCurrency,
        taxTreatment: body.taxTreatment ?? current.taxTreatment,
        creditHold: body.creditHold === undefined ? current.creditHold : Boolean(body.creditHold),
        active: body.active === undefined ? current.active : Boolean(body.active),
      } });
      await this.audit(tx, actor, 'UPDATE', 'CUSTOMER', customerId, {
        name: updated.name,
        creditLimitMinor: updated.creditLimitMinor?.toString() ?? null,
        paymentTermsDays: updated.paymentTermsDays,
        creditHold: updated.creditHold,
      }, {
        name: current.name,
        creditLimitMinor: current.creditLimitMinor?.toString() ?? null,
        paymentTermsDays: current.paymentTermsDays,
        creditHold: current.creditHold,
      });
      return updated;
    });
  }

  async createSupplier(actor: Actor, body: any) {
    requirePermission(actor, 'purchases.write');
    return this.masterCreate(actor, 'SUPPLIER', (tx) => tx.supplier.create({ data: {
      tenantId: actor.tenantId, code: this.requiredText(body.code, 'Supplier code').toUpperCase(), name: this.requiredText(body.name, 'Supplier name'),
      taxNumber: body.taxNumber || null, email: body.email || null, phone: body.phone || null, address: body.address || null,
      city: this.requiredText(body.city, 'City'), paymentTermsDays: Number(body.paymentTermsDays || 30),
    } }));
  }

  async createCategory(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.write');
    return this.masterCreate(actor, 'ITEM_CATEGORY', (tx) => tx.itemCategory.create({ data: {
      tenantId: actor.tenantId, code: this.requiredText(body.code, 'Category code').toUpperCase(), name: this.requiredText(body.name, 'Category name'),
    } }));
  }

  async createUnit(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.write');
    const precision = Number(body.precision ?? 3);
    if (!Number.isInteger(precision) || precision < 0 || precision > 6) throw new BadRequestException('UOM precision must be between 0 and 6');
    return this.masterCreate(actor, 'UNIT_OF_MEASURE', (tx) => tx.unitOfMeasure.create({ data: {
      tenantId: actor.tenantId, code: this.requiredText(body.code, 'UOM code').toUpperCase(), name: this.requiredText(body.name, 'UOM name'), precision,
    } }));
  }

  async createWarehouse(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.write');
    const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
    return this.masterCreate(actor, 'WAREHOUSE', async (tx) => {
      if (!await tx.branch.findUnique({ where: { id: branchId } })) throw new BadRequestException('Branch is invalid');
      return tx.warehouse.create({ data: { tenantId: actor.tenantId, branchId, code: this.requiredText(body.code, 'Warehouse code').toUpperCase(), name: this.requiredText(body.name, 'Warehouse name') } });
    });
  }

  async createItem(actor: Actor, body: any) {
    requirePermission(actor, 'inventory.write');
    const categoryId = BigInt(body.categoryId || 0), uomId = BigInt(body.uomId || 0);
    return this.masterCreate(actor, 'ITEM', async (tx) => {
      const [category, uom] = await Promise.all([tx.itemCategory.findUnique({ where: { id: categoryId } }), tx.unitOfMeasure.findUnique({ where: { id: uomId } })]);
      if (!category || !uom) throw new BadRequestException('Category and unit of measure are required');
      const taxRateBps = Math.round(Number(body.taxRatePercent ?? 14) * 100);
      if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) throw new BadRequestException('Tax rate must be between 0 and 100');
      return tx.item.create({ data: {
        tenantId: actor.tenantId, categoryId, uomId, sku: this.requiredText(body.sku, 'SKU').toUpperCase(), barcode: this.requiredText(body.barcode, 'Barcode'),
        name: this.requiredText(body.name, 'Item name'), nameAr: this.requiredText(body.nameAr || body.name, 'Arabic item name'),
        purchasePriceMinor: money(body.purchasePrice, 'purchase price'), salePriceMinor: money(body.salePrice, 'sales price'),
        taxRateBps, reorderMilli: quantity(body.reorderLevel || '0', 'reorder level'),
      } });
    });
  }

  async createBankAccount(actor: Actor, body: any) {
    requirePermission(actor, 'banking.write');
    const glAccountId = BigInt(body.glAccountId || 0), type = body.type as BankAccountType;
    if (!Object.values(BankAccountType).includes(type)) throw new BadRequestException('Cash or bank account type is invalid');
    return this.masterCreate(actor, 'BANK_ACCOUNT', async (tx) => {
      const account = await tx.account.findUnique({ where: { id: glAccountId } });
      if (!account || !account.postingAllowed || account.type !== AccountType.ASSET) throw new BadRequestException('An active asset GL account is required');
      return tx.bankAccount.create({ data: {
        tenantId: actor.tenantId, glAccountId, type, code: this.requiredText(body.code, 'Account code').toUpperCase(), name: this.requiredText(body.name, 'Account name'),
        currency: String(body.currency || 'EGP').toUpperCase(), bankName: body.bankName || null, accountNumber: body.accountNumber || null,
      } });
    });
  }

  async createPeriod(actor: Actor, body: any) {
    requirePermission(actor, 'periods.manage');
    const year = Number(body.year), month = Number(body.month);
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('A valid fiscal year and month are required');
    return this.masterCreate(actor, 'FISCAL_PERIOD', (tx) => tx.fiscalPeriod.create({ data: {
      tenantId: actor.tenantId, year, month, name: this.requiredText(body.name, 'Period name'), startDate: this.date(body.startDate, 'start date'), endDate: this.date(body.endDate, 'end date'), status: 'OPEN',
    } }));
  }

  async listDocuments(actor: Actor, type?: string, status?: string) {
    return this.withTenant(actor, async (tx) => {
      const documents = await tx.document.findMany({
        where: {
          ...(type ? { type: type as DocumentType } : {}), ...(status ? { status: status as WorkflowStatus } : {}),
          ...(actor.permissions.includes('*') ? {} : { branchId: { in: actor.branchIds.map(BigInt) } }),
        },
        include: { customer: true, supplier: true, branch: true, warehouse: true, salesEmployee: true, sourceDocument: true, journalEntry: true, _count: { select: { lines: true, targetDocuments: true } } },
        orderBy: { createdAt: 'desc' }, take: 200,
      });
      return this.receivables.decorateInvoices(tx, documents);
    });
  }

  async salesDocuments(actor: Actor, query: any = {}) {
    this.requireAny(actor, 'quotations.view', 'invoices.view', 'sales.write');
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(query.pageSize || 20)));
    const search = String(query.search || '').trim();
    const type = query.type && Object.values(DocumentType).includes(query.type as DocumentType) ? query.type as DocumentType : undefined;
    const status = String(query.status || '') === 'PENDING_APPROVAL' ? WorkflowStatus.SUBMITTED
      : query.status && Object.values(WorkflowStatus).includes(query.status as WorkflowStatus) ? query.status as WorkflowStatus : undefined;
    const allowedBranches = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
    const where: Prisma.DocumentWhereInput = {
      type: type || { in: [...SALES_TYPES] },
      ...(status ? { status } : {}),
      ...(query.branchId ? { branchId: BigInt(query.branchId) } : allowedBranches ? { branchId: { in: allowedBranches } } : {}),
      ...(query.salespersonId ? { salespersonId: BigInt(query.salespersonId) } : {}),
      ...(query.currency ? { currency: String(query.currency).toUpperCase() } : {}),
      ...(query.dateFrom || query.dateTo ? { documentDate: {
        ...(query.dateFrom ? { gte: this.date(query.dateFrom, 'start date') } : {}),
        ...(query.dateTo ? { lte: this.date(query.dateTo, 'end date') } : {}),
      } } : {}),
      ...(search ? { OR: [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { salesEmployee: { name: { contains: search, mode: 'insensitive' } } },
        { sourceDocument: { number: { contains: search, mode: 'insensitive' } } },
        { lines: { some: { item: { name: { contains: search, mode: 'insensitive' } } } } },
      ] } : {}),
    };
    const sortFields: Record<string, Prisma.DocumentOrderByWithRelationInput> = {
      number: { number: query.direction === 'asc' ? 'asc' : 'desc' },
      date: { documentDate: query.direction === 'asc' ? 'asc' : 'desc' },
      total: { totalMinor: query.direction === 'asc' ? 'asc' : 'desc' },
      updated: { updatedAt: query.direction === 'asc' ? 'asc' : 'desc' },
    };
    return this.withTenant(actor, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.document.count({ where }),
        tx.document.findMany({
          where,
          include: { customer: true, branch: true, warehouse: true, salesEmployee: true, sourceDocument: true, targetDocuments: true },
          orderBy: sortFields[String(query.sort || 'updated')] || sortFields.updated,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const decorated = await this.receivables.decorateInvoices(tx, rows);
      return {
        rows: decorated.map((row) => ({
          ...row,
          customer: row.customer ? this.customerForActor(actor, row.customer) : null,
          editState: documentEditState(row.status, Boolean(row.journalEntryId || row.postedAt || row.paidMinor > 0n)),
        })),
        pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      };
    });
  }

  async salesOverview(actor: Actor) {
    this.requireAny(actor, 'quotations.view', 'sales.write');
    return this.withTenant(actor, async (tx) => {
      const branchScope = actor.permissions.includes('*') ? {} : { branchId: { in: actor.branchIds.map(BigInt) } };
      const now = new Date();
      const soon = new Date(now.valueOf() + 14 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [awaitingApproval, expiringSoon, invoices, monthlyInvoices, recent, recentCustomers, activity] = await Promise.all([
        tx.document.count({ where: { ...branchScope, type: DocumentType.QUOTATION, status: WorkflowStatus.SUBMITTED } }),
        tx.document.count({ where: { ...branchScope, type: DocumentType.QUOTATION, status: { in: [WorkflowStatus.DRAFT, WorkflowStatus.SUBMITTED, WorkflowStatus.APPROVED] }, dueDate: { gte: now, lte: soon } } }),
        tx.document.findMany({ where: { ...branchScope, type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED } }),
        tx.document.findMany({ where: { ...branchScope, type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED, documentDate: { gte: monthStart } } }),
        tx.document.findMany({ where: { ...branchScope, type: { in: [...SALES_TYPES] } }, include: { customer: true, branch: true, salesEmployee: true }, orderBy: { updatedAt: 'desc' }, take: 12 }),
        tx.customer.findMany({ where: {
          active: true,
          ...(actor.permissions.includes('*') ? {} : { defaultBranchId: { in: actor.branchIds.map(BigInt) } }),
        }, include: { defaultBranch: true }, orderBy: { id: 'desc' }, take: 6 }),
        tx.auditEvent.findMany({ where: { entityType: { in: ['CUSTOMER', 'DOCUMENT'] } }, include: { user: publicUser }, orderBy: { createdAt: 'desc' }, take: 8 }),
      ]);
      const invoiceSettlements = await this.receivables.settlements(tx, invoices, now);
      return {
        metrics: {
          awaitingApproval,
          expiringSoon,
          unpaidMinor: invoices.reduce((sum, invoice) => sum + invoiceSettlements.get(invoice.id.toString())!.baseRemainingMinor, 0n),
          overdueMinor: invoices.filter((invoice) => invoice.dueDate && invoice.dueDate < now).reduce((sum, invoice) => sum + invoiceSettlements.get(invoice.id.toString())!.baseRemainingMinor, 0n),
          salesMonthMinor: monthlyInvoices.reduce((sum, invoice) => sum + receivableBaseMinor(invoice.totalMinor, invoice.exchangeRateMicros), 0n),
        },
        recent: recent.map((document) => ({ ...document, customer: document.customer ? this.customerForActor(actor, document.customer) : null })),
        recentCustomers: recentCustomers.map((customer) => this.customerForActor(actor, customer)),
        activity,
      };
    });
  }

  async salesEmployees(actor: Actor, branchId?: string) {
    this.requireAny(actor, 'employees.sales.read', 'sales.write');
    if (branchId) this.assertBranch(actor, BigInt(branchId));
    return this.withTenant(actor, async (tx) => {
      const employees = await tx.employee.findMany({
        where: { active: true, OR: [{ salesEligible: true }, { department: { code: 'SALES', active: true } }] },
        include: { department: true },
        orderBy: { name: 'asc' },
      });
      return employees.filter((employee) => {
        const branchIds = employee.branchIds as string[];
        return (!branchId || branchIds.includes(branchId)) && (actor.permissions.includes('*') || branchIds.some((id) => actor.branchIds.includes(id)));
      });
    });
  }

  async employees(actor: Actor, query: any = {}) {
    this.requireAny(actor, 'employees.sales.read', 'sales.write');
    const search = String(query.search || '').trim();
    return this.withTenant(actor, (tx) => tx.employee.findMany({
      where: {
        ...(query.status === 'INACTIVE' ? { active: false } : query.status === 'ALL' ? {} : { active: true }),
        ...(query.departmentId ? { departmentId: BigInt(query.departmentId) } : {}),
        ...(search ? { OR: [{ code: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }, { jobTitle: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { department: true },
      orderBy: { name: 'asc' },
      take: 100,
    }));
  }

  async exchangeRate(actor: Actor, currency: string, dateValue?: string) {
    const targetCurrency = String(currency || '').toUpperCase();
    if (!targetCurrency) throw new BadRequestException('Currency is required.');
    return this.withTenant(actor, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: targetCurrency } } });
      if (!currencyRecord || !currencyRecord.active) throw new BadRequestException(`${targetCurrency} is not a registered active currency.`);
      const rateDate = dateValue ? this.date(dateValue, 'rate date') : new Date();
      if (targetCurrency === tenant.baseCurrency) return { baseCurrency: tenant.baseCurrency, targetCurrency, rateMicros: '1000000', rate: '1.000000', rateDate: rateDate.toISOString().slice(0, 10), source: 'BASE_CURRENCY' };
      const rate = await tx.currencyRate.findFirst({
        where: { baseCurrency: tenant.baseCurrency, targetCurrency, rateDate: { lte: rateDate } },
        orderBy: { rateDate: 'desc' },
      });
      if (!rate) throw new BadRequestException(`No exchange rate was found for ${targetCurrency} on ${rateDate.toISOString().slice(0, 10)}.`);
      return {
        baseCurrency: tenant.baseCurrency,
        targetCurrency,
        rateMicros: rate.rateMicros,
        rate: `${rate.rateMicros / 1_000_000n}.${(rate.rateMicros % 1_000_000n).toString().padStart(6, '0')}`,
        rateDate: rate.rateDate,
        source: rate.source,
      };
    });
  }

  async documentDetail(actor: Actor, id: bigint) {
    return this.withTenant(actor, async (tx) => {
      const document = await tx.document.findUnique({ where: { id }, include: {
        customer: { include: { defaultBranch: true } }, supplier: true, branch: true, warehouse: true, destinationWarehouse: true, salesEmployee: { include: { department: true } },
        sourceDocument: true, targetDocuments: true, lines: { include: { item: true, uom: true, targetLines: { include: { document: true } } } },
        journalEntry: { include: { lines: { include: { account: true } } } },
        allocations: { include: { payment: true } },
        createdBy: publicUser, submittedBy: publicUser, approvedBy: publicUser, postedBy: publicUser,
      } });
      if (!document) throw new NotFoundException('Document not found');
      if (SALES_TYPES.has(document.type)) {
        const invoiceLike = [DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE].includes(document.type as any);
        this.requireAny(actor, invoiceLike ? 'invoices.view' : 'quotations.view', 'sales.write', 'approvals.read');
      } else if (PURCHASE_TYPES.has(document.type)) this.requireAny(actor, 'purchases.write', 'approvals.read');
      else this.requireAny(actor, 'inventory.write', 'approvals.read');
      this.assertBranch(actor, document.branchId);
      const stockMovements = await tx.stockMovement.findMany({ where: { sourceType: { startsWith: document.type }, sourceId: document.id }, include: { item: true, warehouse: true } });
      const audit = await tx.auditEvent.findMany({ where: { entityType: 'DOCUMENT', entityId: id.toString() }, include: { user: publicUser }, orderBy: { createdAt: 'desc' } });
      const approvals = await tx.approvalEvent.findMany({ where: { entityType: 'DOCUMENT', entityId: id }, include: { actor: publicUser }, orderBy: { createdAt: 'asc' } });
      const [decorated] = await this.receivables.decorateInvoices(tx, [document]);
      return {
        ...decorated,
        customer: document.customer ? this.customerForActor(actor, document.customer) : null,
        journalEntry: actor.permissions.includes('*') || actor.permissions.includes('invoices.view-accounting') ? document.journalEntry : null,
        editState: documentEditState(document.status, Boolean(document.journalEntryId || document.postedAt || document.paidMinor > 0n || stockMovements.length)),
        stockMovements,
        audit,
        approvals,
        accountingEffect: actor.permissions.includes('*') || actor.permissions.includes('invoices.view-accounting')
          ? document.journalEntryId ? 'Posted journal linked below' : 'No general-ledger impact for this document type'
          : 'Accounting details are restricted.',
      };
    });
  }

  async createDocument(actor: Actor, body: any) {
    const type = body.type as DocumentType;
    if (!Object.values(DocumentType).includes(type)) throw new BadRequestException('Document type is invalid');
    requirePermission(actor, SALES_TYPES.has(type) ? 'sales.write' : PURCHASE_TYPES.has(type) ? 'purchases.write' : 'inventory.write');
    return this.withTenant(actor, (tx) => this.createDocumentTx(tx, actor, type, body));
  }

  async updateDocument(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const current = await tx.document.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Document not found');
      if (SALES_TYPES.has(current.type)) this.requireAny(actor, 'quotations.edit', 'sales.write');
      else requirePermission(actor, PURCHASE_TYPES.has(current.type) ? 'purchases.write' : 'inventory.write');
      const hasStock = await tx.stockMovement.count({ where: { sourceType: { startsWith: current.type }, sourceId: current.id } });
      const state = documentEditState(current.status, Boolean(current.journalEntryId || current.postedAt || current.paidMinor > 0n || hasStock));
      if (!state.editable) throw new BadRequestException(state.reason || 'This document is locked.');
      if (current.sourceDocumentId && body.lines !== undefined) {
        throw new BadRequestException('Lines on a source-linked document cannot be replaced. Create a new conversion to preserve source-line traceability.');
      }

      const branchId = BigInt(body.branchId || current.branchId);
      const warehouseId = body.warehouseId === undefined ? current.warehouseId : body.warehouseId ? BigInt(body.warehouseId) : null;
      await this.assertBranchWarehouse(tx, actor, branchId, warehouseId);
      const customerId = body.customerId === undefined ? current.customerId : body.customerId ? BigInt(body.customerId) : null;
      if (SALES_TYPES.has(current.type) && !customerId) throw new BadRequestException('Customer is required.');
      if (customerId && !await tx.customer.findFirst({ where: { id: customerId, active: true } })) throw new BadRequestException('The selected customer is not available.');

      let salespersonId = body.salespersonId === undefined ? current.salespersonId : body.salespersonId ? BigInt(body.salespersonId) : null;
      let salesperson = current.salesperson;
      if (SALES_TYPES.has(current.type)) {
        if (!salespersonId && (current.type === DocumentType.QUOTATION || current.type === DocumentType.SALES_ORDER)) throw new BadRequestException('Select an active Sales employee.');
        if (salespersonId) {
          const employee = await tx.employee.findUnique({ where: { id: salespersonId }, include: { department: true } });
          const branchIds = employee?.branchIds as string[] | undefined;
          if (!employee || !employee.active || (!employee.salesEligible && employee.department.code !== 'SALES')) throw new BadRequestException('The selected employee is not an active Sales employee.');
          if (!branchIds?.includes(branchId.toString())) throw new BadRequestException('The selected salesperson is not assigned to this branch.');
          salesperson = employee.name;
        }
      }

      const documentDate = body.documentDate ? this.date(body.documentDate, 'document date') : current.documentDate;
      const dueDate = body.dueDate === undefined ? current.dueDate : body.dueDate ? this.date(body.dueDate, 'due date') : null;
      if (dueDate && dueDate < documentDate) throw new BadRequestException('Due or expiry date cannot be before the document date.');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const currency = String(body.currency || current.currency || tenant.baseCurrency).toUpperCase();
      const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: currency } } });
      if (!currencyRecord?.active) throw new BadRequestException(`${currency} is not a registered active currency.`);
      let exchangeRateMicros = 1_000_000n;
      let exchangeRateDate: Date | null = documentDate;
      let manualExchangeRate = false;
      if (currency !== tenant.baseCurrency) {
        if (body.manualExchangeRate) {
          this.requireAny(actor, 'exchange-rates.override');
          exchangeRateMicros = parseFixed(body.exchangeRate, 6, 'exchange rate');
          exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : documentDate;
          manualExchangeRate = true;
          if (!String(body.exchangeRateOverrideReason || '').trim()) throw new BadRequestException('An exchange-rate override reason is required.');
        } else {
          const rate = await tx.currencyRate.findFirst({ where: { baseCurrency: tenant.baseCurrency, targetCurrency: currency, rateDate: { lte: documentDate } }, orderBy: { rateDate: 'desc' } });
          if (!rate) throw new BadRequestException(`No exchange rate was found for ${currency} on ${documentDate.toISOString().slice(0, 10)}.`);
          exchangeRateMicros = rate.rateMicros;
          exchangeRateDate = rate.rateDate;
        }
      }

      let totals = { subtotal: current.subtotalMinor, discount: current.discountMinor, tax: current.taxMinor, total: current.totalMinor };
      let lineCreates: any[] | undefined;
      let priceOverride = false;
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('At least one line is required.');
        const itemIds = body.lines.map((line: any) => BigInt(line.itemId || 0));
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
        const itemMap = new Map(items.map((item) => [item.id.toString(), item]));
        let subtotal = 0n, discount = 0n, tax = 0n, total = 0n;
        lineCreates = body.lines.map((line: any, index: number) => {
          const item = itemMap.get(String(line.itemId));
          if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid.`);
          const lineQuantity = quantity(line.quantity, `line ${index + 1} quantity`);
          const standardPrice = currency === tenant.baseCurrency ? item.salePriceMinor : roundDiv(item.salePriceMinor * 1_000_000n, exchangeRateMicros);
          const unitPrice = line.unitPrice === undefined ? standardPrice : money(line.unitPrice, `line ${index + 1} unit price`);
          if (unitPrice !== standardPrice && !actor.permissions.includes('*') && !actor.permissions.includes('prices.override')) throw new ForbiddenException(`Line ${index + 1}: you do not have permission to override the selling price.`);
          if (unitPrice !== standardPrice) priceOverride = true;
          const lineDiscount = money(line.discount || '0', `line ${index + 1} discount`);
          const taxMode = String(body.taxMode || current.taxMode);
          const calculated = calculateDocumentLine(lineQuantity, unitPrice, lineDiscount, BigInt(line.taxRateBps ?? item.taxRateBps), taxMode);
          subtotal += taxMode === 'INCLUSIVE' ? calculated.taxableMinor + lineDiscount : calculated.grossMinor;
          discount += lineDiscount;
          tax += calculated.taxMinor;
          total += calculated.totalMinor;
          return {
            tenant: { connect: { id: actor.tenantId } },
            item: { connect: { id: item.id } },
            uom: { connect: { id: item.uomId } },
            description: String(line.description || item.name),
            quantityMilli: lineQuantity,
            unitPriceMinor: unitPrice,
            discountMinor: lineDiscount,
            taxableMinor: calculated.taxableMinor,
            taxMinor: calculated.taxMinor,
            totalMinor: calculated.totalMinor,
            unitCostMinor: item.purchasePriceMinor,
          };
        });
        totals = { subtotal, discount, tax, total };
        if (priceOverride && !String(body.priceOverrideReason || '').trim()) throw new BadRequestException('A price override reason is required.');
        await tx.documentLine.deleteMany({ where: { documentId: id } });
      }

      const updated = await tx.document.update({ where: { id }, data: {
        branchId,
        warehouseId,
        customerId,
        documentDate,
        dueDate,
        currency,
        exchangeRateMicros,
        exchangeRateDate,
        manualExchangeRate,
        priceList: body.priceList === undefined ? current.priceList : body.priceList || null,
        taxMode: body.taxMode || current.taxMode,
        paymentTerms: body.paymentTerms === undefined ? current.paymentTerms : body.paymentTerms || null,
        salespersonId,
        salesperson,
        notes: body.notes === undefined ? current.notes : body.notes || null,
        subtotalMinor: totals.subtotal,
        discountMinor: totals.discount,
        taxMinor: totals.tax,
        totalMinor: totals.total,
        ...(lineCreates ? { lines: { create: lineCreates } } : {}),
      }, include: { lines: true } });
      await this.audit(tx, actor, 'UPDATE', 'DOCUMENT', id, {
        number: updated.number,
        status: updated.status,
        totalMinor: updated.totalMinor.toString(),
      }, {
        number: current.number,
        status: current.status,
        totalMinor: current.totalMinor.toString(),
      });
      if (manualExchangeRate) await this.audit(tx, actor, 'EXCHANGE_RATE_OVERRIDE', 'DOCUMENT', id, {
        number: updated.number,
        exchangeRateMicros: exchangeRateMicros.toString(),
        reason: String(body.exchangeRateOverrideReason || 'Manual rate authorized during document update'),
      });
      if (priceOverride) await this.audit(tx, actor, 'PRICE_OVERRIDE', 'DOCUMENT', id, {
        number: updated.number,
        reason: String(body.priceOverrideReason || 'Authorized line price override during document update'),
      });
      return updated;
    });
  }

  private async createDocumentTx(tx: Tx, actor: Actor, type: DocumentType, body: any, trustedSourceConversion = false) {
    const branchId = BigInt(body.branchId || 0);
    const warehouseId = body.warehouseId ? BigInt(body.warehouseId) : null;
    const destinationWarehouseId = body.destinationWarehouseId ? BigInt(body.destinationWarehouseId) : null;
    await this.assertBranchWarehouse(tx, actor, branchId, warehouseId);
    this.assertWarehouse(actor, destinationWarehouseId);
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw new BadRequestException('At least one line is required');
    if (SALES_TYPES.has(type) && !body.customerId) throw new BadRequestException('Customer is required');
    if (PURCHASE_TYPES.has(type) && type !== DocumentType.PURCHASE_REQUEST && !body.supplierId) throw new BadRequestException('Supplier is required');
    if (new Set<DocumentType>([DocumentType.DELIVERY_NOTE, DocumentType.SALES_RETURN, DocumentType.GOODS_RECEIPT, DocumentType.PURCHASE_RETURN, DocumentType.WAREHOUSE_TRANSFER, DocumentType.INVENTORY_ADJUSTMENT, DocumentType.STOCK_COUNT]).has(type) && !warehouseId) throw new BadRequestException('Warehouse is required');
    if (type === DocumentType.WAREHOUSE_TRANSFER && (!destinationWarehouseId || destinationWarehouseId === warehouseId)) throw new BadRequestException('A different destination warehouse is required');
    if (destinationWarehouseId && !await tx.warehouse.findUnique({ where: { id: destinationWarehouseId } })) throw new BadRequestException('The destination warehouse is not available.');
    if (body.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: BigInt(body.customerId) } });
      if (!customer || !customer.active) throw new BadRequestException('The selected customer is not available.');
      if (customer.creditHold && SALES_TYPES.has(type)) throw new BadRequestException('This customer is on credit hold. Ask an authorized manager to review the account.');
    }
    const requiredSource: Partial<Record<DocumentType, DocumentType[]>> = {
      DELIVERY_NOTE: [DocumentType.SALES_ORDER], SALES_INVOICE: [DocumentType.DELIVERY_NOTE], SALES_RETURN: [DocumentType.SALES_INVOICE], CREDIT_NOTE: [DocumentType.SALES_INVOICE],
      GOODS_RECEIPT: [DocumentType.PURCHASE_ORDER], PURCHASE_BILL: [DocumentType.GOODS_RECEIPT], PURCHASE_RETURN: [DocumentType.GOODS_RECEIPT, DocumentType.PURCHASE_BILL],
    };
    let sourceDocument: Awaited<ReturnType<Tx['document']['findUnique']>> = null;
    if (requiredSource[type]) {
      if (!trustedSourceConversion) throw new BadRequestException(`${type} must be created through the source-document conversion workflow.`);
      if (!body.sourceDocumentId) throw new BadRequestException(`${type} must be created by converting an approved source document`);
      sourceDocument = await tx.document.findUnique({ where: { id: BigInt(body.sourceDocumentId) } });
      if (!sourceDocument || !requiredSource[type]!.includes(sourceDocument.type) || (sourceDocument.status !== WorkflowStatus.APPROVED && sourceDocument.status !== WorkflowStatus.POSTED)) throw new BadRequestException(`${type} source type or status is invalid`);
    }
    const date = this.date(body.documentDate || new Date().toISOString().slice(0, 10), 'document date');
    const dueDate = body.dueDate ? this.date(body.dueDate, 'due date') : null;
    if (dueDate && dueDate < date) throw new BadRequestException('Due or expiry date cannot be before the document date.');
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
    const documentCurrency = String(body.currency || tenant.baseCurrency).toUpperCase();
    const currencyRecord = await tx.currency.findUnique({ where: { tenantId_code: { tenantId: actor.tenantId, code: documentCurrency } } });
    if (!currencyRecord || !currencyRecord.active) throw new BadRequestException(`${documentCurrency} is not a registered active currency.`);
    let exchangeRateMicros = 1_000_000n;
    let exchangeRateDate: Date | null = date;
    let manualExchangeRate = false;
    if (documentCurrency !== tenant.baseCurrency) {
      if (body.systemExchangeRateMicros) {
        exchangeRateMicros = BigInt(body.systemExchangeRateMicros);
        exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : date;
        if (exchangeRateMicros <= 0n) throw new BadRequestException('Exchange rate must be greater than zero.');
      } else if (body.manualExchangeRate) {
        this.requireAny(actor, 'exchange-rates.override');
        exchangeRateMicros = parseFixed(body.exchangeRate, 6, 'exchange rate');
        if (exchangeRateMicros <= 0n) throw new BadRequestException('Exchange rate must be greater than zero.');
        exchangeRateDate = body.exchangeRateDate ? this.date(body.exchangeRateDate, 'exchange rate date') : date;
        manualExchangeRate = true;
        if (!String(body.exchangeRateOverrideReason || '').trim()) throw new BadRequestException('An exchange-rate override reason is required.');
      } else {
        const rate = await tx.currencyRate.findFirst({
          where: { baseCurrency: tenant.baseCurrency, targetCurrency: documentCurrency, rateDate: { lte: date } },
          orderBy: { rateDate: 'desc' },
        });
        if (!rate) throw new BadRequestException(`No exchange rate was found for ${documentCurrency} on ${date.toISOString().slice(0, 10)}.`);
        exchangeRateMicros = rate.rateMicros;
        exchangeRateDate = rate.rateDate;
      }
    }
    let salespersonId: bigint | null = body.salespersonId ? BigInt(body.salespersonId) : null;
    let salespersonName: string | null = null;
    if (SALES_TYPES.has(type)) {
      if (!salespersonId && (type === DocumentType.QUOTATION || type === DocumentType.SALES_ORDER)) throw new BadRequestException('Select an active Sales employee.');
      if (salespersonId) {
        const employee = await tx.employee.findUnique({ where: { id: salespersonId }, include: { department: true } });
        const branchIds = employee?.branchIds as string[] | undefined;
        if (!employee || !employee.active || (!employee.salesEligible && employee.department.code !== 'SALES')) {
          throw new BadRequestException('The selected employee is not an active Sales employee.');
        }
        if (!branchIds?.includes(branchId.toString())) throw new BadRequestException(`The selected salesperson is not assigned to this branch.`);
        salespersonName = employee.name;
      }
    }
    if (!['EXCLUSIVE', 'INCLUSIVE', 'EXEMPT'].includes(String(body.taxMode || 'EXCLUSIVE'))) throw new BadRequestException('Tax mode is invalid');
    const itemIds = body.lines.map((line: any) => BigInt(line.itemId || 0));
    const items = await tx.item.findMany({ where: { id: { in: itemIds }, active: true } });
    const itemMap = new Map(items.map((item) => [item.id.toString(), item]));
    const sourceLineIds: Array<bigint | null> = body.lines.map((line: any) => line.sourceLineId ? BigInt(line.sourceLineId) : null);
    const sourceLines = sourceDocument
      ? await tx.documentLine.findMany({ where: { documentId: sourceDocument.id, id: { in: sourceLineIds.filter((lineId): lineId is bigint => lineId !== null) } } })
      : [];
    const sourceLineMap = new Map(sourceLines.map((line) => [line.id.toString(), line]));
    if (sourceDocument && (sourceLines.length !== body.lines.length
      || body.lines.some((line: any) => sourceLineMap.get(String(line.sourceLineId))?.itemId !== BigInt(line.itemId || 0)))) {
      throw new BadRequestException(`${type} lines must preserve valid source-line and item relationships.`);
    }
    const countBalances = type === DocumentType.STOCK_COUNT && warehouseId
      ? await tx.stockBalance.findMany({ where: { warehouseId, itemId: { in: itemIds } } })
      : [];
    const countBalanceMap = new Map(countBalances.map((balance) => [balance.itemId.toString(), balance.quantityMilli]));
    let subtotal = 0n, discount = 0n, tax = 0n, total = 0n, priceOverride = false;
    const lines = body.lines.map((line: any, index: number) => {
      const item = itemMap.get(String(line.itemId));
      if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid`);
      const systemQuantity = type === DocumentType.STOCK_COUNT ? (countBalanceMap.get(item.id.toString()) || 0n) : null;
      const countedQuantity = type === DocumentType.STOCK_COUNT ? quantity(line.countedQuantity ?? line.quantity, `line ${index + 1} counted quantity`) : null;
      const variance = systemQuantity === null || countedQuantity === null ? null : countedQuantity - systemQuantity;
      const qty = variance === null ? quantity(line.quantity, `line ${index + 1} quantity`) : (variance < 0n ? -variance : variance);
      if (qty <= 0n) throw new BadRequestException(`Line ${index + 1}: quantity must be greater than zero`);
      const baseStandardPrice = PURCHASE_TYPES.has(type) ? item.purchasePriceMinor : item.salePriceMinor;
      const standardPrice = documentCurrency === tenant.baseCurrency ? baseStandardPrice : roundDiv(baseStandardPrice * 1_000_000n, exchangeRateMicros);
      const unitPrice = line.unitPrice === undefined ? standardPrice : money(line.unitPrice, `line ${index + 1} unit price`);
      if (SALES_TYPES.has(type) && unitPrice !== standardPrice && !trustedSourceConversion && !actor.permissions.includes('*') && !actor.permissions.includes('prices.override')) {
        throw new ForbiddenException(`Line ${index + 1}: you do not have permission to override the selling price.`);
      }
      if (SALES_TYPES.has(type) && unitPrice !== standardPrice) priceOverride = true;
      const lineDiscount = money(line.discount || '0', `line ${index + 1} discount`);
      const rate = BigInt(line.taxRateBps ?? item.taxRateBps);
      const taxMode = String(body.taxMode || 'EXCLUSIVE');
      const calculated = calculateDocumentLine(qty, unitPrice, lineDiscount, rate, taxMode);
      subtotal += taxMode === 'INCLUSIVE' ? calculated.taxableMinor + lineDiscount : calculated.grossMinor;
      discount += lineDiscount;
      tax += calculated.taxMinor;
      total += calculated.totalMinor;
      return {
        tenantId: actor.tenantId, itemId: item.id, uomId: item.uomId, sourceLineId: line.sourceLineId ? BigInt(line.sourceLineId) : null,
        description: String(variance === null ? (line.description || item.name) : `${variance < 0n ? 'Decrease' : 'Increase'} stock-count variance`), quantityMilli: qty,
        systemQuantityMilli: systemQuantity, countedQuantityMilli: countedQuantity, unitPriceMinor: unitPrice,
        discountMinor: lineDiscount, taxableMinor: calculated.taxableMinor, taxMinor: calculated.taxMinor, totalMinor: calculated.totalMinor,
        unitCostMinor: item.purchasePriceMinor,
      };
    });
    if (priceOverride && !trustedSourceConversion && !String(body.priceOverrideReason || '').trim()) throw new BadRequestException('A price override reason is required.');
    const number = await this.sequence(tx, actor, branchId, type, date);
    const document = await tx.document.create({ data: {
      tenantId: actor.tenantId, type, number, branchId, warehouseId, destinationWarehouseId,
      customerId: body.customerId ? BigInt(body.customerId) : null, supplierId: body.supplierId ? BigInt(body.supplierId) : null,
      sourceDocumentId: body.sourceDocumentId ? BigInt(body.sourceDocumentId) : null, documentDate: date,
      dueDate, currency: documentCurrency,
      exchangeRateMicros, exchangeRateDate, manualExchangeRate, priceList: body.priceList || null,
      taxMode: String(body.taxMode || 'EXCLUSIVE'), paymentTerms: body.paymentTerms || null, salesperson: salespersonName || body.salesperson || null, salespersonId,
      notes: body.notes || null, attachments: Array.isArray(body.attachments) ? body.attachments : [], subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total,
      createdById: actor.userId, lines: { create: lines },
    }, include: { lines: true } });
    await this.audit(tx, actor, 'CREATE', 'DOCUMENT', document.id, { number, type, totalMinor: total.toString() });
    if (manualExchangeRate) await this.audit(tx, actor, 'EXCHANGE_RATE_OVERRIDE', 'DOCUMENT', document.id, {
      number,
      currency: documentCurrency,
      baseCurrency: tenant.baseCurrency,
      exchangeRateMicros: exchangeRateMicros.toString(),
      reason: String(body.exchangeRateOverrideReason || 'Manual rate authorized during document creation'),
    });
    if (priceOverride) await this.audit(tx, actor, 'PRICE_OVERRIDE', 'DOCUMENT', document.id, {
      number,
      reason: trustedSourceConversion ? String(body.priceOverrideReason || 'Preserved from approved source document') : String(body.priceOverrideReason),
    });
    return document;
  }

  async convertDocument(actor: Actor, id: bigint, body: any) {
    return this.withTenant(actor, async (tx) => {
      const source = await tx.document.findUnique({ where: { id }, include: { lines: { include: { targetLines: { include: { document: true } } } } } });
      if (!source) throw new NotFoundException('Source document not found');
      this.assertBranch(actor, source.branchId);
      if (source.status !== WorkflowStatus.APPROVED && source.status !== WorkflowStatus.POSTED) throw new BadRequestException('Source document must be approved or posted');
      const targetType = body.targetType as DocumentType;
      if (!CONVERSIONS[source.type]?.includes(targetType)) throw new BadRequestException(`Cannot convert ${source.type} to ${targetType}`);
      const requested: Map<string, bigint> | null = Array.isArray(body.lines) ? new Map<string, bigint>(body.lines.map((line: any) => [String(line.sourceLineId), quantity(line.quantity)])) : null;
      const lines = source.lines.map((line) => {
        const consumed = line.targetLines.filter((target) => target.document.status !== WorkflowStatus.REJECTED && target.document.status !== WorkflowStatus.CANCELLED).reduce((sum, target) => sum + target.quantityMilli, 0n);
        const remaining = line.quantityMilli - consumed;
        const qty = requested?.get(line.id.toString()) ?? remaining;
        if (qty <= 0n || qty > remaining) throw new BadRequestException(`Source line ${line.id}: requested quantity exceeds remaining ${remaining}`);
        const convertedDiscount = roundDiv(line.discountMinor * qty, line.quantityMilli);
        return { itemId: line.itemId.toString(), sourceLineId: line.id.toString(), quantity: `${qty / 1000n}.${(qty % 1000n).toString().padStart(3, '0')}`, unitPrice: `${line.unitPriceMinor / 100n}.${(line.unitPriceMinor % 100n).toString().padStart(2, '0')}`, discount: `${convertedDiscount / 100n}.${(convertedDiscount % 100n).toString().padStart(2, '0')}` };
      });
      const target = await this.createDocumentTx(tx, actor, targetType, {
        ...body, type: targetType, branchId: source.branchId.toString(), warehouseId: body.warehouseId || source.warehouseId?.toString(),
        customerId: source.customerId?.toString(), supplierId: body.supplierId || source.supplierId?.toString(), sourceDocumentId: source.id.toString(),
        salespersonId: source.salespersonId?.toString(), currency: source.currency, systemExchangeRateMicros: source.exchangeRateMicros.toString(),
        exchangeRateDate: source.exchangeRateDate?.toISOString().slice(0, 10),
        taxMode: source.taxMode,
        paymentTerms: source.paymentTerms,
        notes: source.notes,
        dueDate: body.dueDate,
        documentDate: body.documentDate || new Date().toISOString().slice(0, 10),
        priceOverrideReason: `Preserved from approved source ${source.number}`,
        lines,
      }, true);
      await this.receivables.assertCreditWithinRemaining(tx, target);
      await this.audit(tx, actor, 'CONVERT', 'DOCUMENT', source.id, { targetId: target.id.toString(), targetNumber: target.number, targetType });
      return target;
    });
  }

  async workflow(actor: Actor, id: bigint, action: 'submit' | 'approve' | 'reject' | 'request-changes', body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const document = await tx.document.findUnique({ where: { id } });
      if (!document) throw new NotFoundException('Document not found');
      this.assertBranch(actor, document.branchId);
      const now = new Date();
      if (action === 'submit') {
        if (SALES_TYPES.has(document.type)) this.requireAny(actor, 'quotations.submit', 'sales.write');
        else requirePermission(actor, PURCHASE_TYPES.has(document.type) ? 'purchases.write' : 'inventory.write');
        if (document.status !== WorkflowStatus.DRAFT && document.status !== WorkflowStatus.REJECTED) throw new BadRequestException('Only a draft or returned document can be submitted.');
        const updated = await tx.document.update({ where: { id }, data: { status: WorkflowStatus.SUBMITTED, submittedById: actor.userId, submittedAt: now, approvedById: null, approvedAt: null } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: 'SUBMIT', actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, 'SUBMIT', 'DOCUMENT', id, { approvalReference: updated.number });
        return updated;
      }
      if (action === 'request-changes') this.requireAny(actor, 'approvals.request-changes', 'approvals.act');
      else requirePermission(actor, 'approvals.act');
      if (document.status !== WorkflowStatus.SUBMITTED) throw new BadRequestException('Only a submitted document can be approved or rejected');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      if (action === 'approve' && tenant.makerChecker && document.submittedById === actor.userId) throw new ForbiddenException('Maker-checker control: submitter cannot approve this document');
      const comment = String(body.comment || '').trim();
      if ((action === 'reject' || action === 'request-changes') && !comment) {
        throw new BadRequestException(action === 'reject' ? 'A rejection reason is required.' : 'Describe the changes required before sending the document back.');
      }
      const status = action === 'approve' ? WorkflowStatus.APPROVED : WorkflowStatus.REJECTED;
      const updated = await tx.document.update({ where: { id }, data: { status, ...(action === 'approve' ? { approvedById: actor.userId, approvedAt: now } : {}) } });
      const eventAction = action === 'request-changes' ? 'REQUEST_CHANGES' : action.toUpperCase();
      await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: eventAction, actorId: actor.userId, comment: comment || null } });
      await this.audit(tx, actor, eventAction, 'DOCUMENT', id, { approvalReference: updated.number, comment: comment || null });
      return updated;
    });
  }

  async commentDocument(actor: Actor, id: bigint, body: any = {}) {
    requirePermission(actor, 'approvals.read');
    return this.withTenant(actor, async (tx) => {
      const document = await tx.document.findUnique({ where: { id } });
      if (!document) throw new NotFoundException('Document not found');
      this.assertBranch(actor, document.branchId);
      if (document.status !== WorkflowStatus.SUBMITTED) throw new BadRequestException('Comments can only be added while a document is awaiting approval.');
      const comment = String(body.comment || '').trim();
      if (!comment) throw new BadRequestException('A comment is required.');
      const event = await tx.approvalEvent.create({
        data: { tenantId: actor.tenantId, entityType: 'DOCUMENT', entityId: id, action: 'COMMENT', actorId: actor.userId, comment },
        include: { actor: { select: { id: true, name: true, email: true } } },
      });
      await this.audit(tx, actor, 'APPROVAL_COMMENT', 'DOCUMENT', id, { approvalReference: document.number, comment });
      return event;
    });
  }

  async postDocument(actor: Actor, id: bigint) {
    requirePermission(actor, 'posting.execute');
    return this.withTenant(actor, async (tx) => {
      const doc = await tx.document.findUnique({ where: { id }, include: { lines: { include: { item: true } }, sourceDocument: true } });
      if (!doc) throw new NotFoundException('Document not found');
      this.assertBranch(actor, doc.branchId); this.assertWarehouse(actor, doc.warehouseId);
      if (doc.status !== WorkflowStatus.APPROVED) throw new BadRequestException('Only an approved document can be posted');
      await this.assertOpenPeriod(tx, actor, doc.documentDate);
      await this.receivables.assertCreditWithinRemaining(tx, doc);
      let journal: any = null;
      let cost = 0n;
      const journalLines: JournalLineInput[] = [];
      if (doc.type === DocumentType.DELIVERY_NOTE) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          await tx.documentLine.update({ where: { id: line.id }, data: { unitCostMinor: movement.unitCostMinor, costMinor: movement.totalCostMinor } });
        }
        journalLines.push({ code: '5000', debit: cost, description: `COGS ${doc.number}` }, { code: '1200', credit: cost, description: `Inventory issue ${doc.number}` });
      } else if (doc.type === DocumentType.SALES_INVOICE) {
        const amounts = receivableJournalAmounts(doc.totalMinor, doc.taxMinor, doc.exchangeRateMicros);
        journalLines.push({ code: '1100', debit: amounts.receivableMinor, description: `Customer receivable ${doc.number}` }, { code: '4000', credit: amounts.revenueBaseMinor, description: `Revenue ${doc.number}` });
        if (amounts.taxBaseMinor) journalLines.push({ code: '2200', credit: amounts.taxBaseMinor, description: `Output VAT ${doc.number}` });
      } else if (doc.type === DocumentType.SALES_RETURN || doc.type === DocumentType.CREDIT_NOTE) {
        const amounts = receivableJournalAmounts(doc.totalMinor, doc.taxMinor, doc.exchangeRateMicros);
        journalLines.push({ code: '4000', debit: amounts.revenueBaseMinor, description: `Sales reversal ${doc.number}` });
        if (amounts.taxBaseMinor) journalLines.push({ code: '2200', debit: amounts.taxBaseMinor, description: `Output VAT reversal ${doc.number}` });
        journalLines.push({ code: '1100', credit: amounts.receivableMinor, description: `Customer credit ${doc.number}` });
        if (doc.type === DocumentType.SALES_RETURN) {
          for (const line of doc.lines) {
            const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
            cost += movement.totalCostMinor;
          }
          journalLines.push({ code: '1200', debit: cost, description: `Returned inventory ${doc.number}` }, { code: '5000', credit: cost, description: `COGS reversal ${doc.number}` });
        }
      } else if (doc.type === DocumentType.GOODS_RECEIPT) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          await tx.documentLine.update({ where: { id: line.id }, data: { unitCostMinor: movement.unitCostMinor, costMinor: movement.totalCostMinor } });
        }
        journalLines.push({ code: '1200', debit: cost, description: `Inventory receipt ${doc.number}` }, { code: '2100', credit: cost, description: `Goods received not invoiced ${doc.number}` });
      } else if (doc.type === DocumentType.PURCHASE_BILL) {
        journalLines.push({ code: '2100', debit: doc.subtotalMinor - doc.discountMinor, description: `Clear GRNI ${doc.number}` });
        if (doc.taxMinor) journalLines.push({ code: '1300', debit: doc.taxMinor, description: `Recoverable VAT ${doc.number}` });
        journalLines.push({ code: '2000', credit: doc.totalMinor, description: `Supplier payable ${doc.number}` });
      } else if (doc.type === DocumentType.PURCHASE_RETURN) {
        for (const line of doc.lines) {
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
        }
        if (doc.sourceDocument?.type === DocumentType.PURCHASE_BILL) {
          journalLines.push({ code: '2000', debit: doc.totalMinor, description: `Supplier debit ${doc.number}` });
          if (doc.taxMinor) journalLines.push({ code: '1300', credit: doc.taxMinor, description: `VAT reversal ${doc.number}` });
          journalLines.push({ code: '1200', credit: cost, description: `Inventory return ${doc.number}` });
          const variance = doc.totalMinor - doc.taxMinor - cost;
          if (variance > 0n) journalLines.push({ code: '5100', credit: variance, description: `Purchase return price variance ${doc.number}` });
          if (variance < 0n) journalLines.push({ code: '5100', debit: -variance, description: `Purchase return price variance ${doc.number}` });
        } else journalLines.push({ code: '2100', debit: cost, description: `Reverse GRNI ${doc.number}` }, { code: '1200', credit: cost, description: `Inventory return ${doc.number}` });
      } else if (doc.type === DocumentType.WAREHOUSE_TRANSFER) {
        for (const line of doc.lines) {
          const issue = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: doc.documentDate, sourceType: `${doc.type}_OUT`, sourceId: doc.id, sourceNumber: doc.number });
          await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.destinationWarehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: issue.unitCostMinor, date: doc.documentDate, sourceType: `${doc.type}_IN`, sourceId: doc.id, sourceNumber: doc.number });
          cost += issue.totalCostMinor;
        }
      } else if (doc.type === DocumentType.INVENTORY_ADJUSTMENT || doc.type === DocumentType.STOCK_COUNT) {
        for (const line of doc.lines) {
          const direction = line.description?.toLowerCase().includes('decrease') ? 'OUT' : 'IN';
          const movement = await this.stock(tx, actor, { branchId: doc.branchId, warehouseId: doc.warehouseId!, itemId: line.itemId, qtyMilli: line.quantityMilli, direction, unitCostMinor: line.unitCostMinor || line.item.purchasePriceMinor, date: doc.documentDate, sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number });
          cost += movement.totalCostMinor;
          journalLines.push(direction === 'IN' ? { code: '1200', debit: movement.totalCostMinor, description: `Inventory gain ${doc.number}` } : { code: '5100', debit: movement.totalCostMinor, description: `Inventory loss ${doc.number}` });
          journalLines.push(direction === 'IN' ? { code: '5100', credit: movement.totalCostMinor, description: `Inventory gain ${doc.number}` } : { code: '1200', credit: movement.totalCostMinor, description: `Inventory loss ${doc.number}` });
        }
      }
      if (journalLines.length) journal = await this.postedJournal(tx, actor, { branchId: doc.branchId, date: doc.documentDate, description: `${doc.type} ${doc.number}`, module: SALES_TYPES.has(doc.type) ? 'SALES' : PURCHASE_TYPES.has(doc.type) ? 'PURCHASING' : 'INVENTORY', sourceType: doc.type, sourceId: doc.id, sourceNumber: doc.number, lines: journalLines });
      const updated = await tx.document.update({ where: { id }, data: { status: WorkflowStatus.POSTED, postedById: actor.userId, postedAt: new Date(), costMinor: cost, journalEntryId: journal?.id || null } });
      await this.audit(tx, actor, 'POST', 'DOCUMENT', id, { postingReference: journal?.number || 'NO_GL', documentNumber: doc.number, costMinor: cost.toString() });
      return { ...updated, journal, accountingEffect: journal ? `Journal ${journal.number}` : 'No GL impact; operational document only' };
    });
  }

  async payments(actor: Actor) {
    requirePermission(actor, 'payments.read');
    return this.withTenant(actor, (tx) => tx.payment.findMany({ include: { customer: true, supplier: true, bankAccount: true, journalEntry: true, allocations: { include: { document: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  async createPayment(actor: Actor, body: any) {
    requirePermission(actor, 'payments.write');
    return this.withTenant(actor, async (tx) => {
      const kind = body.kind as PaymentKind;
      if (!Object.values(PaymentKind).includes(kind)) throw new BadRequestException('Payment kind is invalid');
      const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
      const bankAccountId = BigInt(body.bankAccountId || 0);
      const bank = await tx.bankAccount.findUnique({ where: { id: bankAccountId }, include: { glAccount: true } });
      if (!bank) throw new BadRequestException('Cash or bank account is invalid');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      const amount = money(body.amount, 'amount');
      if (amount <= 0n) throw new BadRequestException('Amount must be greater than zero');
      const allocations = Array.isArray(body.allocations) ? body.allocations : [];
      if (!allocations.length) throw new BadRequestException('At least one invoice or bill allocation is required');
      const allocationTotal = allocations.reduce((sum: bigint, row: any) => sum + money(row.amount, 'allocation amount'), 0n);
      if (allocationTotal !== amount) throw new BadRequestException('Allocated amount must exactly equal the posted receipt or payment total');
      const docs = await tx.document.findMany({ where: { id: { in: allocations.map((row: any) => BigInt(row.documentId)) }, status: WorkflowStatus.POSTED } });
      if (docs.length !== allocations.length) throw new BadRequestException('Every allocation must reference a posted document');
      const invoiceSettlements = kind === PaymentKind.RECEIPT
        ? await this.receivables.settlements(tx, docs.filter((doc) => doc.type === DocumentType.SALES_INVOICE))
        : new Map();
      const partyId = kind === PaymentKind.RECEIPT ? docs[0].customerId : docs[0].supplierId;
      if (!partyId || docs.some((doc) => (kind === PaymentKind.RECEIPT ? doc.customerId : doc.supplierId) !== partyId)) {
        throw new BadRequestException('All allocations on one payment must belong to the same customer or supplier.');
      }
      if (docs.some((doc) => doc.currency !== bank.currency)) {
        throw new BadRequestException(`Use a ${docs[0].currency} bank account for these allocations.`);
      }
      for (const row of allocations) {
        const doc = docs.find((item) => item.id === BigInt(row.documentId))!;
        const allocated = money(row.amount, 'allocation amount');
        if (kind === PaymentKind.RECEIPT && doc.type !== DocumentType.SALES_INVOICE) throw new BadRequestException('Receipts can only allocate sales invoices');
        if (kind === PaymentKind.PAYMENT && doc.type !== DocumentType.PURCHASE_BILL) throw new BadRequestException('Payments can only allocate purchase bills');
        const remainingMinor = kind === PaymentKind.RECEIPT
          ? invoiceSettlements.get(doc.id.toString())!.remainingMinor
          : doc.totalMinor - doc.paidMinor;
        if (allocated <= 0n || allocated > remainingMinor) throw new BadRequestException(`Allocation exceeds net outstanding amount for ${doc.number}`);
      }
      const baseAmount = allocations.reduce((sum: bigint, row: any) => {
        const doc = docs.find((item) => item.id === BigInt(row.documentId))!;
        return sum + receivableBaseMinor(money(row.amount, 'allocation amount'), doc.exchangeRateMicros);
      }, 0n);
      const number = await this.sequence(tx, actor, branchId, kind, date);
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('payments', 'id'))::bigint AS id`;
      const journal = await this.postedJournal(tx, actor, {
        branchId, date, description: `${kind} ${number}`, module: 'BANKING', sourceType: kind, sourceId: id, sourceNumber: number,
        lines: kind === PaymentKind.RECEIPT
          ? [{ code: bank.glAccount.code, debit: baseAmount, description: `Funds received ${number}` }, { code: '1100', credit: baseAmount, description: `Settle receivable ${number}` }]
          : [{ code: '2000', debit: baseAmount, description: `Settle payable ${number}` }, { code: bank.glAccount.code, credit: baseAmount, description: `Funds paid ${number}` }],
      });
      const payment = await tx.payment.create({ data: {
        id, tenantId: actor.tenantId, kind, partyType: kind === PaymentKind.RECEIPT ? 'CUSTOMER' : 'SUPPLIER',
        customerId: kind === PaymentKind.RECEIPT ? partyId : null,
        supplierId: kind === PaymentKind.PAYMENT ? partyId : null,
        bankAccountId, number, postingDate: date, amountMinor: amount, method: body.method as PaymentMethod || PaymentMethod.BANK,
        reference: body.reference || null, journalEntryId: journal.id, createdById: actor.userId,
        allocations: { create: allocations.map((row: any) => ({ tenantId: actor.tenantId, documentId: BigInt(row.documentId), amountMinor: money(row.amount) })) },
      }, include: { allocations: true, journalEntry: true } });
      for (const row of allocations) await tx.document.update({ where: { id: BigInt(row.documentId) }, data: { paidMinor: { increment: money(row.amount) } } });
      await this.audit(tx, actor, 'POST', 'PAYMENT', payment.id, { postingReference: journal.number, number, amountMinor: amount.toString() });
      return payment;
    });
  }

  async journals(actor: Actor) {
    requirePermission(actor, 'accounting.read');
    return this.withTenant(actor, (tx) => tx.journalEntry.findMany({ include: { lines: { include: { account: true } }, createdBy: publicUser, approvedBy: publicUser }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  async createJournal(actor: Actor, body: any) {
    requirePermission(actor, 'journals.write');
    return this.withTenant(actor, async (tx) => {
      const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      await this.assertOpenPeriod(tx, actor, date);
      if (!Array.isArray(body.lines) || body.lines.length < 2) throw new BadRequestException('A journal needs at least two lines');
      const accountIds = body.lines.map((line: any) => BigInt(line.accountId || 0));
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds }, active: true } });
      const accountMap = new Map(accounts.map((account) => [account.id.toString(), account]));
      let debit = 0n, credit = 0n;
      const lines = body.lines.map((line: any, index: number) => {
        const account = accountMap.get(String(line.accountId));
        if (!account || !account.postingAllowed) throw new BadRequestException(`Line ${index + 1}: account is invalid`);
        if (account.controlType) throw new BadRequestException(`Manual posting to control account ${account.code} is blocked`);
        const dr = money(line.debit || 0, `line ${index + 1} debit`), cr = money(line.credit || 0, `line ${index + 1} credit`);
        if ((dr > 0n) === (cr > 0n)) throw new BadRequestException(`Line ${index + 1}: enter either debit or credit`);
        debit += dr; credit += cr;
        return { tenantId: actor.tenantId, accountId: account.id, description: String(line.description || body.description), debitMinor: dr, creditMinor: cr, costCenter: line.costCenter || null };
      });
      if (debit <= 0n || debit !== credit) throw new BadRequestException(`Journal is unbalanced: ${debit} / ${credit}`);
      const number = await this.sequence(tx, actor, branchId, 'JOURNAL', date);
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('journal_entries', 'id'))::bigint AS id`;
      const journal = await tx.journalEntry.create({ data: {
        id, tenantId: actor.tenantId, branchId, number, postingDate: date, description: String(body.description || 'Manual journal'),
        sourceModule: 'GENERAL_LEDGER', sourceType: 'MANUAL', sourceId: id, sourceNumber: number, createdById: actor.userId,
        lines: { create: lines },
      }, include: { lines: true } });
      await this.audit(tx, actor, 'CREATE', 'JOURNAL', id, { number, debitMinor: debit.toString() });
      return journal;
    });
  }

  async updateJournal(actor: Actor, id: bigint, body: any) {
    requirePermission(actor, 'journals.write');
    return this.withTenant(actor, async (tx) => {
      const journal = await tx.journalEntry.findUnique({ where: { id } });
      if (!journal) throw new NotFoundException('Journal not found');
      if (journal.status !== JournalStatus.DRAFT) throw new BadRequestException('Posted or controlled journals are immutable; create a linked reversal');
      const description = this.requiredText(body.description, 'Description');
      const updated = await tx.journalEntry.update({ where: { id }, data: { description } });
      await this.audit(tx, actor, 'UPDATE', 'JOURNAL', id, { number: journal.number, description });
      return updated;
    });
  }

  async journalWorkflow(actor: Actor, id: bigint, action: 'submit' | 'approve' | 'reject' | 'post', body: any = {}) {
    return this.withTenant(actor, async (tx) => {
      const journal = await tx.journalEntry.findUnique({ where: { id } });
      if (!journal) throw new NotFoundException('Journal not found');
      this.assertBranch(actor, journal.branchId);
      const now = new Date();
      if (action === 'submit') {
        requirePermission(actor, 'journals.write');
        if (journal.status !== JournalStatus.DRAFT) throw new BadRequestException('Only draft journals can be submitted');
        const updated = await tx.journalEntry.update({ where: { id }, data: { status: JournalStatus.SUBMITTED, submittedById: actor.userId, submittedAt: now } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'JOURNAL', entityId: id, action: 'SUBMIT', actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, 'SUBMIT', 'JOURNAL', id, { approvalReference: journal.number }); return updated;
      }
      if (action === 'approve' || action === 'reject') {
        requirePermission(actor, 'approvals.act');
        if (journal.status !== JournalStatus.SUBMITTED) throw new BadRequestException('Only submitted journals can be approved or rejected');
        if (action === 'approve' && journal.submittedById === actor.userId) throw new ForbiddenException('Maker-checker control: submitter cannot approve this journal');
        const updated = await tx.journalEntry.update({ where: { id }, data: action === 'approve' ? { status: JournalStatus.APPROVED, approvedById: actor.userId, approvedAt: now } : { status: JournalStatus.REJECTED } });
        await tx.approvalEvent.create({ data: { tenantId: actor.tenantId, entityType: 'JOURNAL', entityId: id, action: action.toUpperCase(), actorId: actor.userId, comment: body.comment || null } });
        await this.audit(tx, actor, action.toUpperCase(), 'JOURNAL', id, { approvalReference: journal.number }); return updated;
      }
      requirePermission(actor, 'posting.execute');
      if (journal.status !== JournalStatus.APPROVED) throw new BadRequestException('Only approved journals can be posted');
      await this.assertOpenPeriod(tx, actor, journal.postingDate);
      const updated = await tx.journalEntry.update({ where: { id }, data: { status: JournalStatus.POSTED, postedById: actor.userId, postedAt: now } });
      await this.audit(tx, actor, 'POST', 'JOURNAL', id, { postingReference: journal.number }); return updated;
    });
  }

  async reverseJournal(actor: Actor, id: bigint, body: any) {
    requirePermission(actor, 'posting.execute');
    return this.withTenant(actor, async (tx) => {
      const original = await tx.journalEntry.findUnique({ where: { id }, include: { lines: { include: { account: true } }, reversedBy: true } });
      if (!original || original.status !== JournalStatus.POSTED) throw new BadRequestException('Only posted journals can be reversed');
      if (original.reversedBy) throw new BadRequestException('Journal has already been reversed');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'reversal date');
      const number = await this.sequence(tx, actor, original.branchId, 'JOURNAL', date);
      await this.assertOpenPeriod(tx, actor, date);
      const [{ newId }] = await tx.$queryRaw<Array<{ newId: bigint }>>`SELECT nextval(pg_get_serial_sequence('journal_entries', 'id'))::bigint AS "newId"`;
      const reversal = await tx.journalEntry.create({ data: {
        id: newId, tenantId: actor.tenantId, branchId: original.branchId, number, postingDate: date,
        description: `Reversal of ${original.number}: ${body.reason || 'Correction'}`, status: JournalStatus.DRAFT,
        sourceModule: original.sourceModule, sourceType: 'REVERSAL', sourceId: newId, sourceNumber: number,
        reversesEntryId: original.id, reversalReason: String(body.reason || 'Correction'), createdById: actor.userId,
        submittedById: actor.userId, approvedById: actor.userId, postedById: actor.userId, submittedAt: new Date(), approvedAt: new Date(), postedAt: new Date(),
        lines: { create: original.lines.map((line) => ({ tenantId: actor.tenantId, accountId: line.accountId, description: `Reverse: ${line.description}`, debitMinor: line.creditMinor, creditMinor: line.debitMinor })) },
      } });
      await tx.journalEntry.update({ where: { id: reversal.id }, data: { status: JournalStatus.POSTED } });
      await this.audit(tx, actor, 'REVERSE', 'JOURNAL', original.id, { postingReference: number, reversalId: reversal.id.toString(), reason: body.reason || 'Correction' });
      return reversal;
    });
  }

  async updatePeriod(actor: Actor, id: bigint, status: string) {
    requirePermission(actor, 'periods.manage');
    if (!['OPEN', 'CLOSED', 'LOCKED'].includes(status)) throw new BadRequestException('Period status is invalid');
    return this.withTenant(actor, async (tx) => {
      const period = await tx.fiscalPeriod.update({ where: { id }, data: { status } });
      await this.audit(tx, actor, 'PERIOD_STATUS', 'FISCAL_PERIOD', id, { status, period: period.name });
      return period;
    });
  }

  async posState(actor: Actor) {
    requirePermission(actor, 'pos.use');
    return this.withTenant(actor, async (tx) => ({
      shifts: await tx.posShift.findMany({ include: { openedBy: publicUser, closedBy: publicUser, _count: { select: { sales: true } } }, orderBy: { openedAt: 'desc' }, take: 30 }),
      sales: await tx.posSale.findMany({ include: { lines: { include: { item: true } }, tenders: true, shift: true, journalEntry: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    }));
  }

  async posSaleDetail(actor: Actor, id: bigint) {
    requirePermission(actor, 'pos.use');
    return this.withTenant(actor, async (tx) => {
      const sale = await tx.posSale.findUnique({ where: { id }, include: {
        customer: true, shift: { include: { branch: true, warehouse: true } }, lines: { include: { item: true } }, tenders: true,
        journalEntry: { include: { lines: { include: { account: true } } } },
      } });
      if (!sale) throw new NotFoundException('POS sale not found');
      this.assertBranch(actor, sale.shift.branchId);
      return sale;
    });
  }

  async openShift(actor: Actor, body: any) {
    requirePermission(actor, 'pos.use');
    return this.withTenant(actor, async (tx) => {
      const branchId = BigInt(body.branchId || 0), warehouseId = BigInt(body.warehouseId || 0);
      this.assertBranch(actor, branchId); this.assertWarehouse(actor, warehouseId);
      const existing = await tx.posShift.findFirst({ where: { registerCode: String(body.registerCode || 'REG-01'), status: PosShiftStatus.OPEN } });
      if (existing) throw new BadRequestException('This register already has an open shift');
      const shift = await tx.posShift.create({ data: { tenantId: actor.tenantId, branchId, warehouseId, registerCode: String(body.registerCode || 'REG-01'), openedById: actor.userId, openingCashMinor: money(body.openingCash || 0, 'opening cash'), expectedCashMinor: money(body.openingCash || 0, 'opening cash') } });
      await this.audit(tx, actor, 'OPEN', 'POS_SHIFT', shift.id, { registerCode: shift.registerCode, openingCashMinor: shift.openingCashMinor.toString() });
      return shift;
    });
  }

  async createPosSale(actor: Actor, body: any) {
    requirePermission(actor, 'pos.use');
    return this.withTenant(actor, async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: BigInt(body.shiftId || 0) } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new BadRequestException('An open shift is required');
      this.assertBranch(actor, shift.branchId); this.assertWarehouse(actor, shift.warehouseId);
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('Add at least one item');
      const items = await tx.item.findMany({ where: { id: { in: body.lines.map((line: any) => BigInt(line.itemId)) }, active: true } });
      const map = new Map(items.map((item) => [item.id.toString(), item]));
      let subtotal = 0n, discount = 0n, tax = 0n, total = 0n;
      const lines = body.lines.map((line: any, index: number) => {
        const item = map.get(String(line.itemId)); if (!item) throw new BadRequestException(`Line ${index + 1}: item is invalid`);
        const qty = quantity(line.quantity, 'quantity'); if (qty <= 0n) throw new BadRequestException('Quantity must be greater than zero');
        const unitPrice = line.unitPrice === undefined ? item.salePriceMinor : money(line.unitPrice, 'unit price');
        const lineDiscount = money(line.discount || 0, 'discount'), gross = roundDiv(qty * unitPrice, 1000n);
        if (lineDiscount < 0n || lineDiscount > gross) throw new BadRequestException(`Line ${index + 1}: discount is invalid`);
        if (!actor.permissions.includes('*') && lineDiscount * 100n > gross * 20n) throw new ForbiddenException('POS discount exceeds the cashier limit of 20%');
        const taxable = gross - lineDiscount;
        const lineTax = roundDiv(taxable * BigInt(item.taxRateBps), 10_000n), lineTotal = taxable + lineTax;
        subtotal += gross; discount += lineDiscount; tax += lineTax; total += lineTotal;
        return { tenantId: actor.tenantId, itemId: item.id, quantityMilli: qty, unitPriceMinor: unitPrice, discountMinor: lineDiscount, taxMinor: lineTax, totalMinor: lineTotal };
      });
      const date = new Date(); const number = await this.sequence(tx, actor, shift.branchId, 'POS', date);
      const complete = body.hold !== true;
      const tenders = Array.isArray(body.tenders) ? body.tenders.map((tender: any) => ({ tenantId: actor.tenantId, method: tender.method as PaymentMethod, amountMinor: money(tender.amount, 'tender amount'), reference: tender.reference || null })) : [];
      if (complete && tenders.reduce((sum: bigint, tender: { amountMinor: bigint }) => sum + tender.amountMinor, 0n) !== total) throw new BadRequestException('Split tender total must exactly equal sale total');
      const sale = await tx.posSale.create({ data: { tenantId: actor.tenantId, shiftId: shift.id, customerId: body.customerId ? BigInt(body.customerId) : null, number, status: complete ? PosSaleStatus.HELD : PosSaleStatus.HELD, subtotalMinor: subtotal, discountMinor: discount, taxMinor: tax, totalMinor: total, createdById: actor.userId, lines: { create: lines }, ...(tenders.length ? { tenders: { create: tenders } } : {}) }, include: { lines: true, tenders: true } });
      if (!complete) { await this.audit(tx, actor, 'HOLD', 'POS_SALE', sale.id, { number }); return sale; }
      return this.completePosSaleTx(tx, actor, sale.id);
    });
  }

  async resumePosSale(actor: Actor, id: bigint, body: any) {
    requirePermission(actor, 'pos.use');
    return this.withTenant(actor, async (tx) => {
      const sale = await tx.posSale.findUnique({ where: { id }, include: { tenders: true } });
      if (!sale || sale.status !== PosSaleStatus.HELD) throw new BadRequestException('Held sale not found');
      const tenders = body.tenders.map((tender: any) => ({ tenantId: actor.tenantId, saleId: id, method: tender.method as PaymentMethod, amountMinor: money(tender.amount), reference: tender.reference || null }));
      if (tenders.reduce((sum: bigint, tender: any) => sum + tender.amountMinor, 0n) !== sale.totalMinor) throw new BadRequestException('Split tender total must exactly equal sale total');
      await tx.posTender.deleteMany({ where: { saleId: id } }); await tx.posTender.createMany({ data: tenders });
      return this.completePosSaleTx(tx, actor, id);
    });
  }

  private async completePosSaleTx(tx: Tx, actor: Actor, saleId: bigint) {
    const sale = await tx.posSale.findUniqueOrThrow({ where: { id: saleId }, include: { lines: { include: { item: true } }, tenders: true, shift: true } });
    if (!sale.tenders.length) throw new BadRequestException('Tender is required');
    let cost = 0n;
    for (const line of sale.lines) {
      const movement = await this.stock(tx, actor, { branchId: sale.shift.branchId, warehouseId: sale.shift.warehouseId, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'OUT', date: sale.createdAt, sourceType: 'POS_SALE', sourceId: sale.id, sourceNumber: sale.number });
      cost += movement.totalCostMinor; await tx.posSaleLine.update({ where: { id: line.id }, data: { costMinor: movement.totalCostMinor } });
    }
    const tenderLines = sale.tenders.map((tender) => ({ code: tender.method === PaymentMethod.CASH ? '1000' : tender.method === PaymentMethod.CARD ? '1020' : '1010', debit: tender.amountMinor, description: `${tender.method} tender ${sale.number}` }));
    const journal = await this.postedJournal(tx, actor, { branchId: sale.shift.branchId, date: sale.createdAt, description: `POS sale ${sale.number}`, module: 'POS', sourceType: 'POS_SALE', sourceId: sale.id, sourceNumber: sale.number, lines: [...tenderLines, { code: '4000', credit: sale.subtotalMinor - sale.discountMinor, description: `POS revenue ${sale.number}` }, ...(sale.taxMinor ? [{ code: '2200', credit: sale.taxMinor, description: `POS VAT ${sale.number}` }] : []), { code: '5000', debit: cost, description: `POS COGS ${sale.number}` }, { code: '1200', credit: cost, description: `POS inventory ${sale.number}` }] });
    const cash = sale.tenders.filter((tender) => tender.method === PaymentMethod.CASH).reduce((sum, tender) => sum + tender.amountMinor, 0n);
    await tx.posShift.update({ where: { id: sale.shiftId }, data: { expectedCashMinor: { increment: cash } } });
    const updated = await tx.posSale.update({ where: { id: sale.id }, data: { status: PosSaleStatus.COMPLETED, completedAt: new Date(), costMinor: cost, journalEntryId: journal.id } });
    await this.audit(tx, actor, 'COMPLETE', 'POS_SALE', sale.id, { postingReference: journal.number, number: sale.number, totalMinor: sale.totalMinor.toString() }); return updated;
  }

  async returnPosSale(actor: Actor, id: bigint, body: any) {
    requirePermission(actor, 'pos.returns');
    return this.withTenant(actor, async (tx) => {
      const original = await tx.posSale.findUnique({ where: { id }, include: { lines: true, tenders: true, shift: true } });
      if (!original || original.status !== PosSaleStatus.COMPLETED) throw new BadRequestException('Only a completed sale can be returned');
      const number = await this.sequence(tx, actor, original.shift.branchId, 'POS_RETURN', new Date());
      let cost = 0n;
      for (const line of original.lines) {
        const movement = await this.stock(tx, actor, { branchId: original.shift.branchId, warehouseId: original.shift.warehouseId, itemId: line.itemId, qtyMilli: line.quantityMilli, direction: 'IN', unitCostMinor: roundDiv(line.costMinor * 1000n, line.quantityMilli), date: new Date(), sourceType: 'POS_RETURN', sourceId: original.id, sourceNumber: number }); cost += movement.totalCostMinor;
      }
      const refund = original.tenders[0]?.method || PaymentMethod.CASH;
      const journal = await this.postedJournal(tx, actor, { branchId: original.shift.branchId, date: new Date(), description: `POS return ${number}`, module: 'POS', sourceType: 'POS_RETURN', sourceId: original.id, sourceNumber: number, lines: [{ code: '4000', debit: original.subtotalMinor - original.discountMinor, description: `Reverse revenue ${number}` }, ...(original.taxMinor ? [{ code: '2200', debit: original.taxMinor, description: `Reverse VAT ${number}` }] : []), { code: refund === PaymentMethod.CASH ? '1000' : refund === PaymentMethod.CARD ? '1020' : '1010', credit: original.totalMinor, description: `Refund ${number}` }, { code: '1200', debit: cost, description: `Inventory restored ${number}` }, { code: '5000', credit: cost, description: `COGS reversed ${number}` }] });
      await tx.posSale.update({ where: { id }, data: { status: PosSaleStatus.RETURNED } });
      if (refund === PaymentMethod.CASH) await tx.posShift.update({ where: { id: original.shiftId }, data: { expectedCashMinor: { decrement: original.totalMinor } } });
      await this.audit(tx, actor, 'RETURN', 'POS_SALE', id, { postingReference: journal.number, returnNumber: number, reason: body.reason || 'Customer return' });
      return { originalId: id, number, journalEntryId: journal.id, status: 'RETURNED' };
    });
  }

  async closeShift(actor: Actor, id: bigint, body: any) {
    requirePermission(actor, 'pos.close');
    return this.withTenant(actor, async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id } });
      if (!shift || shift.status !== PosShiftStatus.OPEN) throw new BadRequestException('Open shift not found');
      const actual = money(body.actualCash, 'actual cash'), difference = actual - shift.expectedCashMinor;
      let journal = null;
      if (difference !== 0n) journal = await this.postedJournal(tx, actor, { branchId: shift.branchId, date: new Date(), description: `Cash count difference ${shift.registerCode}`, module: 'POS', sourceType: 'POS_SHIFT_CLOSE', sourceId: shift.id, sourceNumber: shift.registerCode, lines: difference > 0n ? [{ code: '1000', debit: difference, description: 'Cash over' }, { code: '5200', credit: difference, description: 'Cash over' }] : [{ code: '5200', debit: -difference, description: 'Cash short' }, { code: '1000', credit: -difference, description: 'Cash short' }] });
      const updated = await tx.posShift.update({ where: { id }, data: { status: PosShiftStatus.CLOSED, actualCashMinor: actual, differenceMinor: difference, closedById: actor.userId, closedAt: new Date(), closingJournalEntryId: journal?.id || null } });
      await this.audit(tx, actor, 'CLOSE', 'POS_SHIFT', id, { postingReference: journal?.number || 'NO_DIFFERENCE', expected: shift.expectedCashMinor.toString(), actual: actual.toString(), difference: difference.toString() }); return updated;
    });
  }

  async banking(actor: Actor) {
    requirePermission(actor, 'banking.read');
    return this.withTenant(actor, async (tx) => ({
      accounts: await tx.bankAccount.findMany({ include: { glAccount: true }, orderBy: { code: 'asc' } }),
      transactions: await tx.bankTransaction.findMany({ include: { bankAccount: true, counterpartyAccount: true, journalEntry: true }, orderBy: { postingDate: 'desc' }, take: 200 }),
      statements: await tx.bankStatement.findMany({ include: { bankAccount: true, lines: { include: { transaction: true } } }, orderBy: { statementDate: 'desc' }, take: 50 }),
    }));
  }

  async createBankTransaction(actor: Actor, body: any) {
    requirePermission(actor, 'banking.write');
    return this.withTenant(actor, async (tx) => {
      const branchId = BigInt(body.branchId || 0); this.assertBranch(actor, branchId);
      const bank = await tx.bankAccount.findUnique({ where: { id: BigInt(body.bankAccountId || 0) }, include: { glAccount: true } });
      const counterparty = await tx.account.findUnique({ where: { id: BigInt(body.counterpartyAccountId || 0) } });
      if (!bank || !counterparty || !counterparty.postingAllowed) throw new BadRequestException('Bank or counterparty account is invalid');
      const kind = body.kind as BankTransactionKind;
      if (!Object.values(BankTransactionKind).includes(kind)) throw new BadRequestException('Bank transaction kind is invalid');
      const date = this.date(body.postingDate || new Date().toISOString().slice(0, 10), 'posting date');
      const amount = money(body.amount, 'amount'); if (amount <= 0n) throw new BadRequestException('Amount must be greater than zero');
      const number = await this.sequence(tx, actor, branchId, 'BANK', date);
      const [{ id }] = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT nextval(pg_get_serial_sequence('bank_transactions', 'id'))::bigint AS id`;
      const incoming = kind === BankTransactionKind.RECEIPT || kind === BankTransactionKind.TRANSFER_IN;
      const journal = await this.postedJournal(tx, actor, { branchId, date, description: String(body.description || `${kind} ${number}`), module: 'BANKING', sourceType: 'BANK_TRANSACTION', sourceId: id, sourceNumber: number, lines: incoming ? [{ code: bank.glAccount.code, debit: amount, description: `Bank debit ${number}` }, { code: counterparty.code, credit: amount, description: `Counterparty credit ${number}` }] : [{ code: counterparty.code, debit: amount, description: `Counterparty debit ${number}` }, { code: bank.glAccount.code, credit: amount, description: `Bank credit ${number}` }] });
      const transaction = await tx.bankTransaction.create({ data: { id, tenantId: actor.tenantId, branchId, bankAccountId: bank.id, counterpartyAccountId: counterparty.id, kind, number, postingDate: date, amountMinor: amount, reference: body.reference || null, description: String(body.description || kind), journalEntryId: journal.id, createdById: actor.userId }, include: { journalEntry: true, bankAccount: true } });
      await this.audit(tx, actor, 'POST', 'BANK_TRANSACTION', id, { postingReference: journal.number, number, amountMinor: amount.toString() }); return transaction;
    });
  }

  async createStatement(actor: Actor, body: any) {
    requirePermission(actor, 'banking.reconcile');
    return this.withTenant(actor, async (tx) => {
      const bank = await tx.bankAccount.findUnique({ where: { id: BigInt(body.bankAccountId || 0) } });
      if (!bank) throw new BadRequestException('Bank account is invalid');
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('Statement lines are required');
      const statement = await tx.bankStatement.create({ data: { tenantId: actor.tenantId, bankAccountId: bank.id, statementDate: this.date(body.statementDate, 'statement date'), openingMinor: money(body.opening, 'opening balance'), closingMinor: money(body.closing, 'closing balance'), createdById: actor.userId, lines: { create: body.lines.map((line: any) => ({ tenantId: actor.tenantId, lineDate: this.date(line.date, 'line date'), description: String(line.description), reference: line.reference || null, amountMinor: money(line.amount, 'line amount') })) } }, include: { lines: true } });
      await this.audit(tx, actor, 'IMPORT', 'BANK_STATEMENT', statement.id, { lineCount: statement.lines.length, closingMinor: statement.closingMinor.toString() }); return statement;
    });
  }

  async matchStatementLine(actor: Actor, lineId: bigint, transactionId: bigint) {
    requirePermission(actor, 'banking.reconcile');
    return this.withTenant(actor, async (tx) => {
      const line = await tx.bankStatementLine.findUnique({ where: { id: lineId }, include: { statement: true } });
      const transaction = await tx.bankTransaction.findUnique({ where: { id: transactionId } });
      if (!line || !transaction || line.statement.bankAccountId !== transaction.bankAccountId) throw new BadRequestException('Statement line and transaction do not belong to the same account');
      if (line.matched || transaction.reconciled) throw new BadRequestException('Line or transaction is already reconciled');
      if ((line.amountMinor < 0n ? -line.amountMinor : line.amountMinor) !== transaction.amountMinor) throw new BadRequestException('Amounts do not match');
      const updated = await tx.bankStatementLine.update({ where: { id: lineId }, data: { transactionId, matched: true } });
      await tx.bankTransaction.update({ where: { id: transactionId }, data: { reconciled: true } });
      await this.audit(tx, actor, 'MATCH', 'BANK_STATEMENT_LINE', lineId, { transactionId: transactionId.toString(), transactionNumber: transaction.number }); return updated;
    });
  }

  async approvals(actor: Actor) {
    requirePermission(actor, 'approvals.read');
    return this.withTenant(actor, async (tx) => {
      const branchScope = actor.permissions.includes('*') ? {} : { branchId: { in: actor.branchIds.map(BigInt) } };
      const [documents, journals] = await Promise.all([
        tx.document.findMany({
        where: { status: WorkflowStatus.SUBMITTED, ...(actor.permissions.includes('*') ? {} : { branchId: { in: actor.branchIds.map(BigInt) } }) },
        include: { customer: true, supplier: true, branch: true, salesEmployee: true, createdBy: publicUser, submittedBy: publicUser, lines: { include: { item: true } } },
        orderBy: { submittedAt: 'asc' },
      }),
        tx.journalEntry.findMany({ where: { status: JournalStatus.SUBMITTED, ...branchScope }, include: { createdBy: publicUser, submittedBy: publicUser, lines: { include: { account: true } } }, orderBy: { submittedAt: 'asc' } }),
      ]);
      return {
        documents: documents.map((document) => ({ ...document, customer: document.customer ? this.customerForActor(actor, document.customer) : null })),
        journals,
      };
    });
  }

  async auditLog(actor: Actor) {
    requirePermission(actor, 'audit.read');
    return this.withTenant(actor, (tx) => tx.auditEvent.findMany({ include: { user: publicUser }, orderBy: { createdAt: 'desc' }, take: 500 }));
  }

  async referenceEvidence(actor: Actor, reference: string) {
    requirePermission(actor, 'reports.read');
    return this.withTenant(actor, async (tx) => {
      const document = await tx.document.findFirst({ where: { number: reference }, include: { customer: true, supplier: true, lines: { include: { item: true } }, journalEntry: { include: { lines: { include: { account: true } } } } } });
      if (document) {
        const stockMovements = await tx.stockMovement.findMany({ where: { sourceNumber: reference }, include: { item: true, warehouse: true } });
        return { kind: 'DOCUMENT', reference, status: document.status, description: `${document.type} · ${document.customer?.name || document.supplier?.name || 'Internal'}`, totalMinor: document.totalMinor, lines: document.lines.map((line) => `${line.item.sku} × ${line.quantityMilli}`), journal: document.journalEntry?.number || null, stockMovements: stockMovements.map((move) => `${move.item.sku} · ${move.warehouse.name} · in ${move.quantityInMilli} · out ${move.quantityOutMilli}`) };
      }
      const journal = await tx.journalEntry.findFirst({ where: { number: reference }, include: { lines: { include: { account: true } }, reversesEntry: true, reversedBy: true } });
      if (journal) return { kind: 'JOURNAL', reference, status: journal.status, description: journal.description, source: journal.sourceNumber, reverses: journal.reversesEntry?.number || null, reversedBy: journal.reversedBy?.number || null, lines: journal.lines.map((line) => `${line.account.code} ${line.account.name} · Dr ${line.debitMinor} · Cr ${line.creditMinor}`) };
      const payment = await tx.payment.findFirst({ where: { number: reference }, include: { journalEntry: true, customer: true, supplier: true, allocations: { include: { document: true } } } });
      if (payment) return { kind: 'PAYMENT', reference, status: 'POSTED', description: `${payment.kind} · ${payment.customer?.name || payment.supplier?.name}`, totalMinor: payment.amountMinor, journal: payment.journalEntry.number, lines: payment.allocations.map((allocation) => `${allocation.document.number} · ${allocation.amountMinor}`) };
      const pos = await tx.posSale.findFirst({ where: { number: reference }, include: { journalEntry: true, lines: { include: { item: true } } } });
      if (pos) return { kind: 'POS_SALE', reference, status: pos.status, description: 'Point-of-sale transaction', totalMinor: pos.totalMinor, journal: pos.journalEntry?.number || null, lines: pos.lines.map((line) => `${line.item.sku} × ${line.quantityMilli}`) };
      throw new NotFoundException('Referenced source document or journal was not found');
    });
  }

  private ledgerBalance(rows: Array<{ debitMinor: bigint; creditMinor: bigint }>) {
    return rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n);
  }

  async report(actor: Actor, name: string) {
    requirePermission(actor, 'reports.read');
    if (['income-statement', 'balance-sheet', 'sales-profitability'].includes(name)) requirePermission(actor, 'reports.profitability');
    return this.withTenant(actor, async (tx) => {
      const accounts = await tx.account.findMany({ orderBy: { code: 'asc' } });
      const journalLines = await tx.journalLine.findMany({ where: { journalEntry: { status: JournalStatus.POSTED } }, include: { account: true, journalEntry: true } });
      const byAccount = accounts.map((account) => {
        const lines = journalLines.filter((line) => line.accountId === account.id);
        const debitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0n), creditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0n);
        return { id: account.id, code: account.code, name: account.name, type: account.type, debitMinor, creditMinor, balanceMinor: debitMinor - creditMinor };
      });
      if (name === 'trial-balance') return { name: 'Trial balance', rows: byAccount.filter((row) => row.debitMinor || row.creditMinor), totals: { debitMinor: byAccount.reduce((sum, row) => sum + row.debitMinor, 0n), creditMinor: byAccount.reduce((sum, row) => sum + row.creditMinor, 0n) } };
      if (name === 'general-ledger') return { name: 'General ledger', rows: journalLines.map((line) => ({ journal: line.journalEntry.number, date: line.journalEntry.postingDate, account: `${line.account.code} ${line.account.name}`, description: line.description, debitMinor: line.debitMinor, creditMinor: line.creditMinor, source: line.journalEntry.sourceNumber })) };
      if (name === 'account-ledger') return { name: 'Account ledger', rows: byAccount.filter((row) => row.debitMinor || row.creditMinor).map((row) => ({ code: row.code, account: row.name, type: row.type, debitMinor: row.debitMinor, creditMinor: row.creditMinor, balanceMinor: row.balanceMinor })) };
      if (name === 'income-statement') {
        const incomeTypes = new Set<AccountType>([AccountType.REVENUE, AccountType.COGS, AccountType.EXPENSE, AccountType.OTHER_INCOME, AccountType.OTHER_EXPENSE]);
        const rows = byAccount.filter((row) => incomeTypes.has(row.type));
        const profitMinor = -rows.reduce((sum, row) => sum + row.balanceMinor, 0n);
        return { name: 'Income statement', rows, totals: { profitMinor } };
      }
      if (name === 'balance-sheet') {
        const balanceTypes = new Set<AccountType>([AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY]);
        const rows = byAccount.filter((row) => balanceTypes.has(row.type));
        return { name: 'Balance sheet', rows, totals: { assetsMinor: rows.filter((row) => row.type === AccountType.ASSET).reduce((sum, row) => sum + row.balanceMinor, 0n), liabilitiesMinor: -rows.filter((row) => row.type === AccountType.LIABILITY).reduce((sum, row) => sum + row.balanceMinor, 0n), equityMinor: -rows.filter((row) => row.type === AccountType.EQUITY).reduce((sum, row) => sum + row.balanceMinor, 0n) } };
      }
      if (name === 'ar-aging') {
        const branchIds = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
        const rows = await this.receivables.ageing(tx, { branchIds });
        return { name: 'Accounts receivable aging', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'ap-aging') {
        const docs = await tx.document.findMany({ where: { type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED, totalMinor: { gt: 0 } }, include: { supplier: true, targetDocuments: true } });
        const today = Date.now();
        const rows = docs.map((doc) => { const credits = doc.targetDocuments.filter((target) => target.status === WorkflowStatus.POSTED && target.type === DocumentType.PURCHASE_RETURN).reduce((sum, target) => sum + target.totalMinor, 0n); const outstandingMinor = doc.totalMinor - doc.paidMinor - credits; const days = Math.max(0, Math.floor((today - (doc.dueDate || doc.documentDate).valueOf()) / 86_400_000)); return { number: doc.number, party: doc.supplier?.name, dueDate: doc.dueDate, outstandingMinor, bucket: days <= 0 ? 'Current' : days <= 30 ? '1–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'More than 90 days' }; }).filter((row) => row.outstandingMinor > 0n);
        return { name: 'Accounts payable aging', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'customer-balances') {
        const branchIds = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
        const customers = await tx.customer.findMany({
          where: actor.permissions.includes('*') ? {} : { defaultBranchId: { in: branchIds } },
          orderBy: { code: 'asc' },
        });
        const balances = await this.receivables.customerBalances(tx, customers.map((customer) => customer.id), branchIds);
        const tenant = await tx.tenant.findFirstOrThrow({ select: { baseCurrency: true } });
        const rows = customers.map((customer) => ({
          customerCode: customer.code,
          customer: customer.name,
          currency: tenant.baseCurrency,
          outstandingMinor: balances.get(customer.id.toString()) || 0n,
          status: customer.active ? 'ACTIVE' : 'INACTIVE',
        }));
        return { name: 'Customer balances', rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0n) } };
      }
      if (name === 'customer-statement' || name === 'supplier-statement') {
        const customerSide = name === 'customer-statement';
        if (customerSide) {
          const branchIds = actor.permissions.includes('*') ? undefined : actor.branchIds.map(BigInt);
          const statement = await this.receivables.customerStatement(tx, { branchIds });
          const rows = statement.map(({ customerId: _customerId, ...row }) => row);
          return { name: 'Customer statement', rows, totals: { balanceMinor: rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n) } };
        }
        const documents = await tx.document.findMany({ where: { type: customerSide ? { in: [DocumentType.SALES_INVOICE, DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] } : { in: [DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN] }, status: WorkflowStatus.POSTED }, include: { customer: true, supplier: true } });
        const payments = await tx.payment.findMany({ where: { kind: customerSide ? PaymentKind.RECEIPT : PaymentKind.PAYMENT }, include: { customer: true, supplier: true } });
        const rows = [
          ...documents.map((doc) => { const credit = new Set<DocumentType>([DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE, DocumentType.PURCHASE_RETURN]).has(doc.type); return { date: doc.documentDate, party: doc.customer?.name || doc.supplier?.name, reference: doc.number, transaction: credit ? doc.type.replaceAll('_', ' ') : customerSide ? 'Invoice' : 'Supplier bill', debitMinor: credit ? 0n : doc.totalMinor, creditMinor: credit ? doc.totalMinor : 0n }; }),
          ...payments.map((payment) => ({ date: payment.postingDate, party: payment.customer?.name || payment.supplier?.name, reference: payment.number, transaction: customerSide ? 'Receipt' : 'Supplier payment', debitMinor: 0n, creditMinor: payment.amountMinor })),
        ].sort((a, b) => a.date.valueOf() - b.date.valueOf());
        return { name: 'Supplier statement', rows, totals: { balanceMinor: rows.reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0n) } };
      }
      if (name === 'inventory-valuation') {
        const rows = await tx.stockBalance.findMany({ include: { item: true, warehouse: true }, orderBy: [{ warehouse: { code: 'asc' } }, { item: { sku: 'asc' } }] });
        return { name: 'Inventory valuation', rows: rows.map((row) => ({ warehouse: row.warehouse.name, sku: row.item.sku, item: row.item.name, quantityMilli: row.quantityMilli, valueMinor: row.valueMinor })), totals: { valueMinor: rows.reduce((sum, row) => sum + row.valueMinor, 0n) } };
      }
      if (name === 'stock-movements') return { name: 'Stock movements', rows: await tx.stockMovement.findMany({ include: { item: true, warehouse: true }, orderBy: [{ postingDate: 'desc' }, { id: 'desc' }], take: 500 }) };
      if (name === 'tax-report') {
        const output = byAccount.find((row) => row.code === '2200'), input = byAccount.find((row) => row.code === '1300');
        return { name: 'VAT report', rows: [output, input].filter(Boolean), totals: { outputVatMinor: -(output?.balanceMinor || 0n), inputVatMinor: input?.balanceMinor || 0n, netPayableMinor: -(output?.balanceMinor || 0n) - (input?.balanceMinor || 0n) } };
      }
      if (name === 'sales-profitability') {
        const docs = await tx.document.findMany({ where: { type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED }, include: { customer: true, sourceDocument: true } });
        const rows = docs.map((doc) => ({ number: doc.number, customer: doc.customer?.name, revenueMinor: doc.subtotalMinor - doc.discountMinor, costMinor: doc.sourceDocument?.costMinor || 0n, marginMinor: doc.subtotalMinor - doc.discountMinor - (doc.sourceDocument?.costMinor || 0n) }));
        return { name: 'Sales and profitability', rows, totals: { revenueMinor: rows.reduce((sum, row) => sum + row.revenueMinor, 0n), costMinor: rows.reduce((sum, row) => sum + row.costMinor, 0n), marginMinor: rows.reduce((sum, row) => sum + row.marginMinor, 0n) } };
      }
      if (name === 'purchase-analysis') {
        const docs = await tx.document.findMany({ where: { type: { in: [DocumentType.PURCHASE_BILL, DocumentType.PURCHASE_RETURN] }, status: WorkflowStatus.POSTED }, include: { supplier: true } });
        return { name: 'Purchase analysis', rows: docs.map((doc) => ({ number: doc.number, supplier: doc.supplier?.name, type: doc.type, amountMinor: doc.type === DocumentType.PURCHASE_RETURN ? -doc.totalMinor : doc.totalMinor })) };
      }
      if (name === 'cash-flow') {
        const rows = byAccount.filter((row) => ['1000', '1010', '1020'].includes(row.code));
        return { name: 'Cash and bank position', rows, totals: { cashMinor: rows.reduce((sum, row) => sum + row.balanceMinor, 0n) } };
      }
      if (name === 'pos-shifts') {
        const shifts = await tx.posShift.findMany({ include: { branch: true, openedBy: publicUser, closedBy: publicUser, sales: { where: { status: { in: [PosSaleStatus.COMPLETED, PosSaleStatus.RETURNED] } } } }, orderBy: { openedAt: 'desc' }, take: 100 });
        const rows = shifts.map((shift) => ({ register: shift.registerCode, branch: shift.branch.name, openedAt: shift.openedAt, closedAt: shift.closedAt, openedBy: shift.openedBy.name, closedBy: shift.closedBy?.name || 'Open', salesCount: shift.sales.length, openingCashMinor: shift.openingCashMinor, expectedCashMinor: shift.expectedCashMinor, actualCashMinor: shift.actualCashMinor || 0n, differenceMinor: shift.differenceMinor || 0n, status: shift.status }));
        return { name: 'POS shift closing report', rows, totals: { differenceMinor: rows.reduce((sum, row) => sum + row.differenceMinor, 0n) } };
      }
      if (name === 'reconciliation') {
        const arLedger = byAccount.find((row) => row.code === '1100')?.balanceMinor || 0n, apLedger = -(byAccount.find((row) => row.code === '2000')?.balanceMinor || 0n), inventoryLedger = byAccount.find((row) => row.code === '1200')?.balanceMinor || 0n;
        const arSubledger = await this.receivables.totalReceivables(tx);
        const apDocs = await tx.document.aggregate({ where: { type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } });
        const apCredits = await tx.document.aggregate({ where: { type: DocumentType.PURCHASE_RETURN, status: WorkflowStatus.POSTED, sourceDocument: { type: DocumentType.PURCHASE_BILL } }, _sum: { totalMinor: true } });
        const stock = await tx.stockBalance.aggregate({ _sum: { valueMinor: true } });
        const apSubledger = (apDocs._sum.totalMinor || 0n) - (apDocs._sum.paidMinor || 0n) - (apCredits._sum.totalMinor || 0n), inventorySubledger = stock._sum.valueMinor || 0n;
        return { name: 'Control account reconciliation', rows: [{ control: 'Accounts receivable', ledgerMinor: arLedger, subledgerMinor: arSubledger, differenceMinor: arLedger - arSubledger }, { control: 'Accounts payable', ledgerMinor: apLedger, subledgerMinor: apSubledger, differenceMinor: apLedger - apSubledger }, { control: 'Inventory', ledgerMinor: inventoryLedger, subledgerMinor: inventorySubledger, differenceMinor: inventoryLedger - inventorySubledger }] };
      }
      throw new NotFoundException('Report not found');
    });
  }

  async dashboard(actor: Actor) {
    requirePermission(actor, 'dashboard.read');
    return this.withTenant(actor, async (tx) => {
      const [sales, salesCredits, purchases, purchaseCredits, inventory, pending, lowStock, activity, bankAccounts, receivablesMinor] = await Promise.all([
        tx.document.aggregate({ where: { type: DocumentType.SALES_INVOICE, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } }),
        tx.document.aggregate({ where: { type: { in: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] }, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true } }),
        tx.document.aggregate({ where: { type: DocumentType.PURCHASE_BILL, status: WorkflowStatus.POSTED }, _sum: { totalMinor: true, paidMinor: true } }),
        tx.document.aggregate({ where: { type: DocumentType.PURCHASE_RETURN, status: WorkflowStatus.POSTED, sourceDocument: { type: DocumentType.PURCHASE_BILL } }, _sum: { totalMinor: true } }),
        tx.stockBalance.aggregate({ _sum: { valueMinor: true } }),
        tx.document.count({ where: { status: WorkflowStatus.SUBMITTED } }),
        tx.stockBalance.findMany({ include: { item: true, warehouse: true }, orderBy: { quantityMilli: 'asc' }, take: 8 }),
        tx.auditEvent.findMany({ include: { user: publicUser }, orderBy: { createdAt: 'desc' }, take: 8 }),
        tx.bankAccount.findMany({ where: { active: true }, select: { glAccountId: true } }),
        this.receivables.totalReceivables(tx),
      ]);
      const cashLedger = await tx.journalLine.aggregate({
        where: { accountId: { in: bankAccounts.map((account) => account.glAccountId) }, journalEntry: { status: JournalStatus.POSTED } },
        _sum: { debitMinor: true, creditMinor: true },
      });
      return {
        kpis: {
          salesMinor: (sales._sum.totalMinor || 0n) - (salesCredits._sum.totalMinor || 0n),
          purchasesMinor: (purchases._sum.totalMinor || 0n) - (purchaseCredits._sum.totalMinor || 0n),
          cashMinor: (cashLedger._sum.debitMinor || 0n) - (cashLedger._sum.creditMinor || 0n),
          receivablesMinor,
          payablesMinor: (purchases._sum.totalMinor || 0n) - (purchases._sum.paidMinor || 0n) - (purchaseCredits._sum.totalMinor || 0n),
          inventoryMinor: inventory._sum.valueMinor || 0n,
          pendingApprovals: pending,
        },
        lowStock,
        activity,
      };
    });
  }

  async reset(actor: Actor, body: any) {
    requirePermission(actor, 'system.reset');
    if (body.confirmation !== 'RESET ODIN') throw new BadRequestException('Type RESET ODIN to confirm');
    const user = await this.db.admin.user.findUnique({ where: { id: actor.userId } });
    if (!user || !(await compare(String(body.password || ''), user.passwordHash))) throw new ForbiddenException('Administrator password is incorrect');
    await seed(actor.email, actor.tenantId);
    const journals = await this.db.admin.journalEntry.findMany({ where: { tenantId: actor.tenantId, status: JournalStatus.POSTED }, include: { lines: true } });
    const balanced = journals.every((journal) => journal.lines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n) === 0n);
    const stock = await this.db.admin.stockBalance.aggregate({ where: { tenantId: actor.tenantId }, _sum: { valueMinor: true }, _min: { quantityMilli: true, valueMinor: true } });
    const inventoryLines = await this.db.admin.journalLine.findMany({ where: { tenantId: actor.tenantId, account: { code: '1200' }, journalEntry: { status: JournalStatus.POSTED } } });
    const inventoryLedger = inventoryLines.reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
    const integrity = { postedJournalsBalanced: balanced, postedJournalCount: journals.length, negativeStockRows: (stock._min.quantityMilli || 0n) < 0n || (stock._min.valueMinor || 0n) < 0n ? 1 : 0, inventoryDifferenceMinor: (inventoryLedger - (stock._sum.valueMinor || 0n)).toString() };
    return { reset: true, sessionInvalidated: true, integrity, message: 'Odin demo tenant rebuilt from deterministic PostgreSQL seed' };
  }
}
