"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useERP, useResource } from '../core/erp-context';
import { PageHeader, Panel, Table, Resource, Button, AddButton, SearchField, Status, Tabs, Details, Fields, ErrorNotice, Confirm, useUnsaved } from '../components/ui';
import Groups from './access';
import AuthorityLimits from './authority-limits';
import { minorToDecimal } from '../core/access-money';
import { eventLabel } from '../core/admin-copy';
import { Health } from './overview';
const userPath = (id: string) => `/settings/access/users/${id}`;
export const useLabels = () => { const { language, tr } = useERP(); return (value: any) => typeof value === 'object' && value ? value[language] || value.en : tr(String(value || 'Not available')); };
function AdminLinks() {
    const { tr, allowed } = useERP();
    const pathname=usePathname();
    const selected=(href:string)=>pathname===href||href==='/settings/access/users'&&pathname.startsWith(href+'/')||href==='/settings/access/roles'&&['/settings/access/permissions','/settings/access/limits'].includes(pathname)||href==='/admin/audit'&&pathname==='/settings/access/audit'||href==='/admin/advanced'&&['/admin/system-health','/settings/access/reviews'].includes(pathname);
    return <nav className="admin-links" aria-label={tr('Settings & Administration')}>
 {[["/admin/overview", "Overview", "settings.users_access.view"], ["/settings/access/users", "Users", "settings.users_access.view"], ["/settings/access/roles", "Access Groups", "system.super_admin"], ["/admin/audit", "Activity Log", ["audit.business.view", "settings.users_access.view"]], ["/admin/advanced", "Advanced Settings", ["settings.users_access.view", "settings.system.view"]]].filter(([, , permission]) => allowed(permission)).map(([href, name]) => <Link className="btn small" aria-current={selected(String(href))?'page':undefined} key={String(href)} href={String(href)}>{tr(name)}</Link>)}
 </nav>;
}
export default function Administration({ route }: {
    route: string;
}) {
    if (route === '/my-profile')
        return <UserProfile self/>;
    if (/^\/settings\/access\/users\/\d+$/.test(route))
        return <><AdminLinks /><UserProfile userId={route.split('/').at(-1)}/></>;
    if (route === '/settings/access/users/new')
        return <><AdminLinks /><CreateUser /></>;
    if (route === '/settings/access/roles' || route === '/settings/access/permissions')
        return <><AdminLinks /><Groups page={route.endsWith('roles') ? 'roles' : 'permissions'}/></>;
    if (route === '/settings/access/limits')
        return <><AdminLinks /><AuthorityLimits /></>;
    if (route === '/admin/system-health')
        return <><AdminLinks /><Health /></>;
    if (route === '/admin/advanced' || route === '/settings/access/reviews')
        return <><AdminLinks /><Advanced reviews={route.endsWith('reviews')}/></>;
    if (route === '/admin/audit' || route === '/settings/access/audit')
        return <><AdminLinks /><ActivityPage initial={route.startsWith('/settings') ? 'Account & access' : 'General activity'}/></>;
    return <><AdminLinks /><Directory overview={route === '/admin/overview'} selector={route === '/settings/access/governance'}/></>;
}
function Directory({ overview = false, selector = false }: {
    overview?: boolean;
    selector?: boolean;
}) {
    const { tr, dateTime } = useERP(), text = useLabels(), state = useResource('/administration');
    const params = useSearchParams();
    const [search, setSearch] = useState(''), [status, setStatus] = useState(params.get('status') || ''), [role, setRole] = useState(params.get('role')||''), [branch, setBranch] = useState('');
    useEffect(()=>setRole(params.get('role')||''),[params]);
    const data = state.data;
    const rows = (data?.users || []).filter((u: any) => (`${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())) && (!status || String(u.active) === status) && (!role || u.primaryRole.id === role || u.additionalRoles.some((r: any) => r.id === role)) && (!branch || u.branchIds.includes(branch)));
    return <><PageHeader title={overview ? 'Administration Overview' : selector ? 'User access summary' : 'Users'} subtitle={overview ? 'Manage accounts, access groups and recent account changes.' : 'Open a person’s profile to edit details, inspect access or manage sign-in.'}>
 {data?.canManage ? <Link className="btn primary" href="/settings/access/users/new">{tr('Add user')}</Link> : null}</PageHeader>
 <Resource state={state}>{data ? <>{overview ? <><div className="admin-metrics">{[['Active users', data.counts.active, '/settings/access/users?status=true'], ['Inactive users', data.counts.inactive, '/settings/access/users?status=false'], ['Access Groups', data.counts.groups, '/settings/access/roles']].map(([title, value, url]) => <Link key={title} className="surface admin-metric" href={url}><span>{tr(title)}</span><strong>{value}</strong></Link>)}</div><Panel title="Recent account and access changes"><ActivityTable rows={data.activity.slice(0, 10)}/></Panel></> : null}
 {!overview ? <Panel className="admin-directory">{params.get('assign')&&role?<div className="surface-body"><strong>{tr('Group assignment')}: {text(data.roles.find((r:any)=>String(r.id)===role)?.displayName)}</strong><p>{tr('Showing members of this group. Clear the group filter to find another user, then open their profile and Access tab to change assignments.')}</p><Button onClick={()=>setRole('')}>{tr('Show all users')}</Button></div>:null}<div className="toolbar admin-filters"><SearchField value={search} onChange={setSearch} label="Search name or email"/>
 <Fields values={{ status, role, branch }} set={(k, v) => k === 'status' ? setStatus(v) : k === 'role' ? setRole(v) : setBranch(v)} specs={[
                    { key: 'status', label: 'Account status', options: [{ value: '', label: 'All statuses' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }] },
                    { key: 'role', label: 'Access group', options: [{ value: '', label: 'All groups' }, ...data.roles.map((r: any) => ({ value: r.id, label: text(r.displayName) }))] },
                    { key: 'branch', label: 'Branch', options: [{ value: '', label: 'All branches' }, ...data.branches.map((b: any) => ({ value: b.id, label: b.name + (b.operational ? '' : ` · ${tr('Non-operational')}`) }))] },
                ]}/></div>
 <Table rows={rows} filtered={!!search||!!role||!!status||!!branch} onReset={()=>{setSearch('');setRole('');setStatus('');setBranch('');}} empty="No user accounts are available." columns={[
                    { key: 'name', label: 'Name', render: u => <Link className="admin-person" href={userPath(u.id)}><span className="initials" aria-hidden="true">{u.name.slice(0, 2)}</span><strong>{u.name}</strong></Link> },
                    { key: 'email', label: 'Sign-in email', render: u => <bdi className="admin-email" title={u.email}>{u.email}</bdi> },
                    { key: 'primaryRole', label: 'Access group', render: u => text(u.primaryRole.displayName) },
                    { key: 'branch', label: 'Branches', render: u => u.branches.map((b: any) => `${b.name}${b.operational ? '' : ` · ${tr('Non-operational')}`}`).join('، ') || tr('Not available') },
                    { key: 'active', label: 'Account status', render: u => <Status value={u.active ? 'ACTIVE' : 'INACTIVE'}/> },
                    { key: 'lastSignInAt', label: 'Last sign-in', render: u => u.lastSignInAt ? dateTime(u.lastSignInAt) : tr(u.signInState === 'NEVER' ? 'Never signed in' : 'Not available') },
                    { key: 'actions', label: 'Actions', render: u => <Link className="btn small" href={userPath(u.id)}>{tr('View profile')}</Link> },
                ]}/></Panel> : null}</> : null}</Resource></>;
}
function CreateUser() {
    const { tr, request, notify } = useERP(), text = useLabels(), router = useRouter(), state = useResource('/administration');
    const [draft, setDraft] = useState({ name: '', email: '', password: '', roleId: '', branchId: '', phone: '', jobTitle: '', mfaRequired: false });
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
    const guard = useUnsaved(dirty), inFlight = useRef(false);
    const selected = state.data?.roles.find((r: any) => r.id === draft.roleId);
    return <><PageHeader title="Create user" subtitle="Create a login account. An employee or student record is not required." back={() => guard(() => router.push('/settings/access/users'))}/><Resource state={state}>{state.data?.canManage ? <form onSubmit={async (e) => { e.preventDefault(); if (inFlight.current)
            return; inFlight.current = true; setBusy(true); setError(''); try {
            const result = await request('/access/users', { method: 'POST', body: JSON.stringify(draft) });
            setDirty(false);
            notify('User created. Share the sign-in email and temporary password securely. It expires in 7 days.');
            router.push(userPath(result.id) + '?created=1');
        }
        catch (e: any) {
            setError(e.message);
        }
        finally {
            inFlight.current = false;
            setBusy(false);
        } }}>
 <Panel title="Account details"><div className="form-section"><Fields values={draft} set={(k, v) => { setDirty(true); setDraft(d => ({ ...d, [k]: v })); }} specs={[
                { key: 'name', label: 'Full name', required: true, autoComplete: 'name' }, { key: 'email', label: 'Sign-in email', type: 'email', required: true, autoComplete: 'off' },
                { key: 'roleId', label: 'Access group', required: true, options: [{ value: '', label: 'Select an access group' }, ...state.data.roles.filter((r: any) => r.active).map((r: any) => ({ value: r.id, label: text(r.displayName) }))] },
                { key: 'branchId', label: 'Home and permitted branch', required: true, options: [{ value: '', label: 'Select a branch' }, ...state.data.branches.filter((b: any) => b.operational).map((b: any) => ({ value: b.id, label: b.name }))], hint: 'Additional permitted branches can be assigned in the profile after creation.' },
                { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' }, { key: 'jobTitle', label: 'Job title' },
                { key: 'password', label: 'Temporary password', type: 'password', required: true, autoComplete: 'new-password', hint: 'Use at least 12 characters. Maximum: 72 English characters; Arabic and symbols may use more space (72 UTF-8 bytes). Share it securely; no email is sent.' },
                { key: 'mfaRequired', label: 'Require an additional verification code at sign-in', type: 'checkbox', wide: true },
            ]}/></div></Panel><Panel title="Access summary"><div className="surface-body"><strong>{selected ? text(selected.displayName) : tr('Select an access group')}</strong><p>{selected ? text(selected.descriptionLabel) : tr('Choose a group to see its configured access.')}</p><p>{tr('The temporary password expires in 7 days. The user must choose a new password at first sign-in.')}</p></div></Panel>
 {error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button onClick={() => guard(() => router.push('/settings/access/users'))}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy}>{tr('Create user')}</Button></div></form> : null}</Resource></>;
}
export function PasswordChange({ required = false }: {
    required?: boolean;
}) {
    const { tr, request, endSession } = useERP();
    const [draft, setDraft] = useState({ currentPassword: '', newPassword: '', confirm: '' }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
    useUnsaved(!!draft.newPassword && !done);
    return <Panel title={required ? 'Choose your own password' : 'Change password'}><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setError(''); if (draft.newPassword !== draft.confirm) {
        setError(tr('Passwords do not match.'));
        return;
    } setBusy(true); try {
        await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: draft.currentPassword, newPassword: draft.newPassword }) });
        setDone(true);
        setDraft({ currentPassword: '', newPassword: '', confirm: '' });
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }}>
 {done ? <div role="status"><p>{tr('Password changed. Sign in again with your new password.')}</p><Button primary onClick={endSession}>{tr('Return to sign-in')}</Button></div> : <><p>{tr(required ? 'Your temporary password only allows this password change. Choose a new password to open your workspace.' : 'Changing your password signs out all sessions, including this one.')}</p><Fields values={draft} set={(k, v) => setDraft(d => ({ ...d, [k]: v }))} specs={[
                { key: 'currentPassword', label: required ? 'Temporary password' : 'Current password', type: 'password', required: true, autoComplete: 'current-password' }, { key: 'newPassword', label: 'New password', type: 'password', required: true, autoComplete: 'new-password', hint: 'Use at least 12 characters. Maximum: 72 English characters; Arabic and symbols may use more space (72 UTF-8 bytes).' }, { key: 'confirm', label: 'Confirm new password', type: 'password', required: true, autoComplete: 'new-password' }
            ]}/>{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button primary type="submit" busy={busy}>{tr('Change password')}</Button></div></>}
 </form></Panel>;
}
function UserProfile({ userId, self = false }: {
    userId?: string;
    self?: boolean;
}) {
    const { tr, request, notify, dateTime, changeLanguage, language } = useERP(), text = useLabels(), state = useResource(self ? '/profile' : `/administration/users/${userId}`);
    const [tab, setTab] = useState('Details'), [edit, setEdit] = useState(false), [recover, setRecover] = useState(false), [status, setStatus] = useState(false), [mfaReset, setMfaReset] = useState(false);
    const u = state.data;
    return <><PageHeader title={self ? 'My Profile' : u?.name || 'User profile'} subtitle={self ? 'Your personal details, account security and current access.' : 'Details, access, account security and activity for this login account.'}/><Resource state={state}>{u ? <>
 <Panel><div className="profile-heading"><span className="initials large" aria-hidden="true">{u.name.slice(0, 2)}</span><div><h2>{u.name}</h2><bdi>{u.email}</bdi><p>{text(u.primaryRole.displayName)} · {u.branches.map((b: any) => b.name).join('، ') || tr('Not available')}</p></div><Status value={u.active ? 'ACTIVE' : 'INACTIVE'}/></div></Panel>
 {u.passwordChangeRequired ? <div className="notice" role="status">{tr('Temporary password issued. The user must change it at next sign-in. Existing sessions have been revoked.')}</div> : null}
 <Tabs tabs={['Details', 'Access', 'Account & Security', 'Activity']} value={tab} set={(v) => { if (v !== tab && window.dispatchEvent(new Event('odin:before-context-change', { cancelable: true }))) {
            setEdit(false);
            setTab(v);
        } }}/>
 {tab === 'Details' ? edit ? <ProfileForm key={u.profileVersion} user={u} self={self} close={() => setEdit(false)} saved={() => { setEdit(false); state.reload(); notify('Profile saved.'); }}/> : <Panel title="Details" actions={(self || u.canManage) ? <Button onClick={() => setEdit(true)}>{tr('Edit details')}</Button> : null}><Details values={[["Full name", u.name], ["Sign-in email", <bdi key="email">{u.email}</bdi>], ["Phone", <bdi key="phone">{u.phone || tr('Not recorded')}</bdi>], ["Job title", u.jobTitle || tr('Not recorded')], ["Home branch", u.branches.find((b: any) => b.id === u.homeBranchId)?.name || tr('Not recorded')], ["Permitted branches", u.branches.map((b: any) => b.name + (b.operational ? '' : ` · ${tr('Non-operational')}`)).join('، ') || tr('None')], ["Last sign-in", u.lastSignInAt ? dateTime(u.lastSignInAt) : tr(u.signInState === 'NEVER' ? 'Never signed in' : 'Not available')]]}/>{self ? <div className="surface-body"><Button onClick={async () => { try {
            const next = language === 'en' ? 'ar' : 'en';
            await request('/profile', { method: 'PATCH', body: JSON.stringify({ language: next, expectedProfileVersion: u.profileVersion }) });
            changeLanguage();
            state.reload();
        }
        catch (e: any) {
            notify(e.message, true);
        } }}>{tr('Language')}: {language === 'en' ? 'العربية' : 'English'}</Button></div> : null}</Panel> : null}
 {tab === 'Access' ? <>{u.canManage ? <div className="admin-actions"><Button primary onClick={() => { if (!edit || window.dispatchEvent(new Event('odin:before-context-change', { cancelable: true })))
            setEdit(!edit); }}>{tr(edit ? 'Close access editor' : 'Edit access')}</Button></div> : null}{edit && u.canManage ? <AccessForm user={u} saved={() => { setEdit(false); state.reload(); notify('Access saved. The user must sign in again.'); }}/> : <EffectiveSummary access={u.access}/>}</> : null}
 {tab === 'Account & Security' ? <><Panel title="Account & Security"><Details values={[["Account status", tr(u.active ? 'Active' : 'Inactive')], ["Require an additional verification code at sign-in", tr(u.mfaRequired ? 'Required' : 'Optional')], ["Sign-in verification setup", tr(u.mfaEnabled ? 'Enrolled' : 'Not enrolled')], ["Enrollment date", u.mfaEnrolledAt ? dateTime(u.mfaEnrolledAt) : tr('Not recorded')]]}/><div className="surface-body"><p>{tr('The requirement is set by an administrator. Enrollment is completed by the user during sign-in.')}</p>{u.canManage ? <div className="actions"><Button onClick={() => setRecover(!recover)}>{tr('Issue temporary password')}</Button><Button onClick={() => setMfaReset(!mfaReset)}>{tr('Reset sign-in verification')}</Button></div> : null}</div></Panel>{u.canManage?<Panel title="Account availability" className="admin-sensitive"><div className="surface-body"><p>{tr('Deactivation blocks sign-in and ends active sessions. Account history and group assignments are retained.')}</p><Button danger={u.active} onClick={()=>setStatus(true)}>{tr(u.active?'Deactivate account':'Activate account')}</Button></div></Panel>:null}{self ? <PasswordChange /> : null}{recover ? <Recovery user={u} saved={() => { setRecover(false); state.reload(); }}/> : null}{mfaReset ? <MfaReset user={u} saved={() => { setMfaReset(false); state.reload(); }}/> : null}</> : null}
 {tab === 'Activity' ? <Panel title="Account and access activity"><ActivityTable rows={u.activity}/></Panel> : null}
 {status ? <Confirm reason={false} dangerous={u.active} actionLabel={u.active?'Deactivate account':'Activate account'} title={u.active ? 'Deactivate account' : 'Activate account'} message={u.active ? 'This blocks sign-in and revokes all active sessions. Access group assignments are preserved.' : 'This permits sign-in using the account’s current credentials.'} close={() => setStatus(false)} action={async () => { await request(`/access/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active, expectedAuthVersion: u.authVersion, revision: u.revision }) }); setStatus(false); state.reload(); notify('Account status updated.'); }}/> : null}
 </> : null}</Resource></>;
}
function ProfileForm({ user, self, close, saved }: {
    user: any;
    self: boolean;
    close: () => void;
    saved: () => void;
}) {
    const { tr, request } = useERP();
    const [draft, setDraft] = useState({ name: user.name, email: user.email, phone: user.phone || '', jobTitle: user.jobTitle || '', homeBranchId: user.homeBranchId || '' }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [dirty, setDirty] = useState(false);
    const guard = useUnsaved(dirty);
    return <Panel title="Edit details"><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try {
        const { email, homeBranchId, ...basic } = draft;
        await request(self ? '/profile' : `/administration/users/${user.id}/details`, { method: 'PATCH', body: JSON.stringify({ ...basic, ...(!self ? { email, homeBranchId: homeBranchId || null } : {}), expectedProfileVersion: user.profileVersion }) });
        setDirty(false);
        saved();
    }
    catch (e: any) {
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }}><Fields values={draft} set={(k, v) => { setDirty(true); setDraft(d => ({ ...d, [k]: v })); }} specs={[
            { key: 'name', label: 'Full name', required: true }, ...(!self ? [{ key: 'email', label: 'Sign-in email', type: 'email', required: true, hint: 'Changing the sign-in email revokes existing sessions. Share the new sign-in address with the user.' }] : []), { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'jobTitle', label: 'Job title' }, ...(!self ? [{ key: 'homeBranchId', label: 'Home branch', options: [{ value: '', label: 'Not recorded' }, ...user.branches.map((b: any) => ({ value: b.id, label: b.name }))], hint: 'Home branch is a profile detail. Permitted branches are managed in Access.' }] : []),
        ]}/>{self ? <p>{tr('Contact your administrator to change your sign-in email or branch access.')}</p> : null}{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button onClick={() => guard(close)}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy}>{tr('Save details')}</Button></div></form></Panel>;
}
function Recovery({ user, saved }: {
    user: any;
    saved: () => void;
}) { const { tr, request, notify, dateTime } = useERP(); const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''); return <Panel title="Issue temporary password"><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
    await request(`/administration/users/${user.id}/recover`, { method: 'POST', body: JSON.stringify({ temporaryPassword: password }) });
    setPassword('');
    notify('Temporary password issued. It expires in 24 hours. Share it securely; no email is sent.');
    saved();
}
catch (e: any) {
    setError(e.message);
}
finally {
    setBusy(false);
} }}><p>{tr('This replaces the password, signs out existing sessions and requires a new password at next sign-in. MFA requirements stay in effect.')}</p><Fields specs={[{ key: 'password', label: 'Temporary password', type: 'password', required: true, autoComplete: 'new-password', hint: 'Use at least 12 characters. Maximum: 72 English characters; Arabic and symbols may use more space (72 UTF-8 bytes).' }]} values={{ password }} set={(_, v) => setPassword(v)}/>{error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button primary busy={busy} type="submit">{tr('Issue temporary password')}</Button></div></form></Panel>; }
function MfaReset({ user, saved }: {
    user: any;
    saved: () => void;
}) { const { tr, request } = useERP(); const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false); return <Panel title="Reset sign-in verification"><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
    await request(`/access/users/${user.id}/mfa-reset`, { method: 'POST', body: JSON.stringify({ reason }) });
    saved();
}
catch (e: any) {
    setError(e.message);
}
finally {
    setBusy(false);
} }}><p>{tr('Existing security policy requires a reason of at least 10 characters for an MFA reset. The sign-in requirement stays enabled.')}</p><Fields values={{ reason }} set={(_, v) => setReason(v)} specs={[{ key: 'reason', label: 'Reason', required: true }]}/>{error ? <ErrorNotice message={error}/> : null}<Button type="submit" busy={busy}>{tr('Reset sign-in verification')}</Button></form></Panel>; }
export function EffectiveSummary({ access }: {
    access: any;
}) {
    const { tr, dateTime } = useERP(), text = useLabels();
    const [search, setSearch] = useState(''), [advanced, setAdvanced] = useState(false);
    if (!access)
        return null;
    const rows = (access.rows || []).filter((r: any) => (advanced || r.module === 'av8' || r.module === 'system' || r.denied) && `${text(r.area)} ${text(r.actionLabel)} ${r.sources.map((s: any) => text(s.name)).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
    return <><Panel title="Effective access"><div className="surface-body"><p>{tr('This summary is evaluated by the same server rules used for requests. Business approval and sensitive-information rules still apply.')}</p>{access.superAdmin ? <div className="notice">{tr('System-wide administrator access. Explicit restrictions still take precedence.')}</div> : null}{!access.active ? <div className="notice warning">{tr('This account is inactive. Sign-in is blocked; saved access is shown below.')}</div> : null}<div className="toolbar"><SearchField value={search} onChange={setSearch} label="Search business areas or actions"/><label><input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)}/>{tr('Include other configured modules')}</label></div></div>
 <Table rows={rows} empty="No permissions in this view." columns={[{ key: 'area', label: 'Business area', render: r => text(r.area) }, { key: 'action', label: 'Allowed actions', render: r => <><strong>{text(r.actionLabel)}</strong><small>{tr(r.denied ? 'Explicitly denied' : r.allowed ? 'Allowed' : 'Not currently granted')}</small></> }, { key: 'scope', label: 'Record access', render: r => text(r.recordAccess) }, { key: 'source', label: 'Access source', render: r => r.sources.map((s: any) => text(s.name)).join('، ') || tr('Not recorded') }]}/></Panel>
 <Panel title="Which records can this user access?"><div className="surface-body"><p><strong>{tr('Permitted branches')}: </strong>{access.branches.map((b: any) => b.name).join('، ') || tr('None')}</p><p>{tr('Home branch is a profile detail. Changing it does not grant access to another branch.')}</p></div><Table rows={access.records.filter((r: any) => advanced || r.resource.startsWith('av8_') || ['bank_account', 'account'].includes(r.resource))} columns={[{ key: 'label', label: 'Business area', render: r => text(r.label) }, { key: 'description', label: 'Record access', render: r => text(r.description) }, { key: 'names', label: 'Assigned names', render: r => r.names.join('، ') || tr('No named assignments') }]}/></Panel>
 {access.assignments?.length ? <Panel title="Assigned financial resources"><Table rows={access.assignments} columns={[{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status', render: r => tr(r.revoked ? 'Revoked' : r.until && new Date(r.until) < new Date() ? 'Expired' : r.from && new Date(r.from) > new Date() ? 'Scheduled' : 'Active') }, { key: 'until', label: 'Expires', render: r => r.until ? dateTime(r.until) : tr('No expiry') }]}/></Panel> : null}
 {access.grants?.length ? <Panel title="Temporary access and delegations"><Table rows={access.grants} columns={[{ key: 'kind', label: 'Access source', render: r => tr(r.kind === 'TEMPORARY' ? 'Temporary grant' : 'Delegation') }, { key: 'permissions', label: 'Permissions', render: r => r.permissions.map((p: any) => text(p.label)).join('، ') }, { key: 'until', label: 'Expires', render: r => dateTime(r.until) }, { key: 'status', label: 'Status', render: r => tr(r.revoked ? 'Revoked' : new Date(r.until) < new Date() ? 'Expired' : new Date(r.from) > new Date() ? 'Scheduled' : 'Active') }]}/></Panel> : null}
 {advanced ? <><Panel title="Sensitive information"><Table rows={access.fields || []} empty="No additional field rules configured." columns={[{ key: 'label', label: 'Sensitive information', render: r => tr(r.label) }, { key: 'access', label: 'Access', render: r => tr(r.access === 'EDIT' ? 'View and edit' : r.access === 'VIEW' ? 'View only' : 'Hidden') }]}/></Panel><Panel title="Financial limits"><div className="surface-body"><p>{tr('Legacy group amounts use the transaction currency and the existing two-decimal accounting unit. No currency conversion is performed here.')}</p></div><Table rows={access.limits || []} empty="No group limits configured. Company authority policies may still apply." columns={[{ key: 'label', label: 'Limit', render: r => tr(r.label) }, { key: 'value', label: 'Configured amount', render: r => { if (r.value === null)
                return tr('Positive amounts blocked (zero limit)'); if (typeof r.value === 'object')
                return tr('Existing custom limit'); try {
                return r.unit === 'minor_currency' ? <bdi>{minorToDecimal(r.value, 2)}</bdi> : String(r.value);
            }
            catch {
                return tr('Existing custom limit');
            } } }]}/></Panel></> : null}
 {access.conflicts?.length ? <Panel title="Access conflicts"><ul>{access.conflicts.map((c: any) => <li key={c.ruleKey}>{c.name} · {tr(c.enforcement === 'BLOCK' ? 'Blocked by existing policy' : 'Warning')}</li>)}</ul></Panel> : null}</>;
}
function AccessForm({ user, saved }: {
    user: any;
    saved: () => void;
}) {
    const { tr, request } = useERP(), text = useLabels(), state = useResource('/access');
    const initial = { primaryRoleId: user.primaryRole.id, additionalRoleIds: user.additionalRoles.map((r: any) => r.id), overrides: user.overrides, branchIds: user.branchIds, mfaRequired: user.mfaRequired };
    const [draft, setDraft] = useState(initial), [preview, setPreview] = useState<any>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [search, setSearch] = useState(''), [dirty, setDirty] = useState(false);
    useUnsaved(dirty);
    const set = (key: string, value: any) => { setDirty(true); setPreview(null); setDraft((d: any) => ({ ...d, [key]: value })); };
    const choices = state.data?.roles || [];
    return <Resource state={state}>{state.data ? <form onSubmit={async (e) => { e.preventDefault(); if (busy)
            return; setBusy('save'); setError(''); try {
            await request(`/access/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ ...draft, revision: user.revision, expectedAuthVersion: user.authVersion }) });
            setDirty(false);
            saved();
        }
        catch (e: any) {
            setError(e.message);
        }
        finally {
            setBusy('');
        } }}>
 <Panel title="Access group and records"><div className="surface-body"><Fields values={draft} set={set} specs={[{ key: 'primaryRoleId', label: 'Access group', required: true, options: choices.filter((r: any) => r.active).map((r: any) => ({ value: r.id, label: text(r.displayName) })) }, { key: 'mfaRequired', label: 'Require an additional verification code at sign-in', type: 'checkbox' }]}/><p>{text(choices.find((r: any) => r.id === draft.primaryRoleId)?.descriptionLabel)}</p><fieldset><legend>{tr('Permitted branches')}</legend><div className="permission-grid">{user.eligibleBranches.filter((b: any) => b.operational || draft.branchIds.includes(b.id)).map((b: any) => <label key={b.id}><input type="checkbox" checked={draft.branchIds.includes(b.id)} onChange={e => set('branchIds', e.target.checked ? [...draft.branchIds, b.id] : draft.branchIds.filter((id: string) => id !== b.id))}/>{b.name}{!b.operational ? ` · ${tr('Non-operational')}` : ''}</label>)}</div></fieldset><p>{tr('Only branches linked to this user’s company membership can be saved. Record rules come from the selected groups.')}</p></div></Panel>
 <Panel><details className="surface-body"><summary>{tr('Customize access')}</summary><h3>{tr('Additional groups')}</h3><div className="permission-grid">{choices.filter((r: any) => r.id !== draft.primaryRoleId).map((r: any) => <label key={r.id}><input type="checkbox" checked={draft.additionalRoleIds.includes(r.id)} onChange={e => set('additionalRoleIds', e.target.checked ? [...draft.additionalRoleIds, r.id] : draft.additionalRoleIds.filter((id: string) => id !== r.id))}/>{text(r.displayName)}</label>)}</div><h3>{tr('Individual exceptions')}</h3><SearchField value={search} onChange={setSearch} label="Search permissions"/><label className="field"><span>{tr('Add an exception')}</span><select value="" onChange={e => { if (e.target.value)
            set('overrides', [...draft.overrides, { permissionKey: e.target.value, effect: 'DENY', reason: '' }]); }}><option value="">{tr('Select a permission')}</option>{state.data.permissions.filter((p: any) => !draft.overrides.some((o: any) => o.permissionKey === p.key) && text(p.label).toLowerCase().includes(search.toLowerCase())).map((p: any) => <option key={p.key} value={p.key}>{text(p.label)}</option>)}</select></label><Table rows={draft.overrides} columns={[{ key: 'permissionKey', label: 'Permission', render: r => text(state.data.permissions.find((p: any) => p.key === r.permissionKey)?.label || tr('Custom permission')) }, { key: 'effect', label: 'Effect', render: (r, i) => <select aria-label={tr('Effect')} value={r.effect} onChange={e => set('overrides', draft.overrides.map((o: any, j: number) => i === j ? { ...o, effect: e.target.value } : o))}><option value="GRANT">{tr('Allow')}</option><option value="DENY">{tr('Deny')}</option></select> }, { key: 'remove', label: 'Actions', render: (_, i) => <Button onClick={() => set('overrides', draft.overrides.filter((_: any, j: number) => i !== j))}>{tr('Remove exception')}</Button> }]}/><p>{tr('An explicit denial wins over group grants. Removing one grant does not remove access supplied by another group.')}</p></details></Panel>
 {error ? <ErrorNotice message={error}/> : null}<div className="admin-actions"><Button busy={busy === 'preview'} disabled={!!busy} onClick={async () => { setBusy('preview'); setError(''); try {
            setPreview(await request(`/administration/users/${user.id}/preview`, { method: 'POST', body: JSON.stringify({ revision: user.revision, changes: draft }) }));
        }
        catch (e: any) {
            setError(e.message);
        }
        finally {
            setBusy('');
        } }}>{tr('Preview changes')}</Button><Button primary type="submit" disabled={!!busy} busy={busy === 'save'}>{tr('Save access')}</Button></div>
 {preview ? <><div className="notice" role="status">{tr('Unsaved proposal. Preview does not change permissions or sessions.')}</div><Panel title="Before and after"><Table rows={preview.after.rows.filter((r: any) => { const old = preview.before.rows.find((v: any) => v.key === r.key); return !old || old.allowed !== r.allowed || old.denied !== r.denied || old.scope !== r.scope; }).concat(preview.before.rows.filter((r: any) => !preview.after.rows.some((v: any) => v.key === r.key)).map((r: any) => ({ ...r, allowed: false, denied: false })))} empty="No permission changes. Branch and security settings are shown below." columns={[{ key: 'label', label: 'Permission', render: r => text(r.label) }, { key: 'before', label: 'Saved access', render: r => tr(preview.before.rows.find((v: any) => v.key === r.key)?.allowed ? 'Allowed' : 'Not granted') }, { key: 'after', label: 'Proposed access', render: r => tr(r.allowed ? 'Allowed' : r.denied ? 'Explicitly denied' : 'Not granted') }]}/><Details values={[["Saved branches", preview.before.branches.map((b: any) => b.name).join('، ')], ["Proposed branches", preview.after.branches.map((b: any) => b.name).join('، ')], ["Require an additional verification code at sign-in", tr(draft.mfaRequired ? 'Required' : 'Optional')]]}/></Panel><EffectiveSummary access={preview.after}/></> : null}
 </form> : null}</Resource>;
}
export function ActivityTable({ rows }: {
    rows: any[];
}) { const { tr, dateTime, language, allowed, user } = useERP(), text = useLabels(); return <Table rows={rows} empty="No activity recorded." columns={[{ key: 'createdAt', label: 'Time', render: r => dateTime(r.createdAt) }, { key: 'actor', label: 'Who', render: r => r.actor || tr('Not recorded') }, { key: 'action', label: 'What happened', render: r => eventLabel(r.action, language, tr) }, { key: 'subject', label: 'Affected account or record', render: r => r.subjectUserId && (allowed('settings.users_access.view') || r.subjectUserId === user?.userId) ? <Link href={r.subjectUserId === user?.userId ? '/my-profile' : userPath(r.subjectUserId)}>{r.subject || tr('User profile')}</Link> : r.subject || tr('Not recorded') }, { key: 'result', label: 'Result', render: r => tr(r.result === 'DENIED' ? 'Access denied' : 'Recorded') }, { key: 'detail', label: 'Details', render: r => r.result === 'DENIED' ? <><span>{tr(r.reason || 'Not recorded')}</span><small>{text(r.resourceLabel)} · {text(r.attemptLabel)}</small></> : r.changes?.length ? <details><summary>{tr('View changes')}</summary>{r.changes.map((c: any) => <p key={c.field}>{tr(c.field)}: <bdi>{tr(String(c.before ?? 'Not recorded'))}</bdi> → <bdi>{tr(String(c.after ?? 'Not recorded'))}</bdi></p>)}</details> : tr('No field changes recorded') }]}/>; }
function ActivityPage({ initial }: {
    initial: string;
}) { const { tr, allowed } = useERP(); const available = [...(allowed('audit.business.view') ? ['General activity'] : []), ...(allowed('settings.users_access.view') ? ['Account & access'] : [])]; const [tab, setTab] = useState(available.includes(initial) ? initial : available[0]), [search, setSearch] = useState(''); const state = useResource(tab === 'Account & access' ? '/administration' : '/audit'); const rows = tab === 'Account & access' ? state.data?.activity || [] : (state.data || []).map((e: any) => ({ id: e.id, createdAt: e.createdAt, actor: e.user?.name, action: e.action, subject: e.postingReference || e.approvalReference || `${tr(e.entityType)} ${e.entityId || ''}`, result: 'RECORDED', changes: Object.keys(e.newValues || {}).filter(k => e.previousValues && k in e.previousValues && ['status', 'name', 'email', 'phone', 'active', 'description'].includes(k) && e.previousValues[k] !== e.newValues[k]).map(k => ({ field: k, before: e.previousValues[k], after: e.newValues[k] })) })); return <><PageHeader title="Activity Log" subtitle="Recorded business events and account changes. Missing historical details are shown as not recorded."/><Tabs tabs={available} value={tab} set={setTab}/><Panel><div className="toolbar"><SearchField value={search} onChange={setSearch} label="Search activity"/></div><Resource state={state}><ActivityTable rows={rows.filter((r: any) => Object.values(r).join(' ').toLowerCase().includes(search.toLowerCase()))}/></Resource></Panel></>; }
function Advanced({ reviews = false }: {
    reviews?: boolean;
}) { const { tr, allowed } = useERP(); return <><PageHeader title={reviews ? 'Access reviews' : 'Advanced Settings'} subtitle="Technical catalogs, formal reviews and service diagnostics."/>{reviews ? <Reviews /> : <Panel><div className="surface-body admin-links">{[['Company financial authority', '/settings/access/limits', 'system.super_admin'], ['Permission catalog', '/settings/access/permissions', 'system.super_admin'], ['Access reviews', '/settings/access/reviews', 'settings.users_access.view'], ['System diagnostics', '/admin/system-health', 'settings.system.view'], ['User access summary', '/settings/access/governance', 'settings.users_access.view']].filter(([, , permission]) => allowed(permission)).map(([name, path]) => <Link className="btn" key={path} href={path}>{tr(name)}</Link>)}</div></Panel>}</>; }
function Reviews() { const { tr, request, notify, dateTime, allowed } = useERP(), state = useResource('/access/companies'); const [company, setCompany] = useState(''), [user, setUser] = useState(''), [decision, setDecision] = useState('CONFIRMED'), [reason, setReason] = useState(''), [busy, setBusy] = useState(false); const members = state.data?.find((c: any) => String(c.id) === company)?.memberships || []; const reviews = useResource(company ? `/access/reviews?companyId=${company}${user ? '&userId=' + user : ''}` : null); return <Resource state={state}><Panel><form className="surface-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
    await request('/access/reviews', { method: 'POST', body: JSON.stringify({ companyId: company, userId: user, decision, reason }) });
    reviews.reload();
    setReason('');
    notify('Access review recorded.');
}
catch (e: any) {
    notify(e.message, true);
}
finally {
    setBusy(false);
} }}><p>{tr('Reviews record a decision; they do not automatically revoke or change access. Existing review policy requires a reason.')}</p><Fields values={{ company, user, decision, reason }} set={(k, v) => { if (k === 'company') {
    setCompany(v);
    setUser('');
}
else if (k === 'user')
    setUser(v);
else if (k === 'decision')
    setDecision(v);
else
    setReason(v); }} specs={[{ key: 'company', label: 'Company', required: true, options: [{ value: '', label: 'Select' }, ...(state.data || [])] }, { key: 'user', label: 'User', required: true, options: [{ value: '', label: 'Select' }, ...members.map((m: any) => ({ value: String(m.userId || m.user?.id), label: m.user?.name }))] }, { key: 'decision', label: 'Decision', options: [{ value: 'CONFIRMED', label: 'Keep current access' }, { value: 'REVOKE_REQUIRED', label: 'Access removal recommended' }, { value: 'ESCALATED', label: 'Further review needed' }] }, { key: 'reason', label: 'Reason', type: 'textarea', required: true }]}/>{allowed('settings.users_access.manage') ? <Button type="submit" busy={busy}>{tr('Record access review')}</Button> : null}</form><Resource state={reviews}><Table rows={reviews.data || []} columns={[{ key: 'decision', label: 'Decision', render: r => tr(({ CONFIRMED: 'Keep current access', REVOKE_REQUIRED: 'Access removal recommended', ESCALATED: 'Further review needed' } as any)[r.decision]) }, { key: 'reason', label: 'Reason' }, { key: 'reviewedAt', label: 'Time', render: r => dateTime(r.reviewedAt) }]}/></Resource></Panel></Resource>; }
