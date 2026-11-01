import { academicAddress, academicReplyTo, academicSender, academicEmailConfiguration, assertAcademicRecipient, retrieveAcademicEmail, sendAcademicEmail } from './av8-academic-email';

const env = { AV8_ENV: 'test', AV8_ACADEMIC_EMAIL_ENABLED: 'true', AV8_ACADEMIC_EMAIL_PROVIDER: 'resend', AV8_ACADEMIC_EMAIL_FROM: 'sender@av8.invalid', AV8_ACADEMIC_EMAIL_API_KEY: 'synthetic-provider-key', AV8_ACADEMIC_TEST_RECIPIENTS: 'student@av8.invalid,guardian@av8.invalid' };
const message = { from: 'sender@av8.invalid', to: ['student@av8.invalid'], subject: 'Synthetic report v1', text: 'Reviewed academic report only', attachments: [] };
describe('academic provider boundaries', () => {
  it('keeps disabled or incomplete delivery unavailable and requires a nonproduction recipient allowlist', () => {
    expect(academicEmailConfiguration({}).emailConfigured).toBe(false);
    expect(academicEmailConfiguration({ ...env, AV8_ACADEMIC_TEST_RECIPIENTS: '' }).emailConfigured).toBe(false);
    expect(() => assertAcademicRecipient('outside@av8.invalid', env)).toThrow('allowlist');
    expect(() => academicAddress('student@example.org\nBcc: someone@example.org')).toThrow();
  });
  it('records provider acceptance distinctly from delivery and uses a stable opaque idempotency key', async () => {
    const request = jest.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'synthetic-accepted-id' }), { status: 200 }));
    expect(await sendAcademicEmail('report-1:STUDENT', message, env, request)).toEqual({ status: 'ACCEPTED', providerReference: 'synthetic-accepted-id', code: 'PROVIDER_ACCEPTED' });
    expect(await sendAcademicEmail('report-1:STUDENT', message, env, request)).toMatchObject({ status: 'ACCEPTED' });
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(request.mock.calls[1][1].headers['Idempotency-Key']);
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).not.toContain('student@');
  });
  it('supports one safe named sender and optional single Reply-To in the actual provider payload',async()=>{
    const request=jest.fn().mockResolvedValue(new Response(JSON.stringify({id:'synthetic-reply-to'}),{status:200}));
    await sendAcademicEmail('report-reply-to',message,{...env,AV8_ACADEMIC_EMAIL_FROM:'Example Flight Academy <sender@av8.invalid>',AV8_ACADEMIC_EMAIL_REPLY_TO:'Replies@av8.invalid'},request);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({from:'Example Flight Academy <sender@av8.invalid>',reply_to:'replies@av8.invalid'});
    const without=jest.fn().mockResolvedValue(new Response(JSON.stringify({id:'synthetic-no-reply-to'}),{status:200}));await sendAcademicEmail('report-no-reply-to',message,env,without);expect(JSON.parse(without.mock.calls[0][1].body)).not.toHaveProperty('reply_to');
  });
  it('rejects sender or Reply-To header injection and recipient lists before any request',async()=>{
    for(const invalid of ['one@example.invalid,two@example.invalid','Person <one@example.invalid>','one@example.invalid\r\nBcc: other@example.invalid','one@example.invalid\n','a..b@example.invalid'])expect(()=>academicReplyTo(invalid)).toThrow();
    for(const invalid of ['One <one@example.invalid>, Two <two@example.invalid>','Name\nBcc <one@example.invalid>','Name;Other <one@example.invalid>'])expect(()=>academicSender(invalid)).toThrow();
    expect(academicReplyTo('')).toBeUndefined();const request=jest.fn();await expect(sendAcademicEmail('invalid-reply',message,{...env,AV8_ACADEMIC_EMAIL_REPLY_TO:'one@example.invalid,two@example.invalid'},request)).rejects.toThrow();expect(request).not.toHaveBeenCalled();
  });
  it('keeps timeouts, server failures and uncertain responses unknown, without automatic replay', async () => {
    for (const request of [jest.fn().mockRejectedValue(new Error('Synthetic timeout')), jest.fn().mockResolvedValue(new Response('', { status: 503 })), jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))]) {
      expect(await sendAcademicEmail('report-1:STUDENT', message, env, request)).toMatchObject({ status: 'DELIVERY_UNKNOWN' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('distinguishes a confirmed rejected send from an uncertain send', async () => {
    const request = jest.fn().mockResolvedValue(new Response('{}', { status: 422 }));
    expect(await sendAcademicEmail('report-1:GUARDIAN', { ...message, to: ['guardian@av8.invalid'] }, env, request)).toEqual({ status: 'FAILED', code: 'HTTP_422' });
  });
  it('accepts delivery evidence only for the exact recipient and report identity', async () => {
    const request = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1', to: ['student@av8.invalid'], subject: message.subject, last_event: 'delivered' }), { status: 200 }));
    expect(await retrieveAcademicEmail('provider-1', 'student@av8.invalid', message.subject, env, request)).toMatchObject({ status: 'DELIVERED', providerReference: 'provider-1' });
    const wrong = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'provider-1', to: ['guardian@av8.invalid'], subject: message.subject, last_event: 'delivered' }), { status: 200 }));
    await expect(retrieveAcademicEmail('provider-1', 'student@av8.invalid', message.subject, env, wrong)).rejects.toThrow('does not match');
  });
});
