import { BadRequestException } from '@nestjs/common';
import { WorkflowStatus } from '@prisma/client';
import { calculateDocumentLine, documentEditState } from './erp.service';

describe('Sales workflow business rules', () => {
  it('calculates exclusive, inclusive, and exempt tax with exact fixed-point arithmetic', () => {
    expect(calculateDocumentLine(2_500n, 19_995n, 1_000n, 1_400n, 'EXCLUSIVE')).toEqual({
      grossMinor: 49_988n,
      taxableMinor: 48_988n,
      taxMinor: 6_858n,
      totalMinor: 55_846n,
    });
    expect(calculateDocumentLine(1_000n, 11_400n, 0n, 1_400n, 'INCLUSIVE')).toEqual({
      grossMinor: 11_400n,
      taxableMinor: 10_000n,
      taxMinor: 1_400n,
      totalMinor: 11_400n,
    });
    expect(calculateDocumentLine(1_000n, 10_000n, 500n, 1_400n, 'EXEMPT')).toEqual({
      grossMinor: 10_000n,
      taxableMinor: 9_500n,
      taxMinor: 0n,
      totalMinor: 9_500n,
    });
  });

  it('rejects invalid quantities, discounts, and tax rates before persistence', () => {
    expect(() => calculateDocumentLine(0n, 100n, 0n, 0n, 'EXCLUSIVE')).toThrow(BadRequestException);
    expect(() => calculateDocumentLine(1_000n, 100n, 101n, 0n, 'EXCLUSIVE')).toThrow(/Discount/);
    expect(() => calculateDocumentLine(1_000n, 100n, 0n, 10_001n, 'EXCLUSIVE')).toThrow(/Tax rate/);
  });

  it.each([
    [WorkflowStatus.DRAFT, false, true],
    [WorkflowStatus.REJECTED, false, true],
    [WorkflowStatus.SUBMITTED, false, false],
    [WorkflowStatus.APPROVED, false, false],
    [WorkflowStatus.POSTED, false, false],
    [WorkflowStatus.DRAFT, true, false],
  ])('derives the persisted edit lock for %s with operational effects=%s', (status, effects, editable) => {
    expect(documentEditState(status, effects).editable).toBe(editable);
  });
});
