import Link from "next/link";
import { getRequestLanguage } from "../core/i18n-server";
import { t } from "../core/i18n";
export default async function NotFound() {
  const language = await getRequestLanguage();
  return (
    <main className="glass-fallback">
      <span className="glass-fallback-code">404</span>
      <h1>{t("Page not found", language)}</h1>
      <p>{t("This address is not part of your workspace.", language)}</p>
      <Link className="btn primary" href="/dashboard">
        {t("Dashboard Overview", language)}
      </Link>
    </main>
  );
}
