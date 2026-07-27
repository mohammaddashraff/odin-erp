import type { NextConfig } from 'next';

const apiOrigin = (process.env.API_ORIGIN || 'http://127.0.0.1:8081').replace(/\/$/, '');

const nextConfig: NextConfig = {
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
