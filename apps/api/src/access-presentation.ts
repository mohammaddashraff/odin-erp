import { PERMISSION_REGISTRY, normalizePermissions, hasPermission } from './permissions';
export type Label = {
    en: string;
    ar: string;
};
export const label = (en: string, ar: string): Label => ({ en, ar });
const nouns: Record<string, Label> = Object.fromEntries([
    ['workspace', 'Daily workspace', 'مساحة العمل اليومية'], ['leads', 'Leads', 'العملاء المحتملون'], ['applications', 'Student applications', 'طلبات الطلاب'], ['medical', 'Medical results', 'نتائج الكشف الطبي'], ['affairs', 'Student affairs', 'شؤون الطلاب'], ['finance', 'Student collections and academy payments', 'تحصيلات الطلاب ومدفوعات الأكاديمية'], ['policies', 'Business configuration', 'إعدادات العمل'], ['exceptions', 'Business exceptions', 'استثناءات العمل'], ['reports', 'Reports', 'التقارير'], ['passport', 'Passport details', 'بيانات جواز السفر'], ['bank', 'Student bank details', 'بيانات البنك للطالب'], ['criminal', 'Criminal record documents', 'مستندات الحالة الجنائية'], ['guardian', 'Guardian details', 'بيانات ولي الأمر'],
    ['customer', 'Customers', 'العملاء'], ['supplier', 'Suppliers', 'الموردون'], ['employee', 'Employees', 'الموظفون'], ['department', 'Departments', 'الإدارات'], ['attendance', 'Attendance', 'الحضور'], ['leave', 'Leave requests', 'طلبات الإجازة'], ['payroll', 'Payroll', 'الرواتب'], ['salary', 'Salary details', 'بيانات الراتب'], ['quotation', 'Quotations', 'عروض الأسعار'], ['order', 'Orders', 'الأوامر'], ['delivery', 'Deliveries', 'التسليمات'], ['invoice', 'Invoices', 'الفواتير'], ['return', 'Returns', 'المرتجعات'], ['credit_note', 'Credit notes', 'الإشعارات الدائنة'], ['request', 'Purchase requests', 'طلبات الشراء'], ['rfq', 'Supplier quotations', 'عروض الموردين'], ['receipt', 'Receipts', 'المقبوضات'], ['bill', 'Supplier bills', 'فواتير الموردين'], ['item', 'Products', 'المنتجات'], ['warehouse', 'Warehouses', 'المخازن'], ['transfer', 'Transfers', 'التحويلات'], ['adjustment', 'Adjustments', 'التسويات'], ['stock_count', 'Stock counts', 'الجرد'], ['journal', 'Journal entries', 'القيود المحاسبية'], ['account', 'Accounts', 'الحسابات'], ['period', 'Fiscal periods', 'الفترات المالية'], ['payment', 'Payments', 'المدفوعات'], ['transaction', 'Bank transactions', 'حركات البنك'], ['statement', 'Bank statements', 'كشوف البنك'], ['register', 'Cash register', 'نقطة البيع'], ['shift', 'Shifts', 'الورديات'], ['sale', 'Sales', 'المبيعات'], ['standard', 'Standard reports', 'التقارير العامة'], ['profitability', 'Profitability reports', 'تقارير الربحية'], ['business', 'Business activity', 'نشاط العمل'], ['security', 'Security activity', 'النشاط الأمني'], ['users_access', 'Users and access groups', 'المستخدمون ومجموعات الصلاحيات'], ['system', 'System settings', 'إعدادات النظام'], ['access', 'System administration', 'إدارة النظام'], ['queue', 'Approval queue', 'طلبات الاعتماد'], ['overview', 'Overview', 'نظرة عامة'], ['price', 'Prices', 'الأسعار'], ['exchange_rate', 'Exchange rates', 'أسعار الصرف'], ['attachment', 'Private attachments', 'المرفقات الخاصة'], ['bank_account', 'Bank accounts', 'الحسابات البنكية'], ['av8_lead', 'Leads', 'العملاء المحتملون'], ['av8_application', 'Student applications', 'طلبات الطلاب'], ['report', 'Reports', 'التقارير'], ['audit', 'Activity history', 'سجل النشاط'], ['document', 'Business documents', 'مستندات العمل'], ['party', 'Tax details', 'البيانات الضريبية'], ['approval', 'Approval evidence', 'بيانات الاعتماد'], ['bankAccount', 'Bank account details', 'بيانات الحساب البنكي'],
].map(([key, en, ar]) => [key, label(en, ar)]));
export const actions: Record<string, Label> = Object.fromEntries([
    ['view', 'View', 'عرض'], ['create', 'Add', 'إضافة'], ['edit', 'Edit', 'تعديل'], ['delete', 'Delete', 'حذف'], ['approve', 'Approve', 'اعتماد'], ['reject', 'Reject', 'رفض'], ['cancel', 'Cancel', 'إلغاء'], ['print', 'Print', 'طباعة'], ['export', 'Export', 'تصدير'], ['import', 'Import', 'استيراد'], ['post', 'Post to accounting', 'ترحيل للمحاسبة'], ['reopen', 'Reopen', 'إعادة فتح'], ['history', 'View history', 'عرض السجل'], ['convert', 'Convert', 'تحويل'], ['process', 'Process', 'معالجة'], ['reconcile', 'Reconcile', 'مطابقة'], ['manage', 'Manage', 'إدارة'], ['reset', 'Reset demo data', 'إعادة بيانات العرض'], ['use', 'Use', 'استخدام'], ['confirm', 'Confirm payment', 'تأكيد الدفع'], ['adjust', 'Adjust balance', 'تسوية الرصيد']
].map(([key, en, ar]) => [key, label(en, ar)]));
export function resourceLabel(resource: string) { return nouns[resource] || label('Custom business area', 'مجال عمل مخصص'); }
export function permissionPresentation(p: {
    key: string;
    resource: string;
    action: string;
    module: string;
}) {
    const resource = p.module === 'banking' && p.resource === 'account' ? nouns.bank_account : resourceLabel(p.resource);
    const action = actions[p.action] || label('Custom action', 'إجراء مخصص');
    const known = !!nouns[p.resource] && !!actions[p.action] && PERMISSION_REGISTRY.some(x => x.key === p.key);
    return { key: p.key, module: p.module, resource: p.resource, action: p.action, label: label(`${action.en}: ${resource.en}`, `${action.ar}: ${resource.ar}`), area: resource, actionLabel: action, known,
        help: known ? label(`${action.en} ${resource.en.toLowerCase()}, within the assigned record access.`, `${action.ar} ${resource.ar} في حدود البيانات المتاحة للمستخدم.`) : label('Custom permission: consult its owner for the exact effect.', 'صلاحية مخصصة: راجع مسؤولها لمعرفة تأثيرها بدقة.') };
}
const roleNames: Record<string, Label> = { super_admin: label('System Administrator', 'إدارة النظام'), av8_management: label('Management', 'الإدارة'), av8_telesales: label('Telesales', 'المبيعات الهاتفية'), av8_sales: label('Sales & Admissions', 'المبيعات والتسجيل'), av8_affairs: label('Student Affairs', 'شؤون الطلاب'), av8_finance: label('Finance', 'الحسابات') };
export function rolePresentation(role: any) {
    const keys = [...normalizePermissions(Array.isArray(role.permissions) ? role.permissions : []), ...(role.permissionAssignments || []).map((p: any) => p.permission.key), ...(role.permissionKeys || [])];
    const areas = [...new Set(PERMISSION_REGISTRY.filter(p => hasPermission(keys, [], p.key)).map(p => p.resource))];
    const description = hasPermission(keys, [], 'system.super_admin') ? label('Administers all business areas, subject to explicit restrictions and business approval rules.', 'يدير مجالات العمل مع الالتزام بالقيود الصريحة وقواعد الاعتماد.') : label(`Configured access: ${areas.slice(0, 7).map(a => resourceLabel(a).en).join(', ') || 'No permissions'}.`, `الصلاحيات المهيأة: ${areas.slice(0, 7).map(a => resourceLabel(a).ar).join('، ') || 'لا توجد صلاحيات'}.`);
    // A deliberately renamed group keeps its chosen name.
    return { displayName: roleNames[role.key] && /^(AV8 |Super Admin$)/.test(role.name) ? roleNames[role.key] : label(role.name, role.name), descriptionLabel: description };
}
export function scopePresentation(resource: string, scope: string) {
    if (['OWN', 'ASSIGNED'].includes(scope)) {
        if (resource === 'customer') return label('Customers owned by this person', 'العملاء المسندون لهذا المستخدم');
        if (resource === 'employee') return label('The employee record linked to this account', 'سجل الموظف المرتبط بهذا الحساب');
        if (['journal', 'payment'].includes(resource)) return label('Records created by this person', 'السجلات التي أنشأها هذا المستخدم');
        if (['account', 'bank_account', 'supplier', 'item', 'warehouse'].includes(resource) && scope === 'ASSIGNED') return label('Explicitly assigned resources', 'الموارد المسندة بالاسم');
        if (['quotation', 'order', 'delivery', 'invoice', 'return', 'credit_note', 'purchase_request', 'rfq', 'purchase_order', 'receipt', 'bill', 'purchase_return', 'transfer', 'adjustment', 'stock_count'].includes(resource)) return scope === 'OWN' ? label('Documents created by this person', 'المستندات التي أنشأها هذا المستخدم') : label('Documents assigned to the linked salesperson; otherwise created by this person', 'مستندات مندوب المبيعات المرتبط بالحساب، وإلا المستندات التي أنشأها المستخدم');
    }
    const av8 = resource.startsWith('av8_');
    const labels: Record<string, Label> = { NONE: label('No records', 'لا توجد بيانات'), ALL: label('All records inside permitted companies and branches', 'كل البيانات داخل الشركات والفروع المسموح بها'), BRANCH: label('Permitted branches', 'الفروع المسموح بها'), OWN: av8 ? label('Records assigned to this person', 'البيانات المسندة لهذا المستخدم') : label('Records owned by this person (resource-specific)', 'بيانات يملكها المستخدم حسب نوع السجل'), ASSIGNED: av8 ? label('Records assigned to this person', 'البيانات المسندة لهذا المستخدم') : label('Assigned records or financial resources', 'السجلات أو الموارد المالية المسندة'), TEAM: label('Configured team members', 'أعضاء الفريق المحددون'), DEPARTMENT: label('Employee department', 'إدارة الموظف'), WAREHOUSE: label('Assigned warehouses', 'المخازن المسندة') };
    return labels[scope] || label('Existing custom record rule', 'قاعدة بيانات مخصصة موجودة');
}
export function supportedScopes(resource: string): string[] {
    if (resource.startsWith('av8_'))
        return ['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'ALL'];
    if (['account', 'bank_account', 'supplier'].includes(resource))
        return ['NONE', 'ASSIGNED', 'ALL'];
    if (['quotation', 'order', 'delivery', 'invoice', 'return', 'credit_note', 'purchase_request', 'rfq', 'purchase_order', 'receipt', 'bill', 'purchase_return', 'transfer', 'adjustment', 'stock_count'].includes(resource))
        return ['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'WAREHOUSE', 'DEPARTMENT', 'ALL'];
    if (['customer', 'journal', 'payment', 'report'].includes(resource))
        return ['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'ALL'];
    if (resource === 'employee')
        return ['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'DEPARTMENT', 'ALL'];
    if (['item', 'warehouse'].includes(resource))
        return ['NONE', 'ASSIGNED', 'BRANCH', 'WAREHOUSE', 'ALL'];
    if (resource === 'pos_terminal')
        return ['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'WAREHOUSE', 'ALL'];
    return [];
}
