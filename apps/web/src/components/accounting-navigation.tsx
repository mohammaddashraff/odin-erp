"use client";
import Link from "next/link";
import { useERP } from "../core/erp-context";
import { modules } from "../core/navigation";
export default function AccountingNavigation({ route }: { route: string }) {
  const { tr, allowed } = useERP();
  return (
    <nav className="ac-navigation" aria-label={tr("Accounting workspace")}>
      {modules
        .find((m) => m.id === "accounting")!
        .children.filter((c) => allowed(c.permission))
        .map((c) => (
          <Link
            key={c.id}
            href={c.route}
            aria-current={route === c.route ? "page" : undefined}
          >
            {tr(c.label)}
          </Link>
        ))}
    </nav>
  );
}
