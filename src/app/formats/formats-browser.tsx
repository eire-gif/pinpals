"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { TILE_CLASS } from "@/components/formats/format-art";
import {
  FORMAT_CATEGORIES,
  categoryOf,
  formatsIn,
  popularFormats,
  searchFormats,
  type FormatCategory,
  type GameFormat,
} from "@/lib/game-formats";

type Filter = "all" | FormatCategory;

const FEATURE_TONES = ["bg-navy-900", "bg-green-700", "bg-navy-800"];

function FormatRow({ format }: { format: GameFormat }) {
  return (
    <Link
      href={`/formats/${format.id}`}
      className="flex items-center gap-4 px-5 py-3.5 min-h-[64px] border-t border-cream-100 first:border-t-0 hover:bg-surface-tint transition"
    >
      <span
        className={`${TILE_CLASS[format.category]} w-11 h-11 shrink-0 rounded-xl border border-gold-500 text-gold-400 font-bold text-sm tracking-wide flex items-center justify-center`}
        aria-hidden="true"
      >
        {format.code}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-[16px] text-navy-900">{format.name}</span>
        <span className="block text-sm text-ink-500">{format.blurb}</span>
      </span>
      <span className="hidden sm:inline-block shrink-0 rounded-full bg-green-100 text-green-700 text-xs font-bold px-2.5 py-1">
        {format.players}
      </span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 text-gold-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * Search, category chips, the most played formats, then every format in a
 * bordered card per category. The query is mirrored into ?q= so a search can
 * be shared, as on /rules.
 */
export function FormatsBrowser({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);

  const hits = useMemo(() => searchFormats(query), [query]);
  const searching = query.trim().length > 0;
  const popular = useMemo(() => popularFormats().slice(0, 6), []);
  const groups = FORMAT_CATEGORIES.filter((c) => filter === "all" || c.id === filter);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-12 flex flex-col gap-8">
      <div className="flex flex-col gap-4 max-w-[720px]">
        <label htmlFor="formats-search" className="sr-only">
          Search game formats
        </label>
        <div className="relative">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id="formats-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — e.g. greensomes, skins, alternate shot"
            autoComplete="off"
            className="w-full rounded-2xl border-[1.5px] border-line bg-surface py-4 pl-12 pr-4 text-lg text-ink-900 placeholder:text-ink-500 shadow-sm focus:border-navy-900 focus:outline-none focus:ring-2 focus:ring-navy-900/15"
          />
        </div>
        {!searching ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            {([{ id: "all", label: "All" }, ...FORMAT_CATEGORIES] as { id: Filter; label: string }[]).map((c) => {
              const on = filter === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(c.id)}
                  className={`min-h-[40px] px-4 rounded-full text-sm font-bold border-[1.5px] transition ${on ? "bg-navy-900 text-gold-400 border-gold-500" : "bg-surface text-navy-900 border-line hover:border-navy-900"}`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {searching ? (
        <section aria-live="polite" className="flex flex-col gap-4">
          <p className="text-xs font-bold tracking-[0.12em] uppercase text-green-700">
            {hits.length === 0 ? "No matches" : `${hits.length} ${hits.length === 1 ? "format" : "formats"} for “${query.trim()}”`}
          </p>
          {hits.length === 0 ? (
            <p className="rounded-2xl border border-line bg-surface p-5 text-ink-500 max-w-[720px]">
              Nothing matched &ldquo;{query.trim()}&rdquo;. Try a simpler word &mdash; pairs, team, points &mdash; or a format&rsquo;s other name.
            </p>
          ) : (
            <div className="rounded-[22px] border border-line bg-surface overflow-hidden max-w-[820px]">
              {hits.map((f) => (
                <FormatRow key={f.id} format={f} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {filter === "all" ? (
            <section className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display font-bold text-2xl text-navy-900">Most played in Ireland</h2>
                <span className="text-sm font-bold text-green-700">Society favourites</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {popular.map((f, i) => (
                  <Link
                    key={f.id}
                    href={`/formats/${f.id}`}
                    className={`${FEATURE_TONES[i % FEATURE_TONES.length]} rounded-[22px] p-[5px] shadow-[0_6px_18px_rgba(12,32,56,0.18)] hover:-translate-y-0.5 transition`}
                  >
                    <span className="flex flex-col gap-2 h-full rounded-[17px] border border-gold-400/70 p-5">
                      <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-gold-400">
                        {categoryOf(f.category).label} · {f.scoring}
                      </span>
                      <span className="font-display font-bold text-2xl text-cream-50">{f.name}</span>
                      <span className="text-sm text-cream-100 mt-auto">{f.blurb}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {groups.map((c) => {
              const items = formatsIn(c.id);
              return (
                <section key={c.id} className="rounded-[22px] border border-line bg-surface overflow-hidden shadow-[0_3px_14px_rgba(12,32,56,0.06)]">
                  <div className="bg-navy-900 p-[5px]">
                    <div className="flex items-center gap-3 rounded-[17px] border border-gold-500/55 px-4 py-3">
                      <div className="flex-1">
                        <p className="text-[10.5px] font-bold tracking-[0.2em] text-gold-500">{c.kicker}</p>
                        <h2 className="font-display font-bold text-xl text-cream-50">{c.title}</h2>
                      </div>
                      <span className="min-w-[32px] h-8 px-2 rounded-full border-[1.5px] border-gold-500 text-gold-400 text-sm font-bold flex items-center justify-center">
                        {items.length}
                      </span>
                    </div>
                  </div>
                  {items.map((f) => (
                    <FormatRow key={f.id} format={f} />
                  ))}
                </section>
              );
            })}
          </div>
        </>
      )}

      <p className="text-sm text-ink-500 max-w-[70ch]">
        Handicap allowances follow the World Handicap System recommendations used by Golf Ireland.
        Your club, society or competition may set its own &mdash; the entry sheet wins.
      </p>
    </div>
  );
}
