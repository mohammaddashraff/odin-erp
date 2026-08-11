import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getRequestLanguage } from './i18n-server';
import { SessionProvider } from './session-provider';

export const metadata: Metadata = {
  title: 'Odin ERP',
  description: 'Auditable accounting, distribution and POS platform',
  applicationName: 'Odin ERP',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/brand/odin-logo.png', type: 'image/png', sizes: '64x64' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
    apple: [{ url: '/brand/odin-logo.png', type: 'image/png', sizes: '64x64' }],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3ff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1524' },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = await getRequestLanguage();
  return (
    <html lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} data-theme="light" suppressHydrationWarning>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
