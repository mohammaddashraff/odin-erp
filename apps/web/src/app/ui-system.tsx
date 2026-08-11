'use client';

import { useEffect } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, FormEvent, ReactNode } from 'react';
import { normalizeWesternDigits, normalizeWesternNumberInput } from './formatters';
import type { Language } from './i18n';
import { t } from './i18n';
import { AppIcon, type IconName } from './ui-icons';

export type SemanticTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'analytics' | 'neutral';

const statusTones: Record<string, SemanticTone> = {
  ACTIVE: 'success', OPEN: 'success', APPROVED: 'success', POSTED: 'success', COMPLETED: 'success', MATCHED: 'success', GRANT: 'success',
  DRAFT: 'neutral', INACTIVE: 'neutral', CLOSED: 'neutral', CANCELLED: 'neutral', VOID: 'neutral',
  SUBMITTED: 'warning', PENDING: 'warning', HELD: 'warning', UNMATCHED: 'warning', REVIEW: 'warning',
  REJECTED: 'danger', FAILED: 'danger', DENY: 'danger', OVERDUE: 'danger', BLOCKED: 'danger',
  INFO: 'info', RECEIPT: 'info', PAYMENT: 'info', CASH: 'info', CARD: 'info', BANK: 'info',
};

export function statusTone(value: string): SemanticTone {
  return statusTones[String(value || '').toUpperCase()] || 'brand';
}

export function NumericValue({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={`western-digits ${className}`.trim()}>{normalizeWesternDigits(children)}</bdi>;
}

/**
 * One product-level input boundary for typed/pasted Arabic or Persian digits.
 * Arabic text is untouched; decimal/group separator normalization is limited
 * to controls that explicitly declare numeric intent.
 */
export function normalizeWesternInputCapture(event: FormEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const numeric = target.matches('input[type="number"], input[type="tel"], input[inputmode="numeric"], input[inputmode="decimal"]');
  const normalized = numeric ? normalizeWesternNumberInput(target.value) : normalizeWesternDigits(target.value);
  if (normalized === target.value) return;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  target.value = normalized;
  if (selectionStart !== null && selectionEnd !== null) target.setSelectionRange(selectionStart, selectionEnd);
}

const westernInputLocaleSelector = [
  'input[type="number"]',
  'input[type="date"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="week"]',
  'input[type="time"]',
  'input[type="tel"]',
  'input[inputmode="numeric"]',
  'input[inputmode="decimal"]',
  'input[inputmode="tel"]',
].join(',');

/**
 * Native numeric and date controls inherit the document language, so an
 * Arabic page can otherwise paint Arabic-Indic glyphs inside browser chrome.
 * Apply an English/LTR locale boundary to the controls themselves while their
 * labels and surrounding form continue to inherit the application's RTL flow.
 * The observer covers drawers and dialogs mounted after the initial render.
 */
export function useWesternInputLocaleBoundary() {
  useEffect(() => {
    const apply = (root: ParentNode) => {
      const controls: HTMLInputElement[] = [];
      if (root instanceof HTMLInputElement && root.matches(westernInputLocaleSelector)) controls.push(root);
      controls.push(...root.querySelectorAll<HTMLInputElement>(westernInputLocaleSelector));
      for (const control of controls) {
        control.lang = 'en';
        control.dir = 'ltr';
      }
    };

    apply(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) apply(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

export function InlineSpinner({ label }: { label?: string }) {
  return <span className="inline-spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}/>;
}

export function LoadingButton({ loading = false, loadingLabel = 'Saving…', icon, children, className = '', disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  icon?: IconName;
}) {
  return <button className={className} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    <span className="loading-button-content">
      <span className="loading-button-idle" aria-hidden={loading || undefined}>{icon ? <AppIcon name={icon}/> : null}{children}</span>
      <span className="loading-button-busy" aria-hidden={!loading}><InlineSpinner/>{loadingLabel}</span>
    </span>
  </button>;
}

export function SkeletonBlock({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`skeleton-block ${className}`.trim()} style={style} aria-hidden="true"/>;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return <div className="table-skeleton" aria-hidden="true">
    <div className="skeleton-table-row skeleton-table-head">{Array.from({ length: columns }, (_, column) => <SkeletonBlock key={column}/>)}</div>
    {Array.from({ length: rows }, (_, row) => <div className="skeleton-table-row" key={row}>{Array.from({ length: columns }, (_, column) => <SkeletonBlock key={column} className={column === 0 ? 'skeleton-emphasis' : ''}/>)}</div>)}
  </div>;
}

export function ChartSkeleton() {
  return <div className="chart-skeleton" aria-hidden="true"><div className="skeleton-chart-bars">{[62, 38, 78, 51, 86, 68].map((height, index) => <SkeletonBlock key={index} className="skeleton-chart-bar" style={{ '--skeleton-height': `${height}%` } as CSSProperties}/>)}</div><SkeletonBlock className="skeleton-chart-axis"/></div>;
}

export function FormSkeleton() {
  return <div className="form-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <label key={index}><SkeletonBlock className="skeleton-label"/><SkeletonBlock className="skeleton-input"/></label>)}</div>;
}

export function PageSkeleton({ variant = 'page', label = 'Loading…' }: { variant?: 'page' | 'dashboard' | 'table' | 'form' | 'report' | 'detail'; label?: string }) {
  return <section className={`page page-skeleton page-skeleton-${variant}`} role="status" aria-live="polite" aria-label={label}>
    <div className="skeleton-page-head"><div><SkeletonBlock className="skeleton-title"/><SkeletonBlock className="skeleton-subtitle"/></div><SkeletonBlock className="skeleton-action"/></div>
    {variant === 'dashboard' ? <><div className="skeleton-metric-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index}><SkeletonBlock className="skeleton-icon"/><SkeletonBlock className="skeleton-label"/><SkeletonBlock className="skeleton-value"/><SkeletonBlock className="skeleton-meta"/></div>)}</div><div className="skeleton-dashboard-grid"><div className="skeleton-panel"><ChartSkeleton/></div><div className="skeleton-panel"><TableSkeleton rows={4} columns={3}/></div></div></> : null}
    {variant === 'form' ? <div className="skeleton-panel"><FormSkeleton/></div> : null}
    {variant === 'report' ? <><div className="skeleton-report-controls"><SkeletonBlock/><SkeletonBlock/><SkeletonBlock/></div><div className="skeleton-panel"><ChartSkeleton/><TableSkeleton rows={5} columns={6}/></div></> : null}
    {variant === 'detail' ? <div className="skeleton-detail-grid"><div className="skeleton-panel"><FormSkeleton/></div><div className="skeleton-panel"><TableSkeleton rows={5} columns={3}/></div></div> : null}
    {(variant === 'page' || variant === 'table') ? <><div className="skeleton-metric-grid compact">{Array.from({ length: 4 }, (_, index) => <div className="skeleton-card" key={index}><SkeletonBlock className="skeleton-label"/><SkeletonBlock className="skeleton-value"/></div>)}</div><div className="skeleton-panel"><TableSkeleton rows={variant === 'table' ? 8 : 5} columns={6}/></div></> : null}
    <span className="sr-only">{label}</span>
  </section>;
}

export function RouteTransition({ route, busy, children }: { route: string; busy?: boolean; children: ReactNode }) {
  return <div key={route} className="route-transition" aria-busy={busy || undefined}>{children}</div>;
}

export function NavigationProgress({ active, language }: { active: boolean; language: Language }) {
  return <div className={`navigation-progress ${active ? 'active' : ''}`} role={active ? 'status' : undefined} aria-label={active ? t('Loading page…', language) : undefined}><span/></div>;
}

export function ToastNotice({ error, text, language }: { error?: boolean; text: string; language: Language }) {
  const heading = error ? 'Action blocked' : 'Completed';
  return <div className="toast" data-tone={error ? 'danger' : 'success'} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
    <span className="toast-icon"><AppIcon name={error ? 'error' : 'success'} size={17}/></span>
    <span><strong>{t(heading, language)}</strong><small>{t(text, language)}</small></span>
  </div>;
}

export type ChartDatum = { label: string; value: string | number | bigint; displayValue: string; tone: SemanticTone };

const chartMagnitude = (value: ChartDatum['value']) => {
  try {
    if (typeof value === 'bigint') return value < 0n ? -value : value;
    const normalized = String(value).trim();
    if (/^-?\d+$/.test(normalized)) {
      const integer = BigInt(normalized);
      return integer < 0n ? -integer : integer;
    }
    const numeric = Number(normalized);
    return BigInt(Math.round(Number.isFinite(numeric) ? Math.abs(numeric) : 0));
  } catch { return 0n; }
};

export function CompositionChart({ data, language, title = 'Current balance composition' }: { data: ChartDatum[]; language: Language; title?: string }) {
  const magnitudes = data.map((datum) => chartMagnitude(datum.value));
  const maximum = magnitudes.reduce((largest, value) => value > largest ? value : largest, 1n);
  return <figure className="composition-chart" aria-label={t(title, language)}>
    <div className="composition-bars">{data.map((datum, index) => {
      // Integer proportional math keeps ledger-sized values exact; conversion
      // to Number happens only after the result has been clamped to 8..100.
      const height = Math.max(8, Number(magnitudes[index] * 100n / maximum));
      return <div className="composition-column" data-tone={datum.tone} key={datum.label}>
        <div className="composition-value"><NumericValue>{datum.displayValue}</NumericValue></div>
        <span className="composition-track"><i style={{ '--bar-size': `${height}%` } as CSSProperties}/></span>
        <strong>{t(datum.label, language)}</strong>
      </div>;
    })}</div>
    <figcaption>{t('A current-state comparison of posted balances; this is not a historical trend.', language)}</figcaption>
  </figure>;
}
