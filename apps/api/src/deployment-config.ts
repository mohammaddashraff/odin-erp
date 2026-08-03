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

export const demoResetEnabled = (environment: NodeJS.ProcessEnv = process.env) =>
  environment.NODE_ENV !== 'production' || environment.ODIN_DEPLOYMENT_MODE === 'demo';
