import { createHash } from 'node:crypto';
import { fail, text } from './av8-domain';

export function academicAddress(value: unknown) {
  const address = text(value, 'Email address', true, 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) fail('A valid student and guardian email address is required');
  return address;
}

export function academicReplyTo(value: unknown) {
  if(value===undefined||value===null||value==='')return undefined;
  if(typeof value!=='string'||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value))fail('Reply-To must be one valid email address');
  const address=(value as string).trim().toLowerCase();if(!address)return undefined;
  const [local,domain]=address.split('@');
  if(address.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(address)||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.split('.').some(label=>label.length>63))fail('Reply-To must be one valid email address');
  return address;
}

export function academicSender(value:unknown){
  if(typeof value!=='string'||value.length>400||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value))fail('Configure one verified sender mailbox');
  const sender=(value as string).trim(),match=/^([^<>]+?)\s*<([^<>]+)>$/.exec(sender);
  if(match){const name=match[1].trim(),address=academicReplyTo(match[2]);if(!name||name.length>120||/[<>,;:"\\@]/.test(name)||!address)fail('Configure one verified sender mailbox');return `${name} <${address}>`;}
  const address=academicReplyTo(sender);if(!address)fail('Configure one verified sender mailbox');return address!;
}

export function academicEmailConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.AV8_ACADEMIC_EMAIL_ENABLED === 'true';
  const workerEnabled = env.AV8_ACADEMIC_WORKER_ENABLED === 'true';
  const issues: string[] = [];
  if (enabled) {
    if (env.AV8_ACADEMIC_EMAIL_PROVIDER !== 'resend') issues.push('Select the supported academic email provider: resend');
    if (!env.AV8_ACADEMIC_EMAIL_API_KEY) issues.push('Configure AV8_ACADEMIC_EMAIL_API_KEY');
    try { academicSender(env.AV8_ACADEMIC_EMAIL_FROM); } catch { issues.push('Configure a verified sender in AV8_ACADEMIC_EMAIL_FROM'); }
    try { academicReplyTo(env.AV8_ACADEMIC_EMAIL_REPLY_TO); } catch { issues.push('Configure one valid address in AV8_ACADEMIC_EMAIL_REPLY_TO'); }
    if (env.AV8_ENV !== 'production' && !env.AV8_ACADEMIC_TEST_RECIPIENTS) issues.push('Configure explicit controlled AV8_ACADEMIC_TEST_RECIPIENTS');
  }
  if (workerEnabled && (!enabled || !/^[1-9]\d*$/.test(env.AV8_ACADEMIC_WORKER_USER_ID || ''))) issues.push('Worker requires enabled email and an authorized AV8_ACADEMIC_WORKER_USER_ID');
  return { emailEnabled: enabled, emailConfigured: enabled && issues.length === 0, emailMode: enabled ? 'resend' : 'disabled', workerEnabled, issues };
}

export function assertAcademicRecipient(address: string, env: NodeJS.ProcessEnv = process.env) {
  const configuration = academicEmailConfiguration(env);
  if (!configuration.emailConfigured) fail(configuration.issues.join('; ') || 'Academic email is disabled; configure the approved provider before sending');
  if (env.AV8_ENV !== 'production') {
    const allowlist = (env.AV8_ACADEMIC_TEST_RECIPIENTS || '').split(',').filter(Boolean).map(academicAddress);
    if (!allowlist.includes(academicAddress(address))) fail('Recipient is not in the controlled academic test-recipient allowlist');
  }
}

export type AcademicMessage = { from: string; to: string[]; subject: string; text: string; attachments: { filename: string; content: string }[] };
export type SendOutcome = { status: 'ACCEPTED' | 'FAILED' | 'DELIVERY_UNKNOWN'; providerReference?: string; code: string };

/** No retry occurs here: a timeout/5xx may follow provider acceptance. */
export async function sendAcademicEmail(identity: string, message: AcademicMessage, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch): Promise<SendOutcome> {
  for (const address of message.to) assertAcademicRecipient(address, env);
  const replyTo=academicReplyTo(env.AV8_ACADEMIC_EMAIL_REPLY_TO),payload={...message,from:academicSender(env.AV8_ACADEMIC_EMAIL_FROM),...(replyTo?{reply_to:replyTo}:{})};
  const idempotencyKey = `av8-academic-${createHash('sha256').update(identity).digest('hex')}`;
  try {
    const result = await request('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.AV8_ACADEMIC_EMAIL_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) {
      // Resend documents a concurrent-idempotency 409; its outcome is ambiguous.
      return { status: result.status >= 500 || [408, 409].includes(result.status) ? 'DELIVERY_UNKNOWN' : 'FAILED', code: `HTTP_${result.status}` };
    }
    const data: any = await result.json();
    if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(data.id)) return { status: 'DELIVERY_UNKNOWN', code: 'INVALID_PROVIDER_RESPONSE' };
    return { status: 'ACCEPTED', providerReference: data.id, code: 'PROVIDER_ACCEPTED' };
  } catch { return { status: 'DELIVERY_UNKNOWN', code: 'PROVIDER_OUTCOME_UNKNOWN' }; }
}

export async function retrieveAcademicEmail(providerReference: string, recipient: string, subject: string, env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  assertAcademicRecipient(recipient, env);
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(providerReference)) fail('A valid provider message reference is required');
  const response = await request(`https://api.resend.com/emails/${encodeURIComponent(providerReference)}`, { headers: { Authorization: `Bearer ${env.AV8_ACADEMIC_EMAIL_API_KEY}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(`Provider evidence unavailable (HTTP ${response.status}); dispatch remains unchanged`);
  const evidence: any = await response.json();
  if (evidence.id !== providerReference || !Array.isArray(evidence.to) || evidence.to.length !== 1 || academicAddress(evidence.to[0]) !== recipient || evidence.subject !== subject) fail('Provider evidence does not match this dispatch recipient and report');
  const event = String(evidence.last_event || '');
  const status = event === 'delivered' ? 'DELIVERED' : ['bounced', 'complained', 'suppressed'].includes(event) ? 'BOUNCED' : ['failed', 'canceled'].includes(event) ? 'FAILED' : 'ACCEPTED';
  return { status, providerReference, providerEvent: event || 'accepted', verifiedAt: new Date().toISOString() };
}
