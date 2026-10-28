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
export const metadata: Metadata = {
  title: "AV8 ERP · ODIN Software Solutions",
  description: "Student operations for AV8, by ODIN Software Solutions",
  icons: { icon: "/brand/oss-geometric-eye-transparent.png" },
};
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#030c1d",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = await getRequestLanguage();
  return (
    <html lang={language} dir={language === "ar" ? "rtl" : "ltr"}>
      <body>
        <SessionProvider>
          <ERPProvider initialLanguage={language}>{children}</ERPProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
