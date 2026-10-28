import { accountingCsv } from './accounting-csv';

describe('Accounting CSV output', () => {
  it('exports every filtered row with exact decimal monetary units, source references and spreadsheet-safe text', () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({ date: '2026-02-01', journal: `JE-${index}`, code: 'A100', account: '=UNTRUSTED()', description: 'Receipt', debitMinor: '9007199254740993', creditMinor: '0', runningBalanceMinor: '-123', source: `SOURCE-${index}`, costCenter: '' }));
    const output = accountingCsv({ name: 'General ledger', currency: 'EGP', rows }, 'en');
    expect(output.split('\r\n')).toHaveLength(106);
    expect(output).toContain('"90071992547409.93"'); expect(output).toContain('"-1.23"'); expect(output).toContain("\"'=UNTRUSTED()\""); expect(output).toContain('SOURCE-104'); expect(output).toContain('"Currency"');
  });
  it('exports all six trial balance columns with Arabic headers and Western digits', () => {
    const output = accountingCsv({ name: 'Trial balance', currency: 'EGP', rows: [{ code: '1', name: 'Cash', type: 'ASSET', openingDebitMinor: '10000', openingCreditMinor: '0', movementDebitMinor: '200', movementCreditMinor: '100', closingDebitMinor: '10100', closingCreditMinor: '0' }] }, 'ar');
    expect(output).toContain('الأصول'); expect(output).not.toContain('ASSET'); expect(output).toContain('الرصيد الختامي المدين'); expect(output).toContain('"101.00"'); expect(output).not.toMatch(/[٠-٩۰-۹]/); expect(output.split('\r\n')[0].split(',')).toHaveLength(10);
  });
});
