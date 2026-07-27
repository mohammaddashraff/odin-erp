import { DocumentType, WorkflowStatus } from '@prisma/client';
import {
  invoiceSettlement,
  receivableAgeing,
  receivableBaseMinor,
  receivableJournalAmounts,
  type ReceivableDocument,
} from './customer-receivables';

const invoice = (overrides: Partial<ReceivableDocument> = {}): ReceivableDocument => ({
  id: 1n,
  type: DocumentType.SALES_INVOICE,
  status: WorkflowStatus.POSTED,
  customerId: 10n,
  sourceDocumentId: null,
  number: 'SI-TEST-001',
  documentDate: new Date('2026-07-01T00:00:00.000Z'),
  dueDate: new Date('2026-07-31T00:00:00.000Z'),
  currency: 'EGP',
  exchangeRateMicros: 1_000_000n,
  totalMinor: 10_000n,
  paidMinor: 0n,
  ...overrides,
});

const correction = (
  type: ReceivableDocument['type'],
  totalMinor: bigint,
  overrides: Partial<ReceivableDocument> = {},
): ReceivableDocument => ({
  ...invoice(),
  id: type === DocumentType.SALES_RETURN ? 2n : 3n,
  type,
  sourceDocumentId: 1n,
  number: type === DocumentType.SALES_RETURN ? 'SR-TEST-001' : 'CN-TEST-001',
  totalMinor,
  ...overrides,
});

describe('Customer receivable settlement', () => {
  it.each([
    ['unpaid', invoice(), [], { remainingMinor: 10_000n, paymentStatus: 'UNPAID' }],
    ['partially paid', invoice({ paidMinor: 4_000n }), [], { remainingMinor: 6_000n, paymentStatus: 'PARTIALLY_PAID' }],
    ['fully paid', invoice({ paidMinor: 10_000n }), [], { remainingMinor: 0n, paymentStatus: 'PAID' }],
    ['return before payment', invoice(), [correction(DocumentType.SALES_RETURN, 2_500n)], { remainingMinor: 7_500n, paymentStatus: 'PARTIALLY_CREDITED' }],
    ['return after payment', invoice({ paidMinor: 4_000n }), [correction(DocumentType.SALES_RETURN, 2_500n)], { remainingMinor: 3_500n, paymentStatus: 'PARTIALLY_PAID' }],
    ['partial credit note', invoice(), [correction(DocumentType.CREDIT_NOTE, 3_000n)], { remainingMinor: 7_000n, paymentStatus: 'PARTIALLY_CREDITED' }],
    ['full credit note', invoice(), [correction(DocumentType.CREDIT_NOTE, 10_000n)], { remainingMinor: 0n, paymentStatus: 'CREDITED' }],
    ['return and credit note', invoice({ paidMinor: 2_000n }), [correction(DocumentType.SALES_RETURN, 3_000n), correction(DocumentType.CREDIT_NOTE, 5_000n)], { remainingMinor: 0n, paymentStatus: 'PAID' }],
  ])('calculates an invoice that is %s', (_name, source, corrections, expected) => {
    expect(invoiceSettlement(source, corrections)).toMatchObject(expected);
  });

  it('ignores draft, rejected, cancelled, and unrelated corrections', () => {
    const corrections = [
      correction(DocumentType.SALES_RETURN, 1_000n, { status: WorkflowStatus.DRAFT }),
      correction(DocumentType.CREDIT_NOTE, 1_000n, { status: WorkflowStatus.REJECTED }),
      correction(DocumentType.CREDIT_NOTE, 1_000n, { status: WorkflowStatus.CANCELLED }),
      correction(DocumentType.CREDIT_NOTE, 1_000n, { sourceDocumentId: 999n }),
    ];
    expect(invoiceSettlement(invoice(), corrections)).toMatchObject({
      returnedMinor: 0n,
      creditedMinor: 0n,
      remainingMinor: 10_000n,
    });
  });

  it('does not hide a negative balance if invalid historic data exists', () => {
    expect(invoiceSettlement(invoice({ paidMinor: 8_000n }), [
      correction(DocumentType.CREDIT_NOTE, 3_000n),
    ])).toMatchObject({ remainingMinor: -1_000n, paymentStatus: 'CREDIT_BALANCE' });
  });

  it('treats the entire due date as current and assigns exact ageing boundaries', () => {
    const asOf = new Date('2026-07-31T23:59:59.000Z');
    expect(invoiceSettlement(invoice(), [], asOf).paymentStatus).toBe('UNPAID');
    expect(receivableAgeing(new Date('2026-07-31T00:00:00.000Z'), asOf)).toEqual({ daysOverdue: 0, bucket: 'Current' });
    expect(receivableAgeing(new Date('2026-07-30T00:00:00.000Z'), asOf).bucket).toBe('1–30 days');
    expect(receivableAgeing(new Date('2026-07-01T00:00:00.000Z'), asOf).bucket).toBe('1–30 days');
    expect(receivableAgeing(new Date('2026-06-30T00:00:00.000Z'), asOf).bucket).toBe('31–60 days');
    expect(receivableAgeing(new Date('2026-05-31T00:00:00.000Z'), asOf).bucket).toBe('61–90 days');
    expect(receivableAgeing(new Date('2026-05-01T00:00:00.000Z'), asOf).bucket).toBe('More than 90 days');
  });

  it('converts foreign receivables to base currency with fixed-point rounding', () => {
    expect(receivableBaseMinor(10_001n, 49_250_000n)).toBe(492_549n);
    expect(invoiceSettlement(invoice({
      currency: 'USD',
      exchangeRateMicros: 49_250_000n,
      totalMinor: 10_001n,
    }), [
      correction(DocumentType.CREDIT_NOTE, 2_001n, {
        currency: 'USD',
        exchangeRateMicros: 49_250_000n,
      }),
    ])).toMatchObject({
      netReceivableMinor: 8_000n,
      baseNetReceivableMinor: 394_000n,
    });
    expect(receivableJournalAmounts(10_001n, 1_401n, 49_250_000n)).toEqual({
      receivableMinor: 492_549n,
      taxBaseMinor: 68_999n,
      revenueBaseMinor: 423_550n,
    });
  });
});
