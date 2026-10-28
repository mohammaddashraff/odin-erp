"use client";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeWesternInputCapture } from "../core/numeric-input";
import { t, type Language } from "../core/i18n";
export type Verification = { password: string; code: string } | null;
export default function StepUpDialog({
  mfa,
  complete,
}: {
  mfa: boolean;
  complete: (value: Verification) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const language = (
    typeof document !== "undefined" && document.documentElement.lang === "ar"
      ? "ar"
      : "en"
  ) as Language;
  const tr = (s: string) => t(s, language);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement;
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
      ref={ref}
      onInputCapture={normalizeWesternInputCapture}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        complete(null);
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{tr("Verify your identity")}</h2>
      </div>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          complete({ password, code });
        }}
      >
        <p>
          {tr("Re-enter your password to authorize this protected action.")}
        </p>
        <div className="fields">
          <label className="field wide">
            {tr("Password")}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          </label>
          {mfa ? (
            <label className="field wide">
              {tr("Six-digit authentication code")}
              <input
                dir="ltr"
                lang="en"
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
          ) : null}
        </div>
        <div className="form-actions">
          <button className="btn" type="button" onClick={() => complete(null)}>
            {tr("Cancel")}
          </button>
          <button className="btn primary" type="submit">
            {tr("Verify")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
