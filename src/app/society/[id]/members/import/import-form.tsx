"use client";

import { useMemo, useState } from "react";

import { ConsoleForm, SubmitButton, buttonClass, inputClass } from "@/components/society-console/forms";
import { MAX_IMPORT_ROWS, readMemberList } from "@/lib/society-console/member-import";
import { importMembers } from "./actions";

const SAMPLE = "First name,Surname,Email\r\nJane,Byrne,jane.byrne@example.ie\r\nPádraig,O'Neill,padraig@example.com\r\n";
const SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + SAMPLE)}`;

/** Choose a CSV (or paste addresses), see exactly who'll be invited, send. */
export default function ImportForm({ g, societyName }: { g: number; societyName: string }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const preview = useMemo(() => readMemberList(text), [text]);
  const rows = preview.rows;
  const invalid = preview.problems.filter((p) => p.reason === "invalid");
  const dupes = preview.problems.filter((p) => p.reason === "duplicate");

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (/\.(xlsx|xls|numbers)$/i.test(file.name)) {
      setFileName(null);
      setText("");
      setFileError("That's a spreadsheet file. In Excel, Google Sheets or Numbers choose File → Save as / Download → CSV, then choose the .csv here.");
      return;
    }
    if (file.size > 2_000_000) {
      setFileError("That file is too big — 2 MB at most.");
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist">
        {(["file", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setText("");
              setFileName(null);
              setFileError(null);
            }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
          >
            {m === "file" ? "Upload a CSV" : "Paste emails"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div className="space-y-2">
          <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-cream-50 px-6 py-10 text-center cursor-pointer hover:bg-cream-100">
            <span className="text-sm font-semibold text-ink-900">{fileName ?? "Choose your member list (.csv)"}</span>
            <span className="text-xs text-ink-500">A column of email addresses, plus names if you have them. Up to {MAX_IMPORT_ROWS} people.</span>
            <input type="file" accept=".csv,text/csv,text/plain,.xlsx,.xls" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <p className="text-xs text-ink-500">
            Not sure of the layout?{" "}
            <a href={SAMPLE_HREF} download="pinpals-society-members.csv" className="font-semibold text-green-700 hover:underline">
              Download a sample CSV
            </a>
            . Columns can be in any order — we look for Email, First name, Surname or Name.
          </p>
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={"jane.byrne@example.ie\npadraig@example.com\nor: Jane Byrne, jane.byrne@example.ie"}
          aria-label="Email addresses"
          className={`${inputClass} font-mono text-xs`}
        />
      )}

      {fileError && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">{fileError}</p>}

      {text.trim() !== "" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-100 text-green-700 px-3 py-1 font-semibold">{rows.length} to invite</span>
            {invalid.length > 0 && <span className="rounded-full bg-red-100 text-red-600 px-3 py-1 font-semibold">{invalid.length} without a valid email — skipped</span>}
            {dupes.length > 0 && <span className="rounded-full bg-cream-100 text-ink-900 px-3 py-1 font-semibold">{dupes.length} duplicate{dupes.length === 1 ? "" : "s"} — skipped</span>}
            {preview.truncated && <span className="rounded-full bg-red-100 text-red-600 px-3 py-1 font-semibold">Only the first {MAX_IMPORT_ROWS} — import the rest after</span>}
          </div>

          {rows.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-cream-100 text-left text-xs uppercase tracking-[0.06em] text-ink-500">
                  <tr>
                    <th className="px-3 py-2 font-bold">Name</th>
                    <th className="px-3 py-2 font-bold">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.email}>
                      <td className="px-3 py-1.5">{[r.firstName, r.lastName].filter(Boolean).join(" ") || <span className="text-ink-500">—</span>}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {invalid.length > 0 && (
            <details className="text-xs text-ink-500">
              <summary className="cursor-pointer font-semibold">Rows skipped</summary>
              <ul className="mt-2 space-y-0.5">
                {invalid.slice(0, 50).map((p) => (
                  <li key={`${p.line}-${p.value}`}>
                    Line {p.line}: <span className="font-mono">{p.value || "(empty)"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {rows.length > 0 && (
            <ConsoleForm
              action={importMembers}
              confirm={`Email ${rows.length === 1 ? "1 person" : `${rows.length} people`} an invitation to ${societyName}? Anyone already on PinPals with that email is added straight away.`}
            >
              <input type="hidden" name="g" value={g} />
              <input type="hidden" name="rows" value={JSON.stringify(rows)} />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Sending invitations…">{`Send ${rows.length} invitation${rows.length === 1 ? "" : "s"}`}</SubmitButton>
                <button type="button" onClick={() => (setText(""), setFileName(null))} className={buttonClass("quiet", "md")}>
                  Start again
                </button>
              </div>
            </ConsoleForm>
          )}
        </div>
      )}
    </div>
  );
}
