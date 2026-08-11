const canonicalStagingOrigin = 'https://odin-erp-web.vercel.app';
const localTokenSecret = 'odin-local-demo-secret-change-before-production';

export function allowedOrigins(environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.ODIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const canonical = String(environment.ODIN_WEB_ORIGIN || (environment.NODE_ENV === 'production' ? canonicalStagingOrigin : ''))
    .trim()
    .replace(/\/$/, '');
  if (canonical) configured.push(canonical);
  if (configured.length || environment.CI) return new Set(configured);
  return new Set(['http://127.0.0.1:8080', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://localhost:3000']);
}

export const swaggerEnabled = (environment: NodeJS.ProcessEnv = process.env) =>
  String(environment.ENABLE_SWAGGER).toLowerCase() === 'true';

export function tokenSigningSecret(environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.ODIN_TOKEN_SECRET || '');
  if (environment.NODE_ENV === 'production' && (configured.length < 32 || configured === localTokenSecret)) {
    throw new Error('ODIN_TOKEN_SECRET must be a unique production secret of at least 32 characters');
  }
  return configured || localTokenSecret;
}

export function mfaEncryptionKey(environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.ODIN_MFA_ENCRYPTION_KEY || '');
  if (environment.NODE_ENV === 'production' && !configured) {
    throw new Error('ODIN_MFA_ENCRYPTION_KEY must be a unique 32-byte production key');
  }
  if (configured) {
    const encoding = /^[a-f0-9]{64}$/i.test(configured) ? 'hex' : 'base64';
    const decoded = Buffer.from(configured, encoding);
    if (decoded.length !== 32) throw new Error('ODIN_MFA_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return decoded;
  }
  return createHash('sha256').update(`local-mfa:${tokenSigningSecret(environment)}`).digest();
}

export const privilegedMfaRequired = (environment: NodeJS.ProcessEnv = process.env) =>
  (environment.NODE_ENV === 'production' && String(environment.ODIN_ALLOW_SHARED_DEMO_LOGINS).toLowerCase() !== 'true')
  || String(environment.ODIN_REQUIRE_PRIVILEGED_MFA).toLowerCase() === 'true';

export const demoResetEnabled = (environment: NodeJS.ProcessEnv = process.env) =>
  environment.NODE_ENV !== 'production' || environment.ODIN_DEPLOYMENT_MODE === 'demo';
import { createHash } from 'node:crypto';
