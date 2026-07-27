import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Odin ERP',
    short_name: 'Odin',
    description: 'Auditable accounting, distribution and POS platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7fa',
    theme_color: '#2b6cff',
    icons: [{
      src: '/brand/odin-logo.png',
      sizes: '64x64',
      type: 'image/png',
      purpose: 'any',
    }],
  };
}
