import { allowedOrigins, demoResetEnabled, swaggerEnabled, tokenSigningSecret } from './deployment-config';

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
});
