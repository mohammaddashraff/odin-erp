import type { Metadata } from 'next';
import './globals.css';
import { getRequestLanguage } from './i18n-server';
import { SessionProvider } from './session-provider';

export const metadata: Metadata = { title: 'Odin ERP', description: 'Auditable accounting, distribution and POS platform' };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = await getRequestLanguage();
  return (
    <html lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} data-theme="dark" suppressHydrationWarning>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
