"use client";
import { useState } from 'react';
import { useERP, useResource } from '../core/erp-context';
import { PageHeader, Panel, Resource, Table, Fields, Button, ErrorNotice, useUnsaved } from '../components/ui';
import { decimalToMinor, minorToDecimal } from '../core/access-money';
export default function AuthorityLimits() {
    const { tr, request, notify, dateTime } = useERP(), state = useResource('/administration/authority-limits');
    const [draft, setDraft] = useState({ companyId: '', branchId: '', roleId: '', key: 'payments.payment_amount_minor', currency: '', amount: '', reason: '' }), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useUnsaved(open && !!draft.amount);
    const data = state.data, definition = data?.definitions.find((d: any) => d.key === draft.key), percent = definition?.unit === 'percent', precision = data?.currencies.find((c: any) => c.code === draft.currency)?.precision;
    return <><PageHeader title="Company financial authority" subtitle="These limits apply alongside record access and business approvals. The lowest matching active cap wins; priority does not override it.">{data?.canManage ? <Button primary onClick={() => { if (!open || window.dispatchEvent(new Event('odin:before-context-change', { cancelable: true })))
        setOpen(!open); }}>{tr('Add authority limit')}</Button> : null}</PageHeader><Resource state={state}>{data ? <>
 <Panel><div className="surface-body"><p>{tr('No matching policy means no additional company cap. A zero cap blocks positive amounts. A null amount on a percentage policy imposes no amount cap. Currency is matched exactly; no conversion is introduced.')}</p></div><Table rows={data.policies} empty="No company financial limits recorded." columns={[
                { key: 'company', label: 'Company', render: r => r.company.name }, { key: 'key', label: 'Limit', render: r => tr(data.definitions.find((d: any) => d.key === r.key)?.description || 'Custom financial limit') },
                { key: 'amount', label: 'Configured amount', render: r => r.maxAmountMinor !== null ? <bdi>{minorToDecimal(r.maxAmountMinor, data.currencies.find((c: any) => c.code === r.currency)?.precision ?? 0)} {r.currency}</bdi> : r.maxPercentBps !== null ? <bdi>{minorToDecimal(r.maxPercentBps, 2)}%</bdi> : tr('No amount cap') },
                { key: 'scope', label: 'Applies to', render: r => [r.branch?.name || tr('All company branches'), r.role?.name || tr('All groups'), r.department?.name, r.documentType && tr(r.documentType)].filter(Boolean).join(' · ') },
                { key: 'status', label: 'Status', render: r => tr(!r.active ? 'Inactive' : r.validUntil && new Date(r.validUntil) < new Date() ? 'Expired' : new Date(r.validFrom) > new Date() ? 'Scheduled' : 'Active') },
                { key: 'until', label: 'Expires', render: r => r.validUntil ? dateTime(r.validUntil) : tr('No expiry') },
            ]}/></Panel>
 {open ? <Panel title="Add authority limit"><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
                if (!Number.isInteger(precision))
                    throw Error('Select an active configured currency.');
                const { amount, ...body } = draft;
                const units = decimalToMinor(amount, percent ? 2 : precision);
                await request('/access/authority-policies', { method: 'POST', body: JSON.stringify({ ...body, ...(percent ? { maxPercentBps: Number(units) } : { maxAmountMinor: units }) }) });
                setOpen(false);
                setDraft(d => ({ ...d, amount: '', reason: '' }));
                state.reload();
                notify('Company authority limit saved.');
            }
            catch (e: any) {
                setError(e.message);
            }
            finally {
                setBusy(false);
            } }}><Fields values={draft} set={(key, v) => setDraft(d => ({ ...d, [key]: v, ...(key === 'companyId' ? { branchId: '' } : {}) }))} specs={[
                    { key: 'companyId', label: 'Company', required: true, options: [{ value: '', label: 'Select' }, ...data.companies.map((c: any) => ({ value: c.id, label: c.name }))] },
                    { key: 'branchId', label: 'Branch', options: [{ value: '', label: 'All company branches' }, ...(data.companies.find((c: any) => c.id === draft.companyId)?.branches || []).map((b: any) => ({ value: b.id, label: b.name }))] },
                    { key: 'roleId', label: 'Access group', options: [{ value: '', label: 'All groups' }, ...data.roles.map((r: any) => ({ value: r.id, label: r.name }))] },
                    { key: 'key', label: 'Limit', options: data.definitions.map((d: any) => ({ value: d.key, label: d.description })) },
                    { key: 'currency', label: 'Currency', required: true, options: [{ value: '', label: 'Select' }, ...data.currencies.filter((c: any) => c.active).map((c: any) => ({ value: c.code, label: `${c.code} · ${c.precision}` }))] },
                    { key: 'amount', label: percent ? 'Percent' : 'Amount', type: 'decimal', required: true },
                    { key: 'reason', label: 'Reason', type: 'textarea', required: true, hint: 'The existing authority-policy operation requires a reason of at least 10 characters.' },
                ]}/><p>{tr('Currency precision')}: {precision ?? tr('Select')}. {tr('This creates an additional cap. Existing policies are preserved.')}</p>{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button onClick={() => { if (window.dispatchEvent(new Event('odin:before-context-change', { cancelable: true })))
                setOpen(false); }}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy}>{tr('Save authority limit')}</Button></div></form></Panel> : null}
 </> : null}</Resource></>;
}
