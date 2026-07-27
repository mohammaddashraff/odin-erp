import type { Request } from 'express';

export type ApiLanguage = 'en' | 'ar';

const ar: Record<string, string> = {
  'POS RECEIPT': 'إيصال نقطة البيع', 'Walk-in customer': 'عميل نقدي', 'Internal': 'داخلي', 'Generated': 'تاريخ الإصدار', 'SUMMARY': 'الملخص',
  'Trial balance': 'ميزان المراجعة', 'General ledger': 'دفتر الأستاذ العام', 'Account ledger': 'كشف حساب الأستاذ', 'Income statement': 'قائمة الدخل', 'Balance sheet': 'قائمة المركز المالي',
  'Accounts receivable aging': 'أعمار ديون العملاء', 'Accounts payable aging': 'أعمار ديون الموردين', 'Customer statement': 'كشف حساب عميل', 'Supplier statement': 'كشف حساب مورد',
  'Inventory valuation': 'تقييم المخزون', 'Stock movements': 'حركات المخزون', 'VAT report': 'تقرير ضريبة القيمة المضافة', 'Sales and profitability': 'المبيعات والربحية',
  'Purchase analysis': 'تحليل المشتريات', 'Cash and bank position': 'الموقف النقدي والبنكي', 'POS shift closing report': 'تقرير إغلاق وردية نقطة البيع', 'Control account reconciliation': 'تسوية حسابات المراقبة',
  'Accounts receivable': 'الذمم المدينة', 'Accounts payable': 'الذمم الدائنة', 'Inventory': 'المخزون',
  'Sku': 'رمز الصنف', 'Item': 'الصنف', 'Quantity': 'الكمية', 'Unit price': 'سعر الوحدة', 'Discount': 'الخصم', 'Tax': 'الضريبة', 'Total': 'الإجمالي',
  'Customer': 'العميل', 'Register': 'الصندوق', 'Subtotal': 'الإجمالي قبل الخصم', 'Tenders': 'طرق السداد', 'Party': 'الطرف', 'Document date': 'تاريخ المستند', 'Status': 'الحالة',
  'Number': 'الرقم', 'Code': 'الرمز', 'Account': 'الحساب', 'Type': 'النوع', 'Debit': 'مدين', 'Credit': 'دائن', 'Balance': 'الرصيد', 'Date': 'التاريخ', 'Description': 'البيان',
  'Source': 'المصدر', 'Journal': 'القيد', 'Reference': 'المرجع', 'Warehouse': 'المخزن', 'Value': 'القيمة', 'Amount': 'المبلغ', 'Supplier': 'المورد', 'Profit': 'الربح',
  'Revenue': 'الإيراد', 'Cost': 'التكلفة', 'Margin': 'هامش الربح', 'Assets': 'الأصول', 'Liabilities': 'الالتزامات', 'Equity': 'حقوق الملكية', 'Outstanding': 'المتبقي',
  'Output vat': 'ضريبة المخرجات', 'Input vat': 'ضريبة المدخلات', 'Net payable': 'صافي الضريبة المستحقة', 'Cash': 'النقدية', 'Difference': 'الفرق', 'Actual': 'الفعلي', 'Expected': 'المتوقع',
  'Control': 'حساب المراقبة', 'Ledger': 'دفتر الأستاذ', 'Subledger': 'دفتر الأستاذ المساعد',
  'DRAFT': 'مسودة', 'SUBMITTED': 'مرسل للموافقة', 'APPROVED': 'معتمد', 'REJECTED': 'مرفوض', 'POSTED': 'مرحل', 'OPEN': 'مفتوح', 'CLOSED': 'مغلق',
  'CASH': 'نقدي', 'BANK': 'بنكي', 'CARD': 'بطاقة', 'RECEIPT': 'مقبوض', 'PAYMENT': 'مدفوع',
  'QUOTATION': 'عرض سعر مبيعات', 'SALES_ORDER': 'أمر بيع', 'DELIVERY_NOTE': 'إذن تسليم', 'SALES_INVOICE': 'فاتورة مبيعات', 'SALES_RETURN': 'مرتجع مبيعات', 'CREDIT_NOTE': 'إشعار دائن',
  'PURCHASE_REQUEST': 'طلب عرض سعر', 'PURCHASE_ORDER': 'أمر شراء', 'GOODS_RECEIPT': 'إذن استلام', 'PURCHASE_BILL': 'فاتورة مورد', 'PURCHASE_RETURN': 'مرتجع مشتريات',
  'WAREHOUSE_TRANSFER': 'تحويل مخزني', 'INVENTORY_ADJUSTMENT': 'تسوية مخزون', 'STOCK_COUNT': 'جرد مخزون',
  'Cairo Main Warehouse': 'المخزن الرئيسي - القاهرة', 'Cairo Retail Store': 'متجر القاهرة', 'Alexandria Warehouse': 'مخزن الإسكندرية',
  'OdinBook 14 Laptop': 'حاسوب أودين بوك المحمول 14 بوصة', 'VisionPro 27 Monitor': 'شاشة فيجن برو 27 بوصة', 'Mechanical Keyboard': 'لوحة مفاتيح ميكانيكية',
  'Wireless Mouse': 'فأرة لاسلكية', 'USB-C Dock': 'وحدة توصيل USB-C', 'Ergonomic Office Chair': 'كرسي مكتبي مريح',
  'Main Cash Drawer': 'خزينة النقدية الرئيسية', 'CIB Current Account': 'الحساب الجاري - البنك التجاري الدولي', 'Card Settlement Clearing': 'حساب تسوية البطاقات',
  'Cash on Hand': 'النقدية بالصندوق', 'Bank Current Account': 'الحساب البنكي الجاري', 'Card Clearing': 'تسوية البطاقات', 'Accounts Receivable Control': 'حساب مراقبة العملاء',
  'Inventory Control': 'حساب مراقبة المخزون', 'Accounts Payable Control': 'حساب مراقبة الموردين', 'Goods Received Not Invoiced': 'بضاعة مستلمة غير مفوترة',
  'Output VAT Payable': 'ضريبة قيمة مضافة مستحقة', 'Input VAT Recoverable': 'ضريبة قيمة مضافة قابلة للاسترداد', 'Owner Capital': 'رأس المال', 'Retained Earnings': 'الأرباح المحتجزة',
  'Sales Revenue': 'إيرادات المبيعات', 'Cost of Goods Sold': 'تكلفة البضاعة المباعة', 'Inventory Gain or Loss': 'أرباح أو خسائر المخزون', 'Cash Over or Short': 'زيادة أو عجز النقدية', 'Operating Expenses': 'مصروفات التشغيل',
};

export function requestLanguage(request: Request): ApiLanguage {
  const value = String(request.headers['x-odin-language'] || request.headers['accept-language'] || '').toLowerCase();
  return value.startsWith('ar') ? 'ar' : 'en';
}

export function apiText(value: unknown, language: ApiLanguage): string {
  const text = String(value ?? '');
  if (language !== 'ar') return text;
  if (ar[text]) return ar[text];
  const documentTitle = text.match(/^(QUOTATION|SALES_ORDER|DELIVERY_NOTE|SALES_INVOICE|SALES_RETURN|CREDIT_NOTE|PURCHASE_REQUEST|PURCHASE_ORDER|GOODS_RECEIPT|PURCHASE_BILL|PURCHASE_RETURN|WAREHOUSE_TRANSFER|INVENTORY_ADJUSTMENT|STOCK_COUNT) (.+)$/);
  if (documentTitle) return `${apiText(documentTitle[1], language)} ${documentTitle[2]}`;
  const receipt = text.match(/^POS RECEIPT (.+)$/);
  if (receipt) return `${ar['POS RECEIPT']} ${receipt[1]}`;
  return text;
}

export function apiLabel(key: string, language: ApiLanguage): string {
  const label = key.replace(/Minor$/, '').replace(/Milli$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
  return apiText(label, language);
}
