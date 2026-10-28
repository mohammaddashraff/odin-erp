"use client";
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useERP, useResource } from '../core/erp-context';
import { PageHeader, Panel, Table, Resource, Button, SearchField, Fields, ErrorNotice, Tabs, Confirm, useUnsaved } from '../components/ui';
import { minorToDecimal, decimalToMinor } from '../core/access-money';
const scopes: Record<string, string> = { NONE: 'No records', OWN: 'Owned records', ASSIGNED: 'Assigned records', TEAM: 'Configured team', BRANCH: 'Permitted branches', WAREHOUSE: 'Assigned warehouses', DEPARTMENT: 'Employee department', ALL: 'All records within company boundaries' };
function useText() { const { language, tr } = useERP(); return (v: any) => typeof v === 'object' && v ? v[language] || v.en : tr(String(v || 'Not recorded')); }
export default function Groups({ page }: {
    page: string;
}) {
    const { tr, request, notify } = useERP(), text = useText(), state = useResource('/access');
    const [edit, setEdit] = useState<any>(null), [search, setSearch] = useState(''), [operation, setOperation] = useState<any>(null), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    if (edit && state.data)
        return <GroupEditor role={edit} data={state.data} close={() => setEdit(null)} saved={() => { setEdit(null); state.reload(); notify('Access group saved. Assigned users must sign in again.'); }}/>;
    const data = state.data, rows = (page === 'permissions' ? data?.permissions : data?.roles) || [];
    return <><PageHeader title={page === 'permissions' ? 'Permission catalog' : 'Access Groups'} subtitle={page === 'permissions' ? 'Technical permission keys are retained for diagnostics. Use access groups for everyday changes.' : 'Groups define permitted actions and record rules. Changing a group affects everyone assigned to it.'}>{page === 'roles' ? <Button primary onClick={() => setEdit({ name: '', description: '', permissionKeys: [], dataScopes: [], fieldPermissions: [], limits: [] })}>{tr('Create access group')}</Button> : null}</PageHeader><Resource state={state}><Panel><div className="toolbar"><SearchField value={search} onChange={setSearch} label={page === 'permissions' ? 'Search permissions' : 'Search access groups'}/></div><Table rows={rows.filter((r: any) => `${r.name} ${r.key} ${text(r.label || r.displayName)} ${text(r.descriptionLabel)}`.toLowerCase().includes(search.toLowerCase()))} columns={page === 'permissions' ? [
            { key: 'label', label: 'Permission', render: r => text(r.label) }, { key: 'help', label: 'Description', render: r => text(r.help) }, { key: 'key', label: 'Technical key', render: r => <code dir="ltr">{r.key}</code> }
        ] : [
            { key: 'name', label: 'Access group', render: r => <strong>{text(r.displayName)}</strong> }, { key: 'description', label: 'Configured access', render: r => <>{text(r.descriptionLabel)}{r.description ? <small>{r.description}</small> : null}</> }, { key: 'userCount', label: 'Assigned users' }, { key: 'permissions', label: 'Permissions', render: r => tr(r.permissionKeys.includes('system.super_admin') ? 'System-wide access' : 'Configured actions') }, { key: 'actions', label: 'Actions', render: r => <div className="actions"><Button onClick={() => setEdit(r)}>{tr('Edit')}</Button><Button onClick={() => { setOperation({ kind: 'duplicate', role: r }); setName(r.name + ' Copy'); setError(''); }}>{tr('Duplicate')}</Button><Link className="btn" href={'/settings/access/users?role='+encodeURIComponent(r.id)+'&assign=1'}>{tr('Assign users')}</Link><Button danger onClick={() => setOperation({ kind: 'archive', role: r })}>{tr('Archive')}</Button></div> }
        ]}/></Panel></Resource>
 {operation?.kind === 'archive' ? <Confirm reason={false} dangerous actionLabel="Archive access group" title="Archive access group" message="Assigned users must be moved before a group can be archived. Existing activity is preserved." close={() => setOperation(null)} action={async () => { await request(`/access/roles/${operation.role.id}/archive`, { method: 'POST' }); setOperation(null); state.reload(); notify('Access group archived.'); }}/> : null}
 {operation?.kind === 'duplicate' ? <Panel title="Duplicate access group"><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
        await request(`/access/roles/${operation.role.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) });
        setOperation(null);
        state.reload();
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }}><Fields specs={[{ key: 'name', label: 'Access group name', required: true }]} values={{ name }} set={(_, v) => setName(v)}/>{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button onClick={() => setOperation(null)}>{tr('Cancel')}</Button><Button type="submit" primary busy={busy}>{tr('Duplicate')}</Button></div></form></Panel> : null}</>;
}
function GroupEditor({ role, data, close, saved }: {
    role: any;
    data: any;
    close: () => void;
    saved: () => void;
}) {
    const { tr, request } = useERP(), text = useText();
    const [draft, setDraft] = useState({ ...role }), [tab, setTab] = useState('Actions'), [search, setSearch] = useState(''), [advanced, setAdvanced] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const changed = useRef(new Set<string>()), [dirty, setDirty] = useState(false);
    const guard = useUnsaved(dirty);
    const set = (key: string, value: any) => { changed.current.add(key); setDirty(true); setDraft((d: any) => ({ ...d, [key]: value })); };
    const permissions = data.permissions.filter((p: any) => (advanced || ['av8', 'system'].includes(p.module)) && `${text(p.label)} ${text(p.help)}`.toLowerCase().includes(search.toLowerCase()));
    const groups = Object.entries(Object.groupBy(permissions, (p: any) => `${p.module}:${p.resource}`));
    const scopeDefinitions = data.configuration.scopeDefinitions.filter((s: any) => advanced || ['av8_lead', 'av8_application', 'bank_account', 'account'].includes(s.resource));
    const updateScope = (resource: string, patch: any) => { const existing = draft.dataScopes.find((s: any) => s.resource === resource) || { resource, scope: 'NONE' }; set('dataScopes', [...draft.dataScopes.filter((s: any) => s.resource !== resource), { ...existing, ...patch }]); };
    const assignedUsers = data.users.map((u: any) => ({ id: u.id, name: u.name }));
    return <><PageHeader title={role.id ? 'Edit access group' : 'Create access group'} subtitle="Only changed settings are saved. Hidden modules and existing assignments are preserved." back={() => guard(close)}/><form onSubmit={async (e) => { e.preventDefault(); if (busy)
        return; setBusy(true); setError(''); try {
        const body = role.id ? Object.fromEntries([...changed.current].map(key => [key, draft[key]])) : draft;
        await request(role.id ? `/access/roles/${role.id}` : '/access/roles', { method: role.id ? 'PATCH' : 'POST', body: JSON.stringify({ ...body, expectedUpdatedAt: role.updatedAt }) });
        setDirty(false);
        saved();
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }}>
 <Panel title="Group details"><div className="surface-body"><Fields specs={[{ key: 'name', label: 'Access group name', required: true }, { key: 'description', label: 'Description' }]} values={draft} set={set}/>{role.userCount ? <p>{tr('Assigned users')}: {role.userCount}. {tr('Saving access changes revokes their sessions.')}</p> : null}</div></Panel>
 <Tabs tabs={['Actions', 'Which records can this user access?', 'Sensitive information', 'Financial limits']} value={tab} set={setTab}/>
 <Panel><div className="toolbar"><SearchField value={search} onChange={setSearch} label="Search permissions"/><label><input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)}/>{tr('Include other configured modules')}</label></div>
 {tab === 'Actions' ? groups.map(([group, items]) => <section className="permission-section" key={group}><h3>{text((items as any[])[0]?.area)}</h3><div className="permission-grid">{(items as any[]).map(p => <label key={p.key}><input type="checkbox" checked={draft.permissionKeys.includes(p.key)} onChange={e => set('permissionKeys', e.target.checked ? [...draft.permissionKeys, p.key] : draft.permissionKeys.filter((k: string) => k !== p.key))}/><span>{text(p.actionLabel)}<small>{text(p.help)}</small></span></label>)}</div></section>) : null}
 {tab === 'Which records can this user access?' ? <><div className="surface-body"><p>{tr('For AV8 leads and applications, own and assigned both mean the assigned owner, not the creator. All modes remain inside permitted branches.')}</p></div><Table rows={scopeDefinitions} columns={[{ key: 'label', label: 'Business area', render: r => text(r.label) }, { key: 'scope', label: 'Record access', render: r => { const current = draft.dataScopes.find((s: any) => s.resource === r.resource)?.scope || 'NONE'; return <select disabled={!r.modes.length} aria-label={`${tr('Record access')}: ${text(r.label)}`} title={!r.modes.length ? tr('This existing rule can be viewed but cannot be edited here.') : undefined} value={current} onChange={e => updateScope(r.resource, { scope: e.target.value })}>{[...new Set([...r.modes, current])].map(v => <option key={String(v)} value={String(v)}>{r.modeLabels?.[String(v)] ? text(r.modeLabels[String(v)]) : tr(scopes[String(v)] || 'Existing custom rule')}</option>)}</select>; } }, { key: 'assigned', label: 'Assigned names', render: r => { const policy = draft.dataScopes.find((s: any) => s.resource === r.resource); const options = policy?.scope === 'TEAM' ? assignedUsers : data.configuration.assignableResources?.[r.resource] || []; const key = policy?.scope === 'TEAM' ? 'userIds' : 'resourceIds'; return ['TEAM', 'ASSIGNED'].includes(policy?.scope) && options.length ? <div className="admin-assignment-list">{options.map((o: any) => <label key={o.id}><input type="checkbox" checked={(policy.config?.[key] || []).includes(o.id)} onChange={e => updateScope(r.resource, { config: { ...policy.config, [key]: e.target.checked ? [...(policy.config?.[key] || []), o.id] : (policy.config?.[key] || []).filter((id: string) => id !== o.id) } })}/>{o.name}</label>)}</div> : tr(policy?.scope === 'OWN' || policy?.scope === 'ASSIGNED' ? 'The signed-in user’s assigned records' : 'No named assignments'); } }]}/></> : null}
 {tab === 'Sensitive information' ? <><div className="surface-body"><p>{tr('AV8 passport, bank, criminal record and guardian details use the View and Edit actions in the relevant business area. These field rules apply to the other configured modules.')}</p></div>{advanced ? <Table rows={data.configuration.fields.filter((f: any) => tr(f.description).toLowerCase().includes(search.toLowerCase()))} columns={[{ key: 'description', label: 'Sensitive information', render: f => tr(f.description) }, { key: 'access', label: 'Access', render: f => <select aria-label={tr(f.description)} value={draft.fieldPermissions.find((v: any) => v.resource === f.resource && v.field === f.field)?.access || 'HIDDEN'} onChange={e => set('fieldPermissions', [...draft.fieldPermissions.filter((v: any) => v.resource !== f.resource || v.field !== f.field), { resource: f.resource, field: f.field, access: e.target.value }])}>{[['HIDDEN', 'Hidden'], ['VIEW', 'View only'], ['EDIT', 'View and edit']].map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}</select> }]}/> : null}</> : null}
 {tab === 'Financial limits' ? <div className="surface-body"><Link className="btn" href="/settings/access/limits">{tr('Company financial authority')}</Link><p>{tr('Group limits use the transaction currency, with two decimal places. No currency conversion is applied.')}</p><p>{tr('A zero limit blocks positive amounts wherever this group limit applies. Removing a limit uses the operation’s default rule, which may still restrict the amount. Company authority policies apply separately.')}</p><Table rows={data.configuration.limits.filter((l: any) => advanced || draft.limits.some((v: any) => v.key === l.key))} columns={[{ key: 'description', label: 'Limit', render: l => tr(l.description) }, { key: 'value', label: 'Configured amount', render: l => { const existing = draft.limits.find((v: any) => v.key === l.key); return <LimitInput definition={l} value={existing?.value} configured={!!existing} set={(value: any, clear = false) => set('limits', [...draft.limits.filter((v: any) => v.key !== l.key), ...(clear ? [] : [{ key: l.key, value }])])}/>; } }]}/></div> : null}
 </Panel>{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button onClick={() => guard(close)}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy}>{tr('Save access group')}</Button></div></form></>;
}
function LimitInput({ definition, value, configured, set }: {
    definition: any;
    value: any;
    configured: boolean;
    set: (v: any, clear?: boolean) => void;
}) {
    const { tr } = useERP();
    const [raw, setRaw] = useState<string | null>(null), [error, setError] = useState('');
    const money = definition.unit === 'minor_currency';
    const custom = value !== null && typeof value === 'object';
    let display = '';
    try {
        display = configured && value !== null && !custom ? (money ? minorToDecimal(value, 2) : String(value)) : '';
    }
    catch {
        display = String(value);
    }
    return <div className="field"><span>{tr(!configured ? 'Not configured' : value === null ? 'Positive amounts blocked (zero limit)' : custom ? 'Existing custom limit' : 'Configured')}</span>{custom ? <span>{tr('Custom limit retained unchanged. Edit the applicable authority policy to change its currency or structure.')}</span> : <input inputMode="decimal" dir="ltr" aria-label={tr(definition.description)} value={raw ?? display} placeholder={money ? '0.00' : '0'} onChange={e => { const input = e.target.value; setRaw(input); try {
        const result = money ? decimalToMinor(input, 2) : input;
        if (!money && !/^\d+(\.\d+)?$/.test(input))
            throw Error('Enter a valid non-negative number.');
        set(result);
        setError('');
        e.target.setCustomValidity('');
    }
    catch (err: any) {
        setError(tr(err.message));
        e.target.setCustomValidity(tr(err.message));
    } }}/>}<small>{tr(money ? 'Transaction currency · 2 decimal places' : 'Percent')}</small>{error ? <small role="alert">{error}</small> : null}<div className="actions"><Button onClick={() => { setRaw(null); set(null); }}>{tr('Block positive amounts')}</Button><Button onClick={() => { setRaw(null); set(undefined, true); }}>{tr('Remove configured limit')}</Button></div></div>;
}
