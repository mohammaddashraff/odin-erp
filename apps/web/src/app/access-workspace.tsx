'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Language } from './i18n';
import { t } from './i18n';
import { AppIcon } from './ui-icons';
import { formatDateTime, formatInteger, normalizeWesternDigits } from './formatters';
import { LoadingButton, NumericValue, PageSkeleton, TableSkeleton } from './ui-system';

type Json = any;
type Requester = (path: string, options?: RequestInit) => Promise<Json>;

export function AccessWorkspace({ page, request, notify, language, navigate }: {
  page: 'governance' | 'users' | 'roles' | 'permissions' | 'audit'; request: Requester; notify: (message: string, error?: boolean) => void;
  language: Language; navigate: (route: string) => void;
}) {
  const [data, setData] = useState<Json>(null);
  const [busy, setBusy] = useState(false);
  const [roleEditor, setRoleEditor] = useState<Json>(null);
  const [userEditor, setUserEditor] = useState<Json>(null);
  const load = useCallback(async () => {
    setData(null);
    setData(page === 'governance' ? { companies: await request('/access/companies') } : await request('/access'));
  }, [page, request]);
  useEffect(() => { load().catch((error) => notify(error.message, true)); }, [load, notify]);

  const tabs = [
    ['governance', 'Access Governance', '/settings/access/governance'],
    ['users', 'Users', '/settings/access/users'], ['roles', 'Roles', '/settings/access/roles'],
    ['permissions', 'Permissions', '/settings/access/permissions'], ['audit', 'Access Audit Log', '/settings/access/audit'],
  ] as const;
  if (!data) return <PageSkeleton variant="table" label={t(page === 'governance' ? 'Loading access governance…' : 'Loading access policies…', language)}/>;

  const saveRole = async (value: Json) => {
    setBusy(true);
    try {
      await request(value.id ? `/access/roles/${value.id}` : '/access/roles', { method: value.id ? 'PATCH' : 'POST', body: JSON.stringify(value) });
      notify(t(value.id ? 'Role updated successfully.' : 'Role created successfully.', language)); setRoleEditor(null); await load();
    } catch (error: any) { notify(error.message, true); } finally { setBusy(false); }
  };
  const saveUser = async (value: Json) => {
    setBusy(true);
    try {
      await request(`/access/users/${value.id}`, { method: 'PATCH', body: JSON.stringify(value) });
      notify(t('User access updated successfully.', language)); setUserEditor(null); await load();
    } catch (error: any) { notify(error.message, true); } finally { setBusy(false); }
  };
  const duplicateRole = async (role: Json) => {
    const name = window.prompt(t('Enter a name for the duplicated role.', language), `${role.name} ${t('Copy', language)}`);
    if (!name) return;
    try { await request(`/access/roles/${role.id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }); notify(t('Role duplicated successfully.', language)); await load(); }
    catch (error: any) { notify(error.message, true); }
  };
  const archiveRole = async (role: Json) => {
    if (!window.confirm(t('Archive this role? Assigned users must be reassigned first.', language))) return;
    try { await request(`/access/roles/${role.id}/archive`, { method: 'POST' }); notify(t('Role archived successfully.', language)); await load(); }
    catch (error: any) { notify(error.message, true); }
  };

  return <div className="page access-page">
    <div className="page-head"><div><h1>{t('Users & Access', language)}</h1><p>{t('Manage tenant-scoped roles, permissions, data visibility, sensitive fields, and security evidence.', language)}</p></div>
      {page === 'roles' ? <button className="button primary" onClick={() => setRoleEditor({ name: '', description: '', permissionKeys: [], dataScopes: [], fieldPermissions: [], limits: [] })}><AppIcon name="add"/>{t('Create Role', language)}</button> : null}
    </div>
    <nav className="access-tabs" aria-label={t('Users and access sections', language)}>{tabs.map(([id, label, route]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(route)}>{t(label, language)}</button>)}</nav>
    {page === 'governance' ? <GovernancePanel companies={data.companies} request={request} notify={notify} language={language}/> : null}
    {page === 'users' ? <UsersPanel users={data.users} onEdit={setUserEditor} language={language}/> : null}
    {page === 'roles' ? <RolesPanel roles={data.roles} onEdit={setRoleEditor} onDuplicate={duplicateRole} onArchive={archiveRole} onAssign={() => navigate('/settings/access/users')} language={language}/> : null}
    {page === 'permissions' ? <PermissionsPanel permissions={data.permissions} language={language}/> : null}
    {page === 'audit' ? <AuditPanel rows={data.audit} language={language}/> : null}
    {roleEditor ? <RoleEditor value={roleEditor} data={data} busy={busy} language={language} close={() => setRoleEditor(null)} save={saveRole}/> : null}
    {userEditor ? <UserEditor value={userEditor} roles={data.roles} permissions={data.permissions} busy={busy} language={language} close={() => setUserEditor(null)} save={saveUser}/> : null}
  </div>;
}

const membershipUser = (membership: Json) => membership.user || membership;
const membershipUserId = (membership: Json) => String(membership.userId || membership.user?.id || membership.id || '');
const reviewDecisionLabel = (decision: string) => ({
  CONFIRMED: 'Confirmed',
  REVOKE_REQUIRED: 'Revoke required',
  ESCALATED: 'Escalated',
}[decision] || decision.replaceAll('_', ' '));

function GovernancePanel({ companies, request, notify, language }: { companies: Json[]; request: Requester; notify: (message: string, error?: boolean) => void; language: Language }) {
  const [companyId, setCompanyId] = useState(() => String(companies[0]?.id || ''));
  const company = companies.find((item) => String(item.id) === companyId) || companies[0];
  const memberships = company?.memberships || [];
  const [userId, setUserId] = useState(() => membershipUserId(memberships[0]));
  const [effective, setEffective] = useState<Json>(null), [reviews, setReviews] = useState<Json[]>([]), [preview, setPreview] = useState<Json>(null);
  const [proposedKeys, setProposedKeys] = useState(''), [decision, setDecision] = useState('CONFIRMED'), [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState('');

  useEffect(() => {
    if (memberships.some((membership: Json) => membershipUserId(membership) === userId)) return;
    setUserId(membershipUserId(memberships[0]));
  }, [companyId, memberships, userId]);

  const loadEvidence = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setPreview(null);
    try {
      const [effectiveResult, reviewResult] = await Promise.all([
        userId ? request(`/access/users/${userId}/effective?companyId=${encodeURIComponent(companyId)}`) : Promise.resolve(null),
        request(`/access/reviews?companyId=${encodeURIComponent(companyId)}${userId ? `&userId=${encodeURIComponent(userId)}` : ''}`),
      ]);
      setEffective(effectiveResult);
      setReviews(Array.isArray(reviewResult) ? reviewResult : reviewResult?.rows || []);
      setProposedKeys((effectiveResult?.permissionKeys || []).join('\n'));
    } catch (error: any) { notify(error.message, true); } finally { setLoading(false); }
  }, [companyId, userId, request, notify]);

  useEffect(() => { void loadEvidence(); }, [loadEvidence]);

  const simulate = async () => {
    if (!userId || !companyId) return;
    setBusy('simulate');
    try {
      setPreview(await request('/access/simulate', { method: 'POST', body: JSON.stringify({ userId, companyId, proposed: { permissionKeys: proposedKeys.split(/\s+/).map((key) => key.trim()).filter(Boolean) } }) }));
    } catch (error: any) { notify(error.message, true); } finally { setBusy(''); }
  };

  const submitReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!userId || !companyId || !reason.trim()) return;
    setBusy('review');
    try {
      await request('/access/reviews', { method: 'POST', body: JSON.stringify({ companyId, userId, decision, reason: reason.trim() }) });
      notify(t('Access review recorded.', language)); setReason(''); await loadEvidence();
    } catch (error: any) { notify(error.message, true); } finally { setBusy(''); }
  };

  if (!companies.length) return <section className="panel"><div className="empty-state"><strong>{t('No governed companies', language)}</strong><span>{t('No company administration memberships are available for this account.', language)}</span></div></section>;

  const permissionGroups = [
    ['Permanent permissions', effective?.permanentPermissionKeys || [], 'brand'],
    ['Company permissions', effective?.companyScopedPermissionKeys || [], 'success'],
    ['Explicitly denied', effective?.deniedPermissionKeys || [], 'danger'],
  ] as const;
  const administratorNames = memberships
    .filter((membership: Json) => membership.role === 'ADMINISTRATOR')
    .map((membership: Json) => membershipUser(membership).name || membershipUser(membership).email)
    .filter(Boolean);
  const administratorSummary = administratorNames.length ? administratorNames.join(', ') : company?.administrator ? t('Super Admin', language) : '—';
  const accessSources = effective?.sources || effective?.accessSources;
  const sourceEntries: [string, Json][] = Array.isArray(accessSources)
    ? accessSources.map((source: Json, index: number) => [String(source?.type || source?.kind || `source-${index + 1}`), source])
    : Object.entries(accessSources || {});

  return <div className="governance-layout">
    <section className="panel governance-companies"><div className="panel-head"><h2>{t('Governed companies', language)}</h2><span><NumericValue>{formatInteger(companies.length, language)}</NumericValue> {t('companies', language)}</span></div>
      <div className="company-card-list">{companies.map((item) => <button key={item.id} className={String(item.id) === String(company?.id) ? 'active' : ''} onClick={() => setCompanyId(String(item.id))}><span><strong>{item.name}</strong><small><code dir="ltr">{item.code}</code> · {item.baseCurrency}</small></span><span><b><NumericValue>{formatInteger(item.memberships?.length || 0, language)}</NumericValue></b>{t('members', language)}</span></button>)}</div>
      <dl className="governance-company-summary"><div><dt>{t('Company administrator', language)}</dt><dd>{administratorSummary}</dd></div><div><dt>{t('Branches', language)}</dt><dd><NumericValue>{formatInteger(company?.branches?.length || 0, language)}</NumericValue></dd></div><div><dt>{t('Financial resources', language)}</dt><dd><NumericValue>{formatInteger(Array.isArray(company?.financialResources) ? company.financialResources.length : Object.keys(company?.financialResources || {}).length, language)}</NumericValue></dd></div></dl>
    </section>

    <section className="panel governance-effective"><div className="panel-head"><div><h2>{t('Effective access', language)}</h2><span>{t('Read-only evaluation for the selected user and company', language)}</span></div>{effective?.evaluatedAt ? <time>{formatDateTime(effective.evaluatedAt, language)}</time> : null}</div>
      <label className="governance-user-select">{t('Company member', language)}<select value={userId} onChange={(event) => setUserId(event.target.value)}>{memberships.map((membership: Json) => { const user = membershipUser(membership); return <option key={membershipUserId(membership)} value={membershipUserId(membership)}>{user.name || user.email} · {user.email || membership.roleName || ''}</option>; })}</select></label>
      {loading ? <TableSkeleton rows={5} columns={3}/> : effective ? <>
        <div className="effective-permission-groups">{permissionGroups.map(([label, keys, tone]) => <section key={label} data-tone={tone}><h3>{t(label, language)} <NumericValue>{formatInteger(keys.length, language)}</NumericValue></h3><div>{keys.length ? keys.map((key: string) => <code dir="ltr" key={key}>{key}</code>) : <span className="muted">{t('None', language)}</span>}</div></section>)}</div>
        {effective.sodWarnings?.length ? <div className="sod-warning" role="alert"><AppIcon name="warning"/><div><strong>{t('Segregation-of-duties warnings', language)}</strong>{effective.sodWarnings.map((warning: Json, index: number) => <span key={warning.code || index}>{t(warning.message || String(warning), language)}</span>)}</div></div> : null}
        <div className="governance-evidence-grid"><section><h3>{t('Data scopes', language)}</h3><pre dir="ltr">{JSON.stringify(effective.dataScopes || [], null, 2)}</pre></section><section><h3>{t('Resource assignments', language)}</h3><pre dir="ltr">{JSON.stringify(effective.resourceAssignments || [], null, 2)}</pre></section><section><h3>{t('Field permissions', language)}</h3><pre dir="ltr">{JSON.stringify(effective.fieldPermissions || [], null, 2)}</pre></section><section><h3>{t('Approval limits', language)}</h3><pre dir="ltr">{JSON.stringify(effective.limits || [], null, 2)}</pre></section>
          {sourceEntries.length ? <section className="governance-source-summary"><h3>{t('Access sources and risk', language)}</h3><div>{sourceEntries.map(([source, value]) => { const populated = Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value); const risk = populated && /risk|expir|tempor|delegat/i.test(source); return <article key={source} data-tone={risk ? 'warning' : 'neutral'}><code dir="ltr">{normalizeWesternDigits(source)}</code><pre dir="ltr">{populated ? normalizeWesternDigits(typeof value === 'string' ? value : JSON.stringify(value, null, 2)) : t('None', language)}</pre></article>; })}</div></section> : null}
        </div>
      </> : <div className="empty-state"><strong>{t('Select a company member', language)}</strong></div>}
    </section>

    <section className="panel governance-preview"><div className="panel-head"><h2>{t('Safe access preview', language)}</h2><span className="status" data-tone="info">{t('No changes are applied', language)}</span></div><p className="muted">{t('Enter proposed permission keys to evaluate the resulting access before changing any role.', language)}</p>
      <textarea dir="ltr" value={proposedKeys} onChange={(event) => setProposedKeys(event.target.value)} aria-label={t('Proposed permission keys', language)} rows={8}/>
      <LoadingButton type="button" className="button primary" loading={busy === 'simulate'} loadingLabel={t('Evaluating…', language)} disabled={!userId} onClick={simulate}>{t('Run safe preview', language)}</LoadingButton>
      {preview ? <div className="preview-result" data-testid="access-safe-preview"><span className="status" data-tone={preview.mutated ? 'danger' : 'success'}>{t(preview.mutated ? 'Mutation detected' : 'SAFE PREVIEW · no mutation', language)}</span><div><section data-tone="success"><h3>{t('Added', language)}</h3>{(preview.delta?.added || []).map((key: string) => <code dir="ltr" key={key}>{key}</code>)}</section><section data-tone="danger"><h3>{t('Removed', language)}</h3>{(preview.delta?.removed || []).map((key: string) => <code dir="ltr" key={key}>{key}</code>)}</section></div></div> : null}
    </section>

    <section className="panel governance-reviews"><div className="panel-head"><h2>{t('Access reviews', language)}</h2><span>{t('Immutable governance evidence', language)}</span></div>
      <form onSubmit={submitReview}><label>{t('Decision', language)}<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="CONFIRMED">{t('Confirmed', language)}</option><option value="REVOKE_REQUIRED">{t('Revoke required', language)}</option><option value="ESCALATED">{t('Escalated', language)}</option></select></label><label>{t('Reason', language)}<textarea value={reason} onChange={(event) => setReason(event.target.value)} required/></label><LoadingButton className="button primary" loading={busy === 'review'} loadingLabel={t('Recording review…', language)} disabled={!userId || !reason.trim()}>{t('Record access review', language)}</LoadingButton><small>{t('Submitting a governance decision may require step-up authentication.', language)}</small></form>
      <div className="review-history">{reviews.length ? reviews.map((review) => <article key={review.id}><span className="status" data-tone={review.decision === 'CONFIRMED' ? 'success' : review.decision === 'ESCALATED' ? 'warning' : 'danger'}>{t(reviewDecisionLabel(String(review.decision)), language)}</span><strong>{review.reviewer?.name || review.actorUser?.name || t('Administrator', language)}</strong><time>{formatDateTime(review.reviewedAt || review.createdAt, language)}</time><p>{review.reason}</p></article>) : <p className="muted">{t('No reviews recorded for this selection.', language)}</p>}</div>
    </section>
  </div>;
}

function UsersPanel({ users, onEdit, language }: { users: Json[]; onEdit: (value: Json) => void; language: Language }) {
  return <section className="panel"><div className="panel-head"><h2>{t('Users', language)}</h2><span><NumericValue>{formatInteger(users.length, language)}</NumericValue> {t('user accounts', language)}</span></div><div className="table-wrap"><table><thead><tr><th>{t('User', language)}</th><th>{t('Primary Role', language)}</th><th>{t('Additional Roles', language)}</th><th>{t('Overrides', language)}</th><th>{t('Status', language)}</th><th>{t('Actions', language)}</th></tr></thead><tbody>
    {users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><br/><bdi className="muted ltr-value">{user.email}</bdi></td><td>{t(user.primaryRole.name, language)}</td><td>{user.additionalRoles.length ? new Intl.ListFormat(language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG-u-nu-latn').format(user.additionalRoles.map((role: Json) => t(role.name, language))) : '—'}</td><td><span className="access-count"><NumericValue>{formatInteger(user.overrides.length, language)}</NumericValue></span></td><td><span className="status" data-tone={user.active ? 'success' : 'neutral'}>{t(user.active ? 'Active' : 'Inactive', language)}</span><small>{t(user.mfaEnabled ? 'MFA enabled' : user.mfaRequired ? 'MFA required' : 'MFA optional', language)}</small></td><td><button className="button small" onClick={() => onEdit({ ...user, primaryRoleId: user.primaryRole.id, additionalRoleIds: user.additionalRoles.map((role: Json) => role.id) })}>{t('Edit Access', language)}</button></td></tr>)}
  </tbody></table></div></section>;
}

function RolesPanel({ roles, onEdit, onDuplicate, onArchive, onAssign, language }: { roles: Json[]; onEdit: (value: Json) => void; onDuplicate: (value: Json) => void; onArchive: (value: Json) => void; onAssign: () => void; language: Language }) {
  return <div className="access-role-grid">{roles.map((role) => <article className="access-role-card" key={role.id}><div className="access-role-head"><span className="access-role-icon"><AppIcon name="lock"/></span><div><h2>{t(role.name, language)}</h2><p>{role.description ? t(role.description, language) : t('Custom access role', language)}</p></div></div><div className="access-role-metrics"><span><b><NumericValue>{formatInteger(role.userCount, language)}</NumericValue></b>{t('Users', language)}</span><span><b><NumericValue>{formatInteger(role.permissionKeys.length, language)}</NumericValue></b>{t('Permissions', language)}</span><span><b><NumericValue>{formatInteger(role.dataScopes.length, language)}</NumericValue></b>{t('Data Scopes', language)}</span></div><div className="access-role-actions"><button className="button small" onClick={() => onEdit(role)}>{t('Edit Role', language)}</button><button className="button small" onClick={onAssign}>{t('Assign Users', language)}</button><button className="button small" onClick={() => onDuplicate(role)}>{t('Duplicate', language)}</button><button className="button small danger" disabled={role.key === 'super_admin'} onClick={() => onArchive(role)}>{t('Archive', language)}</button></div></article>)}</div>;
}

function PermissionsPanel({ permissions, language }: { permissions: Json[]; language: Language }) {
  const groups = useMemo(() => Object.entries(Object.groupBy(permissions, (permission: Json) => permission.module)), [permissions]);
  return <div className="access-permission-groups">{groups.map(([module, rows]) => <section className="panel" key={module}><div className="panel-head"><h2>{t(module[0].toUpperCase() + module.slice(1), language)}</h2><span><NumericValue>{formatInteger(rows?.length || 0, language)}</NumericValue> {t('permissions', language)}</span></div><div className="table-wrap"><table><thead><tr><th>{t('Permission Key', language)}</th><th>{t('Resource', language)}</th><th>{t('Action', language)}</th><th>{t('Description', language)}</th></tr></thead><tbody>{rows?.map((permission: Json) => <tr key={permission.id}><td><code dir="ltr">{permission.key}</code></td><td>{t(permission.resource.replaceAll('_', ' '), language)}</td><td><span className="permission-action">{t(permission.action, language)}</span></td><td>{t(permission.action, language)} · {t(permission.resource.replaceAll('_', ' '), language)}</td></tr>)}</tbody></table></div></section>)}</div>;
}

function AuditPanel({ rows, language }: { rows: Json[]; language: Language }) {
  return <section className="panel"><div className="panel-head"><h2>{t('Access Audit Log', language)}</h2><span>{t('Append-only security evidence', language)}</span></div><div className="table-wrap"><table><thead><tr><th>{t('Date and Time', language)}</th><th>{t('Actor', language)}</th><th>{t('Action', language)}</th><th>{t('Affected User or Role', language)}</th><th>{t('Permission', language)}</th><th>{t('IP Address', language)}</th><th>{t('Changes', language)}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDateTime(row.createdAt, language)}</td><td>{row.actorUser?.name || t('System', language)}</td><td><span className="permission-action">{t(row.action.replaceAll('_', ' '), language)}</span></td><td>{row.subjectUser?.name || row.subjectRole?.name || '—'}</td><td><code dir="ltr">{row.permissionKey || '—'}</code></td><td><bdi className="ltr-value">{row.ipAddress || '—'}</bdi></td><td><details className="audit-change-details"><summary>{t('View Changes', language)}</summary><strong>{t('Previous Value', language)}</strong><pre dir="ltr">{JSON.stringify(row.previousValue ?? null, null, 2)}</pre><strong>{t('New Value', language)}</strong><pre dir="ltr">{JSON.stringify(row.newValue ?? null, null, 2)}</pre></details></td></tr>)}</tbody></table></div></section>;
}

function RoleEditor({ value, data, busy, language, close, save }: { value: Json; data: Json; busy: boolean; language: Language; close: () => void; save: (value: Json) => void }) {
  const [draft, setDraft] = useState<Json>(() => ({ ...value, permissionKeys: value.permissionKeys || [], limits: value.limits || [], dataScopes: value.dataScopes || [], fieldPermissions: value.fieldPermissions || [] }));
  const [section, setSection] = useState<'modules' | 'scopes' | 'fields' | 'limits'>('modules');
  const grouped = useMemo(() => Object.entries(Object.groupBy(data.permissions, (permission: Json) => permission.module)), [data.permissions]);
  const togglePermission = (key: string) => setDraft((current: Json) => ({ ...current, permissionKeys: current.permissionKeys.includes(key) ? current.permissionKeys.filter((item: string) => item !== key) : [...current.permissionKeys, key] }));
  const setScope = (resource: string, scope: string) => setDraft((current: Json) => {
    const existing = current.dataScopes.find((item: Json) => item.resource === resource);
    return { ...current, dataScopes: [...current.dataScopes.filter((item: Json) => item.resource !== resource), { resource, scope, config: existing?.config }] };
  });
  const setAssignedResources = (resource: string, resourceIds: string[]) => setDraft((current: Json) => {
    const existing = current.dataScopes.find((item: Json) => item.resource === resource) || { resource, scope: 'ASSIGNED' };
    return { ...current, dataScopes: [...current.dataScopes.filter((item: Json) => item.resource !== resource), { ...existing, config: { ...(existing.config || {}), resourceIds } }] };
  });
  const setField = (resource: string, field: string, access: string) => setDraft((current: Json) => ({ ...current, fieldPermissions: [...current.fieldPermissions.filter((item: Json) => !(item.resource === resource && item.field === field)), { resource, field, access }] }));
  const setLimit = (key: string, value: string) => setDraft((current: Json) => ({ ...current, limits: [...current.limits.filter((item: Json) => item.key !== key), { key, value: Number(value || 0) }] }));
  const submit = (event: FormEvent) => { event.preventDefault(); save(draft); };
  return <div className="dialog-backdrop"><form className="dialog access-editor" onSubmit={submit}><div className="dialog-head"><div><h2>{t(draft.id ? 'Edit Role' : 'Create Role', language)}</h2><p>{t('Configure effective access without hardcoded role checks.', language)}</p></div><button type="button" className="icon-button" onClick={close} aria-label={t('Close dialog', language)}><AppIcon name="close"/></button></div>
    <div className="form-grid"><label>{t('Role Name', language)}<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required/></label><label>{t('Description', language)}<input value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label></div>
    <div className="access-editor-tabs">{(['modules', 'scopes', 'fields', 'limits'] as const).map((item) => <button type="button" key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>{t(item[0].toUpperCase() + item.slice(1), language)}</button>)}</div>
    <div className="access-editor-body">
      {section === 'modules' ? grouped.map(([module, permissions]) => <section className="permission-matrix" key={module}><div><h3>{t(module[0].toUpperCase() + module.slice(1), language)}</h3><button type="button" onClick={() => setDraft((current: Json) => ({ ...current, permissionKeys: [...new Set([...current.permissionKeys, ...(permissions || []).map((item: Json) => item.key)])] }))}>{t('Select All', language)}</button></div><div>{permissions?.map((permission: Json) => <label key={permission.key}><input type="checkbox" checked={draft.permissionKeys.includes(permission.key)} onChange={() => togglePermission(permission.key)}/><span><b>{t(permission.resource.replaceAll('_', ' '), language)}</b><small>{t(permission.action, language)}</small></span></label>)}</div></section>) : null}
      {section === 'scopes' ? <div className="policy-list">{data.configuration.dataScopeResources.map((resource: string) => { const policy = draft.dataScopes.find((item: Json) => item.resource === resource); const assignable = data.configuration.assignableResources?.[resource] || []; return <label key={resource}><span><b>{t(resource.replaceAll('_', ' '), language)}</b><small>{t('Records visible to this role', language)}</small></span><select value={policy?.scope || 'NONE'} onChange={(event) => setScope(resource, event.target.value)}>{['NONE', 'OWN', 'ASSIGNED', 'TEAM', 'BRANCH', 'WAREHOUSE', 'DEPARTMENT', 'ALL'].map((scope) => <option key={scope} value={scope}>{t(scope, language)}</option>)}</select>{policy?.scope === 'ASSIGNED' && assignable.length ? <select multiple aria-label={t('Assigned resources', language)} value={policy.config?.resourceIds || []} onChange={(event) => setAssignedResources(resource, [...event.currentTarget.selectedOptions].map((option) => option.value))}>{assignable.map((item: Json) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select> : null}</label>; })}</div> : null}
      {section === 'fields' ? <div className="policy-list">{data.configuration.fields.map((item: Json) => <label key={`${item.resource}.${item.field}`}><span><b>{t(item.description, language)}</b><small><code dir="ltr">{item.resource}.{item.field}</code></small></span><select value={draft.fieldPermissions.find((field: Json) => field.resource === item.resource && field.field === item.field)?.access || 'HIDDEN'} onChange={(event) => setField(item.resource, item.field, event.target.value)}>{['HIDDEN', 'VIEW', 'EDIT'].map((access) => <option key={access} value={access}>{t(access, language)}</option>)}</select></label>)}</div> : null}
      {section === 'limits' ? <div className="policy-list">{data.configuration.limits.map((item: Json) => <label key={item.key}><span><b>{t(item.description, language)}</b><small><code dir="ltr">{item.key}</code> · {t(item.unit, language)}</small></span><input type="number" min="0" value={draft.limits.find((limit: Json) => limit.key === item.key)?.value || 0} onChange={(event) => setLimit(item.key, event.target.value)}/></label>)}</div> : null}
    </div><div className="dialog-actions"><button type="button" className="button" onClick={close}>{t('Cancel', language)}</button><LoadingButton className="button primary" loading={busy} loadingLabel={t('Saving…', language)}>{t('Save Role', language)}</LoadingButton></div>
  </form></div>;
}

function UserEditor({ value, roles, permissions, busy, language, close, save }: { value: Json; roles: Json[]; permissions: Json[]; busy: boolean; language: Language; close: () => void; save: (value: Json) => void }) {
  const [draft, setDraft] = useState<Json>({ ...value });
  const [overrideKey, setOverrideKey] = useState('');
  const addOverride = () => { if (!overrideKey || draft.overrides.some((item: Json) => item.permissionKey === overrideKey)) return; setDraft({ ...draft, overrides: [...draft.overrides, { permissionKey: overrideKey, effect: 'DENY', reason: '' }] }); setOverrideKey(''); };
  return <div className="dialog-backdrop"><form className="dialog access-editor compact" onSubmit={(event) => { event.preventDefault(); save(draft); }}><div className="dialog-head"><div><h2>{t('Edit User Access', language)}</h2><p>{value.name} · <bdi dir="ltr">{value.email}</bdi></p></div><button type="button" className="icon-button" aria-label={t('Close dialog', language)} onClick={close}><AppIcon name="close"/></button></div><div className="access-editor-body">
    <label className="access-active"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })}/><span><b>{t('Active account', language)}</b><small>{t('Inactive users cannot sign in.', language)}</small></span></label>
    <label className="access-active"><input type="checkbox" checked={draft.mfaRequired} onChange={(event) => setDraft({ ...draft, mfaRequired: event.target.checked })}/><span><b>{t('Require MFA', language)}</b><small>{t('The user must enroll before the next privileged sign-in.', language)}</small></span></label>
    <label>{t('Primary Role', language)}<select value={draft.primaryRoleId} onChange={(event) => setDraft({ ...draft, primaryRoleId: event.target.value })}>{roles.map((role) => <option key={role.id} value={role.id}>{t(role.name, language)}</option>)}</select></label>
    <fieldset><legend>{t('Additional Roles', language)}</legend><div className="role-checks">{roles.filter((role) => role.id !== draft.primaryRoleId).map((role) => <label key={role.id}><input type="checkbox" checked={draft.additionalRoleIds.includes(role.id)} onChange={(event) => setDraft({ ...draft, additionalRoleIds: event.target.checked ? [...draft.additionalRoleIds, role.id] : draft.additionalRoleIds.filter((id: string) => id !== role.id) })}/>{t(role.name, language)}</label>)}</div></fieldset>
    <fieldset><legend>{t('Individual Overrides', language)}</legend><p className="muted">{t('Use overrides only for exceptional cases. An explicit deny always wins.', language)}</p><div className="override-add"><select value={overrideKey} onChange={(event) => setOverrideKey(event.target.value)}><option value="">{t('Select permission', language)}</option>{permissions.map((permission) => <option key={permission.id} value={permission.key}>{permission.key}</option>)}</select><button type="button" className="button" onClick={addOverride}>{t('Add Override', language)}</button></div>{draft.overrides.map((override: Json, index: number) => <div className="override-row" key={override.permissionKey}><code dir="ltr">{override.permissionKey}</code><select value={override.effect} onChange={(event) => setDraft({ ...draft, overrides: draft.overrides.map((item: Json, itemIndex: number) => itemIndex === index ? { ...item, effect: event.target.value } : item) })}><option value="GRANT">{t('GRANT', language)}</option><option value="DENY">{t('DENY', language)}</option></select><input placeholder={t('Reason', language)} value={override.reason || ''} onChange={(event) => setDraft({ ...draft, overrides: draft.overrides.map((item: Json, itemIndex: number) => itemIndex === index ? { ...item, reason: event.target.value } : item) })}/><button type="button" className="icon-button" aria-label={t('Remove line', language)} onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter((_: Json, itemIndex: number) => itemIndex !== index) })}><AppIcon name="close"/></button></div>)}</fieldset>
  </div><div className="dialog-actions"><button type="button" className="button" onClick={close}>{t('Cancel', language)}</button><LoadingButton className="button primary" loading={busy} loadingLabel={t('Saving…', language)}>{t('Save User Access', language)}</LoadingButton></div></form></div>;
}
