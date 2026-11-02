"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useERP } from "../core/erp-context";

export function SettingsLinks() {
  const { allowed, tr } = useERP();
  const pathname = usePathname();
  const links: Array<[string, string, string | string[]]> = [
    ["/admin/overview", "Overview", "settings.users_access.view"],
    ["/settings/access/users", "Users", "settings.users_access.view"],
    ["/settings/company", "Company settings", ["settings.system.view", "settings.users_access.manage", "system.super_admin"]],
    ["/settings/access/roles", "Access Groups", "system.super_admin"],
    ["/admin/audit", "Activity Log", ["audit.business.view", "settings.users_access.view"]],
    ["/admin/advanced", "Advanced Settings", ["settings.users_access.view", "settings.system.view"]],
  ];
  return (
    <nav className="admin-links" aria-label={tr("Settings & Administration")}>
      {links.filter(([, , permission]) => allowed(permission)).map(([href, label]) => (
        <Link className="btn small" aria-current={pathname === href ? "page" : undefined} key={href} href={href}>{tr(label)}</Link>
      ))}
    </nav>
  );
}
