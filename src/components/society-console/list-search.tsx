"use client";

import { useState } from "react";

import { inputClass } from "./styles";

/**
 * A search box for a long list drawn on the server (130 entrants on a big
 * society day): hides every row under #target whose `data-search` text
 * doesn't contain all the words typed. Accents and case don't matter, so
 * "gearoid" finds Gearóid. The rows stay server-rendered, with their own
 * buttons; this only shows and hides them.
 */

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export default function ListSearch({ target, placeholder = "Search by name, club or group" }: { target: string; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<{ n: number; of: number } | null>(null);

  const search = (value: string) => {
    setQ(value);
    const root = document.getElementById(target);
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-search]"));
    const words = fold(value).split(/\s+/).filter(Boolean);
    let n = 0;
    for (const row of rows) {
      const hit = words.every((w) => fold(row.dataset.search ?? "").includes(w));
      row.hidden = !hit;
      if (hit) n += 1;
    }
    setShown(words.length ? { n, of: rows.length } : null);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <label className="relative flex-1 min-w-[14rem] max-w-md">
        <span className="sr-only">{placeholder}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 4 4" strokeLinecap="round" />
        </svg>
        <input type="search" value={q} onChange={(e) => search(e.target.value)} placeholder={placeholder} className={`${inputClass} !pl-9`} />
      </label>
      {shown && (
        <span className="text-sm text-ink-500" aria-live="polite">
          {shown.n === 0 ? "No one matches" : `${shown.n} of ${shown.of}`}
          {" · "}
          <button type="button" onClick={() => search("")} className="font-semibold text-green-700 hover:text-green-600">
            Clear
          </button>
        </span>
      )}
    </div>
  );
}
