"use client";

import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  Globe,
  Info,
  Landmark,
  LockKeyhole,
  Package,
} from "lucide-react";
import { useERP } from "../core/erp-context";
import { localizeError } from "../core/i18n";
import { Brand, Button, Fields } from "./ui";
import ThemeToggle from "./theme-toggle";

export default function Login() {
  const { tr, language, changeLanguage, establishSession, sessionMessage } =
    useERP();
  const [form, setForm] = useState({
    email: "",
    password: "",
    rememberMe: true,
    show: false,
    code: "",
    recoveryCode: "",
  });
  const [challenge, setChallenge] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        challenge ? "/api/auth/mfa/verify" : "/api/auth/login",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            challenge
              ? {
                  challengeToken: challenge.challengeToken,
                  code: form.code,
                  recoveryCode: form.recoveryCode,
                }
              : {
                  email: form.email,
                  password: form.password,
                  rememberMe: form.rememberMe,
                },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      if (result.mfaRequired || result.mfaEnrollmentRequired)
        setChallenge(result);
      else establishSession(result);
    } catch (submissionError: any) {
      setError(localizeError(submissionError.message, language));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, value: any) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <main className="auth-layout">
      <section className="auth-identity" aria-label={tr("AV8 ERP")}>
        <div className="auth-brand auth-brand-desktop">
          <Brand />
        </div>
        <div className="auth-brand auth-brand-mobile">
          <Brand compact />
          <span>{tr("AV8 ERP")}</span>
        </div>
        <div className="auth-identity-copy">
          <h1>{tr("AV8 ERP")}</h1>
          <p>{tr("Accounting, operations and control in one workspace.")}</p>
          <div className="auth-domains">
            <span>
              <ChartNoAxesColumnIncreasing size={18} />
              {tr("Sales")}
            </span>
            <span>
              <Package size={18} />
              {tr("Inventory")}
            </span>
            <span>
              <Landmark size={18} />
              {tr("Accounting & Finance")}
            </span>
          </div>
        </div>
      </section>

      <div className="auth-utilities">
        <div className="auth-theme-control">
          <ThemeToggle variant="selector" />
        </div>
        <span className="auth-utility-divider" aria-hidden="true" />
        <Button
          className="auth-language"
          data-testid="language-toggle"
          onClick={changeLanguage}
        >
          <Globe size={17} />
          <span>{language === "en" ? "العربية" : "English"}</span>
        </Button>
      </div>

      <section className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-intro">
            <span className="auth-lock" aria-hidden="true">
              <LockKeyhole size={25} />
            </span>
            <h2>{tr(challenge ? "Verify your identity" : "Sign in")}</h2>
            <p>{tr("Use your ERP account to continue.")}</p>
          </div>

          {sessionMessage ? (
            <div className="notice auth-notice" role="status">
              <Info size={21} />
              <p>{tr(sessionMessage)}</p>
            </div>
          ) : null}

          {challenge ? (
            <>
              {challenge.mfaEnrollmentRequired ? (
                <div className="notice">
                  <p>{tr("Authenticator setup key")}</p>
                  <code dir="ltr">{challenge.secret}</code>
                  <details>
                    <summary>{tr("One-time recovery codes")}</summary>
                    {challenge.recoveryCodes?.map((code: string) => (
                      <code className="recovery-code" dir="ltr" key={code}>
                        {code}
                      </code>
                    ))}
                  </details>
                </div>
              ) : null}
              <Fields
                specs={[
                  {
                    key: "code",
                    label: "Six-digit authentication code",
                    type: "text",
                    pattern: "[0-9]{6}",
                    autoComplete: "one-time-code",
                    required: !form.recoveryCode,
                    testId: "mfa-code",
                  },
                  { key: "recoveryCode", label: "Recovery code" },
                ]}
                values={form}
                set={set}
              />
            </>
          ) : (
            <>
              <div className="auth-fields">
                <label className="auth-field" htmlFor="login-email">
                  <span>
                    {tr("Email")} <b aria-hidden="true">*</b>
                  </span>
                  <input
                    id="login-email"
                    data-testid="login-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={form.email}
                    onChange={(inputEvent) =>
                      set("email", inputEvent.target.value)
                    }
                  />
                </label>
                <label className="auth-field" htmlFor="login-password">
                  <span>
                    {tr("Password")} <b aria-hidden="true">*</b>
                  </span>
                  <span className="auth-password-field">
                    <input
                      id="login-password"
                      data-testid="login-password"
                      type={form.show ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={form.password}
                      onChange={(inputEvent) =>
                        set("password", inputEvent.target.value)
                      }
                    />
                    <Button
                      className="auth-password-toggle"
                      data-testid="show-password"
                      aria-pressed={form.show}
                      aria-label={tr("Show password")}
                      title={tr("Show password")}
                      onClick={() => set("show", !form.show)}
                    >
                      {form.show ? <EyeOff size={19} /> : <Eye size={19} />}
                    </Button>
                  </span>
                </label>
              </div>
              <div className="auth-options">
                <label className="auth-checkbox">
                  <input
                    type="checkbox"
                    checked={form.rememberMe}
                    onChange={(inputEvent) =>
                      set("rememberMe", inputEvent.target.checked)
                    }
                  />
                  <span>{tr("Remember me")}</span>
                </label>
                <Button
                  className="auth-show-password"
                  aria-pressed={form.show}
                  onClick={() => set("show", !form.show)}
                >
                  {form.show ? <EyeOff size={16} /> : <Eye size={16} />}
                  <span>{tr("Show password")}</span>
                </Button>
              </div>
            </>
          )}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" primary busy={busy} data-testid="login-submit">
            {tr(busy ? "Authenticating…" : challenge ? "Verify" : "Sign in")}
            <ArrowRight size={16} />
          </Button>
        </form>
      </section>
    </main>
  );
}
