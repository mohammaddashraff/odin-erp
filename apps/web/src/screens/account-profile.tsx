"use client";

import { useState } from "react";
import { Camera, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useERP, useResource } from "../core/erp-context";
import { Button, Details, ErrorNotice, Fields, PageHeader, Panel, ProfileImage, Resource, Status, Tabs, useUnsaved } from "../components/ui";
import { PasswordChange } from "./administration";

const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 768 * 1024) {
    reject(new Error('Choose a PNG, JPEG or WebP image no larger than 768 KB.'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Unable to read this image.'));
  reader.readAsDataURL(file);
});

export default function AccountProfile() {
  const { tr, dateTime, request, notify, endSession } = useERP();
  const state = useResource('/profile');
  const [tab, setTab] = useState('Details');
  const profile = state.data;
  return <>
    <PageHeader title="My Profile" subtitle="Your personal details, account security and current access." />
    <Resource state={state}>{profile ? <>
      <Panel className="account-profile-hero">
        <div className="profile-identity-card">
          <ProfileImage src={profile.profileImage} name={profile.name} size={92} />
          <div><span className="eyebrow">{tr('Personal account')}</span><h2>{profile.name}</h2><bdi>{profile.email}</bdi><p>{profile.jobTitle || tr('Not recorded')} · {profile.branches.map((branch: any) => branch.name).join(', ') || tr('Not available')}</p></div>
          <Status value={profile.active ? 'ACTIVE' : 'INACTIVE'} />
        </div>
      </Panel>
      <Tabs tabs={['Details', 'Account & Security']} value={tab} set={setTab} />
      {tab === 'Details' ? <ProfileDetails key={profile.profileVersion} profile={profile} reload={state.reload} /> : <>
        <div className="settings-card-grid">
          <Panel title="Account & Security"><div className="settings-icon-heading"><ShieldCheck /><div><strong>{tr('Sign-in protection')}</strong><p>{tr('Review your account state and verification setup.')}</p></div></div><Details values={[["Account status", tr(profile.active ? 'Active' : 'Inactive')], ["Sign-in verification setup", tr(profile.mfaEnabled ? 'Enrolled' : 'Not enrolled')], ["Enrollment date", profile.mfaEnrolledAt ? dateTime(profile.mfaEnrolledAt) : tr('Not recorded')], ["Last sign-in", profile.lastSignInAt ? dateTime(profile.lastSignInAt) : tr(profile.signInState === 'NEVER' ? 'Never signed in' : 'Not available')]]} /></Panel>
          <Panel title="Account actions"><div className="settings-icon-heading"><LogOut /><div><strong>{tr('Active sessions')}</strong><p>{tr('Sign out every device if you no longer recognize a session.')}</p></div></div><div className="surface-body"><Button danger onClick={async () => { try { await request('/auth/logout-all', { method: 'POST' }); endSession(); } catch (error: any) { notify(error.message, true); } }}>{tr('Sign out all devices')}</Button></div></Panel>
        </div>
        <PasswordChange />
      </>}
    </> : null}</Resource>
  </>;
}

function ProfileDetails({ profile, reload }: { profile: any; reload: () => void }) {
  const { language, request, notify, refreshAccountProfile, changeLanguage, tr } = useERP();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: profile.name, phone: profile.phone || '', jobTitle: profile.jobTitle || '', profileImage: profile.profileImage || '' });
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useUnsaved(dirty);
  const set = (key: string, value: any) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  const cancel = () => {
    setDraft({ name: profile.name, phone: profile.phone || '', jobTitle: profile.jobTitle || '', profileImage: profile.profileImage || '' });
    setDirty(false);
    setError('');
    setEditing(false);
  };
  if (!editing) return <div className="account-profile-layout">
    <Panel title="Details" actions={<Button onClick={() => setEditing(true)}>{tr('Edit details')}</Button>}><Details values={[["Full name", profile.name], ["Sign-in email", <bdi key="email">{profile.email}</bdi>], ["Phone", <bdi key="phone">{profile.phone || tr('Not recorded')}</bdi>], ["Job title", profile.jobTitle || tr('Not recorded')], ["Home branch", profile.branches.find((branch: any) => branch.id === profile.homeBranchId)?.name || tr('Not recorded')]]} /><div className="surface-body"><Button onClick={async () => { try { const next = language === 'en' ? 'ar' : 'en'; await request('/profile', { method: 'PATCH', body: JSON.stringify({ language: next, expectedProfileVersion: profile.profileVersion }) }); changeLanguage(); reload(); } catch (reason: any) { notify(reason.message, true); } }}>{tr('Language')}: {language === 'en' ? 'العربية' : 'English'}</Button></div></Panel>
    <Panel title="Access summary"><div className="settings-icon-heading"><UserRound /><div><strong>{profile.primaryRole?.displayName?.[language] || profile.primaryRole?.name}</strong><p>{tr('Your access is managed by your administrator.')}</p></div></div><Details values={[["Permitted branches", profile.branches.map((branch: any) => branch.name).join(', ') || tr('None')], ["Additional groups", profile.additionalRoles?.map((role: any) => role.displayName?.[language] || role.name).join(', ') || tr('None')]]} /></Panel>
  </div>;
  return <Panel title="Edit details"><form className="surface-body" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await request('/profile', { method: 'PATCH', body: JSON.stringify({ ...draft, expectedProfileVersion: profile.profileVersion }) }); setDirty(false); await refreshAccountProfile(); reload(); notify('Profile saved.'); setEditing(false); } catch (reason: any) { setError(reason.message); } finally { setBusy(false); } }}>
    <div className="profile-photo-editor"><ProfileImage src={draft.profileImage} name={draft.name} size={96} /><div><strong>{tr('Profile photo')}</strong><p>{tr('PNG, JPEG or WebP · up to 768 KB')}</p><div className="actions"><label className="btn"><Camera size={16} />{tr('Choose photo')}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { set('profileImage', await readImage(file)); setError(''); } catch (reason: any) { setError(reason.message); } }} /></label>{draft.profileImage ? <Button onClick={() => set('profileImage', '')}>{tr('Remove photo')}</Button> : null}</div></div></div>
    <Fields values={draft} set={set} specs={[{ key: 'name', label: 'Full name', required: true }, { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'jobTitle', label: 'Job title' }]} />
    <p>{tr('Contact your administrator to change your sign-in email or branch access.')}</p>{error ? <ErrorNotice message={error} /> : null}<div className="admin-actions"><Button onClick={cancel}>{tr('Cancel')}</Button><Button primary type="submit" busy={busy}>{tr('Save details')}</Button></div>
  </form></Panel>;
}
