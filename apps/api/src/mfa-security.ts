import { compare, hash } from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mfaEncryptionKey } from './deployment-config';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(input: Buffer) {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  return output;
}

function base32Decode(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of normalized) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Invalid MFA secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export const newMfaSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, time = Date.now(), stepSeconds = 30) {
  const counter = BigInt(Math.floor(time / 1000 / stepSeconds));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  return [-30_000, 0, 30_000].some((offset) => timingSafeEqual(supplied, Buffer.from(totpCode(secret, now + offset))));
}

export function encryptMfaSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', mfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptMfaSecret(value: string) {
  const [ivText, tagText, encryptedText] = value.split('.');
  if (!ivText || !tagText || !encryptedText) throw new Error('MFA secret storage is invalid');
  const decipher = createDecipheriv('aes-256-gcm', mfaEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-'));
}

export async function hashRecoveryCodes(codes: string[]) {
  const rounds = Number(process.env.ODIN_BCRYPT_ROUNDS || (process.env.NODE_ENV === 'production' ? 12 : 4));
  return Promise.all(codes.map((code) => hash(code.replaceAll('-', '').toUpperCase(), rounds)));
}

export async function consumeRecoveryCode(hashes: string[], supplied: string) {
  const normalized = supplied.replaceAll('-', '').toUpperCase();
  for (let index = 0; index < hashes.length; index += 1) {
    if (await compare(normalized, hashes[index])) return { accepted: true, remaining: hashes.filter((_hash, candidate) => candidate !== index) };
  }
  return { accepted: false, remaining: hashes };
}

export function otpAuthUri(secret: string, tenantName: string, email: string) {
  const issuer = 'Odin ERP';
  const label = encodeURIComponent(`${tenantName}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
