import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createAccountingPdf, accountingPdfAmount, AccountingPdfReport } from './accounting-pdf';
import { ErpController } from './erp.controller';

// Poppler verifies the produced PDF rather than mirroring the renderer's data model.
// Run on the QA host with pdftotext, pdfinfo, pdffonts and pdftoppm installed.
const directory = process.env.ODIN_PDF_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'odin-accounting-pdf-'));
const compact = (value: string) => value.replace(/[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
const base = { currency: 'EGP', basis: 'POSTED', reportContext: { company: 'ODIN Test Company', branch: 'QA Main Branch' }, filters: { from: '2026-09-01', to: '2026-09-30', branchId: '1' } };
function capture(document: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}
async function evidence(name: string, report: AccountingPdfReport, language: 'en' | 'ar' = 'en') {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.pdf`), buffer = await capture(createAccountingPdf(report, language));
  writeFileSync(path, buffer);
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  return { path, text, pages };
}
afterAll(() => { if (!process.env.ODIN_PDF_EVIDENCE_DIR) rmSync(directory, { recursive: true, force: true }); });

it('formats minor money exactly beyond Number precision and retains negatives and cents', () => {
  expect(accountingPdfAmount('900719925474099312345')).toBe('9,007,199,254,740,993,123.45');
  expect(accountingPdfAmount('-10001')).toBe('-100.01');
  expect(accountingPdfAmount(0n)).toBe('0.00');
});

it('exports all 105 ledger rows and all financial columns with repeated headings, scope and final totals', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({ date: '2026-09-15', journal: `JRN-${String(index + 1).padStart(5, '0')}`, code: '1112', account: 'Bank Current Account', description: `Movement ${index + 1}`, source: `SRC-${String(index + 1).padStart(5, '0')}`, debitMinor: 10025n, creditMinor: 0n, runningBalanceMinor: 500000n + BigInt(index + 1) * 10025n }));
  const report = { ...base, name: 'General ledger', rows, totals: { openingBalanceMinor: 500000n, debitMinor: 1052625n, creditMinor: 0n, closingBalanceMinor: 1552625n } };
  const { text, pages } = await evidence('ledger-en', report);
  expect(pages).toBeGreaterThan(3);
  for (let index = 1; index <= 105; index++) expect(text).toContain(`JRN-${String(index).padStart(5, '0')}`);
  expect(text).toContain('SRC-00105');
  expect(compact(text)).toContain('Runningbalance');
  expect(compact(text)).toContain('15,526.25');
  expect(compact(text)).toContain('Closingbalance');
  expect(text).toContain('ODIN Test Company');
  expect(text).toContain('QA Main Branch');
  expect(text).toContain('2026-09-01');
  expect(text).toContain('2026-09-30');
  expect(text.match(/General ledger/g)?.length).toBe(pages);
  expect(text.match(/Journal/g)?.length).toBe(pages);
});

it.each(['en', 'ar'] as const)('exports all eight trial-balance columns and exact last-row/totals money, rendering %s with packaged fonts', async (language) => {
  const huge = 900719925474099312345n;
  const rows = Array.from({ length: 100 }, (_, index) => ({ code: `A-${String(index + 1).padStart(4, '0')}`, name: language === 'ar' ? 'الحساب البنكي الرئيسي' : 'Main bank account', openingDebitMinor: 10001n, openingCreditMinor: 20002n, movementDebitMinor: 30003n, movementCreditMinor: 40004n, closingDebitMinor: index === 99 ? huge : 50005n, closingCreditMinor: 60006n }));
  const totals = { openingDebitMinor: 1000100n, openingCreditMinor: 2000200n, movementDebitMinor: 3000300n, movementCreditMinor: 4000400n, closingDebitMinor: huge + 99n * 50005n, closingCreditMinor: 6000600n, differenceMinor: huge + 99n * 50005n - 6000600n };
  const report = { ...base, name: 'Trial balance', reportContext: { company: language === 'ar' ? 'شركة أودين للحلول' : 'ODIN Test Company', branch: language === 'ar' ? 'فرع القاهرة' : 'QA Main Branch' }, rows, totals };
  const { path, text, pages } = await evidence(`trial-${language}`, report, language);
  expect(pages).toBeGreaterThan(3);
  expect(text).toContain('A-0100');
  for (const value of ['100.01', '200.02', '300.03', '400.04', '600.06', accountingPdfAmount(huge), accountingPdfAmount(totals.closingDebitMinor)]) expect(compact(text)).toContain(value);
  if (language === 'ar') {
    expect(compact(text)).toContain(compact('ميزان المراجعة'));
    expect(compact(text)).toContain(compact('الحساب البنكي الرئيسي'));
    expect(compact(text)).toContain(compact('فرع القاهرة'));
  } else {
    for (const header of ['Opening debit', 'Opening credit', 'Movement debit', 'Movement credit', 'Closing debit', 'Closing credit']) expect(compact(text)).toContain(compact(header));
  }
  const fonts = execFileSync('pdffonts', [path], { encoding: 'utf8' });
  expect(fonts).toContain('Manrope');
  if (language === 'ar') expect(fonts).toContain('NotoSansArabic');
  const rendered = join(directory, `trial-${language}`);
  execFileSync('pdftoppm', ['-f', '1', '-singlefile', '-scale-to', '1400', '-png', path, rendered]);
  expect(readFileSync(`${rendered}.png`).subarray(1, 4).toString()).toBe('PNG');
});

it('keeps document and POS PDF output working beyond the former 84-row limit', async () => {
  const controller = new ErpController(null as any, null as any);
  for (const title of ['SALES_INVOICE INV-0099', 'POS RECEIPT POS-0099']) {
    const output = new PassThrough() as PassThrough & { type: () => any; setHeader: () => any };
    output.type = () => output; output.setHeader = () => output;
    const finished = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; output.on('data', (chunk) => chunks.push(chunk)); output.on('end', () => resolve(Buffer.concat(chunks))); output.on('error', reject); });
    (controller as any).writePdf(output, title, Array.from({ length: 90 }, (_, index) => ({ sku: `SKU-${String(index + 1).padStart(4, '0')}`, item: 'Product', quantityMilli: 1000n, unitPriceMinor: 100n, taxMinor: 14n, totalMinor: 114n })), { totalMinor: 10260n }, 'document.pdf', 'en');
    const path = join(directory, title.startsWith('POS') ? 'pos.pdf' : 'document.pdf');
    writeFileSync(path, await finished);
    const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
    expect(text).toContain('SKU-0090');
    expect(text).toContain('102.60');
  }
});

it('passes the authorized report metadata through the actual PDF controller output', async () => {
  const query = { from: '2026-09-01', to: '2026-09-30', branchId: '1' }, actor = { userId: 'tester' };
  const service = { reportOutput: jest.fn().mockResolvedValue({ ...base, name: 'Balance sheet', rows: [{ code: '1000', name: 'Assets', type: 'ASSET', amountMinor: 12345n }], totals: { assetsMinor: 12345n, liabilitiesMinor: 0n, equityMinor: 12345n, differenceMinor: 0n } }) };
  const controller = new ErpController(service as any, null as any);
  const output = new PassThrough() as PassThrough & { type: () => any; setHeader: () => any };
  output.type = () => output; output.setHeader = () => output;
  const finished = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; output.on('data', (chunk) => chunks.push(chunk)); output.on('end', () => resolve(Buffer.concat(chunks))); output.on('error', reject); });
  await controller.reportPdf({ actor, headers: { 'x-odin-language': 'en' } } as any, 'balance-sheet', output as any, query);
  const path = join(directory, 'controller-balance-sheet.pdf');
  writeFileSync(path, await finished);
  expect(service.reportOutput).toHaveBeenCalledWith(actor, 'balance-sheet', 'print', query);
  const text = execFileSync('pdftotext', [path, '-'], { encoding: 'utf8' });
  expect(text).toContain('ODIN Test Company');
  expect(text).toContain('QA Main Branch');
  expect(text).toContain('2026-09-01');
  expect(text).toContain('123.45');
});

it('continues an exceptionally long cell across pages without ellipsis or a missing tail', async () => {
  const description = `${'Long description content '.repeat(300)}FINAL-NARRATIVE-MARKER`;
  const { text, pages } = await evidence('ledger-long-description', { ...base, name: 'General ledger', rows: [{ date: '2026-09-15', journal: 'JRN-LONG', code: '1112', account: 'Bank Current Account', description, source: 'SRC-LONG', debitMinor: 100n, creditMinor: 0n, runningBalanceMinor: 100n }], totals: { closingBalanceMinor: 100n } });
  expect(pages).toBeGreaterThan(1);
  expect(compact(text)).toContain('FINAL-NARRATIVE-MARKER');
  expect(text.match(/Long description content/g)?.length).toBe(300);
  expect(compact(text)).toContain('Closingbalance');
});


it('keeps a normal thirteen-account trial balance and its reconciliation on one complete page', async () => {
  const rows = Array.from({ length: 13 }, (_, index) => ({ code: String(1000 + index * 10), name: index === 12 ? 'Recoverable Input VAT' : 'Bank Current Account', openingDebitMinor: 0n, openingCreditMinor: 0n, movementDebitMinor: 100000n, movementCreditMinor: 100000n, closingDebitMinor: 0n, closingCreditMinor: 0n }));
  const totals = { openingDebitMinor: 0n, openingCreditMinor: 0n, movementDebitMinor: 1300000n, movementCreditMinor: 1300000n, closingDebitMinor: 0n, closingCreditMinor: 0n, differenceMinor: 0n };
  for (const language of ['en', 'ar'] as const) {
    const { pages, text } = await evidence(`trial-compact-${language}`, { ...base, name: 'Trial balance', rows, totals }, language);
    expect(pages).toBe(1);
    expect(compact(text)).toContain('13,000.00');
    expect(compact(text)).toContain(compact(language === 'ar' ? 'الفرق' : 'Difference'));
    expect(text).toContain('1120');
    if (language === 'ar') expect(compact(text)).toContain(compact('ضريبة القيمة المضافة القابلة للاسترداد'));
  }
});
