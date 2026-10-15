"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buttonClass, inputClass } from "@/components/society-console/forms";
import { makeExport, type ExportResult } from "./actions";

/**
 * One export: a button that makes the file on the server and hands back a
 * ten-minute link, then a Download link to it. The booking sheet asks which
 * event first.
 */
export function ExportCard({
  groupId,
  file,
  title,
  detail,
  who,
  locked,
  events,
}: {
  groupId: number;
  file: string;
  title: string;
  detail: string;
  who: string;
  locked: boolean;
  events?: { id: number; label: string }[];
}) {
  const router = useRouter();
  const [outing, setOuting] = useState<number | null>(events?.[0]?.id ?? null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [pending, start] = useTransition();
  const needsEvent = events != null;
  const blocked = needsEvent && outing == null;

  function make() {
    setResult(null);
    start(async () => {
      const r = await makeExport(groupId, file, needsEvent ? outing : null).catch((): ExportResult => ({ ok: false, error: "Couldn't make the file. Please try again." }));
      setResult(r);
      if (r.ok) {
        // Start the download, and refresh the log below.
        window.location.assign(r.url);
        router.refresh();
      }
    });
  }

  return (
    <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-bold text-lg text-ink-900">{title}</h2>
          <p className="text-sm text-ink-500 mt-0.5">{detail}</p>
          <span className={`inline-flex items-center gap-1 mt-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${locked ? "bg-navy-900 text-cream-50" : "bg-cream-100 text-ink-500"}`}>
            {locked && (
              <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                <path d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
              </svg>
            )}
            {who}
          </span>
        </div>
        <button type="button" onClick={make} disabled={pending || blocked} className={buttonClass("navy")}>
          {pending ? "Making…" : "Make CSV"}
        </button>
      </div>

      {needsEvent &&
        (events.length === 0 ? (
          <p className="text-sm text-ink-500">No events yet. Add one first, then come back for its booking sheet.</p>
        ) : (
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">Which event</span>
            <select value={outing ?? ""} onChange={(e) => setOuting(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        ))}

      {result && !result.ok && (
        <p role="alert" className="text-sm text-red-600 bg-red-100 rounded-lg px-3 py-2">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p aria-live="polite" className="text-sm text-green-700 bg-green-100 rounded-lg px-3 py-2">
          {result.rows} {result.rows === 1 ? "row" : "rows"} ready.{" "}
          <a href={result.url} className="font-semibold underline">
            Download {result.filename}
          </a>{" "}
          — the link works for ten minutes.
        </p>
      )}
    </section>
  );
}
