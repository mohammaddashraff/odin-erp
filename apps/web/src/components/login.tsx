"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Globe, LockKeyhole } from "lucide-react";
import { useERP } from "../core/erp-context";
import { localizeError } from "../core/i18n";
import { Brand, Button, Fields } from "./ui";
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
  async function submit(e: FormEvent) {
    e.preventDefault();
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
    } catch (error: any) {
      setError(localizeError(error.message, language));
    } finally {
      setBusy(false);
    }
  }
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <main className="auth-layout">
      <section className="auth-identity">
        <div className="auth-brand">
          <Brand />
        </div>
        <div>
          <h1>{tr("AV8 ERP")}</h1>
          <p>{tr("Accounting, operations and control in one workspace.")}</p>
          <div className="auth-domains">
            <span>{tr("Sales")}</span>
            <span>{tr("Inventory")}</span>
            <span>{tr("Accounting & Finance")}</span>
          </div>
        </div>
        <small>AV8 ERP · ODIN Software Solutions</small>
      </section>
      <section className="auth-main">
        <Button
          className="auth-language"
          data-testid="language-toggle"
          onClick={changeLanguage}
        >
          <Globe size={16} />
          {language === "en" ? "العربية" : "English"}
        </Button>
        <form className="auth-form" onSubmit={submit}>
          <LockKeyhole size={24} />
          <h2>{tr(challenge ? "Verify your identity" : "Sign in")}</h2>
          <p>{tr("Use your ERP account to continue.")}</p>
          {sessionMessage ? (
            <p className="notice">{tr(sessionMessage)}</p>
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
              <Fields
                specs={[
                  {
                    key: "email",
                    label: "Email",
                    type: "email",
                    autoComplete: "username",
                    required: true,
                    testId: "login-email",
                  },
                  {
                    key: "password",
                    label: "Password",
                    type: form.show ? "text" : "password",
                    autoComplete: "current-password",
                    required: true,
                    testId: "login-password",
                  },
                ]}
                values={form}
                set={set}
              />
              <div className="auth-options">
                <label>
                  <input
                    type="checkbox"
                    checked={form.rememberMe}
                    onChange={(e) => set("rememberMe", e.target.checked)}
                  />
                  {tr("Remember me")}
                </label>
                <label>
                  <input
                    data-testid="show-password"
                    type="checkbox"
                    checked={form.show}
                    onChange={(e) => set("show", e.target.checked)}
                  />
                  {tr("Show password")}
                </label>
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
        <small className="auth-footer">AV8 / ERP</small>
      </section>
    </main>
  );
}
