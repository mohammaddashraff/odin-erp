"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./session-provider";
import { cairoToday } from './cairo-time';
import {
  normalizeWesternInputCapture,
  canonicalNumericPayload,
  useWesternInputLocaleBoundary,
} from "./numeric-input";
import { canAccess, displayPermissionsFor } from "./navigation";
import { t, enumLabel, localizeError, type Language } from "./i18n";
import {
  formatCurrency,
  formatQuantity,
  formatDate,
  formatDateTime,
} from "./formatters";

export type RecordData = Record<string, any>;
export type Requester = (path: string, options?: RequestInit) => Promise<any>;
const Context = createContext<any>(null);
export function ERPProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage: Language;
}) {
  const session = useSession();
  useWesternInputLocaleBoundary();
  const router = useRouter();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [refs, setRefs] = useState<RecordData | null>(null);
  const [error, setError] = useState("");
  const [notices, setNotices] = useState<
    { id: number; message: string; error: boolean; owner: unknown }[]
  >([]);
  const generation = useRef(0);
  const referenceOwner = useRef<any>(null);
  const referenceLanguage = useRef<Language>(initialLanguage);
  const notify = useCallback(
    (message: string, error = false) => {
      const id = Date.now() + Math.random();
      setNotices((current) => [
        ...current.filter((n) => n.owner === session.user),
        { id, message, error, owner: session.user },
      ]);
      setTimeout(
        () => setNotices((current) => current.filter((n) => n.id !== id)),
        6500,
      );
    },
    [session.user],
  );
  const request: Requester = useCallback(
    async (path, options = {}) => {
      const response = await session.authorizedFetch(`/api${path}`, {
        cache: "no-store",
        ...options,
        ...(typeof options.body === "string"
          ? { body: canonicalNumericPayload(options.body) }
          : {}),
        headers: {
          ...(options.body && !(options.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          "Accept-Language": language,
          "X-Odin-Language": language,
          ...options.headers,
        },
      });
      const payload = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : await response.text();
      if (!response.ok)
        throw Object.assign(
          new Error(
            language === 'ar' && payload?.messageAr
              ? payload.messageAr
              : localizeError(payload?.message || payload?.error || String(payload), language),
          ),
          { status: response.status, field: payload?.field, details: payload },
        );
      return payload;
    },
    [session.authorizedFetch, language],
  );
  const refreshRefs = useCallback(async () => {
    const version = ++generation.current;
    setError("");
    try {
      const result = await request("/bootstrap");
      if (version === generation.current) {
        referenceOwner.current = session.user;
        referenceLanguage.current = language;
        setRefs(result);
      }
    } catch (reason: any) {
      if (version === generation.current) setError(reason.message);
    }
  }, [request]);
  useEffect(() => {
    setRefs(null);
    ++generation.current;
    if (session.user && !session.user.passwordChangeRequired) void refreshRefs();
    return () => {
      ++generation.current;
    };
  }, [session.user, refreshRefs]);
  const allowContextChange = () =>
    window.dispatchEvent(
      new Event("odin:before-context-change", { cancelable: true }),
    );
  const changeLanguage = () => {
    if (!allowContextChange()) return;
    const next = language === "en" ? "ar" : "en";
    setLanguage(next);
    localStorage.setItem("av8_language", next);
    document.cookie = `av8_language=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    router.refresh();
  };
  const permissions = session.user ? displayPermissionsFor(session.user) : [];
  const allowed = (permission: string | readonly string[]) =>
    permission === "authenticated" ? !!session.user : canAccess(permissions, permission);
  const field = (resource: string, name: string) =>
    allowed("system.super_admin")
      ? "EDIT"
      : session.user?.fieldPermissions?.find(
          (f: any) => f.resource === resource && f.field === name,
        )?.access || "HIDDEN";
  const download = async (path: string, filename: string) => {
    const response = await session.authorizedFetch(`/api${path}`, {
      headers: { "Accept-Language": language, "X-Odin-Language": language },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(
        localizeError(result.message || "Export failed", language),
      );
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const value = {
    ...session,
    endSession: () => {
      if (allowContextChange()) session.endSession();
    },
    refs:
      referenceOwner.current === session.user &&
      referenceLanguage.current === language
        ? refs
        : null,
    error,
    refreshRefs,
    request,
    notify,
    notices: notices.filter((n) => n.owner === session.user),
    language,
    changeLanguage,
    permissions,
    allowed,
    field,
    download,
    tr: (value: string) => enumLabel(value, language),
    label: (value: string) => enumLabel(value, language),
    money: (value: unknown, currency = refs?.tenant?.baseCurrency || "EGP") =>
      value === undefined
        ? t("Restricted", language)
        : value === null
          ? "—"
          : formatCurrency(value, currency, language),
    quantity: (value: unknown) =>
      value == null ? "—" : formatQuantity(value, language),
    date: (value: string) => formatDate(value, language),
    dateTime: (value: string) => formatDateTime(value, language),
    name: (value: any) =>
      (language === "ar" && value?.nameAr) || t(value?.name || "—", language),
  };
  return (
    <Context.Provider value={value}>
      <div className="erp-root" onInputCapture={normalizeWesternInputCapture}>
        {children}
      </div>
    </Context.Provider>
  );
}
export function useERP(): any {
  const value = useContext(Context);
  if (!value) throw new Error("ERPProvider required");
  return value;
}
export function useResource<T = any>(path: string | null) {
  const { request } = useERP();
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
    path: string | null;
    requester: Requester | null;
  }>({ data: null, error: "", loading: true, path: null, requester: null });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({
      data: null,
      error: "",
      loading: !!path,
      path,
      requester: request,
    });
    if (path)
      request(path, { signal: controller.signal })
        .then((data: T) => {
          if (!controller.signal.aborted)
            setState({
              data,
              error: "",
              loading: false,
              path,
              requester: request,
            });
        })
        .catch((error: Error) => {
          if (!controller.signal.aborted)
            setState({
              data: null,
              error: error.message,
              loading: false,
              path,
              requester: request,
            });
        });
    return () => controller.abort();
  }, [path, request, version]);
  const current = state.path === path && state.requester === request;
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    loading: current ? state.loading : !!path,
    reload,
  };
}
export const today = cairoToday;
export function decimal(value: any, scale = 2) {
  if (value === undefined || value === null) return "";
  const n = BigInt(value);
  const abs = n < 0n ? -n : n;
  const unit = 10n ** BigInt(scale);
  return `${n < 0n ? "-" : ""}${abs / unit}.${String(abs % unit).padStart(scale, "0")}`;
}
export function fixed(value: string, scale = 2) {
  const match = String(value)
    .replace(/,/g, "")
    .match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!match) return 0n;
  return (
    (match[1] ? -1n : 1n) *
    BigInt(
      (match[2] || "0") + (match[3] || "").padEnd(scale, "0").slice(0, scale),
    )
  );
}
