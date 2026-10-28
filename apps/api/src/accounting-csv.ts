import { type ApiLanguage, apiText } from './i18n';

const labels: Record<string, [string, string]> = {
  code: ['Code', 'رمز الحساب'], name: ['Account', 'الحساب'], account: ['Account', 'الحساب'], type: ['Type', 'نوع الحساب'], currency: ['Currency', 'العملة'],
  openingDebitMinor: ['Opening debit', 'الرصيد الافتتاحي المدين'], openingCreditMinor: ['Opening credit', 'الرصيد الافتتاحي الدائن'], movementDebitMinor: ['Period debit', 'حركة الفترة المدينة'], movementCreditMinor: ['Period credit', 'حركة الفترة الدائنة'], closingDebitMinor: ['Closing debit', 'الرصيد الختامي المدين'], closingCreditMinor: ['Closing credit', 'الرصيد الختامي الدائن'],
  debitMinor: ['Debit', 'مدين'], creditMinor: ['Credit', 'دائن'], runningBalanceMinor: ['Running balance', 'الرصيد الجاري'], amountMinor: ['Amount', 'القيمة'], journal: ['Journal', 'القيد'], date: ['Posting date', 'تاريخ الترحيل'], description: ['Description', 'البيان'], source: ['Source reference', 'مرجع المصدر'], costCenter: ['Cost center', 'مركز التكلفة'],
};
export function accountingCsv(report: any, language: ApiLanguage) {
  const keys = ['Trial balance'].includes(report.name) ? ['code', 'name', 'type', 'openingDebitMinor', 'openingCreditMinor', 'movementDebitMinor', 'movementCreditMinor', 'closingDebitMinor', 'closingCreditMinor']
    : ['Income statement', 'Balance sheet'].includes(report.name) ? ['code', 'name', 'type', 'amountMinor']
      : ['date', 'journal', 'code', 'account', 'description', 'debitMinor', 'creditMinor', 'runningBalanceMinor', 'source', 'costCenter'];
  keys.push('currency');
  const quote = (value: unknown, numeric = false) => {
    const text = String(value ?? '');
    const safe = !numeric && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const decimal = (value: unknown) => {
    const amount = BigInt(String(value ?? 0)), absolute = amount < 0n ? -amount : amount;
    return `${amount < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  };
  return `\uFEFF${[keys.map((key) => quote(labels[key][language === 'ar' ? 1 : 0])).join(','), ...report.rows.map((row: any) => keys.map((key) => quote(key === 'currency' ? report.currency : key.endsWith('Minor') ? decimal(row[key]) : apiText(row[key] ?? '', language), key.endsWith('Minor'))).join(','))].join('\r\n')}`;
}
