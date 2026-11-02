"use client";

import { useEffect, useState } from "react";
import { Building2, ImageIcon } from "lucide-react";
import CompanyLetterhead from "../components/company-letterhead";
import { SettingsLinks } from "../components/settings-ui";
import { Button, ErrorNotice, Fields, PageHeader, Panel, Resource, Tabs, useUnsaved } from "../components/ui";
import { useERP, useResource } from "../core/erp-context";

const readLogo = (file: File) => new Promise<string>((resolve, reject) => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 768 * 1024) return reject(new Error('Choose a PNG, JPEG or WebP image no larger than 768 KB.'));
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read this image.')); reader.readAsDataURL(file);
});

export default function CompanySettings() {
  const { tr } = useERP();
  const state = useResource('/company-settings');
  const [companyId, setCompanyId] = useState('');
  const companies = state.data || [];
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companyId, companies]);
  const company = companies.find((item: any) => item.id === companyId) || companies[0];
  return <><SettingsLinks /><PageHeader title={tr('Company settings')} subtitle={tr('Official company details and the identity used on correspondence and documents.')} literal />
    <Resource state={state}>{company ? <>{companies.length > 1 ? <label className="field company-selector"><span>{tr('Company')}</span><select value={company.id} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}<CompanySettingsForm key={`${company.id}-${company.version}`} company={company} reload={state.reload} /></> : null}</Resource>
  </>;
}

function CompanySettingsForm({ company, reload }: { company: any; reload: () => void }) {
  const { language, request, notify, refreshRefs, tr } = useERP();
  const [tab, setTab] = useState('Company details');
  const [draft, setDraft] = useState({ name: company.name || '', nameAr: company.nameAr || '', legalName: company.legalName || '', email: company.email || '', phone: company.phone || '', website: company.website || '', address: company.address || '', commercialRegistration: company.commercialRegistration || '', taxNumber: company.taxNumber || '', logoImage: company.logoImage || '' });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useUnsaved(dirty);
  const tabs = ['Company details', 'Branding & letterhead'];
  const detailsTab = tab === 'Company details';
  const set = (key: string, value: any) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  return <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await request(`/company-settings/${company.id}`, { method: 'PATCH', body: JSON.stringify({ ...draft, version: company.version }) }); setDirty(false); await refreshRefs(); reload(); notify(tr('Company settings saved.')); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } }}>
    <Tabs tabs={tabs} value={tab} set={setTab} />
    {detailsTab ? <div className="settings-card-grid"><Panel><div className="settings-icon-heading"><Building2 /><div><strong>{tr('Company identity')}</strong><p>{tr('Names and contact details shown across the workspace.')}</p></div></div><div className="surface-body"><Fields values={draft} set={set} specs={[{ key: 'name', label: tr('Company name'), required: true, readOnly: !company.canManage }, { key: 'nameAr', label: tr('Arabic company name'), readOnly: !company.canManage }, { key: 'legalName', label: tr('Legal name'), readOnly: !company.canManage }, { key: 'email', label: tr('Company email'), type: 'email', readOnly: !company.canManage }, { key: 'phone', label: tr('Company phone'), type: 'tel', readOnly: !company.canManage }, { key: 'website', label: tr('Website'), type: 'url', readOnly: !company.canManage }, { key: 'address', label: tr('Address'), type: 'textarea', wide: true, readOnly: !company.canManage }]} /></div></Panel><Panel><div className="settings-icon-heading"><ImageIcon /><div><strong>{tr('Registration details')}</strong><p>{tr('References used on formal company documents.')}</p></div></div><div className="surface-body"><Fields values={draft} set={set} specs={[{ key: 'commercialRegistration', label: tr('Commercial registration'), readOnly: !company.canManage }, { key: 'taxNumber', label: tr('Tax registration number'), readOnly: !company.canManage }]} /></div></Panel></div> : <div className="settings-card-grid"><Panel title="Company logo"><div className="surface-body"><p>{tr('Use a clear PNG, JPEG or WebP logo up to 768 KB.')}</p>{company.canManage ? <div className="actions"><label className="btn">{tr('Choose logo')}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { set('logoImage', await readLogo(file)); setError(''); } catch (reason: any) { setError(reason.message); } }} /></label>{draft.logoImage ? <Button onClick={() => set('logoImage', '')}>{tr('Remove logo')}</Button> : null}</div> : null}</div></Panel><Panel title="Letterhead preview"><div className="surface-body"><CompanyLetterhead company={draft} language={language} /></div></Panel></div>}
    {error ? <ErrorNotice message={error} /> : null}{company.canManage ? <div className="admin-actions"><Button primary type="submit" busy={busy} disabled={!dirty}>{tr('Save company settings')}</Button></div> : <div className="notice">{tr('You can view these settings. A company administrator can change them.')}</div>}
  </form>;
}
