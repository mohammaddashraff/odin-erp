"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Box,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Globe,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  allRoutes,
  modules,
  routeEntry,
  type ModuleDefinition,
  type ModuleId,
  type RouteDefinition,
} from "../core/navigation";
import { useERP } from "../core/erp-context";
import {
  Brand,
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Loading,
  SearchField,
} from "./ui";
import { t } from "../core/i18n";
import Login from "./login";
import ThemeToggle from "./theme-toggle";
import Screens from "../screens";
import { PasswordChange } from "../screens/administration";

const sidebarStorageKey = "odin-sidebar-collapsed";

const icons: Record<ModuleId, LucideIcon> = {
  av8: Box,
  command: LayoutDashboard,
  sales: ReceiptText,
  purchasing: ShoppingCart,
  inventory: Package,
  hr: Users,
  pos: Store,
  accounting: Landmark,
  banking: WalletCards,
  approvals: ClipboardCheck,
  reports: ChartNoAxesCombined,
  admin: Settings,
};

const sidebarLabels: Partial<Record<ModuleId, string>> = {
  command: "Dashboard",
  purchasing: "Purchasing",
  inventory: "Inventory",
  accounting: "Finance",
  banking: "Cash & Bank",
  approvals: "Approvals",
  reports: "Reports",
  pos: "POS",
  admin: "Users & settings",
};

const navigationGroups: Array<{
  label: string;
  modules: ModuleId[];
}> = [
  { label: "WORKSPACE", modules: ["command", "av8"] },
  {
    label: "BUSINESS",
    modules: [
      "sales",
      "inventory",
      "purchasing",
      "accounting",
      "banking",
      "approvals",
      "reports",
      "hr",
      "pos",
    ],
  },
  { label: "SYSTEM", modules: ["admin"] },
];

export default function Workspace({ route }: { route: string }) {
  const {
    status,
    user,
    refs,
    error,
    refreshRefs,
    allowed,
    tr,
    language,
    changeLanguage,
    endSession,
    notices,
  } = useERP();
  const current = routeEntry(route);
  const [expanded, setExpanded] = useState<string>(current.module.id);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(sidebarStorageKey) === "true");
    } catch {
      /* Keep the expanded default when browser storage is unavailable. */
    }
  }, []);

  useEffect(() => {
    setExpanded(current.module.id);
    setMobile(false);
    setSearchOpen(false);
  }, [current.module.id, route]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 801px)");
    const closeDrawer = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener("change", closeDrawer);
    return () => desktop.removeEventListener("change", closeDrawer);
  }, []);

  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigation.current
      ?.querySelector<HTMLElement>("button:not([disabled]),a[href]")
      ?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobile(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(navigation.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled])",
        ) || []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trap);
      if (menuButton.current?.getClientRects().length) menuButton.current.focus();
      else if (previous?.isConnected) previous.focus();
    };
  }, [mobile]);

  if (status === "restoring") {
    return (
      <div className="session-loading">
        <Brand />
        <Loading label="Restoring your session…" />
      </div>
    );
  }
  if (!user) return <Login />;
  if (user.passwordChangeRequired) {
    return (
      <div className="temporary-password-page">
        <Brand />
        <PasswordChange required />
        <Button onClick={endSession}>{tr("Sign out")}</Button>
      </div>
    );
  }

  const moduleChildren = (module: ModuleDefinition) => {
    const children = allRoutes
      .filter(
        (entry) =>
          entry.module.id === module.id && allowed(entry.child.permission),
      )
      .map((entry) => entry.child);
    if (module.id === "av8" && allowed("av8.workspace.view")) {
      return [
        {
          id: "av8-daily",
          label: "Daily workspace",
          route: "/dashboard?view=daily",
          permission: "av8.workspace.view",
          namespace: "av8",
          screen: "av8",
        } as RouteDefinition,
        ...children,
      ];
    }
    return children;
  };

  const visible = modules.filter((module) => moduleChildren(module).length > 0);
  const visibleById = new Map(visible.map((module) => [module.id, module]));
  const normalizedQuery = query
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase();
  const destinations = allRoutes.filter(
    ({ child }) =>
      allowed(child.permission) &&
      [t(child.label, "en"), t(child.label, "ar"), child.route.replaceAll("/", " ")].some(
        (label) =>
          label.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery),
      ),
  );

  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    try {
      localStorage.setItem(sidebarStorageKey, String(next));
    } catch {
      /* Collapsing still works for this page when storage is unavailable. */
    }
  };

  const closeAfterNavigation = () => setMobile(false);

  return (
    <div
      className={`classic-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobile ? "drawer-open" : ""}`}
    >
      <a className="skip" href="#main">
        {tr("Skip to content")}
      </a>

      <aside
        ref={navigation}
        id="workspace-navigation"
        className="classic-sidebar"
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile || undefined}
        aria-label={tr("ERP modules")}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || mobile || !expanded) return;
          const trigger = navigation.current?.querySelector<HTMLElement>(
            `[data-testid="nav-${expanded}"]`,
          );
          setExpanded("");
          trigger?.focus();
        }}
      >
        <div className="classic-sidebar-brand">
          <Link href="/dashboard" aria-label="ODIN ERP" onClick={closeAfterNavigation}>
            <Brand compact />
          </Link>
          <Button
            className="classic-drawer-close"
            aria-label={tr("Close navigation")}
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </Button>
        </div>

        <div className="classic-workspace-context" title={refs?.tenant?.name || ""}>
          <Building2 size={19} />
          <span>
            <small>{tr("Current company")}</small>
            <strong>{refs?.tenant?.name || "—"}</strong>
          </span>
        </div>

        <nav className="classic-nav-scroll" aria-label={tr("ERP modules")}>
          {navigationGroups.map((group) => {
            const groupModules = group.modules
              .map((id) => visibleById.get(id))
              .filter(Boolean) as ModuleDefinition[];
            if (!groupModules.length) return null;
            return (
              <section className="classic-nav-group" key={group.label}>
                <h2>{tr(group.label)}</h2>
                <ul>
                  {groupModules.map((module) => {
                    const Icon = icons[module.id];
                    const children = moduleChildren(module);
                    const selected = current.module.id === module.id;
                    const open = expanded === module.id;
                    const label = tr(sidebarLabels[module.id] || module.label);
                    return (
                      <li
                        className={`classic-nav-module ${selected ? "selected" : ""}`}
                        key={module.id}
                      >
                        {children.length === 1 ? (
                          <Link
                            className="classic-nav-row"
                            data-testid={`nav-${module.id}`}
                            href={children[0].route}
                            aria-current={selected ? "page" : undefined}
                            aria-label={label}
                            onClick={closeAfterNavigation}
                          >
                            <Icon size={19} />
                            <span className="classic-nav-label">{label}</span>
                            <span className="classic-tooltip" aria-hidden="true">
                              {label}
                            </span>
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className="classic-nav-row"
                            data-testid={`nav-${module.id}`}
                            aria-expanded={open}
                            aria-controls={`classic-pages-${module.id}`}
                            aria-label={label}
                            onClick={() => setExpanded(open ? "" : module.id)}
                          >
                            <Icon size={19} />
                            <span className="classic-nav-label">{label}</span>
                            <ChevronDown size={15} />
                            <span className="classic-tooltip" aria-hidden="true">
                              {label}
                            </span>
                          </button>
                        )}

                        {children.length > 1 && open ? (
                          <div
                            className="classic-nav-children"
                            id={`classic-pages-${module.id}`}
                          >
                            <strong>{label}</strong>
                            {children.map((child) => {
                              const childActive =
                                current.child.id === child.id || route === child.route;
                              return (
                                <Link
                                  href={child.route}
                                  key={child.id}
                                  data-testid={`nav-${child.id}`}
                                  aria-current={childActive ? "page" : undefined}
                                  onClick={closeAfterNavigation}
                                >
                                  <span>{tr(child.label)}</span>
                                  <ChevronRight size={14} />
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </nav>

        <div className="classic-sidebar-footer">
          <Button
            className="classic-collapse-control"
            data-testid="sidebar-collapse"
            aria-label={tr(collapsed ? "Expand sidebar" : "Collapse sidebar")}
            aria-pressed={collapsed}
            onClick={() => setSidebarCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>{tr(collapsed ? "Expand sidebar" : "Collapse sidebar")}</span>
          </Button>
        </div>
      </aside>

      {mobile ? (
        <button
          className="classic-sidebar-backdrop"
          aria-label={tr("Close navigation")}
          tabIndex={-1}
          onClick={() => setMobile(false)}
        />
      ) : null}

      <div className="classic-main" inert={mobile}>
        <header className="classic-toolbar">
          <button
            ref={menuButton}
            className="btn classic-menu-control"
            aria-label={tr("Menu")}
            aria-expanded={mobile}
            aria-controls="workspace-navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={20} />
          </button>
          <Button
            className="classic-toolbar-collapse"
            data-testid="sidebar-toggle"
            aria-label={tr(collapsed ? "Expand sidebar" : "Collapse sidebar")}
            aria-pressed={collapsed}
            onClick={() => setSidebarCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </Button>

          <nav className="classic-page-context" aria-label={tr("Breadcrumbs")}>
            {route === "/dashboard" ? (
              <strong>{tr("Dashboard")}</strong>
            ) : (
              <>
                <Link
                  href={
                    current.module.children.find((child) => allowed(child.permission))
                      ?.route || "/dashboard"
                  }
                >
                  {tr(sidebarLabels[current.module.id] || current.module.label)}
                </Link>
                <ChevronRight size={13} />
                <strong>{tr(current.child.label)}</strong>
              </>
            )}
          </nav>

          <div className="classic-toolbar-actions">
            <Button
              className="classic-search-trigger"
              aria-label={tr("Search pages")}
              onClick={() => setSearchOpen(true)}
            >
              <Search size={17} />
              <span>{tr("Search anything…")}</span>
            </Button>
            <ThemeToggle compact />
            <Button
              className="classic-language-control"
              data-testid="language-toggle"
              aria-label={tr(
                language === "en" ? "Switch to Arabic" : "Switch to English",
              )}
              title={tr(
                language === "en" ? "Switch to Arabic" : "Switch to English",
              )}
              onClick={changeLanguage}
            >
              <Globe size={17} />
              <span>{language === "en" ? "English" : "العربية"}</span>
              <ChevronDown size={13} />
            </Button>
            <details className="account-menu classic-account-menu">
              <summary aria-label={tr("Account menu")}>
                <span className="initials">{user.name.slice(0, 2)}</span>
                <span className="account-name">{user.name}</span>
                <ChevronDown size={13} />
              </summary>
              <div className="account-menu-panel">
                <div className="account-menu-identity">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </div>
                <Link href="/my-profile">{tr("My Profile")}</Link>
                <div className="account-appearance">
                  <span>{tr("Appearance")}</span>
                  <ThemeToggle variant="selector" />
                </div>
                <Button onClick={endSession}>
                  <LogOut size={16} />
                  {tr("Sign out")}
                </Button>
              </div>
            </details>
          </div>
        </header>

        <div className="classic-workspace">
          <main id="main">
            {!allowed(current.child.permission) ? (
              <div className="denied">
                <ClipboardCheck size={32} />
                <h1>{tr("Access Denied")}</h1>
                <p>
                  {tr(
                    "Your role does not include the required permission. Contact your Super Admin if you need access.",
                  )}
                </p>
                <code>{route}</code>
              </div>
            ) : route === "/my-profile" ? (
              <Screens route={route} />
            ) : error ? (
              <ErrorNotice message={error} retry={refreshRefs} />
            ) : !refs ? (
              <Loading label="Loading secured company data…" />
            ) : (
              <Screens key={`${route}-${user.userId || user.id}`} route={route} />
            )}
          </main>
        </div>
      </div>

      {searchOpen ? (
        <Dialog title="Search pages" close={() => setSearchOpen(false)}>
          <div
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "Enter") return;
              event.preventDefault();
              const first = event.currentTarget.nextElementSibling?.querySelector<HTMLAnchorElement>(
                "a",
              );
              if (event.key === "Enter") first?.click();
              else first?.focus();
            }}
          >
            <SearchField label="Search pages" value={query} onChange={setQuery} />
          </div>
          <div className="glass-search-results">
            {!destinations.length ? (
              <>
                <Empty
                  filtered
                  description="Try an English or Arabic page name."
                />
                <Button onClick={() => setQuery("")}>{tr("Clear search")}</Button>
              </>
            ) : null}
            {destinations.map(({ module, child }) => (
              <Link
                href={child.route}
                key={child.route}
                onClick={() => setSearchOpen(false)}
              >
                <span>
                  {tr(child.label)}
                  <small>{tr(module.label)}</small>
                </span>
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        </Dialog>
      ) : null}

      <div className="notices" aria-live="polite">
        {notices.map((notice: any) => (
          <div
            key={notice.id}
            role={notice.error ? "alert" : "status"}
            className={notice.error ? "notice error" : "notice"}
          >
            {tr(notice.message)}
          </div>
        ))}
      </div>
    </div>
  );
}
