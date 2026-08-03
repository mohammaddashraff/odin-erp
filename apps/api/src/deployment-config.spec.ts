import { allowedOrigins, demoResetEnabled, mfaEncryptionKey, privilegedMfaRequired, swaggerEnabled, tokenSigningSecret } from './deployment-config';

describe('Deployment exposure controls', () => {
  it('allows only configured production and preview origins plus the canonical web origin', () => {
    expect([...allowedOrigins({
      NODE_ENV: 'production',
      ODIN_ALLOWED_ORIGINS: 'https://preview-one.example, https://preview-two.example/',
      ODIN_WEB_ORIGIN: 'https://erp.example/',
    })]).toEqual([
      'https://preview-one.example',
      'https://preview-two.example',
      'https://erp.example',
    ]);
  });

  it('keeps the deployed staging web origin working without a wildcard', () => {
    expect([...allowedOrigins({ NODE_ENV: 'production' })]).toEqual(['https://odin-erp-web.vercel.app']);
  });

  it('does not expose Swagger unless explicitly enabled', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(swaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' })).toBe(true);
  });

  it('fails closed when the production token secret is missing, weak, or the demo fallback', () => {
    expect(() => tokenSigningSecret({ NODE_ENV: 'production' })).toThrow(/ODIN_TOKEN_SECRET/);
    expect(() => tokenSigningSecret({ NODE_ENV: 'production', ODIN_TOKEN_SECRET: 'too-short' })).toThrow(/ODIN_TOKEN_SECRET/);
    expect(() => tokenSigningSecret({ NODE_ENV: 'production', ODIN_TOKEN_SECRET: 'odin-local-demo-secret-change-before-production' })).toThrow(/ODIN_TOKEN_SECRET/);
    expect(tokenSigningSecret({ NODE_ENV: 'production', ODIN_TOKEN_SECRET: 'a-unique-production-secret-with-32-chars' })).toBe('a-unique-production-secret-with-32-chars');
  });

  it('allows tenant reset in disposable environments only', () => {
    expect(demoResetEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(demoResetEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(demoResetEnabled({ NODE_ENV: 'production', ODIN_DEPLOYMENT_MODE: 'demo' })).toBe(true);
  });

  it('requires a dedicated 32-byte MFA encryption key in production', () => {
    expect(() => mfaEncryptionKey({ NODE_ENV: 'production', ODIN_TOKEN_SECRET: 'a-unique-production-secret-with-32-chars' })).toThrow(/ODIN_MFA_ENCRYPTION_KEY/);
    expect(() => mfaEncryptionKey({ NODE_ENV: 'production', ODIN_MFA_ENCRYPTION_KEY: 'too-short' })).toThrow(/32 bytes/);
    expect(mfaEncryptionKey({ NODE_ENV: 'production', ODIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') })).toHaveLength(32);
  });

  it('fails closed on privileged MFA in production and supports explicit pre-production enforcement', () => {
    expect(privilegedMfaRequired({ NODE_ENV: 'production' })).toBe(true);
    expect(privilegedMfaRequired({ NODE_ENV: 'test' })).toBe(false);
    expect(privilegedMfaRequired({ NODE_ENV: 'test', ODIN_REQUIRE_PRIVILEGED_MFA: 'true' })).toBe(true);
  });
});
