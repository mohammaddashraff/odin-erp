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
  Pin,
  X,
} from "lucide-react";
import { modules, routeEntry } from "../core/navigation";
import { useERP } from "../core/erp-context";
import { Brand, Button, ErrorNotice, Loading } from "./ui";
import Login from "./login";
import Screens from "../screens";
import { PasswordChange } from "../screens/administration";
const icons: any = {
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
  const [expanded, setExpanded] = useState<string>(current.module.id);
  const [mobile, setMobile] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [sidebarKeyboardFocused, setSidebarKeyboardFocused] = useState(false);
  const sidebarCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinned,setPinned]=useState(false);
  useEffect(()=>{setPinned(localStorage.getItem('av8_sidebar_pinned')==='true');},[]);
  const navigation = useRef<HTMLElement>(null);
  const cancelSidebarClose = () => {
    if (sidebarCloseTimer.current) clearTimeout(sidebarCloseTimer.current);
    sidebarCloseTimer.current = null;
  };
  useEffect(() => () => {
    if (sidebarCloseTimer.current) clearTimeout(sidebarCloseTimer.current);
  }, []);
  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setNarrow(viewport.matches);
      setSidebarHovered(false);
      setSidebarKeyboardFocused(false);
      if (!viewport.matches) setMobile(false);
    };
    update();
    viewport.addEventListener("change", update);
    return () => viewport.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile || !narrow) return;
    const panel = navigation.current;
    if (!panel) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ),
      ].filter((element) => element.getClientRects().length > 0);
    (
      panel.querySelector<HTMLElement>(".nav-module.selected") || controls()[0]
    )?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobile(false);
      } else if (event.key === "Tab") {
        const elements = controls();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !panel.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      if (opener?.isConnected) opener.focus();
    };
  }, [mobile, narrow]);
  // Desktop navigation stays compact until it is hovered or focused. This keeps
  // the workspace wide without making people remember a persistent toggle.
  const compact = !narrow && !sidebarHovered && !sidebarKeyboardFocused && !pinned;
  if (status === "restoring")
    return (
      <div className="session-loading">
        <Brand />
        <Loading label="Restoring your session…" />
      </div>
    );
  if (!user) return <Login />;
  if (user.passwordChangeRequired) return <div className="temporary-password-page"><Brand/><PasswordChange required/><Button onClick={endSession}>{tr('Sign out')}</Button></div>;
  const visible = modules.filter((m) =>
    !["sales","purchasing","inventory","pos","hr","reports"].includes(m.id) && m.children.some((c) => allowed(c.permission)),
  );
  return (
    <div className={`erp-shell ${compact ? "compact" : ""}`}>
      <a className="skip" href="#main">
        {tr("Skip to content")}
      </a>
      {mobile ? (
        <button
          className="nav-scrim"
          tabIndex={-1}
          aria-label={tr("Close")}
          onClick={() => setMobile(false)}
        />
      ) : null}
      <aside
        ref={navigation}
        className={`navigation ${mobile ? "mobile-open" : ""}`}
        inert={narrow && !mobile}
        role={narrow && mobile ? "dialog" : undefined}
        aria-modal={narrow && mobile ? true : undefined}
        aria-label={tr("ERP modules")}
        onMouseEnter={() => {
          cancelSidebarClose();
          if (!narrow) setSidebarHovered(true);
        }}
        onMouseLeave={() => {
          cancelSidebarClose();
          if (!narrow) {
            sidebarCloseTimer.current = setTimeout(() => setSidebarHovered(false), 140);
          }
        }}
        onPointerDownCapture={() => setSidebarKeyboardFocused(false)}
        onFocusCapture={(event) => {
          if (!narrow && event.target.matches(":focus-visible")) {
            setSidebarKeyboardFocused(true);
          }
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setSidebarKeyboardFocused(false);
          }
        }}
      >
        <div className="navigation-header">
          <Link href="/dashboard" className="nav-brand" aria-label="AV8 ERP · ODIN Software Solutions" onClick={() => setMobile(false)}>
            <Brand />
          </Link>
          <button
            type="button"
            className="navigation-control navigation-pin"
            aria-label={tr("Keep navigation open")}
            title={tr(pinned ? "Unpin navigation" : "Keep navigation open")}
            aria-pressed={pinned}
            onClick={() => {
              const next = !pinned;
              localStorage.setItem("av8_sidebar_pinned", String(next));
              setPinned(next);
            }}
          >
            <Pin size={16} aria-hidden="true" />
          </button>
          <button type="button" className="navigation-control navigation-close" aria-label={tr("Close navigation")} onClick={() => setMobile(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav id="workspace-navigation" aria-label={tr("ERP modules")}>
          {visible.map((m, index) => {
            const Icon = icons[m.id];
            const children = m.children.filter((c) => allowed(c.permission));
            return (
              <div className="nav-group" key={m.id}>
                {index === 0 || visible[index - 1].category !== m.category ? (
                  <h2>{tr(m.category.toUpperCase())}</h2>
                ) : null}
                <button
                  data-testid={`nav-${m.id}`}
                  className={`nav-module ${m.id === current.module.id ? "selected" : ""}`}
                  aria-expanded={children.length > 1 ? expanded === m.id : undefined}
                  aria-controls={children.length > 1 && expanded === m.id ? `nav-pages-${m.id}` : undefined}
                  title={tr(m.label)}
                  onClick={() => {
                    setExpanded(expanded !== m.id ? m.id : "");
                    if (children.length === 1) {
                      setMobile(false);
                      window.location.assign(children[0].route);
                    }
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{tr(m.label)}</span>
                  {children.length > 1 ? <ChevronDown size={14} aria-hidden="true" /> : null}
                </button>
                {expanded === m.id && children.length > 1 ? (
                  <div className="nav-pages" id={`nav-pages-${m.id}`} inert={compact}>
                    <div className="nav-page-list">
                      {children.map((c) => (
                        <Link
                          data-testid={`nav-${c.id}`}
                          href={c.route}
                          key={c.id}
                          aria-current={route === c.route ? "page" : undefined}
                          onClick={() => setMobile(false)}
                        >
                          {tr(c.label)}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="workspace" inert={narrow && mobile}>
        <header className="context-bar">
          <Button
            className="mobile-menu"
            aria-label={tr("Menu")}
            aria-expanded={mobile}
            aria-controls="workspace-navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu size={20} />
          </Button>
          <div className="company-context">
            <span>{tr("Current company")}</span>
            <strong>{tr((refs?.tenant?.name || '—').replace(/\s*·?\s*isolated workspace/i,''))}</strong>
          </div>
          <div className="context-actions">
            <Button data-testid="language-toggle" onClick={changeLanguage}>
              <Globe size={15} />
              {language === "en" ? "العربية" : "English"}
            </Button>
            <details className="account-menu">
              <summary aria-label={tr('Account menu')}><span className="initials" aria-hidden="true">{user.name.slice(0,2)}</span><span>{user.name}</span><ChevronDown size={15}/></summary>
              <div className="account-menu-panel"><Link href="/my-profile">{tr('My Profile')}</Link><Button onClick={endSession}><LogOut size={16}/>{tr('Sign out')}</Button></div>
            </details>
          </div>
        </header>
        <main id="main">
          <nav className="breadcrumbs" aria-label={tr("Breadcrumbs")}>
            <span>{tr(current.module.label)}</span>
            <span>/</span>
            <strong>{tr(current.child.label)}</strong>
          </nav>
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
