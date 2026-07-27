import { allowedOrigins, swaggerEnabled } from './deployment-config';

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
});
