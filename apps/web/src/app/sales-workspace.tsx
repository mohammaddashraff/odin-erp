'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppIcon, IconButton } from './ui-icons';
import { Language, t } from './i18n';
import { formatCurrency, formatDate, formatDateTime } from './formatters';
import { canAccess } from './navigation';

type Json = any;
type Requester = (path: string, options?: RequestInit) => Promise<Json>;
const SALES_CONVERSIONS: Record<string, string[]> = {
  QUOTATION: ['SALES_ORDER'],
  SALES_ORDER: ['DELIVERY_NOTE'],
  DELIVERY_NOTE: ['SALES_INVOICE'],
  SALES_INVOICE: ['SALES_RETURN', 'CREDIT_NOTE'],
};
const SALES_DOCUMENT_ROUTES: Record<string, string> = {
  QUOTATION: '/sales/quotations',
  SALES_ORDER: '/sales/orders',
  DELIVERY_NOTE: '/sales/deliveries',
  SALES_INVOICE: '/sales/invoices',
  SALES_RETURN: '/sales/returns',
  CREDIT_NOTE: '/sales/credit-notes',
};
const salesResource: Record<string, string> = { QUOTATION: 'quotation', SALES_ORDER: 'order', DELIVERY_NOTE: 'delivery', SALES_INVOICE: 'invoice', SALES_RETURN: 'return', CREDIT_NOTE: 'credit_note' };
const documentPermission = (type: string, action: string) => `sales.${salesResource[type] || 'quotation'}.${action}`;
const fieldAccess = (user: Json, resource: string, field: string) => canAccess(user.permissions, 'system.super_admin') ? 'EDIT' : user.fieldPermissions?.find((item: Json) => item.resource === resource && item.field === field)?.access || 'HIDDEN';
const documentTypeName = (type: string) => ({
  SALES_ORDER: 'Sales Order',
  DELIVERY_NOTE: 'Delivery Note',
  SALES_INVOICE: 'Sales Invoice',
  SALES_RETURN: 'Sales Return',
  CREDIT_NOTE: 'Credit Note',
}[type] || type.replaceAll('_', ' '));

export type SalesWorkspaceProps = {
  user: Json;
  refs: Json;
  request: Requester;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  notify: (message: string, error?: boolean) => void;
  refreshRefs: () => Promise<void>;
  navigate: (route: string) => void;
  language: Language;
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const asBigInt = (value: unknown) => {
  try { return BigInt(String(value ?? 0)); } catch { return 0n; }
};
const roundDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator / 2n) / denominator;
const fixed = (value: string, decimals: number) => {
  const match = String(value || '0').trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return 0n;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] || '').slice(0, decimals).padEnd(decimals, '0') || '0');
};
const decimal = (value: bigint, decimals = 2) => `${value / 10n ** BigInt(decimals)}.${(value % 10n ** BigInt(decimals)).toString().padStart(decimals, '0')}`;
const money = (minor: unknown, currency = 'EGP', language: Language = 'en') => formatCurrency(minor, currency, language);
const displayDate = (value: string | undefined, language: Language) => formatDate(value, language);
const displayDateTime = (value: string | undefined, language: Language) => formatDateTime(value, language);

const statusLabel = (value: string, type: string, language: Language) => {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    SUBMITTED: 'Pending Approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
    POSTED: type === 'SALES_INVOICE' ? 'Issued' : type === 'DELIVERY_NOTE' ? 'Delivered' : 'Converted',
    PAID: 'Paid',
    PARTIALLY_PAID: 'Partially Paid',
    PARTIALLY_CREDITED: 'Partially Credited',
    CREDITED: 'Credited',
    CREDIT_BALANCE: 'Customer Credit',
    OVERDUE: 'Overdue',
    UNPAID: 'Unpaid',
  };
  return t(labels[value] || value, language);
};

function StatusBadge({ value, type = '', language }: { value: string; type?: string; language: Language }) {
  return <span className={`sales-status ${value}`}>{statusLabel(value, type, language)}</span>;
}

function SalesPageHead({ title, subtitle, children, back }: { title: string; subtitle?: string; children?: ReactNode; back?: () => void }) {
  return <div className="sales-page-head">
    <div className="sales-heading">
      {back ? <IconButton icon="undo" label="Back" className="sales-back" onClick={back}/> : null}
      <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
    </div>
    <div className="sales-head-actions">{children}</div>
  </div>;
}

function SalesEmpty({ heading, text, action }: { heading: string; text: string; action?: ReactNode }) {
  return <div className="sales-empty"><span><AppIcon name="inbox" size={28}/></span><strong>{heading}</strong><p>{text}</p>{action}</div>;
}

function Pagination({ pagination, onPage, language }: { pagination: Json; onPage: (page: number) => void; language: Language }) {
  if (!pagination || pagination.pages <= 1) return null;
  const pages = Array.from({ length: Math.min(5, pagination.pages) }, (_, index) => index + 1);
  return <div className="sales-pagination">
    <span>{t('Showing', language)} {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.total, pagination.page * pagination.pageSize)} {t('of', language)} {pagination.total}</span>
    <div>
      <button disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}><AppIcon name="undo" size={14}/></button>
      {pages.map((page) => <button key={page} className={pagination.page === page ? 'active' : ''} onClick={() => onPage(page)}>{page}</button>)}
      <button disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}><AppIcon name="next" size={14}/></button>
    </div>
  </div>;
}

function ReasonDialog({ title, description, confirmLabel, tone, close, confirm, language }: { title: string; description: string; confirmLabel: string; tone: 'danger' | 'warning'; close: () => void; confirm: (reason: string) => Promise<void>; language: Language }) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    try { await confirm(reason.trim()); close(); } finally { setBusy(false); }
  };
  return <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="sales-reason-dialog" role="dialog" aria-modal="true" aria-labelledby="reason-title">
      <div className="sales-reason-head"><span className={tone}><AppIcon name={tone === 'danger' ? 'rejected' : 'warning'}/></span><div><h2 id="reason-title">{title}</h2><p>{description}</p></div></div>
      <form onSubmit={submit}><label>{t('Reason or requested changes', language)}<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('Explain clearly what needs to happen next…', language)} required/></label>
        <div className="modal-actions"><button type="button" className="button" onClick={close}>{t('Cancel', language)}</button><button className={`button ${tone}`} disabled={busy || !reason.trim()}>{busy ? t('Working…', language) : confirmLabel}</button></div>
      </form>
    </section>
  </div>;
}

function SalesConversionDialog({ document, targetType, request, notify, close, converted, language }: { document: Json; targetType: string; request: Requester; notify: (message: string, error?: boolean) => void; close: () => void; converted: (target: Json) => Promise<void>; language: Language }) {
  const rows = useMemo<Array<{ line: Json; remaining: bigint }>>(() => document.lines.map((line: Json) => {
    const consumed = (line.targetLines || [])
      .filter((target: Json) => !['REJECTED', 'CANCELLED'].includes(target.document?.status))
      .reduce((sum: bigint, target: Json) => sum + asBigInt(target.quantityMilli), 0n);
    return { line, remaining: asBigInt(line.quantityMilli) - consumed };
  }), [document.lines]);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(({ line, remaining }) => [line.id, decimal(remaining, 3)])));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const available = rows.filter(({ remaining }) => remaining > 0n);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const target = await request(`/documents/${document.id}/convert`, { method: 'POST', body: JSON.stringify({
        targetType,
        documentDate: isoToday(),
        warehouseId: document.warehouseId,
        lines: available.map(({ line }) => ({ sourceLineId: line.id, quantity: quantities[line.id] })),
      }) });
      notify(`${document.number} converted to ${documentTypeName(targetType)}`);
      close();
      await converted(target);
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  };
  return <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="modal sales-conversion-dialog" role="dialog" aria-modal="true" aria-labelledby="conversion-title">
      <div className="modal-head"><div><h2 id="conversion-title">{t(`Convert ${document.number} to ${documentTypeName(targetType)}`, language)}</h2><p>{t('Enter a quantity up to the remaining source quantity. The backend rejects over-conversion and preserves every source-line link.', language)}</p></div><IconButton icon="close" label={t('Close dialog', language)} onClick={close}/></div>
      <div className="modal-body"><div className="table-wrap"><table><thead><tr><th>{t('Product', language)}</th><th>{t('Original', language)}</th><th>{t('Remaining', language)}</th><th>{t('Convert now', language)}</th></tr></thead><tbody>{rows.map(({ line, remaining }) => <tr key={line.id}><td><strong>{line.item?.sku}</strong><br/><span className="muted">{language === 'ar' ? line.item?.nameAr : line.item?.name}</span></td><td>{decimal(asBigInt(line.quantityMilli), 3)}</td><td>{decimal(remaining, 3)}</td><td><input aria-label={t(`Convert ${line.item?.sku} quantity`, language)} inputMode="decimal" disabled={remaining <= 0n} value={quantities[line.id]} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}/></td></tr>)}</tbody></table></div>
        <p className="form-message">{error || (!available.length ? t('No quantity remains to convert.', language) : '')}</p>
      </div>
      <div className="modal-actions"><button className="button" onClick={close}>{t('Cancel', language)}</button><button className="button primary" disabled={busy || !available.length} onClick={submit}>{busy ? t('Converting…', language) : t('Create linked draft', language)}</button></div>
    </section>
  </div>;
}

export function SalesOverviewPage({ user, refs, request, notify, navigate, language }: SalesWorkspaceProps) {
  const [data, setData] = useState<Json>(null);
  useEffect(() => { request('/sales/overview').then(setData).catch((error) => notify(error.message, true)); }, [request, notify]);
  if (!data) return <div className="sales-loading"><div className="spinner"/>{t('Loading Sales Overview…', language)}</div>;
  const metrics = data.metrics;
  return <div className="page sales-v2-page">
    <SalesPageHead title={t('Sales Overview', language)} subtitle={t('Your team’s current work, approvals, and customer follow-up in one place.', language)}>
      {canAccess(user.permissions, 'sales.customer.create') ? <button className="button" onClick={() => navigate('/sales/customers?new=1')}><AppIcon name="customer"/>{t('New Customer', language)}</button> : null}
      {canAccess(user.permissions, 'sales.quotation.create') ? <button className="button primary" onClick={() => navigate('/sales/quotations?new=1')}><AppIcon name="add"/>{t('New Quotation', language)}</button> : null}
    </SalesPageHead>
    <section className="sales-metric-rail">
      <button onClick={() => navigate('/approvals/inbox')}><i><AppIcon name="pending"/></i><span>{t('Awaiting approval', language)}<strong>{metrics.awaitingApproval}</strong></span></button>
      <button onClick={() => navigate('/sales/quotations')}><i className="warning"><AppIcon name="warning"/></i><span>{t('Expiring soon', language)}<strong>{metrics.expiringSoon}</strong></span></button>
      <button onClick={() => navigate('/sales/invoices')}><i><AppIcon name="payments"/></i><span>{t('Unpaid invoices', language)}<strong>{money(metrics.unpaidMinor, refs.tenant.baseCurrency, language)}</strong></span></button>
      <button onClick={() => navigate('/sales/invoices')}><i><AppIcon name="sales"/></i><span>{t('Sales this month', language)}<strong>{money(metrics.salesMonthMinor, refs.tenant.baseCurrency, language)}</strong></span></button>
    </section>
    <div className="sales-overview-layout">
      <section className="sales-data-panel sales-overview-table">
        <div className="sales-panel-title"><div><h2>{t('Recent sales activity', language)}</h2><p>{t('Latest quotations, orders, deliveries, and invoices', language)}</p></div><button className="text-action" onClick={() => navigate('/sales/quotations')}>{t('View all', language)}<AppIcon name="next" size={14}/></button></div>
        <div className="table-wrap"><table><thead><tr><th>{t('Date', language)}</th><th>{t('Document', language)}</th><th>{t('Customer', language)}</th><th>{t('Salesperson', language)}</th><th>{t('Branch', language)}</th><th className="number">{t('Total', language)}</th><th>{t('Status', language)}</th></tr></thead>
          <tbody>{data.recent.map((row: Json) => <tr key={row.id}><td>{displayDate(row.documentDate, language)}</td><td><button className="sales-link" onClick={() => navigate(`/sales/quotations?document=${row.id}`)}>{row.number}</button></td><td><strong>{row.customer?.name || '—'}</strong></td><td>{row.salesEmployee ? `${row.salesEmployee.name} · ${row.salesEmployee.code}` : '—'}</td><td>{row.branch?.name}</td><td className="number"><strong>{money(row.totalMinor, row.currency, language)}</strong></td><td><StatusBadge value={row.status} type={row.type} language={language}/></td></tr>)}</tbody>
        </table></div>
      </section>
      <aside className="sales-attention-rail">
        <div className="sales-panel-title"><div><h2>{t('Approvals waiting', language)}</h2><p>{metrics.awaitingApproval} {t('documents', language)}</p></div><AppIcon name="pending"/></div>
        <div className="attention-docs">{data.recent.filter((row: Json) => row.status === 'SUBMITTED').slice(0, 5).map((row: Json) => <button key={row.id} onClick={() => navigate(`/sales/quotations?document=${row.id}`)}><span><strong>{row.customer?.name}</strong><small>{row.number}</small></span><b>{money(row.totalMinor, row.currency, language)}</b></button>)}</div>
        <button className="rail-footer" onClick={() => navigate('/approvals/inbox')}>{t('Open approval queue', language)}<AppIcon name="next" size={14}/></button>
        <div className="sales-panel-title secondary"><div><h2>{t('Recent customers', language)}</h2><p>{t('New and active accounts', language)}</p></div><AppIcon name="customer"/></div>
        <div className="attention-docs">{data.recentCustomers.map((customer: Json) => <button key={customer.id} onClick={() => navigate(`/sales/customers?customer=${customer.id}`)}><span><strong>{customer.name}</strong><small>{customer.code} · {customer.city}</small></span><AppIcon name="next" size={14}/></button>)}</div>
      </aside>
    </div>
  </div>;
}

export function CustomerWorkspace({ user, refs, request, notify, refreshRefs, navigate, language }: SalesWorkspaceProps) {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<Json>(null), [search, setSearch] = useState(''), [status, setStatus] = useState('ACTIVE'), [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1), [mode, setMode] = useState<'list' | 'create' | 'detail'>('list'), [selected, setSelected] = useState<Json>(null);
  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: '15', status });
    if (search.trim()) query.set('search', search.trim());
    if (branchId) query.set('branchId', branchId);
    setResult(await request(`/sales/customers?${query}`));
  }, [request, page, status, search, branchId]);
  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error) => notify(error.message, true)), 220); return () => window.clearTimeout(timer); }, [load, notify]);
  const open = useCallback(async (id: string) => { try { setSelected(await request(`/sales/customers/${id}`)); setMode('detail'); } catch (error: any) { notify(error.message, true); } }, [request, notify]);
  useEffect(() => {
    const requestedCustomer = searchParams.get('customer');
    if (requestedCustomer) void open(requestedCustomer);
    else if (searchParams.get('new') === '1') setMode('create');
  }, [searchParams, open]);
  if (mode === 'create') return <CustomerForm creditAccess={fieldAccess(user, 'customer', 'creditLimitMinor')} termsAccess={fieldAccess(user, 'customer', 'paymentTermsDays')} taxAccess={fieldAccess(user, 'party', 'taxNumber')} refs={refs} request={request} language={language} close={() => setMode('list')} saved={async (customer) => { await refreshRefs(); await load(); notify(`${customer.code} · ${customer.name} created`); await open(customer.id); }}/>;
  if (mode === 'detail' && selected) return <CustomerDetail customer={selected} user={user} refs={refs} navigate={navigate} language={language} close={() => { setMode('list'); setSelected(null); }} request={request} notify={notify} reload={() => open(selected.id)}/>;
  return <div className="page sales-v2-page">
    <SalesPageHead title={t('Customers', language)} subtitle={t('Find customer contacts, credit settings, balances, and related sales documents.', language)}>
      {canAccess(user.permissions, 'sales.customer.create') ? <button data-testid="new-customer" className="button primary" onClick={() => setMode('create')}><AppIcon name="add"/>{t('New Customer', language)}</button> : null}
    </SalesPageHead>
    <section className="sales-data-panel">
      <div className="sales-filter-bar">
        <label className="sales-search"><AppIcon name="search" size={16}/><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder={t(fieldAccess(user, 'party', 'taxNumber') === 'HIDDEN' ? 'Search code, name, phone, or email…' : 'Search code, name, phone, email, or tax number…', language)} aria-label={t('Search customers', language)}/></label>
        <label><span>{t('Status', language)}</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="ACTIVE">{t('Active', language)}</option><option value="INACTIVE">{t('Inactive', language)}</option><option value="ALL">{t('All statuses', language)}</option></select></label>
        <label><span>{t('Branch', language)}</span><select value={branchId} onChange={(event) => { setPage(1); setBranchId(event.target.value); }}><option value="">{t('All branches', language)}</option>{refs.branches.map((branch: Json) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        {(search || branchId || status !== 'ACTIVE') ? <button className="text-action" onClick={() => { setSearch(''); setBranchId(''); setStatus('ACTIVE'); }}>{t('Clear filters', language)}</button> : null}
        <span className="filter-count">{result?.pagination?.total || 0} {t('customers', language)}</span>
      </div>
      {!result ? <div className="sales-loading"><div className="spinner"/>{t('Loading customers…', language)}</div> : result.rows.length ? <><div className="table-wrap"><table data-testid="customer-table"><thead><tr><th>{t('Customer code', language)}</th><th>{t('Customer name', language)}</th><th>{t('Contact', language)}</th><th>{t('Branch', language)}</th><th>{t('Credit status', language)}</th><th className="number">{t('Outstanding balance', language)}</th><th>{t('Status', language)}</th><th></th></tr></thead>
        <tbody>{result.rows.map((customer: Json) => <tr key={customer.id}><td><button className="sales-link" onClick={() => open(customer.id)}>{customer.code}</button></td><td><button className="customer-link" onClick={() => open(customer.id)}><strong>{customer.name}</strong><span>{customer.city}</span></button></td><td>{customer.phone || '—'}<br/><span className="muted">{customer.email || '—'}</span></td><td>{customer.defaultBranch?.name || t('Not assigned', language)}</td><td>{customer.creditLimitMinor === undefined ? <span className="neutral-state">{t('Restricted', language)}</span> : customer.creditHold ? <StatusBadge value="REJECTED" language={language}/> : customer.creditLimitMinor === null ? <span className="neutral-state">{t('No credit limit configured', language)}</span> : <span>{money(customer.creditLimitMinor, customer.defaultCurrency || refs.tenant.baseCurrency, language)}</span>}</td><td className="number"><strong>{money(customer.outstandingMinor, refs.tenant.baseCurrency, language)}</strong></td><td><StatusBadge value={customer.active ? 'APPROVED' : 'CANCELLED'} language={language}/></td><td><button className="row-button" onClick={() => open(customer.id)}>{t('View', language)}</button></td></tr>)}</tbody>
      </table></div><Pagination pagination={result.pagination} onPage={setPage} language={language}/></> : <SalesEmpty heading={t('No matching customers', language)} text={t('Adjust the filters or create the first customer.', language)} action={<button className="button primary" onClick={() => setMode('create')}>{t('New Customer', language)}</button>}/>}
    </section>
  </div>;
}

function CustomerForm({ refs, request, language, close, saved, customer, creditAccess, termsAccess, taxAccess }: { refs: Json; request: Requester; language: Language; close: () => void; saved: (customer: Json) => Promise<void>; customer?: Json; creditAccess: string; termsAccess: string; taxAccess: string }) {
  const [form, setForm] = useState<Json>(() => ({ name: customer?.name || '', customerType: customer?.customerType || 'BUSINESS', city: customer?.city || 'Cairo', phone: customer?.phone || '', email: customer?.email || '', taxNumber: customer?.taxNumber || '', registrationNumber: customer?.registrationNumber || '', defaultBranchId: customer?.defaultBranchId || refs.branches[0]?.id || '', billingAddress: customer?.billingAddress || '', shippingAddress: customer?.shippingAddress || '', paymentTermsDays: customer?.paymentTermsDays ?? '', creditLimit: customer?.creditLimitMinor === null || customer?.creditLimitMinor === undefined ? '' : decimal(asBigInt(customer.creditLimitMinor)), defaultCurrency: customer?.defaultCurrency || '', taxTreatment: customer?.taxTreatment || 'STANDARD', creditHold: Boolean(customer?.creditHold) }));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key: string, value: unknown) => setForm((current: Json) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const payload = { ...form };
    if (creditAccess !== 'EDIT') { delete payload.creditLimit; delete payload.creditHold; }
    if (termsAccess !== 'EDIT') delete payload.paymentTermsDays;
    if (taxAccess !== 'EDIT') { delete payload.taxNumber; delete payload.registrationNumber; }
    try { await saved(await request(customer ? `/masters/customers/${customer.id}` : '/masters/customers', { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(payload) })); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  };
  return <div className="page sales-v2-page sales-form-surface">
    <SalesPageHead title={t(customer ? 'Edit Customer' : 'New Customer', language)} subtitle={t('Add the details your team needs to sell, deliver, and follow up.', language)} back={close}><span className="auto-code"><AppIcon name="lock" size={14}/>{customer ? customer.code : t('Customer code is generated automatically after saving', language)}</span></SalesPageHead>
    <form className="customer-create-layout" onSubmit={submit}>
      <section className="sales-form-section"><div className="section-title"><span>1</span><div><h2>{t('Basic information', language)}</h2><p>{t('The customer’s identity and main contact details', language)}</p></div></div>
        <div className="sales-form-grid">
          <label className="wide">{t('Customer name', language)}<input data-testid="master-customer-name" value={form.name} onChange={(event) => set('name', event.target.value)} required/></label>
          <label>{t('Customer type', language)}<select value={form.customerType} onChange={(event) => set('customerType', event.target.value)}><option value="BUSINESS">{t('Business', language)}</option><option value="INDIVIDUAL">{t('Individual', language)}</option></select></label>
          <label>{t('Default branch', language)}<select value={form.defaultBranchId} onChange={(event) => set('defaultBranchId', event.target.value)}><option value="">{t('Not assigned', language)}</option>{refs.branches.map((branch: Json) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>{t('Phone', language)}<input value={form.phone} onChange={(event) => set('phone', event.target.value)}/></label>
          <label>{t('Email', language)}<input type="email" value={form.email} onChange={(event) => set('email', event.target.value)}/></label>
          <label>{t('City', language)}<input value={form.city} onChange={(event) => set('city', event.target.value)} required/></label>
          {taxAccess !== 'HIDDEN' ? <><label>{t('Tax number', language)}<input value={form.taxNumber} readOnly={taxAccess !== 'EDIT'} onChange={(event) => set('taxNumber', event.target.value)}/></label><label>{t('Registration number', language)}<input value={form.registrationNumber} readOnly={taxAccess !== 'EDIT'} onChange={(event) => set('registrationNumber', event.target.value)}/></label></> : null}
          <label className="wide">{t('Billing address', language)}<textarea value={form.billingAddress} onChange={(event) => set('billingAddress', event.target.value)}/></label>
          <label className="wide">{t('Shipping address', language)}<textarea value={form.shippingAddress} onChange={(event) => set('shippingAddress', event.target.value)}/></label>
        </div>
      </section>
      {creditAccess !== 'HIDDEN' || termsAccess !== 'HIDDEN' ? <details className="advanced-section" open><summary><span><AppIcon name="money"/><b>{t('Credit and Payment Settings', language)}</b><small>{t('Optional', language)}</small></span><AppIcon name="next" size={15}/></summary>
        <div className="sales-form-grid">
          {termsAccess !== 'HIDDEN' ? <label>{t('Payment terms (days)', language)}<input type="number" min="0" value={form.paymentTermsDays} readOnly={termsAccess !== 'EDIT'} onChange={(event) => set('paymentTermsDays', event.target.value)} placeholder={t('Not specified', language)}/><small>{t('Leave blank when no standard terms apply.', language)}</small></label> : null}
          {creditAccess !== 'HIDDEN' ? <label>{t('Credit limit', language)}<input inputMode="decimal" value={form.creditLimit} readOnly={creditAccess !== 'EDIT'} onChange={(event) => set('creditLimit', event.target.value)} placeholder={t('No credit limit configured', language)}/><small>{t('Blank is different from a zero credit limit.', language)}</small></label> : null}
          <label>{t('Default currency', language)}<select value={form.defaultCurrency} onChange={(event) => set('defaultCurrency', event.target.value)}><option value="">{t('Not specified', language)}</option>{refs.currencies.map((currency: Json) => <option key={currency.id} value={currency.code}>{currency.code} · {currency.name}</option>)}</select></label>
          <label>{t('Tax treatment', language)}<select value={form.taxTreatment} onChange={(event) => set('taxTreatment', event.target.value)}><option value="STANDARD">{t('Standard taxable', language)}</option><option value="EXEMPT">{t('Tax exempt', language)}</option></select></label>
          {creditAccess !== 'HIDDEN' ? <label className="check-field wide"><input type="checkbox" checked={form.creditHold} disabled={creditAccess !== 'EDIT'} onChange={(event) => set('creditHold', event.target.checked)}/><span><b>{t('Place customer on credit hold', language)}</b><small>{t('New sales documents will require review.', language)}</small></span></label> : null}
        </div>
      </details> : null}
      {error ? <p className="sales-form-error" role="alert"><AppIcon name="error" size={15}/>{error}</p> : null}
      <div className="sales-sticky-actions"><button type="button" className="button" onClick={close}>{t('Cancel', language)}</button><button data-testid="save-customer" className="button primary" disabled={busy}>{busy ? t('Saving…', language) : t(customer ? 'Save changes' : 'Create Customer', language)}</button></div>
    </form>
  </div>;
}

function CustomerDetail({ customer, user, refs, navigate, language, close, request, notify, reload }: { customer: Json; user: Json; refs: Json; navigate: (route: string) => void; language: Language; close: () => void; request: Requester; notify: (message: string, error?: boolean) => void; reload: () => Promise<void> }) {
  const [tab, setTab] = useState('overview'), [editCredit, setEditCredit] = useState(false), [credit, setCredit] = useState({ creditLimit: customer.creditLimitMinor === null ? '' : decimal(asBigInt(customer.creditLimitMinor)), paymentTermsDays: customer.paymentTermsDays ?? '', creditHold: customer.creditHold });
  const [editing, setEditing] = useState(false);
  const allowed = (permission: string) => canAccess(user.permissions, permission);
  const creditAccess = fieldAccess(user, 'customer', 'creditLimitMinor'), termsAccess = fieldAccess(user, 'customer', 'paymentTermsDays'), balanceAccess = fieldAccess(user, 'customer', 'balanceMinor'), taxAccess = fieldAccess(user, 'party', 'taxNumber');
  const tabs = ['overview', 'quotations', 'invoices', 'payments', ...(balanceAccess === 'HIDDEN' ? [] : ['statement', 'ageing']), 'activity'];
  const saveCredit = async () => {
    const payload: Json = {};
    if (creditAccess === 'EDIT') { payload.creditLimit = credit.creditLimit; payload.creditHold = credit.creditHold; }
    if (termsAccess === 'EDIT') payload.paymentTermsDays = credit.paymentTermsDays;
    try { await request(`/masters/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); notify('Customer credit settings updated'); setEditCredit(false); await reload(); } catch (error: any) { notify(error.message, true); }
  };
  const documents = (type: string) => customer.documents.filter((document: Json) => document.type === type);
  if (editing) return <CustomerForm customer={customer} creditAccess={creditAccess} termsAccess={termsAccess} taxAccess={taxAccess} refs={refs} request={request} language={language} close={() => setEditing(false)} saved={async () => { notify('Customer details updated'); setEditing(false); await reload(); }}/>;
  return <div className="page sales-v2-page record-surface">
    <SalesPageHead title={customer.name} subtitle={`${customer.code} · ${customer.city}`} back={close}><StatusBadge value={customer.active ? 'APPROVED' : 'CANCELLED'} language={language}/>{allowed('sales.customer.edit') ? <button className="button" onClick={() => setEditing(true)}><AppIcon name="edit"/>{t('Edit Customer', language)}</button> : null}{allowed('sales.quotation.create') ? <button className="button primary" onClick={() => navigate(`/sales/quotations?new=1&customer=${customer.id}`)}><AppIcon name="add"/>{t('New Quotation', language)}</button> : null}</SalesPageHead>
    <section className="record-summary"><div><span>{t('Phone', language)}</span><strong>{customer.phone || '—'}</strong></div><div><span>{t('Email', language)}</span><strong>{customer.email || '—'}</strong></div><div><span>{t('Default branch', language)}</span><strong>{customer.defaultBranch?.name || t('Not assigned', language)}</strong></div>{balanceAccess !== 'HIDDEN' ? <div><span>{t('Outstanding balance', language)}</span><strong>{money(customer.outstandingMinor, refs.tenant.baseCurrency, language)}</strong></div> : null}</section>
    <nav className="record-tabs" aria-label={t('Customer sections', language)}>{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{t(item[0].toUpperCase() + item.slice(1), language)}{['quotations','invoices','payments'].includes(item) ? <b>{item === 'payments' ? customer.payments.length : documents(item === 'quotations' ? 'QUOTATION' : 'SALES_INVOICE').length}</b> : null}</button>)}</nav>
    {tab === 'overview' ? <div className="customer-detail-grid"><section className="sales-data-panel"><div className="sales-panel-title"><div><h2>{t('Customer information', language)}</h2><p>{t('Contact, registration, and delivery details', language)}</p></div></div><dl className="record-fields"><div><dt>{t('Customer type', language)}</dt><dd>{t(customer.customerType, language)}</dd></div>{taxAccess !== 'HIDDEN' ? <><div><dt>{t('Tax number', language)}</dt><dd>{customer.taxNumber || '—'}</dd></div><div><dt>{t('Registration number', language)}</dt><dd>{customer.registrationNumber || '—'}</dd></div></> : null}<div><dt>{t('Billing address', language)}</dt><dd>{customer.billingAddress || '—'}</dd></div><div><dt>{t('Shipping address', language)}</dt><dd>{customer.shippingAddress || '—'}</dd></div></dl></section>
      {creditAccess !== 'HIDDEN' || termsAccess !== 'HIDDEN' ? <section className="sales-data-panel credit-panel"><div className="sales-panel-title"><div><h2>{t('Credit and payment', language)}</h2><p>{customer.creditLimitMinor === null ? t('No credit limit configured', language) : t('Configured account terms', language)}</p></div>{creditAccess === 'EDIT' || termsAccess === 'EDIT' ? <button className="row-button" onClick={() => setEditCredit(!editCredit)}>{t(editCredit ? 'Close' : 'Edit', language)}</button> : null}</div>
        {editCredit ? <div className="credit-edit">{creditAccess !== 'HIDDEN' ? <label>{t('Credit limit', language)}<input value={credit.creditLimit} readOnly={creditAccess !== 'EDIT'} onChange={(event) => setCredit({ ...credit, creditLimit: event.target.value })} placeholder={t('Not specified', language)}/></label> : null}{termsAccess !== 'HIDDEN' ? <label>{t('Payment terms (days)', language)}<input value={credit.paymentTermsDays} readOnly={termsAccess !== 'EDIT'} onChange={(event) => setCredit({ ...credit, paymentTermsDays: event.target.value })} placeholder={t('Not specified', language)}/></label> : null}{creditAccess !== 'HIDDEN' ? <label className="check-field"><input type="checkbox" checked={credit.creditHold} disabled={creditAccess !== 'EDIT'} onChange={(event) => setCredit({ ...credit, creditHold: event.target.checked })}/><span>{t('Credit hold', language)}</span></label> : null}<button className="button primary" onClick={saveCredit}>{t('Save changes', language)}</button></div> : <dl className="record-fields">{creditAccess !== 'HIDDEN' ? <div><dt>{t('Credit limit', language)}</dt><dd>{customer.creditLimitMinor === null ? t('Not specified', language) : money(customer.creditLimitMinor, customer.defaultCurrency || 'EGP', language)}</dd></div> : null}{termsAccess !== 'HIDDEN' ? <div><dt>{t('Payment terms', language)}</dt><dd>{customer.paymentTermsDays === null ? t('Not specified', language) : `${customer.paymentTermsDays} ${t('days', language)}`}</dd></div> : null}<div><dt>{t('Default currency', language)}</dt><dd>{customer.defaultCurrency || t('Not specified', language)}</dd></div>{creditAccess !== 'HIDDEN' ? <div><dt>{t('Credit hold', language)}</dt><dd>{t(customer.creditHold ? 'Active' : 'Not active', language)}</dd></div> : null}</dl>}
      </section> : null}</div> : null}
    {tab === 'quotations' || tab === 'invoices' ? <DocumentRows rows={documents(tab === 'quotations' ? 'QUOTATION' : 'SALES_INVOICE')} language={language}/> : null}
    {tab === 'payments' ? <section className="sales-data-panel"><DocumentRows rows={customer.payments.map((payment: Json) => ({ ...payment, type: payment.kind, documentDate: payment.postingDate, totalMinor: payment.amountMinor, status: 'POSTED', currency: 'EGP' }))} language={language}/></section> : null}
    {tab === 'statement' ? <section className="sales-data-panel"><div className="table-wrap"><table><thead><tr><th>{t('Date', language)}</th><th>{t('Document', language)}</th><th>{t('Reference', language)}</th><th>{t('Currency', language)}</th><th className="number">{t('Debit', language)}</th><th className="number">{t('Credit', language)}</th><th className="number">{t('Running balance', language)}</th></tr></thead><tbody>{customer.statement.map((row: Json) => <tr key={`${row.transaction}-${row.documentNumber}`}><td>{displayDate(row.date, language)}</td><td><strong>{row.documentNumber}</strong><br/><span className="muted">{t(row.transaction.replaceAll('_', ' '), language)}</span></td><td>{row.reference || '—'}</td><td>{row.currency}</td><td className="number">{money(row.debitMinor, row.baseCurrency, language)}</td><td className="number">{money(row.creditMinor, row.baseCurrency, language)}</td><td className="number"><strong>{money(row.runningBalanceMinor, row.baseCurrency, language)}</strong></td></tr>)}</tbody></table></div></section> : null}
    {tab === 'ageing' ? <section className="sales-data-panel"><div className="table-wrap"><table><thead><tr><th>{t('Document', language)}</th><th>{t('Due date', language)}</th><th>{t('Bucket', language)}</th><th className="number">{t('Outstanding', language)}</th></tr></thead><tbody>{customer.ageing.map((row: Json) => <tr key={row.invoiceId}><td><strong>{row.number}</strong></td><td>{displayDate(row.dueDate, language)}</td><td>{t(row.bucket, language)}</td><td className="number"><strong>{money(row.outstandingMinor, refs.tenant.baseCurrency, language)}</strong></td></tr>)}</tbody></table></div></section> : null}
    {tab === 'activity' ? <AuditTimeline rows={customer.audit} language={language}/> : null}
  </div>;
}

function DocumentRows({ rows, language }: { rows: Json[]; language: Language }) {
  return <section className="sales-data-panel">{rows.length ? <div className="table-wrap"><table><thead><tr><th>{t('Document', language)}</th><th>{t('Date', language)}</th><th>{t('Status', language)}</th><th className="number">{t('Total', language)}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.number}</strong></td><td>{displayDate(row.documentDate, language)}</td><td><StatusBadge value={row.status} type={row.type} language={language}/></td><td className="number">{money(row.totalMinor, row.currency || 'EGP', language)}</td></tr>)}</tbody></table></div> : <SalesEmpty heading={t('Nothing here yet', language)} text={t('Related records will appear here when the workflow progresses.', language)}/>}</section>;
}

function AuditTimeline({ rows, language }: { rows: Json[]; language: Language }) {
  return <section className="sales-data-panel audit-timeline">{rows.length ? rows.map((row) => <div key={row.id}><i><AppIcon name="history" size={13}/></i><span><strong>{t(row.action.replaceAll('_', ' '), language)}</strong><small>{row.user?.name || row.actor?.name || '—'} · {displayDateTime(row.createdAt, language)}</small></span></div>) : <SalesEmpty heading={t('No activity yet', language)} text={t('Changes and decisions will be recorded here.', language)}/>}</section>;
}

export function SalesDocumentsWorkspace({ selectedType, ...props }: SalesWorkspaceProps & { selectedType: string }) {
  const { refs, request, notify, language, user } = props;
  const searchParams = useSearchParams();
  const [result, setResult] = useState<Json>(null), [page, setPage] = useState(1), [search, setSearch] = useState(''), [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState(''), [salespersonId, setSalespersonId] = useState(''), [currency, setCurrency] = useState('');
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>('list'), [detail, setDetail] = useState<Json>(null);
  const pageNames: Record<string, string> = { QUOTATION: 'Quotations', SALES_ORDER: 'Sales Orders', DELIVERY_NOTE: 'Deliveries', SALES_INVOICE: 'Invoices', SALES_RETURN: 'Returns', CREDIT_NOTE: 'Credit Notes' };
  const load = useCallback(async () => {
    const query = new URLSearchParams({ type: selectedType, page: String(page), pageSize: '15', sort: 'updated' });
    if (search.trim()) query.set('search', search.trim());
    if (status) query.set('status', status);
    if (branchId) query.set('branchId', branchId);
    if (salespersonId) query.set('salespersonId', salespersonId);
    if (currency) query.set('currency', currency);
    setResult(await request(`/sales/documents?${query}`));
  }, [request, selectedType, page, search, status, branchId, salespersonId, currency]);
  const openDetail = useCallback(async (id: string) => {
    try { setDetail(await request(`/documents/${id}`)); setMode('detail'); } catch (error: any) { notify(error.message, true); }
  }, [request, notify]);
  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error) => notify(error.message, true)), 220); return () => window.clearTimeout(timer); }, [load, notify]);
  useEffect(() => {
    const requestedDocument = searchParams.get('document');
    if (requestedDocument) void openDetail(requestedDocument);
    else if (searchParams.get('new') === '1' && ['QUOTATION', 'SALES_ORDER'].includes(selectedType)) setMode('create');
  }, [searchParams, selectedType, openDetail]);
  const directCreate = ['QUOTATION', 'SALES_ORDER'].includes(selectedType) && canAccess(user.permissions, documentPermission(selectedType, 'create'));
  if (mode === 'create' && directCreate) return <QuotationWizard type={selectedType} initialCustomerId={searchParams.get('customer') || undefined} {...props} close={() => setMode('list')} saved={async (document) => { await load(); await openDetail(document.id); }}/>;
  if (mode === 'detail' && detail) return <SalesDocumentDetail document={detail} {...props} close={() => { setMode('list'); setDetail(null); }} reload={() => openDetail(detail.id)}/>;
  return <div className="page sales-v2-page">
    <SalesPageHead title={t(pageNames[selectedType] || selectedType, language)} subtitle={t(selectedType === 'QUOTATION' ? 'Create clear offers, follow approvals, and convert accepted quotations.' : selectedType === 'SALES_INVOICE' ? 'Track issued invoices, due dates, payments, and delivery links.' : 'Review each document and its place in the sales workflow.', language)}>
      {directCreate ? <button data-testid="new-document" className="button primary" onClick={() => setMode('create')}><AppIcon name="add"/>{t(selectedType === 'QUOTATION' ? 'New Quotation' : 'New Sales Order', language)}</button> : <span className="auto-code"><AppIcon name="approve" size={14}/>{t('Created from an approved source document', language)}</span>}
    </SalesPageHead>
    <section className="sales-data-panel">
      <div className="sales-filter-bar document-filters">
        <label className="sales-search"><AppIcon name="search" size={16}/><input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder={t('Search document, customer, salesperson, product, or reference…', language)} aria-label={t('Search documents', language)}/></label>
        <label><span>{t('Status', language)}</span><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}><option value="">{t('All statuses', language)}</option><option value="DRAFT">{t('Draft', language)}</option><option value="PENDING_APPROVAL">{t('Pending Approval', language)}</option><option value="APPROVED">{t('Approved', language)}</option><option value="REJECTED">{t('Rejected', language)}</option><option value="POSTED">{t('Issued / Completed', language)}</option></select></label>
        <label><span>{t('Branch', language)}</span><select value={branchId} onChange={(event) => { setPage(1); setBranchId(event.target.value); }}><option value="">{t('All branches', language)}</option>{refs.branches.map((branch: Json) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label><span>{t('Salesperson', language)}</span><select value={salespersonId} onChange={(event) => { setPage(1); setSalespersonId(event.target.value); }}><option value="">{t('All salespeople', language)}</option>{refs.salesEmployees.map((employee: Json) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
        <label><span>{t('Currency', language)}</span><select value={currency} onChange={(event) => { setPage(1); setCurrency(event.target.value); }}><option value="">{t('All currencies', language)}</option>{refs.currencies.map((entry: Json) => <option key={entry.id} value={entry.code}>{entry.code}</option>)}</select></label>
        {(search || status || branchId || salespersonId || currency) ? <button className="text-action" onClick={() => { setSearch(''); setStatus(''); setBranchId(''); setSalespersonId(''); setCurrency(''); }}>{t('Clear filters', language)}</button> : null}
      </div>
      {!result ? <div className="sales-loading"><div className="spinner"/>{t('Loading documents…', language)}</div> : result.rows.length ? <><div className="table-wrap"><table data-testid="document-table"><thead><tr><th>{t('Document number', language)}</th><th>{t('Customer', language)}</th><th>{t('Salesperson', language)}</th><th>{t('Branch', language)}</th><th>{t(selectedType === 'SALES_INVOICE' ? 'Invoice date' : 'Valid until', language)}</th><th className="number">{t('Total', language)}</th>{selectedType === 'SALES_INVOICE' ? <th className="number">{t('Remaining balance', language)}</th> : null}<th>{t('Status', language)}</th><th>{t('Last updated', language)}</th><th></th></tr></thead>
        <tbody>{result.rows.map((document: Json) => <tr key={document.id}><td><button className="sales-link" onClick={() => openDetail(document.id)}>{document.number}</button></td><td><button className="customer-link" onClick={() => openDetail(document.id)}><strong>{document.customer?.name || '—'}</strong><span>{document.customer?.code}</span></button></td><td>{document.salesEmployee ? `${document.salesEmployee.name} · ${document.salesEmployee.code}` : '—'}</td><td>{document.branch?.name}</td><td>{displayDate(selectedType === 'SALES_INVOICE' ? document.documentDate : document.dueDate, language)}</td><td className="number"><strong>{money(document.totalMinor, document.currency, language)}</strong></td>{selectedType === 'SALES_INVOICE' ? <td className="number">{money(document.remainingMinor, document.currency, language)}</td> : null}<td><StatusBadge value={document.paymentStatus && document.paymentStatus !== 'UNPAID' ? document.paymentStatus : document.status} type={document.type} language={language}/></td><td>{displayDate(document.updatedAt, language)}</td><td><button className="row-button" onClick={() => openDetail(document.id)}>{t('View', language)}</button></td></tr>)}</tbody>
      </table></div><Pagination pagination={result.pagination} onPage={setPage} language={language}/></> : <SalesEmpty heading={t('No matching documents', language)} text={t('Adjust the filters or create the first document.', language)} action={directCreate ? <button className="button primary" onClick={() => setMode('create')}>{t('Create document', language)}</button> : null}/>}
    </section>
  </div>;
}

type WizardLine = { itemId: string; description: string; quantity: string; unitPrice: string; discountPercent: string };

function QuotationWizard({ type, initialCustomerId, user, refs, request, notify, close, saved, language }: SalesWorkspaceProps & { type: string; initialCustomerId?: string; close: () => void; saved: (document: Json) => Promise<void> }) {
  const initialCustomer = refs.customers.find((customer: Json) => customer.id === initialCustomerId) || refs.customers[0];
  const defaultBranch = refs.branches.find((branch: Json) => branch.id === initialCustomer?.defaultBranchId) || refs.branches[0];
  const defaultWarehouse = refs.warehouses.find((warehouse: Json) => warehouse.branchId === defaultBranch?.id);
  const [step, setStep] = useState(1), [draftId, setDraftId] = useState('');
  const [employees, setEmployees] = useState<Json[]>(refs.salesEmployees || []);
  const [fields, setFields] = useState<Json>({
    customerId: initialCustomer?.id || '',
    branchId: defaultBranch?.id || '',
    warehouseId: defaultWarehouse?.id || '',
    salespersonId: refs.salesEmployees?.[0]?.id || '',
    documentDate: isoToday(),
    dueDate: addDays(14),
    currency: refs.tenant.baseCurrency,
    exchangeRate: '1.000000',
    exchangeRateDate: isoToday(),
    rateSource: 'BASE_CURRENCY',
    manualExchangeRate: false,
    exchangeRateOverrideReason: '',
    paymentTerms: '',
    deliveryTerms: '',
    notes: '',
    taxMode: 'EXCLUSIVE',
    priceOverrideReason: '',
  });
  const [lines, setLines] = useState<WizardLine[]>([{ itemId: refs.items[0]?.id || '', description: refs.items[0]?.name || '', quantity: '1.000', unitPrice: '', discountPercent: '0' }]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [savedAt, setSavedAt] = useState('');
  const warehouses = refs.warehouses.filter((warehouse: Json) => warehouse.branchId === fields.branchId);
  const currencyRecord = refs.currencies.find((entry: Json) => entry.code === fields.currency);
  const rateMicros = fixed(fields.exchangeRate, 6) || 1_000_000n;
  const baseCurrency = refs.tenant.baseCurrency;

  const defaultPrice = useCallback((item: Json) => {
    const basePrice = asBigInt(item?.salePriceMinor);
    const converted = fields.currency === baseCurrency ? basePrice : roundDiv(basePrice * 1_000_000n, rateMicros);
    return decimal(converted);
  }, [fields.currency, baseCurrency, rateMicros]);

  const calculations = useMemo(() => lines.map((line) => {
    const item = refs.items.find((entry: Json) => entry.id === line.itemId);
    const quantityMilli = fixed(line.quantity, 3);
    const unitPriceMinor = fixed(line.unitPrice || defaultPrice(item), 2);
    const gross = roundDiv(quantityMilli * unitPriceMinor, 1000n);
    const discount = roundDiv(gross * fixed(line.discountPercent || '0', 2), 10_000n);
    const charged = gross - discount;
    const rate = asBigInt(item?.taxRateBps);
    const taxable = fields.taxMode === 'INCLUSIVE' ? roundDiv(charged * 10_000n, 10_000n + rate) : charged;
    const tax = fields.taxMode === 'EXEMPT' ? 0n : fields.taxMode === 'INCLUSIVE' ? charged - taxable : roundDiv(taxable * rate, 10_000n);
    const subtotal = fields.taxMode === 'INCLUSIVE' ? taxable + discount : gross;
    const total = fields.taxMode === 'INCLUSIVE' ? charged : taxable + tax;
    return { item, quantityMilli, unitPriceMinor, gross, subtotal, discount, taxable, tax, total };
  }), [lines, refs.items, fields.taxMode, defaultPrice]);
  const totals = calculations.reduce((sum, line) => ({ subtotal: sum.subtotal + line.subtotal, discount: sum.discount + line.discount, tax: sum.tax + line.tax, total: sum.total + line.total }), { subtotal: 0n, discount: 0n, tax: 0n, total: 0n });
  const canOverridePrice = canAccess(user.permissions, 'sales.price.edit');
  const hasPriceOverride = calculations.some((line, index) => Boolean(lines[index].unitPrice) && line.unitPriceMinor !== fixed(defaultPrice(line.item), 2));

  useEffect(() => {
    void request(`/references/sales-employees?branchId=${fields.branchId}`).then((rows) => {
      setEmployees(rows);
      if (!rows.some((employee: Json) => employee.id === fields.salespersonId)) setFields((current: Json) => ({ ...current, salespersonId: rows[0]?.id || '' }));
    }).catch((reason) => notify(reason.message, true));
    const validWarehouses = refs.warehouses.filter((warehouse: Json) => warehouse.branchId === fields.branchId);
    if (!validWarehouses.some((warehouse: Json) => warehouse.id === fields.warehouseId)) setFields((current: Json) => ({ ...current, warehouseId: validWarehouses.length === 1 ? validWarehouses[0].id : '' }));
  }, [fields.branchId, request, notify, refs.warehouses]);

  useEffect(() => {
    if (fields.currency === baseCurrency) {
      setFields((current: Json) => ({ ...current, exchangeRate: '1.000000', exchangeRateDate: current.documentDate, rateSource: 'BASE_CURRENCY', manualExchangeRate: false, exchangeRateOverrideReason: '' }));
      return;
    }
    if (fields.manualExchangeRate) return;
    void request(`/exchange-rates?currency=${fields.currency}&date=${fields.documentDate}`).then((rate) => setFields((current: Json) => ({
      ...current, exchangeRate: rate.rate, exchangeRateDate: String(rate.rateDate).slice(0, 10), rateSource: rate.source,
    }))).catch((reason) => { setError(reason.message); setFields((current: Json) => ({ ...current, exchangeRate: '', rateSource: 'MISSING' })); });
  }, [fields.currency, fields.documentDate, fields.manualExchangeRate, baseCurrency, request]);

  const setField = (key: string, value: unknown) => setFields((current: Json) => ({ ...current, [key]: value }));
  const chooseCustomer = (customerId: string) => {
    const customer = refs.customers.find((entry: Json) => entry.id === customerId);
    const branch = refs.branches.find((entry: Json) => entry.id === customer?.defaultBranchId);
    setFields((current: Json) => ({
      ...current,
      customerId,
      ...(branch ? { branchId: branch.id } : {}),
      ...(!current.paymentTerms && customer?.paymentTermsDays != null ? { paymentTerms: `${customer.paymentTermsDays} days` } : {}),
    }));
  };
  const setLine = (index: number, key: keyof WizardLine, value: string) => setLines((current) => current.map((line, row) => row === index ? { ...line, [key]: value } : line));
  const chooseItem = (index: number, itemId: string) => {
    const item = refs.items.find((entry: Json) => entry.id === itemId);
    setLines((current) => current.map((line, row) => row === index ? { ...line, itemId, description: item?.name || '', unitPrice: '' } : line));
  };
  const validateStep = () => {
    if (step === 1 && (!fields.customerId || !fields.branchId || !fields.warehouseId || !fields.salespersonId)) return t('Choose a customer, branch, warehouse, and salesperson.', language);
    if (step === 2 && (!lines.length || calculations.some((line) => line.quantityMilli <= 0n))) return t('Every product line needs a quantity greater than zero.', language);
    if (step === 2 && hasPriceOverride && !String(fields.priceOverrideReason || '').trim()) return t('Explain why the standard selling price is being overridden.', language);
    if (step === 3 && (!fields.currency || !fields.exchangeRate || rateMicros <= 0n)) return t('A valid exchange rate is required.', language);
    if (step === 3 && fields.manualExchangeRate && !String(fields.exchangeRateOverrideReason || '').trim()) return t('Explain why the system exchange rate is being overridden.', language);
    return '';
  };
  const body = () => ({
    type,
    branchId: fields.branchId,
    warehouseId: fields.warehouseId,
    customerId: fields.customerId,
    salespersonId: fields.salespersonId,
    documentDate: fields.documentDate,
    dueDate: fields.dueDate,
    currency: fields.currency,
    manualExchangeRate: Boolean(fields.manualExchangeRate),
    exchangeRate: fields.exchangeRate,
    exchangeRateDate: fields.exchangeRateDate,
    exchangeRateOverrideReason: fields.exchangeRateOverrideReason,
    priceOverrideReason: fields.priceOverrideReason,
    taxMode: fields.taxMode,
    paymentTerms: fields.paymentTerms,
    notes: [fields.deliveryTerms, fields.notes].filter(Boolean).join('\n'),
    lines: calculations.map((line, index) => ({
      itemId: line.item.id,
      description: lines[index].description,
      quantity: lines[index].quantity,
      unitPrice: decimal(line.unitPriceMinor),
      discount: decimal(line.discount),
      taxRateBps: line.item.taxRateBps,
    })),
  });
  const persist = async (submit = false) => {
    const validation = validateStep();
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try {
      const document = draftId
        ? await request(`/documents/${draftId}`, { method: 'PATCH', body: JSON.stringify(body()) })
        : await request('/documents', { method: 'POST', body: JSON.stringify(body()) });
      setDraftId(document.id);
      setSavedAt(new Date().toISOString());
      if (submit) {
        await request(`/documents/${document.id}/submit`, { method: 'POST', body: JSON.stringify({ comment: 'Submitted from guided quotation review.' }) });
        notify(`${document.number} submitted for approval`);
      } else notify(`${document.number} saved as draft`);
      if (submit || step === 4) await saved(document);
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  };
  const next = () => { const validation = validateStep(); if (validation) setError(validation); else { setError(''); setStep((value) => Math.min(4, value + 1)); } };
  const selectedCustomer = refs.customers.find((customer: Json) => customer.id === fields.customerId);
  const selectedBranch = refs.branches.find((branch: Json) => branch.id === fields.branchId);
  const selectedWarehouse = refs.warehouses.find((warehouse: Json) => warehouse.id === fields.warehouseId);
  const selectedEmployee = employees.find((employee: Json) => employee.id === fields.salespersonId);
  return <div className="page sales-v2-page quotation-wizard">
    <SalesPageHead title={t(type === 'QUOTATION' ? 'New Quotation' : 'New Sales Order', language)} subtitle={t('Create a clear offer for your customer.', language)} back={close}>{savedAt ? <span className="save-state"><AppIcon name="success" size={14}/>{t('Saved just now', language)}</span> : <span className="save-state muted">{t('Unsaved draft', language)}</span>}</SalesPageHead>
    <ol className="sales-stepper">{['Customer & Sales', 'Products & Pricing', 'Payment & Delivery', 'Review'].map((label, index) => <li key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'complete' : ''}><span>{step > index + 1 ? <AppIcon name="success" size={17}/> : index + 1}</span><div><strong>{t(label, language)}</strong><small>{t(step === index + 1 ? 'In progress' : step > index + 1 ? 'Completed' : 'Upcoming', language)}</small></div></li>)}</ol>
    <div className="wizard-layout"><section className="wizard-main">
      {step === 1 ? <div className="sales-form-section"><div className="section-title"><span>1</span><div><h2>{t('Customer and sales information', language)}</h2><p>{t('Choose who, where, and when this quotation applies.', language)}</p></div></div><div className="sales-form-grid">
        <label className="wide">{t('Customer', language)}<select aria-label={t('Customer', language)} value={fields.customerId} onChange={(event) => chooseCustomer(event.target.value)} required>{refs.customers.map((customer: Json) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label>
        <label>{t('Branch', language)}<select aria-label={t('Branch', language)} value={fields.branchId} onChange={(event) => setField('branchId', event.target.value)}>{refs.branches.map((branch: Json) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>{t('Warehouse', language)}<select aria-label={t('Warehouse', language)} value={fields.warehouseId} onChange={(event) => setField('warehouseId', event.target.value)}><option value="">{t('Choose warehouse', language)}</option>{warehouses.map((warehouse: Json) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select><small><AppIcon name="info" size={12}/>{t('Warehouses are filtered based on the selected branch.', language)}</small></label>
        <label>{t('Salesperson', language)}<select aria-label={t('Salesperson', language)} value={fields.salespersonId} onChange={(event) => setField('salespersonId', event.target.value)}><option value="">{employees.length ? t('Choose salesperson', language) : t('No Sales employees are available', language)}</option>{employees.map((employee: Json) => <option key={employee.id} value={employee.id}>{employee.name} — {employee.code}</option>)}</select></label>
        <label>{t('Quotation date', language)}<input type="date" value={fields.documentDate} onChange={(event) => setField('documentDate', event.target.value)}/></label>
        <label>{t('Expiry date', language)}<input type="date" value={fields.dueDate} min={fields.documentDate} onChange={(event) => setField('dueDate', event.target.value)}/></label>
      </div></div> : null}
      {step === 2 ? <div className="line-workspace"><div className="context-strip"><div><span>{t('Customer', language)}</span><strong>{selectedCustomer?.name}</strong></div><div><span>{t('Branch', language)}</span><strong>{selectedBranch?.name}</strong></div><div><span>{t('Warehouse', language)}</span><strong>{selectedWarehouse?.name}</strong></div><div><span>{t('Salesperson', language)}</span><strong>{selectedEmployee ? `${selectedEmployee.name} · ${selectedEmployee.code}` : '—'}</strong></div></div>
        <div className="line-table-wrap"><table className="quotation-lines"><thead><tr><th>#</th><th>{t('Product', language)}</th><th>{t('Description', language)}</th><th>{t('Quantity', language)}</th><th>{t('Unit', language)}</th><th>{t('Unit price', language)}</th><th>{t('Discount %', language)}</th><th>{t('Tax', language)}</th><th className="number">{t('Line total', language)}</th><th></th></tr></thead><tbody>{lines.map((line, index) => { const calc = calculations[index]; return <tr key={index}><td>{index + 1}</td><td><select value={line.itemId} onChange={(event) => chooseItem(index, event.target.value)}>{refs.items.map((item: Json) => <option key={item.id} value={item.id}>{item.sku} · {language === 'ar' ? item.nameAr : item.name}</option>)}</select></td><td><textarea value={line.description} onChange={(event) => setLine(index, 'description', event.target.value)}/></td><td><input aria-label={`${t('Line', language)} ${index + 1} ${t('quantity', language)}`} inputMode="decimal" className={calc.quantityMilli <= 0n ? 'invalid' : ''} value={line.quantity} onChange={(event) => setLine(index, 'quantity', event.target.value)}/>{calc.quantityMilli <= 0n ? <small className="inline-error">{t('Must be greater than zero', language)}</small> : null}</td><td>{calc.item?.uom?.code || 'EA'}</td><td><input inputMode="decimal" value={line.unitPrice || defaultPrice(calc.item)} readOnly={!canOverridePrice} onChange={(event) => setLine(index, 'unitPrice', event.target.value)}/></td><td><input inputMode="decimal" value={line.discountPercent} onChange={(event) => setLine(index, 'discountPercent', event.target.value)}/></td><td>{Number(calc.item?.taxRateBps || 0) / 100}%</td><td className="number"><strong>{money(calc.total, fields.currency, language)}</strong></td><td><IconButton icon="remove" label={t('Remove line', language)} onClick={() => setLines((rows) => rows.filter((_, row) => row !== index))}/></td></tr>; })}</tbody></table></div>
        <button className="button add-line" type="button" onClick={() => setLines((rows) => [...rows, { itemId: refs.items[0]?.id || '', description: refs.items[0]?.name || '', quantity: '1.000', unitPrice: '', discountPercent: '0' }])}><AppIcon name="add"/>{t('Add product', language)}</button>
        <details className="advanced-section" open={hasPriceOverride}><summary><span><AppIcon name="settings"/><b>{t('Advanced Options', language)}</b></span><AppIcon name="next" size={14}/></summary><div className="sales-form-grid"><label>{t('Tax mode', language)}<select value={fields.taxMode} onChange={(event) => setField('taxMode', event.target.value)}><option value="EXCLUSIVE">{t('Tax exclusive', language)}</option><option value="INCLUSIVE">{t('Tax inclusive', language)}</option><option value="EXEMPT">{t('Tax exempt', language)}</option></select></label>{hasPriceOverride ? <label className="wide">{t('Price override reason', language)}<input value={fields.priceOverrideReason} onChange={(event) => setField('priceOverrideReason', event.target.value)} required/><small>{t('The original price, new price, reason, and actor will be kept in the audit trail.', language)}</small></label> : null}</div></details>
      </div> : null}
      {step === 3 ? <div className="sales-form-section"><div className="section-title"><span>3</span><div><h2>{t('Payment and delivery', language)}</h2><p>{t('Set the currency and the terms the customer will see.', language)}</p></div></div><div className="sales-form-grid">
        <label>{t('Currency', language)}<select aria-label={t('Currency', language)} value={fields.currency} onChange={(event) => setField('currency', event.target.value)}>{refs.currencies.map((entry: Json) => <option key={entry.id} value={entry.code}>{entry.code} · {entry.name}</option>)}</select></label>
        <label>{t('Exchange rate', language)}<div className={`rate-field ${fields.rateSource === 'MISSING' ? 'missing' : ''}`}><input aria-label={t('Exchange rate', language)} value={fields.exchangeRate} readOnly={!fields.manualExchangeRate} onChange={(event) => setField('exchangeRate', event.target.value)}/><StatusBadge value={fields.rateSource === 'MISSING' ? 'REJECTED' : 'APPROVED'} language={language}/></div><small>{fields.currency === baseCurrency ? `1 ${baseCurrency} = 1 ${baseCurrency}` : fields.exchangeRate ? `1 ${fields.currency} = ${fields.exchangeRate} ${baseCurrency}` : t('No exchange rate is available.', language)} · {displayDate(fields.exchangeRateDate, language)}</small></label>
        {canAccess(user.permissions, 'sales.exchange_rate.edit') && fields.currency !== baseCurrency ? <><label className="check-field wide"><input type="checkbox" aria-label={t('Enable manual rate override', language)} checked={Boolean(fields.manualExchangeRate)} onChange={(event) => setFields((current: Json) => ({ ...current, manualExchangeRate: event.target.checked, rateSource: event.target.checked ? 'MANUAL_OVERRIDE' : current.rateSource }))}/><span><b>{t('Use a manual exchange rate', language)}</b><small>{t('The rate, date, reason, and actor will be written to the audit trail.', language)}</small></span></label>{fields.manualExchangeRate ? <><label>{t('Rate date', language)}<input type="date" value={fields.exchangeRateDate} onChange={(event) => setField('exchangeRateDate', event.target.value)}/></label><label className="wide">{t('Override reason', language)}<input value={fields.exchangeRateOverrideReason} onChange={(event) => setField('exchangeRateOverrideReason', event.target.value)} required/></label></> : null}</> : null}
        <label className="wide">{t('Payment terms', language)}<input value={fields.paymentTerms} onChange={(event) => setField('paymentTerms', event.target.value)} placeholder={selectedCustomer?.paymentTermsDays ? `${selectedCustomer.paymentTermsDays} ${t('days', language)}` : t('Optional', language)}/></label>
        <label className="wide">{t('Delivery terms', language)}<input value={fields.deliveryTerms} onChange={(event) => setField('deliveryTerms', event.target.value)} placeholder={t('For example: delivery within seven business days', language)}/></label>
        <label className="wide">{t('Notes', language)}<textarea value={fields.notes} onChange={(event) => setField('notes', event.target.value)} placeholder={t('Optional customer-facing notes', language)}/></label>
      </div></div> : null}
      {step === 4 ? <DocumentPreview language={language} document={{ number: draftId ? t('Saved draft', language) : t('Generated after saving', language), type, status: 'DRAFT', documentDate: fields.documentDate, dueDate: fields.dueDate, currency: fields.currency, customer: selectedCustomer, branch: selectedBranch, warehouse: selectedWarehouse, salesEmployee: selectedEmployee, lines: calculations.map((calc, index) => ({ item: calc.item, description: lines[index].description, quantityMilli: calc.quantityMilli, unitPriceMinor: calc.unitPriceMinor, discountMinor: calc.discount, taxMinor: calc.tax, totalMinor: calc.total })), subtotalMinor: totals.subtotal, discountMinor: totals.discount, taxMinor: totals.tax, totalMinor: totals.total, paymentTerms: fields.paymentTerms, notes: fields.notes }}/>: null}
    </section>
    <aside className="wizard-totals"><label>{t('Currency', language)}<strong>{currencyRecord?.code || fields.currency}</strong></label><dl><div><dt>{t('Subtotal', language)}</dt><dd>{money(totals.subtotal, fields.currency, language)}</dd></div><div><dt>{t('Line discounts', language)}</dt><dd>− {money(totals.discount, fields.currency, language)}</dd></div><div><dt>{t('Tax', language)}</dt><dd>{money(totals.tax, fields.currency, language)}</dd></div><div className="grand"><dt>{t('Grand total', language)}</dt><dd>{money(totals.total, fields.currency, language)}</dd></div></dl><p><AppIcon name="info" size={14}/>{t('Prices and totals are recalculated automatically. The server verifies them again when you save.', language)}</p></aside>
    </div>
    {error ? <p className="sales-form-error" role="alert"><AppIcon name="error" size={15}/>{error}</p> : null}
    <div className="sales-sticky-actions"><button className="button" onClick={step === 1 ? close : () => setStep((value) => value - 1)}><AppIcon name="undo"/>{t(step === 1 ? 'Cancel' : 'Back', language)}</button><div>{step < 4 || type !== 'QUOTATION' ? <button className="button" disabled={busy} onClick={() => persist(false)}><AppIcon name="save"/>{t('Save Draft', language)}</button> : null}{step < 4 ? <button className="button primary" onClick={next}>{t(step === 1 ? 'Continue to Products & Pricing' : step === 2 ? 'Continue to Payment & Delivery' : 'Review Quotation', language)}<AppIcon name="next"/></button> : type === 'QUOTATION' ? <button className="button primary" disabled={busy} onClick={() => persist(false)}><AppIcon name="save"/>{busy ? t('Saving…', language) : t('Create Quotation', language)}</button> : <button className="button primary" disabled={busy} onClick={() => persist(true)}><AppIcon name="send"/>{busy ? t('Submitting…', language) : t('Submit for Approval', language)}</button>}</div></div>
  </div>;
}

function SalesDocumentDetail({ document, user, refs, request, authorizedFetch, notify, close, reload, navigate, language }: SalesWorkspaceProps & { document: Json; close: () => void; reload: () => Promise<void> }) {
  const [tab, setTab] = useState('overview'), [busy, setBusy] = useState(''), [reasonAction, setReasonAction] = useState<'reject' | 'request-changes' | 'comment' | ''>(''), [editing, setEditing] = useState(false);
  const [convertTarget, setConvertTarget] = useState('');
  const allowed = (permission: string) => canAccess(user.permissions, permission);
  const act = async (action: string, body?: Json) => {
    setBusy(action);
    try {
      const result = await request(`/documents/${document.id}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      notify(action === 'request-changes' ? 'Document returned for changes' : action === 'approve' ? 'Approval completed' : action === 'reject' ? 'Rejection completed' : action === 'comment' ? 'Comment added to the approval timeline' : `${document.number}: ${action} completed`);
      setReasonAction('');
      await reload();
      return result;
    } catch (error: any) { notify(error.message, true); throw error; } finally { setBusy(''); }
  };
  const printPdf = async () => {
    try {
      const response = await authorizedFetch(`/api/documents/${document.id}/pdf`);
      if (!response.ok) throw new Error('Unable to prepare the PDF.');
      window.open(URL.createObjectURL(await response.blob()), '_blank', 'noopener,noreferrer');
    } catch (error: any) { notify(error.message, true); }
  };
  if (editing) return <DocumentEditSurface document={document} user={user} refs={refs} request={request} notify={notify} language={language} close={() => setEditing(false)} saved={async () => { setEditing(false); await reload(); }}/>;
  const lockReason = document.editState?.reason;
  const related = [document.sourceDocument, ...(document.targetDocuments || [])].filter(Boolean);
  const tabs = ['overview', 'items', 'terms', 'approvals', 'related documents', 'activity'];
  const isSubmitter = String(document.submittedById || '') === String(user.userId || '');
  const directDraftQuotation = document.type === 'QUOTATION' && document.status === 'DRAFT';
  const canConvert = ['APPROVED', 'POSTED'].includes(document.status) || directDraftQuotation;
  return <div className="page sales-v2-page record-surface document-detail">
    <SalesPageHead title={document.number} subtitle={`${document.customer?.name || document.supplier?.name || t('Internal', language)} · ${statusLabel(document.status, document.type, language)}`} back={close}>
      <StatusBadge value={document.status} type={document.type} language={language}/>
      {document.editState?.editable && allowed(documentPermission(document.type, 'edit')) ? <button className="button" onClick={() => setEditing(true)}><AppIcon name="edit"/>{t('Edit', language)}</button> : null}
      {allowed(documentPermission(document.type, 'print')) ? <button className="button" onClick={printPdf}><AppIcon name="print"/>{t('Print / PDF', language)}</button> : null}
      {document.status === 'DRAFT' && document.type !== 'QUOTATION' && allowed(documentPermission(document.type, 'edit')) ? <button className="button primary" disabled={!!busy} onClick={() => act('submit', { comment: 'Submitted from sales document detail.' })}><AppIcon name="send"/>{t('Submit for Approval', language)}</button> : null}
      {document.status === 'REJECTED' && allowed(documentPermission(document.type, 'edit')) ? <button className="button primary" disabled={!!busy} onClick={() => act('submit', { comment: 'Changes completed and resubmitted.' })}><AppIcon name="send"/>{t('Resubmit for Approval', language)}</button> : null}
      {document.status === 'SUBMITTED' && allowed('approvals.queue.history') ? <button className="button" disabled={!!busy} onClick={() => setReasonAction('comment')}><AppIcon name="comment"/>{t('Add Comment', language)}</button> : null}
      {document.status === 'SUBMITTED' && allowed(documentPermission(document.type, 'approve')) && !isSubmitter ? <><button className="button danger" disabled={!!busy || !allowed(documentPermission(document.type, 'reject'))} onClick={() => setReasonAction('reject')}><AppIcon name="rejected"/>{t('Reject', language)}</button>{allowed('approvals.queue.edit') ? <button className="button warning" disabled={!!busy} onClick={() => setReasonAction('request-changes')}><AppIcon name="edit"/>{t('Request Changes', language)}</button> : null}<button className="button primary" disabled={!!busy} onClick={() => act('approve', { comment: 'Reviewed and approved.' })}><AppIcon name="approve"/>{t('Approve', language)}</button></> : null}
      {document.status === 'SUBMITTED' && isSubmitter ? <span data-testid="approval-waiting" className="auto-code"><AppIcon name="pending" size={14}/>{t('Awaiting approval from another authorized user', language)}</span> : null}
      {canConvert && allowed(documentPermission(document.type, 'convert')) ? (SALES_CONVERSIONS[document.type] || []).filter((targetType) => allowed(documentPermission(targetType, 'create'))).map((targetType) => <button key={targetType} className="button primary" disabled={!!busy} onClick={() => setConvertTarget(targetType)}><AppIcon name="next"/>{t(`Convert to ${documentTypeName(targetType)}`, language)}</button>) : null}
    </SalesPageHead>
    {lockReason ? <div className="document-lock"><AppIcon name="lock" size={15}/><span>{t(lockReason, language)}</span>{document.stockMovements?.length ? <b>{document.stockMovements[0].sourceNumber}</b> : document.journalEntry ? <b>{document.journalEntry.number}</b> : null}</div> : null}
    <section className="record-summary document-summary"><div><span>{t('Customer', language)}</span><strong>{document.customer?.name || '—'}</strong></div><div><span>{t('Salesperson', language)}</span><strong>{document.salesEmployee ? `${document.salesEmployee.name} · ${document.salesEmployee.code}` : '—'}</strong></div><div><span>{t('Branch', language)}</span><strong>{document.branch?.name}</strong></div><div><span>{t('Total', language)}</span><strong>{money(document.totalMinor, document.currency, language)}</strong></div>{document.type === 'SALES_INVOICE' ? <><div><span>{t('Paid', language)}</span><strong>{money(document.paidMinor, document.currency, language)}</strong></div><div><span>{t('Returned', language)}</span><strong>{money(document.returnedMinor, document.currency, language)}</strong></div><div><span>{t('Credited', language)}</span><strong>{money(document.creditedMinor, document.currency, language)}</strong></div><div><span>{t('Net receivable', language)}</span><strong>{money(document.netReceivableMinor, document.currency, language)}</strong></div><div><span>{t('Remaining', language)}</span><strong>{money(document.remainingMinor, document.currency, language)}</strong></div></> : null}<div><span>{t(document.type === 'QUOTATION' ? 'Valid until' : 'Due date', language)}</span><strong>{displayDate(document.dueDate, language)}</strong></div></section>
    <nav className="record-tabs" aria-label={t('Document sections', language)}>{tabs.map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{t(item.split(' ').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '), language)}{item === 'approvals' ? <b>{document.approvals.length}</b> : item === 'related documents' ? <b>{related.length}</b> : null}</button>)}</nav>
    {tab === 'overview' ? <div className="document-view-layout"><DocumentPreview document={document} language={language}/><ApprovalTimeline document={document} language={language}/></div> : null}
    {tab === 'items' ? <section className="sales-data-panel"><div className="table-wrap"><table><thead><tr><th>{t('Product', language)}</th><th>{t('Description', language)}</th><th className="number">{t('Quantity', language)}</th><th className="number">{t('Unit price', language)}</th><th className="number">{t('Discount', language)}</th><th className="number">{t('Tax', language)}</th><th className="number">{t('Line total', language)}</th></tr></thead><tbody>{document.lines.map((line: Json) => <tr key={line.id || line.item.id}><td><strong>{line.item.sku}</strong><br/><span className="muted">{language === 'ar' ? line.item.nameAr : line.item.name}</span></td><td>{line.description}</td><td className="number">{Number(asBigInt(line.quantityMilli)) / 1000} {line.uom?.code}</td><td className="number">{money(line.unitPriceMinor, document.currency, language)}</td><td className="number">{money(line.discountMinor, document.currency, language)}</td><td className="number">{money(line.taxMinor, document.currency, language)}</td><td className="number"><strong>{money(line.totalMinor, document.currency, language)}</strong></td></tr>)}</tbody></table></div></section> : null}
    {tab === 'terms' ? <section className="sales-data-panel"><dl className="record-fields"><div><dt>{t('Currency', language)}</dt><dd>{document.currency}</dd></div><div><dt>{t('Exchange rate', language)}</dt><dd>1 {document.currency} = {decimal(asBigInt(document.exchangeRateMicros), 6)} {refs.tenant.baseCurrency}</dd></div><div><dt>{t('Rate date', language)}</dt><dd>{displayDate(document.exchangeRateDate, language)}</dd></div><div><dt>{t('Payment terms', language)}</dt><dd>{document.paymentTerms || t('Not specified', language)}</dd></div><div><dt>{t('Notes', language)}</dt><dd>{document.notes || t('No notes', language)}</dd></div></dl></section> : null}
    {tab === 'approvals' ? <ApprovalTimeline document={document} language={language} full/> : null}
    {tab === 'related documents' ? <section className="sales-data-panel">{related.length ? <div className="related-documents">{related.map((row: Json) => <div key={row.id}><AppIcon name="pdf"/><span><strong>{row.number}</strong><small>{t(row.type.replaceAll('_', ' '), language)}</small></span><StatusBadge value={row.status} type={row.type} language={language}/></div>)}</div> : <SalesEmpty heading={t('No related documents', language)} text={t('Converted orders, deliveries, invoices, and corrections will appear here.', language)}/>}</section> : null}
    {tab === 'activity' ? <AuditTimeline rows={[...document.approvals.map((row: Json) => ({ ...row, user: row.actor })), ...document.audit]} language={language}/> : null}
    {reasonAction ? <ReasonDialog title={t(reasonAction === 'reject' ? 'Reject this document?' : reasonAction === 'request-changes' ? 'Request changes' : 'Add approval comment', language)} description={t(reasonAction === 'reject' ? 'Provide a reason so the requester understands the decision.' : reasonAction === 'request-changes' ? 'Describe exactly what the requester needs to update.' : 'Add context for the requester and other reviewers.', language)} confirmLabel={t(reasonAction === 'reject' ? 'Reject Document' : reasonAction === 'request-changes' ? 'Send Back for Changes' : 'Add Comment', language)} tone={reasonAction === 'reject' ? 'danger' : 'warning'} language={language} close={() => setReasonAction('')} confirm={(comment) => act(reasonAction, { comment }).then(() => undefined)}/> : null}
    {convertTarget ? <SalesConversionDialog document={document} targetType={convertTarget} request={request} notify={notify} language={language} close={() => setConvertTarget('')} converted={async (target) => navigate(`${SALES_DOCUMENT_ROUTES[target.type]}?document=${target.id}`)}/> : null}
  </div>;
}

function DocumentPreview({ document, language }: { document: Json; language: Language }) {
  return <article className="document-paper">
    <div className={`document-watermark ${document.status}`}>{statusLabel(document.status, document.type, language)}</div>
    <header><div className="paper-brand"><img src="/brand/odin-logo.png" alt="ODIN"/><span><strong>ODIN ERP</strong><small>{t('Enterprise Systems', language)}</small></span></div><div className="paper-company"><strong>{t('Odin Distribution Egypt', language)}</strong><span>{t('Cairo, Egypt', language)}</span><span>finance@odin.demo</span></div><div className="paper-title"><h2>{t(document.type === 'SALES_INVOICE' ? 'INVOICE' : document.type === 'SALES_ORDER' ? 'SALES ORDER' : 'QUOTATION', language)}</h2><dl><div><dt>{t('Document No.', language)}</dt><dd>{document.number}</dd></div><div><dt>{t('Date', language)}</dt><dd>{displayDate(document.documentDate, language)}</dd></div><div><dt>{t(document.type === 'QUOTATION' ? 'Valid until' : 'Due date', language)}</dt><dd>{displayDate(document.dueDate, language)}</dd></div><div><dt>{t('Currency', language)}</dt><dd>{document.currency}</dd></div></dl></div></header>
    <section className="paper-parties"><div><span>{t('Customer', language)}</span><strong>{document.customer?.name || '—'}</strong><p>{document.customer?.billingAddress || document.customer?.address || document.customer?.city || ''}</p><p>{document.customer?.taxNumber ? `${t('Tax number', language)}: ${document.customer.taxNumber}` : ''}</p></div><div><span>{t('Sales information', language)}</span><strong>{document.salesEmployee?.name || '—'}</strong><p>{document.branch?.name}</p><p>{document.warehouse?.name}</p></div></section>
    <table><thead><tr><th>#</th><th>{t('Product', language)}</th><th>{t('Description', language)}</th><th className="number">{t('Quantity', language)}</th><th className="number">{t('Unit price', language)}</th><th className="number">{t('Discount', language)}</th><th className="number">{t('Tax', language)}</th><th className="number">{t('Line total', language)}</th></tr></thead><tbody>{document.lines.map((line: Json, index: number) => <tr key={line.id || index}><td>{index + 1}</td><td><strong>{line.item?.sku}</strong><br/>{language === 'ar' ? line.item?.nameAr : line.item?.name}</td><td>{line.description}</td><td className="number">{Number(asBigInt(line.quantityMilli)) / 1000}</td><td className="number">{money(line.unitPriceMinor, document.currency, language)}</td><td className="number">{money(line.discountMinor, document.currency, language)}</td><td className="number">{money(line.taxMinor, document.currency, language)}</td><td className="number"><strong>{money(line.totalMinor, document.currency, language)}</strong></td></tr>)}</tbody></table>
    <footer><div className="paper-terms"><span>{t('Payment terms', language)}</span><strong>{document.paymentTerms || t('Not specified', language)}</strong><p>{document.notes || t('Thank you for your business.', language)}</p></div><dl className="paper-totals"><div><dt>{t('Subtotal', language)}</dt><dd>{money(document.subtotalMinor, document.currency, language)}</dd></div><div><dt>{t('Discount', language)}</dt><dd>− {money(document.discountMinor, document.currency, language)}</dd></div><div><dt>{t('Tax', language)}</dt><dd>{money(document.taxMinor, document.currency, language)}</dd></div><div className="grand"><dt>{t('Grand total', language)}</dt><dd>{money(document.totalMinor, document.currency, language)}</dd></div></dl></footer>
  </article>;
}

function ApprovalTimeline({ document, language, full = false }: { document: Json; language: Language; full?: boolean }) {
  const rows = document.approvals || [];
  return <aside className={`approval-timeline ${full ? 'full' : ''}`}><div className="sales-panel-title"><div><h2>{t('Approval timeline', language)}</h2><p>{t('Sequence, decisions, and comments', language)}</p></div><AppIcon name="approvals"/></div>
    <div className="approval-steps">{rows.map((row: Json) => <div key={row.id} className={row.action}><i><AppIcon name={row.action === 'APPROVE' ? 'success' : row.action === 'REJECT' ? 'rejected' : row.action === 'REQUEST_CHANGES' ? 'edit' : 'pending'} size={15}/></i><span><strong>{t(row.action.replaceAll('_', ' '), language)}</strong><b>{row.actor?.name}</b><small>{displayDateTime(row.createdAt, language)}</small>{row.comment ? <p>{row.comment}</p> : null}</span></div>)}
      {document.status === 'SUBMITTED' ? <div className="WAITING"><i><AppIcon name="pending" size={15}/></i><span><strong>{t('Waiting for review', language)}</strong><small>{t('Current approval step', language)}</small></span></div> : null}
    </div>
    {!rows.length ? <SalesEmpty heading={t('No approval activity', language)} text={t('Submission and decisions will appear here.', language)}/> : null}
  </aside>;
}

function DocumentEditSurface({ document, user, refs, request, notify, language, close, saved }: { document: Json; user: Json; refs: Json; request: Requester; notify: (message: string, error?: boolean) => void; language: Language; close: () => void; saved: () => Promise<void> }) {
  const [fields, setFields] = useState({ documentDate: String(document.documentDate).slice(0, 10), dueDate: document.dueDate ? String(document.dueDate).slice(0, 10) : '', paymentTerms: document.paymentTerms || '', notes: document.notes || '', priceOverrideReason: '' });
  const [lines, setLines] = useState(document.lines.map((line: Json) => ({ itemId: line.itemId, description: line.description || '', quantity: decimal(asBigInt(line.quantityMilli), 3), unitPrice: decimal(asBigInt(line.unitPriceMinor)), discount: decimal(asBigInt(line.discountMinor)) })));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const canOverridePrice = canAccess(user.permissions, 'sales.price.edit');
  const update = (index: number, key: string, value: string) => setLines((rows: Json[]) => rows.map((row: Json, rowIndex: number) => rowIndex === index ? { ...row, [key]: value } : row));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await request(`/documents/${document.id}`, { method: 'PATCH', body: JSON.stringify({ ...fields, lines }) });
      notify(`${document.number} updated`);
      await saved();
    } catch (reason: any) { setError(reason.message); } finally { setBusy(false); }
  };
  return <div className="page sales-v2-page sales-form-surface"><SalesPageHead title={`${t('Edit', language)} ${document.number}`} subtitle={t('Update the returned or draft document, then save before resubmitting.', language)} back={close}><StatusBadge value={document.status} type={document.type} language={language}/></SalesPageHead>
    <form onSubmit={submit}><div className="sales-form-section"><div className="sales-form-grid"><label>{t('Document date', language)}<input type="date" value={fields.documentDate} onChange={(event) => setFields({ ...fields, documentDate: event.target.value })}/></label><label>{t('Valid until', language)}<input type="date" value={fields.dueDate} onChange={(event) => setFields({ ...fields, dueDate: event.target.value })}/></label><label className="wide">{t('Payment terms', language)}<input value={fields.paymentTerms} onChange={(event) => setFields({ ...fields, paymentTerms: event.target.value })}/></label><label className="wide">{t('Notes', language)}<textarea value={fields.notes} onChange={(event) => setFields({ ...fields, notes: event.target.value })}/></label>{canOverridePrice ? <label className="wide">{t('Price override reason', language)}<input value={fields.priceOverrideReason} onChange={(event) => setFields({ ...fields, priceOverrideReason: event.target.value })} placeholder={t('Required only when a standard price is changed', language)}/></label> : null}</div></div>
      <section className="sales-data-panel"><div className="line-table-wrap"><table className="quotation-lines"><thead><tr><th>{t('Product', language)}</th><th>{t('Description', language)}</th><th>{t('Quantity', language)}</th><th>{t('Unit price', language)}</th><th>{t('Discount', language)}</th><th></th></tr></thead><tbody>{lines.map((line: Json, index: number) => <tr key={index}><td><select value={line.itemId} onChange={(event) => update(index, 'itemId', event.target.value)}>{refs.items.map((item: Json) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></td><td><input value={line.description} onChange={(event) => update(index, 'description', event.target.value)}/></td><td><input value={line.quantity} onChange={(event) => update(index, 'quantity', event.target.value)}/></td><td><input value={line.unitPrice} readOnly={!canOverridePrice} onChange={(event) => update(index, 'unitPrice', event.target.value)}/></td><td><input value={line.discount} onChange={(event) => update(index, 'discount', event.target.value)}/></td><td><IconButton icon="remove" label={t('Remove line', language)} onClick={() => setLines((rows: Json[]) => rows.filter((_: Json, row: number) => row !== index))}/></td></tr>)}</tbody></table></div></section>
      {error ? <p className="sales-form-error">{error}</p> : null}<div className="sales-sticky-actions"><button type="button" className="button" onClick={close}>{t('Cancel', language)}</button><button className="button primary" disabled={busy}>{busy ? t('Saving…', language) : t('Save Draft', language)}</button></div>
    </form>
  </div>;
}

export function ApprovalWorkspace(props: SalesWorkspaceProps & { pageTitle: string }) {
  const { request, notify, language, pageTitle } = props;
  const [data, setData] = useState<Json>(null), [selected, setSelected] = useState<Json>(null);
  const load = useCallback(async () => setData(await request('/approvals')), [request]);
  useEffect(() => { void load().catch((error) => notify(error.message, true)); }, [load, notify]);
  const open = async (id: string) => { try { setSelected(await request(`/documents/${id}`)); } catch (error: any) { notify(error.message, true); } };
  if (selected) return <SalesDocumentDetail document={selected} {...props} close={() => setSelected(null)} reload={() => open(selected.id)}/>;
  if (!data) return <div className="sales-loading"><div className="spinner"/>{t('Loading approvals…', language)}</div>;
  return <div className="page sales-v2-page"><SalesPageHead title={t(pageTitle, language)} subtitle={t('Review customer documents with the full context, history, and comments.', language)}><span className="queue-count">{data.documents.length} {t('waiting', language)}</span></SalesPageHead>
    <section className="sales-data-panel"><div className="sales-panel-title"><div><h2>{t('Approvals', language)}</h2><p>{t('Submitted customer documents awaiting a decision', language)}</p></div><AppIcon name="approvals"/></div><div className="sales-filter-bar"><label className="sales-search"><AppIcon name="search" size={16}/><input placeholder={t('Search approval queue…', language)}/></label><span className="filter-count">{t('Oldest requests first', language)}</span></div>
      {data.documents.length ? <div className="table-wrap"><table><thead><tr><th>{t('Document', language)}</th><th>{t('Customer', language)}</th><th>{t('Requested by', language)}</th><th>{t('Approval step', language)}</th><th className="number">{t('Total', language)}</th><th>{t('Submitted', language)}</th><th>{t('Waiting time', language)}</th><th>{t('Status', language)}</th><th></th></tr></thead><tbody>{data.documents.map((document: Json) => <tr key={document.id}><td><button className="sales-link" onClick={() => open(document.id)}>{document.number}</button><br/><span className="muted">{t(document.type.replaceAll('_', ' '), language)}</span></td><td><strong>{document.customer?.name || document.supplier?.name || t('Internal', language)}</strong></td><td>{document.submittedBy?.name}<br/><span className="muted">{document.salesEmployee?.name}</span></td><td>{t('Step 1 · Manager review', language)}</td><td className="number"><strong>{money(document.totalMinor, document.currency, language)}</strong></td><td>{displayDateTime(document.submittedAt, language)}</td><td>{Math.max(1, Math.round((Date.now() - new Date(document.submittedAt).valueOf()) / 3_600_000))}h</td><td><StatusBadge value="SUBMITTED" type={document.type} language={language}/></td><td><button className="button small primary" onClick={() => open(document.id)}>{t('Review', language)}</button></td></tr>)}</tbody></table></div> : <SalesEmpty heading={t('Approval queue is clear', language)} text={t('Submitted sales orders and invoices will appear here.', language)}/>}
    </section>
    {data.journals.length ? <section className="sales-data-panel secondary-queue"><div className="sales-panel-title"><div><h2>{t('Journal approvals', language)}</h2><p>{data.journals.length} {t('waiting', language)}</p></div></div><div className="table-wrap"><table><tbody>{data.journals.map((journal: Json) => <tr key={journal.id}><td><strong>{journal.number}</strong></td><td>{journal.description}</td><td>{journal.submittedBy?.name}</td><td><StatusBadge value="SUBMITTED" language={language}/></td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

export function EmployeeWorkspace({ refs, request, notify, language }: SalesWorkspaceProps) {
  const [rows, setRows] = useState<Json[]>([]), [search, setSearch] = useState(''), [status, setStatus] = useState('ACTIVE');
  useEffect(() => { const timer = window.setTimeout(() => void request(`/hr/employees?search=${encodeURIComponent(search)}&status=${status}`).then(setRows).catch((error) => notify(error.message, true)), 200); return () => window.clearTimeout(timer); }, [request, notify, search, status]);
  return <div className="page sales-v2-page"><SalesPageHead title={t('Employees', language)} subtitle={t('Active HR employees available to operational workflows.', language)}/><section className="sales-data-panel"><div className="sales-filter-bar"><label className="sales-search"><AppIcon name="search" size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search employee code, name, or job title…', language)}/></label><label><span>{t('Status', language)}</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">{t('Active', language)}</option><option value="INACTIVE">{t('Inactive', language)}</option><option value="ALL">{t('All statuses', language)}</option></select></label><span className="filter-count">{rows.length} {t('employees', language)}</span></div>
    <div className="table-wrap"><table><thead><tr><th>{t('Employee code', language)}</th><th>{t('Employee name', language)}</th><th>{t('Department', language)}</th><th>{t('Job title', language)}</th><th>{t('Sales role', language)}</th><th>{t('Status', language)}</th></tr></thead><tbody>{rows.map((employee) => <tr key={employee.id}><td><strong>{employee.code}</strong></td><td>{employee.name}</td><td>{employee.department.name}</td><td>{employee.jobTitle || '—'}</td><td>{employee.salesEligible || employee.department.code === 'SALES' ? <StatusBadge value="APPROVED" language={language}/> : <span className="neutral-state">{t('Not assigned', language)}</span>}</td><td><StatusBadge value={employee.active ? 'APPROVED' : 'CANCELLED'} language={language}/></td></tr>)}</tbody></table></div></section></div>;
}
