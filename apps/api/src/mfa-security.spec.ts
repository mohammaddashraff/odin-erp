import { consumeRecoveryCode, decryptMfaSecret, encryptMfaSecret, hashRecoveryCodes, newMfaSecret, newRecoveryCodes, totpCode, verifyTotp } from './mfa-security';

describe('MFA cryptography', () => {
  it('encrypts TOTP secrets with authenticated encryption and verifies only the current window', () => {
    process.env.ODIN_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const secret = newMfaSecret();
    const encrypted = encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted)).toBe(secret);
    const now = Date.UTC(2026, 7, 3, 12, 0, 0);
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
    delete process.env.ODIN_MFA_ENCRYPTION_KEY;
  });

  it('stores recovery codes as one-way hashes and consumes each code once', async () => {
    const codes = newRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes);
    expect(JSON.stringify(hashes)).not.toContain(codes[0]);
    const consumed = await consumeRecoveryCode(hashes, codes[0]);
    expect(consumed.accepted).toBe(true);
    expect((await consumeRecoveryCode(consumed.remaining, codes[0])).accepted).toBe(false);
  });
});
