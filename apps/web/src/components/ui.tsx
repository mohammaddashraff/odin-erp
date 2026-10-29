"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  RefreshCw,
  X,
  Search,
  Download,
} from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { routeEntry } from "../core/navigation";
import { pageGuides } from "../core/ui-copy";
import { useERP } from "../core/erp-context";
import { cairoDateTime, cairoInstant } from '../core/cairo-time';
import {statusTone} from '../core/ui-presentation';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand av8-brand ${compact ? "brand-compact" : ""}`} dir="ltr">
      <span className="brand-mark">
        <Image className="brand-artwork" src="/brand/oss-geometric-eye-transparent.png" width={64} height={48} alt="" loading="eager" />
      </span>
      {compact ? (
        <strong className="brand-compact-name">ODIN ERP</strong>
      ) : (
        <span className="brand-copy">
          <strong>OSS<span className="brand-dot">.</span></strong>
          <span className="brand-product"><b>ODIN ERP</b><small>Odin Software Solutions</small></span>
        </span>
      )}
    </span>
  );
}
export function Button({
  children,
  primary,
  danger,
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className={`btn ${primary ? "primary" : ""} ${danger ? "danger" : ""} ${props.className || ""}`}
    >
      {busy ? <RefreshCw size={15} className="spin" /> : null}
      {children}
    </button>
  );
}
export function PageHeader({
  title,
  subtitle,
  children,
  back,
  literal = false,
  showGuide = true,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  back?: () => void;
  literal?: boolean;
  showGuide?: boolean;
}) {
  const { tr } = useERP();
  const pathname = usePathname();
  const { module } = routeEntry(pathname);
  const guide = module.id === 'admin' ? undefined : pageGuides[module.id];
  return (
    <>
    <header className="page-heading">
      <div>
        {back ? (
          <button className="back" onClick={back}>
            <ArrowLeft size={15} />
            {tr("Back")}
          </button>
        ) : null}
        <h1 tabIndex={-1}>{literal ? <bdi>{title}</bdi> : tr(title)}</h1>
        {subtitle ? <p>{literal ? <bdi>{subtitle}</bdi> : tr(subtitle)}</p> : null}
      </div>
      <div className="actions">{children}</div>
    </header>
    {showGuide && guide ? <details className="page-guide"><summary>{tr("How to use this page")}</summary><p>{tr(guide)}</p></details> : null}
    </>
  );
}
export function Panel({
  title,
  children,
  actions,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { tr } = useERP();
  return (
    <section className={`surface ${className}`}>
      {title ? (
        <div className="surface-heading">
          <h2>{tr(title)}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
export function Status({ value,context }: { value: string;context?:string }) {
  const { label, tr } = useERP();
  const tone = statusTone(value);
  return (
    <span className={`status ${tone}`}>
      <i />
      {context==='visa'&&value==='SUBMITTED'?tr('Visa application submitted'):context==='progress'&&value==='EXPECTED'?tr('Awaiting academy report'):tr(label(value) || value)}
    </span>
  );
}
export function Stats({
  items,
}: {
  items: { label: string; value: ReactNode; href?: string }[];
}) {
  const { tr } = useERP();
  return (
    <div className="stats">
      {items.map((item, i) => (
        <div key={i}>
          <span>{tr(item.label)}</span>
          {item.href ? (
            <a href={item.href}>
              <strong>{item.value}</strong>
              <ArrowRight size={14} />
            </a>
          ) : (
            <strong>{item.value}</strong>
          )}
        </div>
      ))}
    </div>
  );
}
export function Empty({
  filtered = false,
  children,
  description,
  title,
}: {
  filtered?: boolean;
  children?: ReactNode;
  description?: string;
  title?: string;
}) {
  const { tr } = useERP();
  return (
    <div className="empty">
      <strong>
        {tr(title || (filtered ? "No matching records" : "Nothing here yet"))}
      </strong>
      <p>
        {tr(
          filtered
            ? "Adjust the search or filters to view records."
            : description || "Related records will appear here when the workflow progresses.",
        )}
      </p>
      {children}
    </div>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  const { tr } = useERP();
  return (
    <div className="loading" role="status" aria-label={tr(label)}>
      <RefreshCw size={20} className="spin" />
      <span>{tr(label)}</span>
      <div className="loading-lines">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
export function ErrorNotice({
  message,
  retry,
  title = "Unable to load data",
}: {
  message: string;
  retry?: () => void;
  title?: string;
}) {
  const { tr } = useERP();
  return (
    <div className="error-notice" role="alert">
      <strong>{tr(title)}</strong>
      <p>{tr(message)}</p>
      {retry ? <Button onClick={retry}>{tr("Retry")}</Button> : null}
    </div>
  );
}
export function Resource({
  state,
  children,
}: {
  state: { loading: boolean; error: string; reload?: () => void };
  children: ReactNode;
}) {
  return state.loading ? (
    <Loading />
  ) : state.error ? (
    <ErrorNotice message={state.error} retry={state.reload} />
  ) : (
    <>{children}</>
  );
}
export type Column = {
  key: string;
  label: string;
  render?: (row: any, index: number) => ReactNode;
  numeric?: boolean;
  width?: string;
  sortable?: boolean;
};
export function Table({
  columns,
  rows,
  testId,
  caption,
  filtered,
  empty,
  onReset,
  sort,
  onSort,
}: {
  columns: Column[];
  rows: any[];
  testId?: string;
  caption?: string;
  filtered?: boolean;
  empty?: string;
  onReset?: () => void;
  sort?: {key:string;direction:'asc'|'desc'};
  onSort?: (key:string) => void;
}) {
  const { tr } = useERP();
  return (
    <div
      className="table-region"
      role="region"
      aria-label={tr(caption || "Records")}
      tabIndex={0}
    >
      <table data-testid={testId}>
        {caption ? <caption className="sr-only">{tr(caption)}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                scope="col"
                key={c.key}
                className={c.numeric ? "numeric" : ""}
                style={{ width: c.width }}
                aria-sort={c.sortable && onSort ? sort?.key===c.key ? sort.direction==='asc'?'ascending':'descending' : 'none' : undefined}
              >
                {c.sortable && onSort ? <button type="button" className="table-sort" onClick={()=>onSort(c.key)}>{tr(c.label)}<span aria-hidden="true">{sort?.key===c.key?(sort.direction==='asc'?'↑':'↓'):'↕'}</span></button> : tr(c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows?.length ? <tr><td colSpan={Math.max(1,columns.length)}><Empty filtered={filtered} description={empty}>{filtered && onReset ? <Button onClick={onReset}>{tr('Reset filters')}</Button>:null}</Empty></td></tr> : null}
          {rows.map((row, i) => (
            <tr key={row.id || i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "numeric" : ""}>
                  {c.render ? (
                    c.render(row, i)
                  ) : (
                    <bdi>
                      {row[c.key] == null ? "—" : ['status','type','kind','action','scope','bucket','unit'].includes(c.key) ? tr(String(row[c.key])) : String(row[c.key])}
                    </bdi>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 15,
  onPage,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (page: number) => void;
}) {
  const { tr } = useERP();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <footer className="pagination">
      <span>
        <bdi>
          {total ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(total, page * pageSize)} / {total}
        </bdi>{" "}
        {tr("records")}
      </span>
      <div>
        <Button
          aria-label={tr("Previous page")}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={15} />
        </Button>
        <bdi>
          {page} / {pages}
        </bdi>
        <Button
          aria-label={tr("Next page")}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight size={15} />
        </Button>
      </div>
    </footer>
  );
}
export function SearchField({
  value,
  onChange,
  label = "Search documents",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const { tr } = useERP();
  return (
    <label className="search-field">
      <span className="sr-only">{tr(label)}</span>
      <Search size={16} />
      <input
        type="search"
        aria-label={tr(label)}
        placeholder={tr(label)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: any[];
  readOnly?: boolean;
  min?: string;
  max?: string;
  step?: string;
  wide?: boolean;
  hint?: string;
  accept?: string;
  testId?: string;
  pattern?: string;
  autoComplete?: string;
  suggestions?: string[];
};
export function Fields({
  specs,
  values,
  set,
  errors: serverErrors = {},
}: {
  specs: FieldSpec[];
  values: any;
  set: (key: string, value: any) => void;
  errors?: Record<string, string>;
}) {
  const { tr, name } = useERP();
  const id = useId();
  const [clientErrors,setClientErrors]=useState<Record<string,string>>({});
  const errors={...clientErrors,...serverErrors};
  const previousErrors=useRef<string[]>([]);
  useEffect(()=>{const keys=Object.keys(errors);if(keys.some(key=>!previousErrors.current.includes(key)))document.getElementById(`${id}-${keys[0]}`)?.focus();previousErrors.current=keys;},[errors,id]);
  return (
    <div className="fields" onInvalidCapture={event=>{const control=event.target as HTMLInputElement,key=control.dataset.fieldKey;if(key)setClientErrors(old=>({...old,[key]:control.validity.valueMissing?'Complete this required field.':'Check this value.'}));}} onChangeCapture={event=>{const key=(event.target as HTMLInputElement).dataset.fieldKey;if(key)setClientErrors(old=>{if(!old[key])return old;const next={...old};delete next[key];return next;});}}>
      {specs.map((f) => (
        <label
          key={f.key}
          className={`field ${f.wide ? "wide" : ""} ${f.type === "checkbox" ? "checkbox" : ""}`}
          htmlFor={`${id}-${f.key}`}
        >
          <span id={`${id}-${f.key}-label`}>
            {tr(f.label)}
            {f.required ? <span className="required" aria-hidden="true"> *</span> : null}
          </span>
          {f.options ? (
            <select
              id={`${id}-${f.key}`}
              aria-labelledby={`${id}-${f.key}-label`}
              aria-describedby={[f.hint ? `${id}-${f.key}-hint` : "", errors[f.key] ? `${id}-${f.key}-error` : ""].filter(Boolean).join(" ") || undefined}
              aria-invalid={!!errors[f.key] || undefined}
              data-field-key={f.key}
              data-testid={f.testId}
              value={values[f.key] ?? ""}
              disabled={f.readOnly}
              required={f.required}
              onChange={(e) => set(f.key, e.target.value)}
            >
              {!f.options.some(o=>o === "" || o?.value === "") ? <option value="">{tr("Select")}</option>:null}
              {f.options.map((o, i) =>
                typeof o === "string" ? (
                  <option key={o} value={o}>
                    {tr(o)}
                  </option>
                ) : (
                  <option key={o.id ?? o.value ?? i} value={o.value ?? o.id}>
                    {o.label
                      ? tr(o.label)
                      : `${o.code ? o.code + " · " : ""}${name(o)}`}
                  </option>
                ),
              )}
            </select>
          ) : f.type === 'datetime-cairo' ? (
            <span className="cairo-date-field">
              <input id={`${id}-${f.key}`}
              aria-labelledby={`${id}-${f.key}-label`}
              aria-describedby={[f.hint ? `${id}-${f.key}-hint` : "", errors[f.key] ? `${id}-${f.key}-error` : ""].filter(Boolean).join(" ") || undefined}
              aria-invalid={!!errors[f.key] || undefined}
              data-field-key={f.key} type="datetime-local" dir="ltr" required={f.required}
                value={values[f.key] ? cairoDateTime(values[f.key]) : ''} readOnly={f.readOnly}
                onChange={event=>{
                  try {const value=cairoInstant(event.target.value);event.target.setCustomValidity('');set(f.key,value);}
                  catch(error:any){event.target.setCustomValidity(tr(error.message));event.target.reportValidity();}
                }} />
              <small>{tr('Cairo time')}</small>
              {f.key==='nextFollowUp'?<span className="actions">{[[1,'Tomorrow'],[7,'After a week'],[30,'After a month']].map(([days,label])=><button type="button" className="btn" key={label} onClick={()=>{const local=cairoDateTime();const day=new Date(local+':00Z');day.setUTCDate(day.getUTCDate()+Number(days));set(f.key,cairoInstant(day.toISOString().slice(0,16)));}}>{tr(String(label))}</button>)}</span>:null}
            </span>
          ) : f.type === "textarea" ? (
            <textarea
              id={`${id}-${f.key}`}
              aria-labelledby={`${id}-${f.key}-label`}
              aria-describedby={[f.hint ? `${id}-${f.key}-hint` : "", errors[f.key] ? `${id}-${f.key}-error` : ""].filter(Boolean).join(" ") || undefined}
              aria-invalid={!!errors[f.key] || undefined}
              data-field-key={f.key}
              value={values[f.key] ?? ""}
              readOnly={f.readOnly}
              required={f.required}
              onChange={(e) => set(f.key, e.target.value)}
            />
          ) : f.type === "file" ? (
            <input
              id={`${id}-${f.key}`}
              aria-labelledby={`${id}-${f.key}-label`}
              aria-describedby={[f.hint ? `${id}-${f.key}-hint` : "", errors[f.key] ? `${id}-${f.key}-error` : ""].filter(Boolean).join(" ") || undefined}
              aria-invalid={!!errors[f.key] || undefined}
              data-field-key={f.key}
              data-testid={f.testId}
              type="file"
              accept={f.accept}
              required={f.required}
              disabled={f.readOnly}
              onChange={(event) => set(f.key, event.target.files?.[0] || null)}
            />
          ) : (
            <input
              id={`${id}-${f.key}`}
              aria-labelledby={`${id}-${f.key}-label`}
              aria-describedby={[f.hint ? `${id}-${f.key}-hint` : "", errors[f.key] ? `${id}-${f.key}-error` : ""].filter(Boolean).join(" ") || undefined}
              aria-invalid={!!errors[f.key] || undefined}
              data-field-key={f.key}
              data-testid={f.testId}
              type={f.type === "decimal" ? "text" : f.type || "text"}
              inputMode={f.type === "decimal" ? "decimal" : undefined}
              dir={
                ["decimal", "number", "email", "date", "tel", "time", "month"].includes(f.type || "")
                  ? "ltr"
                  : undefined
              }
              value={f.type === "checkbox" ? undefined : (values[f.key] ?? "")}
              checked={f.type === "checkbox" ? !!values[f.key] : undefined}
              readOnly={f.readOnly}
              disabled={f.type === "checkbox" && f.readOnly}
              required={f.required}
              pattern={f.pattern}
              autoComplete={f.autoComplete}
              list={f.suggestions ? `${id}-${f.key}-suggestions`:undefined}
              min={f.min}
              max={f.max}
              step={f.step}
              onChange={(e) =>
                set(
                  f.key,
                  f.type === "checkbox" ? e.target.checked : e.target.value,
                )
              }
            />
          )}{" "}
          {f.suggestions ? <datalist id={`${id}-${f.key}-suggestions`}>{f.suggestions.map(value=><option key={value} value={value}/>)}</datalist> : null}
          {f.hint ? <small id={`${id}-${f.key}-hint`}>{tr(f.hint)}</small> : null}
          {errors[f.key] ? <small id={`${id}-${f.key}-error`} className="field-error" role="alert">{tr(errors[f.key])}</small> : null}
        </label>
      ))}
    </div>
  );
}
export function Tabs({
  tabs,
  value,
  set,
}: {
  tabs: string[];
  value: string;
  set: (tab: string) => void;
}) {
  const { tr } = useERP();
  return (
    <nav className="tabs" aria-label={tr("Sections")}>
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab}
          aria-current={value === tab ? "page" : undefined}
          onClick={() => set(tab)}
        >
          {tr(tab)}
        </button>
      ))}
    </nav>
  );
}
export function Dialog({
  title,
  children,
  close,
  className,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { tr } = useERP();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      queueMicrotask(() => {
        if (!dialog?.isConnected) previous?.focus();
      });
    };
  }, []);
  return (
    <dialog
      className={className}
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{tr(title)}</h2>
        <Button aria-label={tr("Close dialog")} onClick={close}>
          <X size={18} />
        </Button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function Confirm({
  title,
  action,
  close,
  reason = true,
  dangerous = false,
  message,
  actionLabel = 'Confirm',
}: {
  title: string;
  action: (comment: string) => Promise<void>;
  close: () => void;
  reason?: boolean;
  dangerous?: boolean;
  message?: string;
  actionLabel?: string;
}) {
  const { tr } = useERP();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={title}
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await action(comment);
            close();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {reason ? (
          <Fields
            specs={[
              {
                key: "comment",
                label: "Reason",
                type: "textarea",
                required: true,
                wide: true,
              },
            ]}
            values={{ comment }}
            set={(_, v) => setComment(v)}
          />
        ) : (
          <p>{tr(message || "Confirm this action to continue.")}</p>
        )}
        {error ? <ErrorNotice message={error} /> : null}
        <div className="form-actions">
          <Button onClick={close} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button
            type="submit"
            primary={!dangerous}
            danger={dangerous}
            busy={busy}
            disabled={reason && !comment.trim()}
          >
            {tr(actionLabel)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function useUnsaved(dirty: boolean) {
  const { tr } = useERP();
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        link.target === "_blank" ||
        link.download ||
        event.ctrlKey ||
        event.metaKey ||
        link.hash === "#main" ||
        link.href === window.location.href
      )
        return;
      if (!window.confirm(tr("Discard unsaved changes?"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const contextChange = (event: Event) => {
      if (!window.confirm(tr("Discard unsaved changes?")))
        event.preventDefault();
    };
    window.addEventListener("odin:before-context-change", contextChange);
    // Navigation API can cancel same-document Back/Forward before React unmounts.
    const navigation = (window as any).navigation;
    const traverse = (event:any) => {
      if(event.navigationType==='traverse' && event.cancelable && !window.confirm(tr('Discard unsaved changes?'))) event.preventDefault();
    };
    navigation?.addEventListener('navigate',traverse);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("odin:before-context-change", contextChange);
      navigation?.removeEventListener('navigate',traverse);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, tr]);
  return (action: () => void) => {
    if (!dirty || window.confirm(tr("Discard unsaved changes?"))) action();
  };
}
export function Details({ values }: { values: [string, ReactNode][] }) {
  const { tr } = useERP();
  return (
    <dl className="details">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{tr(label)}</dt>
          <dd>
            <bdi>{value ?? "—"}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function AddButton({
  children,
  onClick,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <Button primary onClick={onClick} data-testid={testId}>
      <Plus size={16} />
      {children}
    </Button>
  );
}
