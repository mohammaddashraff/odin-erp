import type { NextConfig } from "next";

const hosted=process.env.AV8_ENV==='production';
if (process.env.AV8_OUTBOUND !== 'disabled' || !['dev','test','production'].includes(process.env.AV8_ENV || '') || process.env.API_ORIGIN !== (hosted?'https://av8-erp-api.vercel.app':'http://127.0.0.1:8181') || process.env.ODIN_UI_BUILD_DIR !== (hosted?'.next':'.next-av8')) throw new Error('Start AV8 with its verified isolated configuration');
if(hosted&&process.env.VERCEL==='1'&&process.env.VERCEL_PROJECT_ID!=='prj_uhdt4Zm1BiauDHJeHoMa1ccO2GvG')throw new Error('Unexpected AV8 frontend project');

const apiOrigin = (process.env.API_ORIGIN || "http://127.0.0.1:8181").replace(
  /\/$/,
  "",
);
const demoMode = process.env.NEXT_PUBLIC_ODIN_DEMO_MODE === "true";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  distDir: process.env.ODIN_UI_BUILD_DIR || ".next-av8",
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
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'`,
          },
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
