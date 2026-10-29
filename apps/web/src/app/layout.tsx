import type { Metadata, Viewport } from "next";
import { SessionProvider } from "../core/session-provider";
import { ERPProvider } from "../core/erp-context";
import { getRequestLanguage } from "../core/i18n-server";
import "./workspace.css";
import "./av8.css";
import "./accounting.css";
import "./accounting-reports.css";
import "./interface-polish.css";
import "./administration.css";
import "./glass.css";
import "./themes.css";
import "./classic-shell.css";
import "./login.css";
export const metadata: Metadata = {
  title: "AV8 ERP · ODIN Software Solutions",
  description: "Student operations for AV8, by ODIN Software Solutions",
  icons: { icon: "/brand/oss-geometric-eye-transparent.png" },
};
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: "#f5f7fb",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = await getRequestLanguage();
  return (
    <html
      lang={language}
      dir={language === "ar" ? "rtl" : "ltr"}
      data-theme="light"
      data-theme-preference="system"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var r=document.documentElement,p=localStorage.getItem('odin-theme');p=p==='light'||p==='dark'||p==='system'?p:'system';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;r.dataset.theme=d;r.dataset.themePreference=p;r.style.colorScheme=d;var m=document.querySelector('meta[name=theme-color]');if(m)m.content=d==='dark'?'#0b1220':'#f5f7fb'}catch(e){}",
          }}
        />
      </head>
      <body>
        <SessionProvider>
          <ERPProvider initialLanguage={language}>{children}</ERPProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
