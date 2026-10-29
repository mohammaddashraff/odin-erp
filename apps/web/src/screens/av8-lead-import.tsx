"use client";
import { useRef, useState } from "react";
import { useERP } from "../core/erp-context";
import { Button, ErrorNotice, Table, type FieldSpec } from "../components/ui";
import { Form } from "./av8-ui";
import { canonicalLeadInput } from "../core/av8-report-schema";

type PreviewRow = {
  row: number;
  data: Record<string, unknown> & { name?: string };
  duplicates: { name: string }[];
  duplicateInFile?: unknown;
  error?: string;
  reviewed?: boolean;
};

type ImportPreview = { rows: PreviewRow[] };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function LeadImport({
  fields,
  initial,
  close,
  reload,
}: {
  fields: FieldSpec[];
  initial: Record<string, unknown>;
  close: () => void;
  reload: () => void;
}) {
  const { tr, request, notify } = useERP();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const valid = Boolean(
    preview &&
      preview.rows.length > 0 &&
      preview.rows.length <= 500 &&
      !preview.rows.some(
        (row) =>
          row.error ||
          ((row.duplicates.length || row.duplicateInFile) && !row.reviewed),
      ),
  );
  const change = (value: string) => {
    setCsv(value);
    setPreview(null);
    setError("");
  };
  return (
    <Form
      title="Import leads"
      fields={fields}
      initial={initial}
      dirty={!!csv}
      submitLabel="Import validated leads"
      submitDisabled={!valid || busy}
      submitHint={
        valid
          ? "Ready to import the reviewed rows."
          : "Upload and preview 1–500 rows, resolve errors and review duplicates first."
      }
      close={close}
      save={async (value) => {
        if (!valid)
          throw new Error(
            "Resolve row errors and review duplicates before importing",
          );
        const result = (await request("/av8/leads/import/commit", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            ...value,
            rows: preview!.rows.map((row) => ({
              ...canonicalLeadInput(row.data),
              duplicateReviewed: !!row.reviewed,
            })),
          }),
        })) as { count: number };
        notify(`${tr("Imported leads")}: ${result.count}`);
        reload();
      }}
    >
      <section className="import-step">
        <h3>{tr("1. Choose a CSV file")}</h3>
        <p>
          {tr(
            "Required columns: name, phone, source. Optional columns: email, campaign, program.",
          )}
        </p>
        <label className="field">
          <span>{tr("CSV file")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) change(await file.text());
            }}
          />
        </label>
        <details>
          <summary>{tr("Advanced: paste CSV")}</summary>
          <label className="field">
            <span>{tr("CSV content")}</span>
            <textarea
              value={csv}
              disabled={busy}
              onChange={(event) => change(event.target.value)}
            />
          </label>
        </details>
      </section>
      <section className="import-step">
        <h3>{tr("2. Preview and review")}</h3>
        <Button
          busy={busy}
          disabled={!csv.trim()}
          onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError("");
            try {
              setPreview(
                (await request("/av8/leads/import/preview", {
                  method: "POST",
                  body: JSON.stringify({ csv }),
                })) as ImportPreview,
              );
            } catch (previewError: unknown) {
              setPreview(null);
              setError(errorMessage(previewError));
            } finally {
              setBusy(false);
              inFlight.current = false;
            }
          }}
        >
          {tr("Preview CSV")}
        </Button>
        {error ? <ErrorNotice message={error} /> : null}
        {preview ? (
          <Table
            caption="Import preview"
            rows={preview.rows}
            columns={[
              { key: "row", label: "Row", numeric: true },
              {
                key: "name",
                label: "Name",
                render: (r) => <bdi>{r.data.name}</bdi>,
              },
              {
                key: "error",
                label: "Error",
                render: (r) => (r.error ? tr(r.error) : "—"),
              },
              {
                key: "duplicates",
                label: "Potential duplicates reviewed",
                render: (r) =>
                  r.duplicates.length || r.duplicateInFile ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={!!r.reviewed}
                        onChange={(e) =>
                          setPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  rows: current.rows.map((row) =>
                                    row.row === r.row
                                      ? { ...row, reviewed: e.target.checked }
                                      : row,
                                  ),
                                }
                              : current,
                          )
                        }
                      />
                      {r.duplicates
                        .map((duplicate: { name: string }) => duplicate.name)
                        .join(", ") || tr("Same phone in CSV")}
                    </label>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        ) : null}
      </section>
      <section className="import-step">
        <h3>{tr("3. Import validated leads")}</h3>
        <p>
          {tr(
            "The import saves all reviewed rows together. If validation fails, no rows are imported.",
          )}
        </p>
      </section>
    </Form>
  );
}
