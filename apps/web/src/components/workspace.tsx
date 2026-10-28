"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Store,
  Landmark,
  WalletCards,
  ReceiptText,
  ShieldCheck,
  ChartNoAxesCombined,
  Settings,
  ClipboardCheck,
  Menu,
  ChevronDown,
  LogOut,
  Globe,
  X,
  Search,
  ArrowRight,
} from "lucide-react";
import { modules, allRoutes, routeEntry } from "../core/navigation";
import { useERP } from "../core/erp-context";
import { Brand, Button, Dialog, SearchField, ErrorNotice, Loading, Empty } from "./ui";
import { t } from '../core/i18n';
import Login from "./login";
import ThemeToggle from './theme-toggle';
import Screens from "../screens";
import { PasswordChange } from "../screens/administration";
const icons = {
  av8: Users,
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
  const [expanded, setExpanded] = useState("");
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigation = useRef<HTMLElement>(null);
  const measurements = useRef<HTMLDivElement>(null);
  const [fitCount, setFitCount] = useState(2);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const nav = navigation.current, measure = measurements.current;
    if (!nav || !measure) return;
    const fit = () => {
      const widths = Array.from(measure.children, e => e.getBoundingClientRect().width);
      const more = widths.pop() || 110;
      const available = nav.clientWidth;
      let used = 0, count = 0;
      for (const width of widths) {
        const reserve = count === widths.length - 1 ? 0 : more + 6;
        if (used + width + reserve > available) break;
        used += width + 6; count++;
      }
      setFitCount(Math.max(1, count));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(nav); observer.observe(measure); fit();
    return () => observer.disconnect();
  }, [status, user, language]);
  useEffect(() => {
    setExpanded("");
    setMobile(false);
    setSearchOpen(false);
  }, [route]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 801px)");
    const closeDrawer = () => {
      if (desktop.matches) setMobile(false);
    };
    desktop.addEventListener("change", closeDrawer);
    return () => desktop.removeEventListener("change", closeDrawer);
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!navigation.current?.contains(event.target as Node)) setExpanded("");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigation.current?.querySelector<HTMLElement>("button, a")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobile(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(navigation.current?.querySelectorAll<HTMLElement>(
          "a[href],button",
        ) || []),
      ].filter((e) => e.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
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
      if (menuButton.current?.getClientRects().length)
        menuButton.current.focus();
      else if (previous.isConnected) previous.focus();
    };
  }, [mobile]);
  if (status === "restoring")
    return (
      <div className="session-loading">
        <Brand />
        <Loading label="Restoring your session…" />
      </div>
    );
  if (!user) return <Login />;
  if (user.passwordChangeRequired)
    return (
      <div className="temporary-password-page">
        <Brand />
        <PasswordChange required />
        <Button onClick={endSession}>{tr("Sign out")}</Button>
      </div>
    );
  const order = [
    "command",
    "av8",
    "sales",
    "inventory",
    "purchasing",
    "accounting",
    "banking",
    "approvals",
    "reports",
    "hr",
    "pos",
    "admin",
  ];
  const visible = [...modules]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .filter((m) => m.children.some((c) => allowed(c.permission)));
  const activeModule = visible.find((m) => m.id === expanded);
  const destinations = allRoutes.filter(
    ({ child }) =>
      allowed(child.permission) &&
      [t(child.label,'en'), t(child.label,'ar'), child.route.replaceAll('/',' ')].some(label => label.normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase())),
  );
  return (
    <div className="glass-shell">
      <a className="skip" href="#main">
        {tr("Skip to content")}
      </a>
      <header className="glass-header context-bar" inert={mobile}>
        <Link
          href="/dashboard"
          className="glass-brand-link"
          aria-label="ODIN ERP"
        >
          <Brand />
        </Link>
        <div className="company-context">
          <span>{tr("Current company")}</span>
          <strong>
            {tr(
              (refs?.tenant?.name || "—").replace(
                /\s*·?\s*isolated workspace/i,
                "",
              ),
            )}
          </strong>
        </div>
        <div className="context-actions">
          <Button
            className="round-control"
            aria-label={tr("Search pages")}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={19} />
          </Button>
          <Button data-testid="language-toggle" aria-label={tr(language === 'en' ? 'Switch to Arabic' : 'Switch to English')} title={tr(language === 'en' ? 'Switch to Arabic' : 'Switch to English')} onClick={changeLanguage}>
            <Globe size={18} />
            <span>{language === "en" ? "العربية" : "English"}</span>
          </Button>
          <details className="account-menu">
            <summary aria-label={tr("Account menu")}>
              <span className="initials">{user.name.slice(0, 2)}</span>
              <span className="account-name">{user.name}</span>
              <ChevronDown size={14} />
            </summary>
            <div className="account-menu-panel">
              <Link href="/my-profile">{tr("My Profile")}</Link>
              <ThemeToggle/>
              <Button onClick={endSession}>
                <LogOut size={16} />
                {tr("Sign out")}
              </Button>
            </div>
          </details>
          <button
            ref={menuButton}
            className="btn glass-menu-toggle"
            aria-label={tr("Menu")}
            aria-expanded={mobile}
            aria-controls="workspace-navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>
      {mobile ? (
        <button
          className="glass-nav-scrim"
          aria-label={tr("Close")}
          tabIndex={-1}
          onClick={() => setMobile(false)}
        />
      ) : null}
      <nav
        ref={navigation}
        id="workspace-navigation"
        className={`glass-navigation ${mobile ? "is-open" : ""}`}
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile ? true : undefined}
        aria-label={tr("ERP modules")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            const trigger = navigation.current?.querySelector<HTMLElement>(
              '[aria-expanded="true"]',
            );
            setExpanded("");
            trigger?.focus();
          }
        }}
      >
        <div ref={measurements} className="glass-nav-measure" aria-hidden="true" inert>
          {visible.map(m => {const Icon=icons[m.id];return <span key={m.id} className="glass-nav-item"><Icon size={19}/><span>{tr(m.id==='command'?'Dashboard Overview':m.label)}</span>{m.children.filter(c=>allowed(c.permission)).length>1?<ChevronDown size={14}/>:null}</span>;})}
          <span className="glass-nav-item"><Menu size={19}/>{tr('More')}<ChevronDown size={14}/></span>
        </div>
        <div className="glass-mobile-title">
          <Brand />
          <Button
            aria-label={tr("Close navigation")}
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </Button>
        </div>
        <div className="glass-nav-items">
          {visible.map((m, index) => {
            const Icon = icons[m.id],
              children = m.children.filter((c) => allowed(c.permission)),
              selected = m.id === current.module.id;
            const label =
              m.id === "command" ? tr("Dashboard Overview") : tr(m.label);
            return children.length === 1 ? (
              <Link
                key={m.id}
                className={`glass-nav-item ${selected ? "selected" : ""} ${index >= fitCount ? "glass-nav-overflow" : ""}`}
                data-testid={`nav-${m.id}`}
                href={children[0].route}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMobile(false)}
              >
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            ) : (
              <button
                key={m.id}
                type="button"
                className={`glass-nav-item ${selected ? "selected" : ""} ${index >= fitCount ? "glass-nav-overflow" : ""}`}
                data-testid={`nav-${m.id}`}
                aria-expanded={expanded === m.id}
                aria-controls={
                  expanded === m.id ? "glass-module-pages" : undefined
                }
                onClick={() => setExpanded(expanded === m.id ? "" : m.id)}
              >
                <Icon size={19} />
                <span>{label}</span>
                <ChevronDown size={14} />
              </button>
            );
          })}
          {visible.length > fitCount ? (
            <button
              className={`glass-nav-item glass-more ${visible.slice(fitCount).some((m) => m.id === current.module.id) ? "selected" : ""}`}
              aria-expanded={expanded === "more"}
              aria-controls={
                expanded === "more" ? "glass-more-pages" : undefined
              }
              onClick={() => setExpanded(expanded === "more" ? "" : "more")}
            >
              <Menu size={19} />
              {tr("More")}
              <ChevronDown size={14} />
            </button>
          ) : null}
        </div>
        {expanded === "more" ? (
          <div id="glass-more-pages" className="glass-module-pages">
            <div>
              {visible.slice(fitCount).map((m) => (
                <section key={m.id}>
                  <h2>{tr(m.label)}</h2>
                  {m.children
                    .filter((c) => allowed(c.permission))
                    .map((c) => (
                      <Link
                        href={c.route}
                        key={c.id}
                        data-testid={`nav-${c.id}`}
                        aria-current={route === c.route ? 'page' : undefined}
                        onClick={() => setExpanded("")}
                      >
                        {tr(c.label)}
                        <ArrowRight size={14} />
                      </Link>
                    ))}
                </section>
              ))}
            </div>
          </div>
        ) : null}
        {activeModule ? (
          <div id="glass-module-pages" className="glass-module-pages">
            <strong>{tr(activeModule.label)}</strong>
            <div>
              {activeModule.id === "av8" && allowed("av8.workspace.view") ? (
                <Link
                  href="/dashboard?view=daily"
                  onClick={() => {
                    setExpanded("");
                    setMobile(false);
                  }}
                >
                  {tr("Daily workspace")}
                  <ArrowRight size={15} />
                </Link>
              ) : null}
              {activeModule.children
                .filter((c) => allowed(c.permission))
                .map((c) => (
                  <Link
                    key={c.id}
                    href={c.route}
                    data-testid={`nav-${c.id}`}
                    aria-current={route === c.route ? "page" : undefined}
                    onClick={() => {
                      setExpanded("");
                      setMobile(false);
                    }}
                  >
                    {tr(c.label)}
                    <ArrowRight size={15} />
                  </Link>
                ))}
            </div>
          </div>
        ) : null}
      </nav>
      <div className="glass-workspace" inert={mobile}>
        <main id="main">
          {route !== "/dashboard" ? (
            <nav className="breadcrumbs" aria-label={tr("Breadcrumbs")}>
              <Link href="/dashboard">{tr("Dashboard Overview")}</Link>
              <span>/</span>
              <Link
                href={
                  current.module.children.find((c) => allowed(c.permission))
                    ?.route || "/dashboard"
                }
              >
                {tr(current.module.label)}
              </Link>
              <span>/</span>
              <strong>{tr(current.child.label)}</strong>
            </nav>
          ) : null}
          {!allowed(current.child.permission) ? (
            <div className="denied">
              <ShieldCheck size={32} />
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
      {searchOpen ? (
        <Dialog title="Search pages" close={() => setSearchOpen(false)}>
          <div onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='Enter'){event.preventDefault();const first=event.currentTarget.nextElementSibling?.querySelector<HTMLAnchorElement>('a');if(event.key==='Enter')first?.click();else first?.focus();}}}><SearchField label="Search pages" value={query} onChange={setQuery} /></div>
          <div className="glass-search-results">
            {!destinations.length?<><Empty filtered description="Try an English or Arabic page name."/><Button onClick={()=>setQuery('')}>{tr('Clear search')}</Button></>:null}
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
        {notices.map((n: any) => (
          <div
            key={n.id}
            role={n.error ? "alert" : "status"}
            className={n.error ? "notice error" : "notice"}
          >
            {tr(n.message)}
          </div>
        ))}
      </div>
    </div>
  );
}
