import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiLanguage, apiLabel, apiText, normalizeWesternDigits } from './i18n';

type Row = Record<string, unknown>;
export type AccountingPdfReport = {
  name: string;
  rows?: Row[];
  totals?: Row;
  currency?: string;
  basis?: string;
  generatedAt?: string;
  companyName?: string;
  branchName?: string;
  reportContext?: { company?: string; branch?: string };
  filters?: { from?: string; to?: string; branchId?: string; accountId?: string; costCenter?: string; search?: string; includeZero?: boolean };
  context?: { companyName?: string; branchName?: string; accountName?: string };
};
type Column = { key: string; en: string; ar: string; weight: number; money?: boolean };
const palette = { blue: '#245DE8', navy: '#102747', muted: '#53647B', border: '#DCE4EF', panel: '#F4F7FC' };
const isArabic = (text: string) => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(text);
const labels: Record<string, [string, string]> = {
  openingBalanceMinor: ['Opening balance', 'الرصيد الافتتاحي'], closingBalanceMinor: ['Closing balance', 'الرصيد الختامي'],
  openingDebitMinor: ['Opening debit', 'مدين افتتاحي'], openingCreditMinor: ['Opening credit', 'دائن افتتاحي'],
  movementDebitMinor: ['Movement debit', 'الحركة المدينة'], movementCreditMinor: ['Movement credit', 'الحركة الدائنة'],
  closingDebitMinor: ['Closing debit', 'مدين ختامي'], closingCreditMinor: ['Closing credit', 'دائن ختامي'],
  differenceMinor: ['Difference', 'الفرق'], revenueMinor: ['Revenue', 'الإيرادات'], costOfSalesMinor: ['Cost of sales', 'تكلفة المبيعات'],
  grossProfitMinor: ['Gross profit', 'مجمل الربح'], operatingExpenseMinor: ['Operating expenses', 'مصروفات التشغيل'],
  operatingProfitMinor: ['Operating profit', 'الربح التشغيلي'], otherIncomeMinor: ['Other income', 'إيرادات أخرى'],
  otherExpenseMinor: ['Other expenses', 'مصروفات أخرى'], profitMinor: ['Net profit', 'صافي الربح'],
  assetsMinor: ['Assets', 'الأصول'], liabilitiesMinor: ['Liabilities', 'الالتزامات'], equityMinor: ['Equity', 'حقوق الملكية'],
  currentEarningsMinor: ['Current earnings', 'أرباح الفترة'], equityIncludingEarningsMinor: ['Equity including earnings', 'حقوق الملكية شاملة الأرباح'],
  liabilitiesAndEquityMinor: ['Liabilities and equity', 'الالتزامات وحقوق الملكية'],
};
const accountTypes: Record<string, [string, string]> = {
  ASSET: ['Assets', 'الأصول'], LIABILITY: ['Liabilities', 'الالتزامات'], EQUITY: ['Equity', 'حقوق الملكية'],
  REVENUE: ['Revenue', 'الإيرادات'], COGS: ['Cost of sales', 'تكلفة المبيعات'], EXPENSE: ['Expenses', 'المصروفات'],
  OTHER_INCOME: ['Other income', 'إيرادات أخرى'], OTHER_EXPENSE: ['Other expenses', 'مصروفات أخرى'],
};
const trialColumns: Column[] = [
  { key: 'code', en: 'Code', ar: 'الرمز', weight: 58 }, { key: 'name', en: 'Account', ar: 'الحساب', weight: 166 },
  ...(['openingDebitMinor', 'openingCreditMinor', 'movementDebitMinor', 'movementCreditMinor', 'closingDebitMinor', 'closingCreditMinor'] as const).map((key) => ({ key, en: labels[key][0], ar: labels[key][1], weight: 90, money: true })),
];
const ledgerColumns: Column[] = [
  { key: 'date', en: 'Date', ar: 'التاريخ', weight: 62 }, { key: 'journal', en: 'Journal', ar: 'القيد', weight: 76 },
  { key: 'account', en: 'Account', ar: 'الحساب', weight: 102 }, { key: 'description', en: 'Description', ar: 'البيان', weight: 124 },
  { key: 'source', en: 'Source', ar: 'المصدر', weight: 78 },
  { key: 'debitMinor', en: 'Debit', ar: 'مدين', weight: 88, money: true }, { key: 'creditMinor', en: 'Credit', ar: 'دائن', weight: 88, money: true },
  { key: 'runningBalanceMinor', en: 'Running balance', ar: 'الرصيد الجاري', weight: 100, money: true },
];
const statementColumns: Column[] = [
  { key: 'code', en: 'Code', ar: 'الرمز', weight: 80 }, { key: 'name', en: 'Account', ar: 'الحساب', weight: 360 },
  { key: 'type', en: 'Type', ar: 'النوع', weight: 160 }, { key: 'amountMinor', en: 'Amount', ar: 'المبلغ', weight: 164, money: true },
];

/** Exact decimal output. Monetary values never pass through Number or parseFloat. */
export function accountingPdfAmount(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  const amount = BigInt(String(value));
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${(absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function publicAsset(relative: string) {
  const roots = [resolve(__dirname, '../../web/public'), resolve(__dirname, '../../../../web/public'), resolve(process.cwd(), 'apps/web/public'), resolve(process.cwd(), '../web/public')];
  const path = roots.map((root) => resolve(root, relative)).find(existsSync);
  if (!path) throw new Error(`Required accounting PDF asset is missing: ${relative}`);
  return path;
}

/** Render only already-authorized, already-filtered report output. Call pipe(), then end(). */
export function createAccountingPdf(report: AccountingPdfReport, language: ApiLanguage = 'en'): PDFKit.PDFDocument {
  const rtl = language === 'ar', translate = (en: string, ar: string) => rtl ? ar : en;
  const title = apiText(report.name, language), rows = report.rows || [], totals = report.totals || {}, filters = report.filters || {};
  const ledger = ['General ledger', 'Account ledger'].includes(report.name), trial = report.name === 'Trial balance';
  const columns = (trial ? trialColumns : ledger ? ledgerColumns : statementColumns).map((column) => ({ ...column }));
  if (ledger && rows.some((row) => row.costCenter)) columns.splice(5, 0, { key: 'costCenter', en: 'Cost center', ar: 'مركز التكلفة', weight: 65 });
  for (const column of columns) if (column.money) column.weight = [...rows, totals].reduce((minimum, row) => Math.max(minimum, accountingPdfAmount(row[column.key]).length * 6 + 14), column.weight);
  const wideAmounts = [...rows, totals].some((row) => Object.entries(row).some(([key, value]) => key.endsWith('Minor') && value !== null && value !== undefined && accountingPdfAmount(value).length > 18));
  const doc = new PDFDocument({ size: wideAmounts ? 'A3' : 'A4', layout: 'landscape', margins: { top: 30, right: 34, bottom: 30, left: 34 }, bufferPages: true, info: { Title: title, Author: 'AV8 ERP', Subject: report.reportContext?.company || report.companyName || report.context?.companyName || 'Accounting report' } });
  for (const [name, file] of Object.entries({ latin: 'manrope-regular.ttf', latinBold: 'manrope-bold.ttf', arabic: 'noto-arabic-regular.ttf', arabicBold: 'noto-arabic-bold.ttf' })) doc.registerFont(name, publicAsset(`fonts/${file}`));
  const margin = 34, width = doc.page.width - 2 * margin, bottom = doc.page.height - 42, lineHeight = 14, pad = trial ? 6 : 7;
  const weight = columns.reduce((value, column) => value + column.weight, 0);
  const widths = columns.map((column) => column.weight / weight * width);
  const positions = widths.map((_, index) => rtl ? margin + width - widths.slice(0, index + 1).reduce((a, b) => a + b, 0) : margin + widths.slice(0, index).reduce((a, b) => a + b, 0));
  const font = (text: string, bold = false) => `${isArabic(text) ? 'arabic' : 'latin'}${bold ? 'Bold' : ''}`;
  const clean = (value: unknown) => normalizeWesternDigits(value).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  const measure = (text: string, size: number, bold = false) => doc.font(font(text, bold)).fontSize(size).widthOfString(text, { features: [] });
  const wrap = (value: unknown, maxWidth: number, size = 8.5, bold = false) => {
    const result: string[] = [];
    for (const paragraph of clean(value).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, size, bold) <= maxWidth) { line = next; continue; }
        if (line) result.push(line);
        line = '';
        for (const character of word) {
          if (line && measure(line + character, size, bold) > maxWidth) { result.push(line); line = ''; }
          line += character;
        }
      }
      result.push(line);
    }
    return result.length ? result : [''];
  };
  // Fontkit shapes complete Arabic runs. Separate Latin/number runs keep identifiers
  // and Western digits LTR; whole-run features bypass PDFKit's per-word layout cache.
  const drawLine = (value: string, x: number, y: number, maxWidth: number, size = 8.5, align: 'left' | 'right' | 'center' = rtl ? 'right' : 'left', bold = false, color = palette.navy) => {
    const text = clean(value);
    const runs: { text: string; arabic: boolean }[] = [];
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const arabic = isArabic(word), previous = runs.at(-1);
      if (previous && previous.arabic === arabic) previous.text += ` ${word}`;
      else runs.push({ text: word, arabic });
    }
    const space = measure(' ', size, bold), lengths = runs.map((run) => measure(run.text, size, bold));
    const total = lengths.reduce((a, b) => a + b, 0) + Math.max(0, runs.length - 1) * space;
    let cursor = x + (align === 'right' ? maxWidth - total : align === 'center' ? (maxWidth - total) / 2 : 0);
    const visual = isArabic(text) ? runs.map((run, index) => ({ ...run, width: lengths[index] })).reverse() : runs.map((run, index) => ({ ...run, width: lengths[index] }));
    for (const run of visual) {
      // Arabic glyphs are painted in visual RTL order. Tag that visual sequence so
      // PDF text extractors can recover the original characters without fontkit's
      // shared contextual-glyph Unicode aliases (e.g. dotted Arabic letters).
      if (run.arabic) doc.markContent('Span', { actual: [...run.text].reverse().join(''), lang: 'ar' });
      doc.font(font(run.text, bold)).fontSize(size).fillColor(color).text(run.text, cursor, y, { lineBreak: false, features: [] });
      if (run.arabic) doc.endMarkedContent();
      cursor += run.width + space;
    }
  };
  const drawBlock = (value: unknown, x: number, y: number, maxWidth: number, size = 8.5, bold = false, color = palette.navy, align: 'left' | 'right' | 'center' = rtl ? 'right' : 'left') => {
    const lines = wrap(value, maxWidth, size, bold);
    lines.forEach((line, index) => drawLine(line, x, y + index * lineHeight, maxWidth, size, align, bold, color));
    return lines.length * lineHeight;
  };
  const label = (key: string) => labels[key]?.[rtl ? 1 : 0] || apiLabel(key, language);
  let y = 0, bodyStartY = 0;
  const pageHeader = () => {
    drawLine('AV8 ERP', margin, 26, 175, 18, 'left', true);
    drawLine(translate('Student & academy operations','إدارة الطلبة والأكاديميات'), margin, 49, 175, 8, 'left', false, palette.muted);
    const company = report.reportContext?.company || report.companyName || report.context?.companyName || translate('Authorized company scope', 'نطاق الشركات المصرح به');
    y = 28 + drawBlock(company, margin + 205, 28, width - 205, 11, true, palette.navy, rtl ? 'right' : 'left');
    y += drawBlock(title, margin + 205, y + 3, width - 205, 17, true, palette.navy, rtl ? 'right' : 'left') + 13;
    y = Math.max(y, 78);
    const context = [
      `${translate('Period', 'الفترة')}: ${filters.from || translate('Beginning', 'من البداية')} — ${filters.to || translate('Present', 'حتى الآن')}`,
      `${translate('Branch', 'الفرع')}: ${(report.reportContext?.branch === 'All authorized branches' ? translate('All authorized branches', 'جميع الفروع المصرح بها') : report.reportContext?.branch) || report.branchName || report.context?.branchName || (filters.branchId ? `#${filters.branchId}` : translate('All authorized branches', 'جميع الفروع المصرح بها'))}`,
      `${translate('Base currency', 'العملة الأساسية')}: ${report.currency || 'EGP'}`,
      translate('Posted entries only', 'القيود المرحلة فقط'),
      ...(filters.accountId ? [`${translate('Account', 'الحساب')}: ${report.context?.accountName || `#${filters.accountId}`}`] : []),
      ...(filters.costCenter ? [`${translate('Cost center', 'مركز التكلفة')}: ${filters.costCenter}`] : []),
      ...(filters.search ? [`${translate('Search', 'البحث')}: ${filters.search}`] : []),
    ];
    y += drawBlock(context.join('  ·  '), margin, y, width, 8, false, palette.muted) + 9;
    doc.strokeColor(palette.border).lineWidth(0.8).moveTo(margin, y).lineTo(margin + width, y).stroke();
    y += 10;
  };
  const tableHeader = () => {
    const lines = columns.map((column, index) => wrap(column[language], widths[index] - 2 * pad, 8, true));
    const height = Math.max(...lines.map((value) => value.length)) * lineHeight + 2 * pad;
    doc.rect(margin, y, width, height).fill(palette.panel);
    lines.forEach((values, index) => values.forEach((value, line) => drawLine(value, positions[index] + pad, y + pad + line * lineHeight, widths[index] - 2 * pad, 8, columns[index].money ? 'right' : rtl ? 'right' : 'left', true)));
    y += height;
    bodyStartY = y;
  };
  const newPage = () => { doc.addPage(); pageHeader(); tableHeader(); };
  const cell = (column: Column, row: Row) => {
    if (column.money) return accountingPdfAmount(row[column.key]);
    if (column.key === 'account') return [row.code, apiText(row.account, language)].filter(Boolean).join('\n');
    if (column.key === 'type') return accountTypes[String(row.type)]?.[rtl ? 1 : 0] || apiText(row.type, language);
    return apiText(row[column.key], language);
  };
  const tableRow = (row: Row, index: number, total = false) => {
    const lines = columns.map((column, columnIndex) => wrap(cell(column, row), widths[columnIndex] - 2 * pad, 8.5, total));
    let offset = 0, remaining = Math.max(...lines.map((value) => value.length));
    const completeHeight = remaining * lineHeight + 2 * pad;
    if (y + completeHeight > bottom && completeHeight <= bottom - bodyStartY) newPage();
    while (remaining > 0) {
      let available = Math.floor((bottom - y - 2 * pad) / lineHeight);
      if (available < 1) { newPage(); available = Math.floor((bottom - y - 2 * pad) / lineHeight); }
      const count = Math.min(remaining, available), height = count * lineHeight + 2 * pad;
      if (total || index % 2) doc.rect(margin, y, width, height).fill(palette.panel);
      if (total) doc.strokeColor(palette.navy).lineWidth(1).moveTo(margin, y).lineTo(margin + width, y).stroke();
      lines.forEach((values, columnIndex) => values.slice(offset, offset + count).forEach((value, line) => drawLine(value, positions[columnIndex] + pad, y + pad + line * lineHeight, widths[columnIndex] - 2 * pad, 8.5, columns[columnIndex].money ? 'right' : rtl ? 'right' : 'left', total)));
      y += height;
      doc.strokeColor(palette.border).lineWidth(0.4).moveTo(margin, y).lineTo(margin + width, y).stroke();
      offset += count; remaining -= count;
      if (remaining) newPage();
    }
  };
  pageHeader(); tableHeader();
  if (!rows.length) y += drawBlock(translate('No posted movements match these filters.', 'لا توجد حركات مرحلة تطابق عوامل التصفية.'), margin + pad, y + pad, width - 2 * pad) + 2 * pad;
  rows.forEach((row, index) => tableRow(row, index));
  if (trial) tableRow({ ...totals, name: translate('Total', 'الإجمالي') }, rows.length, true);
  const summaryEntries = Object.entries(totals).filter(([key]) => !trial || !['openingDebitMinor', 'openingCreditMinor', 'movementDebitMinor', 'movementCreditMinor', 'closingDebitMinor', 'closingCreditMinor', 'debitMinor', 'creditMinor'].includes(key));
  for (const [key, value] of summaryEntries) {
    const amount = key.endsWith('Minor') ? accountingPdfAmount(value) : apiText(value, language);
    const size = trial ? 8 : 9, gap = trial ? 3 : 7, after = trial ? 2 : 4;
    const needed = gap + Math.max(wrap(label(key), width * 0.65 - 2 * pad, size, true).length, wrap(amount, width * 0.35 - pad, size, true).length) * lineHeight + after;
    if (y + needed > bottom) newPage();
    y += gap;
    const labelHeight = drawBlock(label(key), rtl ? margin + width * 0.35 : margin + pad, y, width * 0.65 - 2 * pad, size, true);
    const amountHeight = drawBlock(amount, rtl ? margin + pad : margin + width * 0.65, y, width * 0.35 - pad, size, true, palette.navy, 'right');
    y += Math.max(labelHeight, amountHeight) + after;
  }
  if (filters.search && ledger) {
    if (y + 42 > bottom) newPage();
    y += 9 + drawBlock(translate('Search filters displayed rows; balances include all posted movements in the selected period and scope.', 'البحث يرشح الصفوف المعروضة؛ الأرصدة تشمل جميع الحركات المرحلة في الفترة والنطاق المحددين.'), margin + pad, y + 9, width - 2 * pad, 8, false, palette.muted);
  }
  const range = doc.bufferedPageRange();
  for (let page = 0; page < range.count; page++) {
    doc.switchToPage(range.start + page);
    const footer = doc.page.height - 28;
    drawLine(`${translate('Page', 'صفحة')} ${page + 1} / ${range.count}`, margin, footer, width, 8, 'right', false, palette.muted);
    drawLine(`${report.currency || 'EGP'} · ${rows.length} ${translate('rows', 'صفوف')}`, margin, footer, width / 2, 8, 'left', false, palette.muted);
  }
  return doc;
}
