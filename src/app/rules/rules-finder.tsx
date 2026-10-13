"use client";

import { useEffect, useMemo, useState } from "react";

import { SUGGESTED_SEARCHES, officialUrl, searchRules, type RuleEntry } from "@/lib/rules-of-golf";

/**
 * The search box and results. The query is mirrored into ?q= so a ruling can
 * be shared as a link ("pinpals.ie/rules?q=provisional"); the page reads it
 * on the server and hands it in as the starting query.
 */
export function RulesFinder({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);

  const hits = useMemo(() => searchRules(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <section>
      <div className="max-w-[720px]">
        <label htmlFor="rules-search" className="sr-only">
          Search the Rules of Golf
        </label>
        <div className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="rules-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Lost ball, water, cart path, 18…"
            autoComplete="off"
            className="w-full rounded-2xl border border-line bg-surface py-4 pl-12 pr-4 text-lg text-ink-900 placeholder:text-ink-500 shadow-sm focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-700/20"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Popular searches">
          {SUGGESTED_SEARCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuery(s)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                query === s
                  ? "border-green-700 bg-green-700 text-cream-50"
                  : "border-line bg-surface text-ink-900 hover:border-green-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-8 mb-4 text-xs font-bold uppercase tracking-[0.12em] text-green-700" aria-live="polite">
        {searching
          ? hits.length === 0
            ? "No matches"
            : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`
          : "All 25 Rules"}
      </p>

      {searching && hits.length === 0 ? (
        <div className="max-w-[720px] rounded-2xl border border-line bg-surface p-6 text-ink-500">
          Nothing matched &ldquo;{query.trim()}&rdquo;. Try a simpler word &mdash;
          &ldquo;water&rdquo;, &ldquo;drop&rdquo;, &ldquo;green&rdquo; &mdash; or a rule
          number like 18.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {hits.map(({ entry }) => (
            <RuleCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function RuleCard({ entry }: { entry: RuleEntry }) {
  return (
    <article id={entry.id} className="flex flex-col rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-navy-900 px-2.5 py-1 text-xs font-bold tracking-wide text-gold-400">
          {entry.ref}
        </span>
        {entry.kind === "topic" && entry.rule > 0 && (
          <span className="text-xs font-semibold text-ink-500">in Rule {entry.rule}</span>
        )}
      </div>
      <h2 className="mt-3 font-display text-xl font-bold leading-snug text-ink-900">{entry.title}</h2>
      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-500">{entry.summary}</p>
      {entry.points && entry.points.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {entry.points.map((p) => (
            <li key={p} className="flex gap-2 text-[14px] leading-relaxed text-ink-900">
              <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
              {p}
            </li>
          ))}
        </ul>
      )}
      <a
        href={officialUrl(entry)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-bold text-green-700 hover:text-green-600"
      >
        Read the official {entry.rule === 0 ? "Definitions" : `Rule ${entry.rule}`} on randa.org
        <span aria-hidden="true">&rarr;</span>
      </a>
    </article>
  );
}
