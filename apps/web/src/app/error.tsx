"use client";
import { useERP } from "../core/erp-context";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { tr } = useERP();
  return (
    <main className="glass-fallback">
      <h1>{tr("Unable to display this page")}</h1>
      <p>{tr("Please retry or return to your workspace.")}</p>
      <button className="btn primary" onClick={reset}>
        {tr("Retry")}
      </button>
    </main>
  );
}
