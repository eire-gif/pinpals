"use client";

import { useMemo, useState } from "react";
import { CLUBS } from "@/lib/clubs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function CourseDirectory() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? CLUBS.filter((c) => c.toLowerCase().includes(q)) : CLUBS;
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of filtered) {
      const letter = /[A-Za-z]/.test(c[0]) ? c[0].toUpperCase() : "#";
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    for (const list of map.values()) list.sort();
    return map;
  }, [filtered]);

  return (
    <div>
      <span className="inline-flex items-center gap-2 bg-green-100 text-green-800 font-bold text-[13.5px] px-4 py-2 rounded-full mb-4">
        {filtered.length} {query ? "matching clubs" : "clubs"}
      </span>

      <div className="relative max-w-md mb-6">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all Irish golf clubs…"
          className="w-full pl-10 pr-3.5 py-3 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-1.5 sticky top-[76px] bg-cream-50 py-2.5 z-10 mb-6">
        {ALPHABET.map((letter) => {
          const has = groups.has(letter);
          return (
            <a
              key={letter}
              href={has ? `#group-${letter}` : undefined}
              className={`w-7.5 h-7.5 flex items-center justify-center rounded-lg text-[13px] font-bold border border-line bg-surface ${
                has ? "text-ink-500 hover:bg-green-100 hover:text-green-800" : "opacity-30 pointer-events-none"
              }`}
            >
              {letter}
            </a>
          );
        })}
      </div>

      {groups.size === 0 ? (
        <p className="text-ink-500 py-10 text-center">No clubs match &ldquo;{query}&rdquo;.</p>
      ) : (
        Array.from(groups.entries()).map(([letter, clubs]) => (
          <div key={letter} id={`group-${letter}`} className="mb-8">
            <h2 className="font-display font-bold text-2xl text-gold-600 border-b-2 border-line pb-2 mb-3.5">
              {letter}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-0">
              {clubs.map((c) => (
                <div key={c} className="py-2 border-b border-dashed border-line/70 text-[14.5px] flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-green-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 21V4l13 4-13 4" />
                  </svg>
                  {c}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
