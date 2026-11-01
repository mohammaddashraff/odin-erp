import type { NextConfig } from "next";
import path from "node:path";

import {av8WebConfiguration} from './src/core/server-config';
const {hosted,apiOrigin,buildDir}=av8WebConfiguration(process.env);

const demoMode = process.env.NEXT_PUBLIC_ODIN_DEMO_MODE === "true";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.AV8_HOSTING==='hetzner'?{output:'standalone' as const,outputFileTracingRoot:path.join(__dirname,'../..')}:{}),
  agentRules: false,
  distDir: buildDir,
  // A compile-time literal lets production builds remove demo credentials.
  env: {
    NEXT_PUBLIC_ODIN_DEMO_MODE: demoMode ? "true" : "false",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/brand/oss-geometric-eye-transparent.png",
        permanent: true,
      },
      {
        source: "/favicon.png",
        destination: "/brand/oss-geometric-eye-transparent.png",
        permanent: true,
      },
      {
        source: "/apple-touch-icon.png",
        destination: "/brand/oss-geometric-eye-transparent.png",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return hosted?[]:[{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
