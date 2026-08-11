import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentType, PaymentKind, Prisma, WorkflowStatus } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type ReceivableDocument = {
  id: bigint;
  type: DocumentType;
  status: WorkflowStatus;
  customerId: bigint | null;
  sourceDocumentId: bigint | null;
  number: string;
  documentDate: Date;
  dueDate: Date | null;
  currency: string;
  exchangeRateMicros: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
};

export type InvoiceSettlement = {
  grossInvoiceMinor: bigint;
  paidMinor: bigint;
  returnedMinor: bigint;
  creditedMinor: bigint;
  netReceivableMinor: bigint;
  remainingMinor: bigint;
  paymentStatus: 'NOT_POSTED' | 'UNPAID' | 'PARTIALLY_PAID' | 'PARTIALLY_CREDITED' | 'PAID' | 'CREDITED' | 'OVERDUE' | 'CREDIT_BALANCE';
  baseGrossInvoiceMinor: bigint;
  basePaidMinor: bigint;
  baseReturnedMinor: bigint;
  baseCreditedMinor: bigint;
  baseNetReceivableMinor: bigint;
  baseRemainingMinor: bigint;
};

export type AgeingBucket = 'Current' | '1–30 days' | '31–60 days' | '61–90 days' | 'More than 90 days';

const RECEIVABLE_DOCUMENT_TYPES = [
  DocumentType.SALES_INVOICE,
  DocumentType.SALES_RETURN,
  DocumentType.CREDIT_NOTE,
] as const;

const CREDIT_DOCUMENT_TYPES = new Set<DocumentType>([
  DocumentType.SALES_RETURN,
  DocumentType.CREDIT_NOTE,
]);

const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export function receivableAgeing(dueDate: Date, asOf: Date) {
  const daysOverdue = Math.max(0, Math.floor((utcDay(asOf) - utcDay(dueDate)) / 86_400_000));
  const bucket: AgeingBucket = daysOverdue === 0 ? 'Current'
    : daysOverdue <= 30 ? '1–30 days'
    : daysOverdue <= 60 ? '31–60 days'
    : daysOverdue <= 90 ? '61–90 days'
    : 'More than 90 days';
  return { daysOverdue, bucket };
}

export function receivableBaseMinor(amountMinor: bigint, exchangeRateMicros: bigint) {
  if (exchangeRateMicros <= 0n) throw new BadRequestException('Exchange rate must be greater than zero.');
  const numerator = amountMinor * exchangeRateMicros;
  return numerator >= 0n
    ? (numerator + 500_000n) / 1_000_000n
    : (numerator - 500_000n) / 1_000_000n;
}

export function receivableJournalAmounts(totalMinor: bigint, taxMinor: bigint, exchangeRateMicros: bigint) {
  const receivableMinor = receivableBaseMinor(totalMinor, exchangeRateMicros);
  const taxBaseMinor = receivableBaseMinor(taxMinor, exchangeRateMicros);
  return { receivableMinor, taxBaseMinor, revenueBaseMinor: receivableMinor - taxBaseMinor };
}

export function invoiceSettlement(
  invoice: ReceivableDocument,
  corrections: ReceivableDocument[] = [],
  asOf = new Date(),
): InvoiceSettlement {
  const postedCorrections = corrections.filter((correction) =>
    correction.status === WorkflowStatus.POSTED
    && correction.sourceDocumentId === invoice.id
    && CREDIT_DOCUMENT_TYPES.has(correction.type),
  );
  const returnedMinor = postedCorrections
    .filter((correction) => correction.type === DocumentType.SALES_RETURN)
    .reduce((sum, correction) => sum + correction.totalMinor, 0n);
  const creditedMinor = postedCorrections
    .filter((correction) => correction.type === DocumentType.CREDIT_NOTE)
    .reduce((sum, correction) => sum + correction.totalMinor, 0n);
  const grossInvoiceMinor = invoice.totalMinor;
  const paidMinor = invoice.paidMinor;
  const netReceivableMinor = grossInvoiceMinor - returnedMinor - creditedMinor;
  const remainingMinor = netReceivableMinor - paidMinor;
  let paymentStatus: InvoiceSettlement['paymentStatus'];
  if (invoice.status !== WorkflowStatus.POSTED) paymentStatus = 'NOT_POSTED';
  else if (remainingMinor < 0n) paymentStatus = 'CREDIT_BALANCE';
  else if (remainingMinor === 0n && paidMinor === 0n && returnedMinor + creditedMinor > 0n) paymentStatus = 'CREDITED';
  else if (remainingMinor === 0n) paymentStatus = 'PAID';
  else if (paidMinor > 0n) paymentStatus = 'PARTIALLY_PAID';
  else if (returnedMinor + creditedMinor > 0n) paymentStatus = 'PARTIALLY_CREDITED';
  else if (invoice.dueDate && receivableAgeing(invoice.dueDate, asOf).daysOverdue > 0) paymentStatus = 'OVERDUE';
  else paymentStatus = 'UNPAID';
  const rate = invoice.exchangeRateMicros;
  const baseGrossInvoiceMinor = receivableBaseMinor(grossInvoiceMinor, rate);
  const basePaidMinor = receivableBaseMinor(paidMinor, rate);
  const baseReturnedMinor = receivableBaseMinor(returnedMinor, rate);
  const baseCreditedMinor = receivableBaseMinor(creditedMinor, rate);
  const baseNetReceivableMinor = baseGrossInvoiceMinor - baseReturnedMinor - baseCreditedMinor;
  return {
    grossInvoiceMinor,
    paidMinor,
    returnedMinor,
    creditedMinor,
    netReceivableMinor,
    remainingMinor,
    paymentStatus,
    baseGrossInvoiceMinor,
    basePaidMinor,
    baseReturnedMinor,
    baseCreditedMinor,
    baseNetReceivableMinor,
    baseRemainingMinor: baseNetReceivableMinor - basePaidMinor,
  };
}

@Injectable()
export class CustomerReceivablesService {
  private branchWhere(branchIds?: bigint[]) {
    return branchIds ? { branchId: { in: branchIds } } : {};
  }

  async settlements(tx: Tx, invoices: ReceivableDocument[], asOf = new Date()) {
    if (!invoices.length) return new Map<string, InvoiceSettlement>();
    const corrections = await tx.document.findMany({
      where: {
        type: { in: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] },
        status: WorkflowStatus.POSTED,
        sourceDocumentId: { in: invoices.map((invoice) => invoice.id) },
      },
    });
    return new Map(invoices.map((invoice) => [
      invoice.id.toString(),
      invoiceSettlement(invoice, corrections, asOf),
    ]));
  }

  async decorateInvoices<T extends ReceivableDocument>(tx: Tx, documents: T[], asOf = new Date()) {
    const invoices = documents.filter((document) => document.type === DocumentType.SALES_INVOICE);
    const settlements = await this.settlements(tx, invoices, asOf);
    return documents.map((document) => document.type === DocumentType.SALES_INVOICE
      ? { ...document, ...settlements.get(document.id.toString())! }
      : document);
  }

  async customerBalances(tx: Tx, customerIds?: bigint[], branchIds?: bigint[], documentScope?: Prisma.DocumentWhereInput) {
    if (customerIds && !customerIds.length) return new Map<string, bigint>();
    const baseWhere: Prisma.DocumentWhereInput = {
      type: DocumentType.SALES_INVOICE,
      status: WorkflowStatus.POSTED,
      customerId: customerIds ? { in: customerIds } : { not: null },
      ...this.branchWhere(branchIds),
    };
    const invoices = await tx.document.findMany({
      where: documentScope ? { AND: [baseWhere, documentScope] } : baseWhere,
      select: {
        id: true,
        customerId: true,
        totalMinor: true,
        paidMinor: true,
        exchangeRateMicros: true,
      },
    });
    const corrections = invoices.length ? await tx.document.findMany({
      where: {
        type: { in: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] },
        status: WorkflowStatus.POSTED,
        sourceDocumentId: { in: invoices.map(({ id }) => id) },
      },
      select: { customerId: true, totalMinor: true, exchangeRateMicros: true },
    }) : [];
    const balances = new Map<string, bigint>();
    for (const invoice of invoices) {
      const key = invoice.customerId!.toString();
      const movement = receivableBaseMinor(invoice.totalMinor, invoice.exchangeRateMicros) - receivableBaseMinor(invoice.paidMinor, invoice.exchangeRateMicros);
      balances.set(key, (balances.get(key) || 0n) + movement);
    }
    for (const correction of corrections) {
      const key = correction.customerId!.toString();
      const movement = receivableBaseMinor(correction.totalMinor, correction.exchangeRateMicros);
      balances.set(key, (balances.get(key) || 0n) - movement);
    }
    return balances;
  }

  async totalReceivables(tx: Tx, branchIds?: bigint[]) {
    const balances = await this.customerBalances(tx, undefined, branchIds);
    return [...balances.values()].reduce((sum, balance) => sum + balance, 0n);
  }

  async ageing(tx: Tx, options: { customerId?: bigint; branchIds?: bigint[]; asOf?: Date; documentScope?: Prisma.DocumentWhereInput } = {}) {
    const asOf = options.asOf || new Date();
    const baseWhere: Prisma.DocumentWhereInput = {
      type: DocumentType.SALES_INVOICE,
      status: WorkflowStatus.POSTED,
      ...(options.customerId ? { customerId: options.customerId } : {}),
      ...this.branchWhere(options.branchIds),
    };
    const invoices = await tx.document.findMany({
      where: options.documentScope ? { AND: [baseWhere, options.documentScope] } : baseWhere,
      include: { customer: true },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    const settlements = await this.settlements(tx, invoices, asOf);
    return invoices.flatMap((invoice) => {
      const settlement = settlements.get(invoice.id.toString())!;
      if (settlement.remainingMinor <= 0n) return [];
      const dueDate = invoice.dueDate || invoice.documentDate;
      const { daysOverdue, bucket } = receivableAgeing(dueDate, asOf);
      return [{
        invoiceId: invoice.id,
        number: invoice.number,
        customerId: invoice.customerId,
        party: invoice.customer?.name || '',
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        grossInvoiceMinor: invoice.totalMinor,
        paidMinor: settlement.paidMinor,
        returnedMinor: settlement.returnedMinor,
        creditedMinor: settlement.creditedMinor,
        transactionOutstandingMinor: settlement.remainingMinor,
        outstandingMinor: settlement.baseRemainingMinor,
        daysOverdue,
        bucket,
      }];
    });
  }

  async customerStatement(tx: Tx, options: {
    customerId?: bigint;
    branchIds?: bigint[];
    documentScope?: Prisma.DocumentWhereInput;
    paymentScope?: Prisma.PaymentWhereInput;
    allocationDocumentScope?: Prisma.DocumentWhereInput;
  } = {}) {
    const baseDocumentWhere: Prisma.DocumentWhereInput = {
      type: { in: [...RECEIVABLE_DOCUMENT_TYPES] },
      status: WorkflowStatus.POSTED,
      ...(options.customerId ? { customerId: options.customerId } : {}),
      ...this.branchWhere(options.branchIds),
    };
    const documentWhere: Prisma.DocumentWhereInput = options.documentScope ? { AND: [baseDocumentWhere, options.documentScope] } : baseDocumentWhere;
    const basePaymentWhere: Prisma.PaymentWhereInput = {
      kind: PaymentKind.RECEIPT,
      ...(options.customerId ? { customerId: options.customerId } : {}),
      ...(options.branchIds ? { allocations: { some: { document: { branchId: { in: options.branchIds } } } } } : {}),
    };
    const [documents, payments, tenant] = await Promise.all([
      tx.document.findMany({
        where: documentWhere,
        include: { customer: true, sourceDocument: { select: { number: true } } },
      }),
      tx.payment.findMany({
        where: options.paymentScope ? { AND: [basePaymentWhere, options.paymentScope] } : basePaymentWhere,
        include: {
          customer: true,
          bankAccount: true,
          allocations: {
            ...(options.allocationDocumentScope ? { where: { document: options.allocationDocumentScope } } : {}),
            include: { document: { select: { number: true, branchId: true, exchangeRateMicros: true, currency: true } } },
          },
        },
      }),
      tx.tenant.findFirstOrThrow({ select: { baseCurrency: true } }),
    ]);
    const rows = [
      ...documents.map((document) => {
        const isCredit = CREDIT_DOCUMENT_TYPES.has(document.type);
        const baseAmount = receivableBaseMinor(document.totalMinor, document.exchangeRateMicros);
        return {
          sortAt: document.postedAt || document.createdAt,
          sortId: `D${document.id.toString().padStart(24, '0')}`,
          customerId: document.customerId!,
          date: document.documentDate,
          party: document.customer?.name || '',
          documentNumber: document.number,
          transaction: document.type,
          debitMinor: isCredit ? 0n : baseAmount,
          creditMinor: isCredit ? baseAmount : 0n,
          currency: document.currency,
          transactionAmountMinor: document.totalMinor,
          status: document.status,
          sourceDocument: document.sourceDocument?.number || null,
          reference: document.sourceDocument?.number || document.number,
          baseCurrency: tenant.baseCurrency,
        };
      }),
      ...payments.map((payment) => {
        const scopedAllocations = options.branchIds
          ? payment.allocations.filter((allocation) => options.branchIds!.includes(allocation.document.branchId))
          : payment.allocations;
        const baseAmount = scopedAllocations.reduce(
          (sum, allocation) => sum + receivableBaseMinor(allocation.amountMinor, allocation.document.exchangeRateMicros),
          0n,
        );
        const transactionAmount = scopedAllocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0n);
        return {
          sortAt: payment.createdAt,
          sortId: `P${payment.id.toString().padStart(24, '0')}`,
          customerId: payment.customerId!,
          date: payment.postingDate,
          party: payment.customer?.name || '',
          documentNumber: payment.number,
          transaction: 'RECEIPT',
          debitMinor: 0n,
          creditMinor: baseAmount,
          currency: scopedAllocations[0]?.document.currency || payment.bankAccount.currency,
          transactionAmountMinor: transactionAmount || payment.amountMinor,
          status: 'POSTED',
          sourceDocument: scopedAllocations.map((allocation) => allocation.document.number).join(', '),
          reference: payment.reference || scopedAllocations.map((allocation) => allocation.document.number).join(', '),
          baseCurrency: tenant.baseCurrency,
        };
      }).filter((row) => row.creditMinor !== 0n),
    ].sort((left, right) =>
      left.date.valueOf() - right.date.valueOf()
      || left.sortAt.valueOf() - right.sortAt.valueOf()
      || left.sortId.localeCompare(right.sortId),
    );
    const running = new Map<string, bigint>();
    return rows.map(({ sortAt: _sortAt, sortId: _sortId, ...row }) => {
      const key = row.customerId.toString();
      const runningBalanceMinor = (running.get(key) || 0n) + row.debitMinor - row.creditMinor;
      running.set(key, runningBalanceMinor);
      return { ...row, runningBalanceMinor };
    });
  }

  async assertCreditWithinRemaining(tx: Tx, correction: ReceivableDocument) {
    if (!CREDIT_DOCUMENT_TYPES.has(correction.type)) return;
    if (!correction.sourceDocumentId) throw new BadRequestException(`${correction.type} must reference its source sales invoice.`);
    const invoice = await tx.document.findUnique({ where: { id: correction.sourceDocumentId } });
    if (!invoice || invoice.type !== DocumentType.SALES_INVOICE || invoice.status !== WorkflowStatus.POSTED) {
      throw new BadRequestException(`${correction.type} must reference a posted sales invoice.`);
    }
    if (invoice.customerId !== correction.customerId || invoice.currency !== correction.currency || invoice.exchangeRateMicros !== correction.exchangeRateMicros) {
      throw new BadRequestException(`${correction.type} must preserve the source invoice customer, currency, and exchange rate.`);
    }
    const otherCorrections = await tx.document.findMany({
      where: {
        id: { not: correction.id },
        sourceDocumentId: invoice.id,
        type: { in: [DocumentType.SALES_RETURN, DocumentType.CREDIT_NOTE] },
        status: WorkflowStatus.POSTED,
      },
    });
    const settlement = invoiceSettlement(invoice, otherCorrections);
    if (correction.totalMinor > settlement.remainingMinor) {
      throw new BadRequestException(
        `${correction.type} ${correction.number} exceeds the remaining receivable for ${invoice.number}. `
        + `Available ${settlement.remainingMinor.toString()} minor units; requested ${correction.totalMinor.toString()}. `
        + 'Customer credit balances require an explicit credit/refund workflow.',
      );
    }
  }
}
