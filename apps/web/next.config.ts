import type { NextConfig } from 'next';

const apiOrigin = (process.env.API_ORIGIN || 'http://127.0.0.1:8081').replace(/\/$/, '');
const demoMode = process.env.NEXT_PUBLIC_ODIN_DEMO_MODE === 'true';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // A compile-time literal lets production builds remove demo credentials.
  env: {
    NEXT_PUBLIC_ODIN_DEMO_MODE: demoMode ? 'true' : 'false',
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
  async redirects() {
    return [
      { source: '/favicon.ico', destination: '/brand/odin-logo.png', permanent: true },
      { source: '/favicon.png', destination: '/brand/odin-logo.png', permanent: true },
      { source: '/apple-touch-icon.png', destination: '/brand/odin-logo.png', permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
