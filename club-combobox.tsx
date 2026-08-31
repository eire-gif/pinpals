"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CLUBS } from "@/lib/clubs";

export default function ClubCombobox({
  name,
  defaultValue = "",
  required = true,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? CLUBS.filter((c) => c.toLowerCase().includes(q)) : CLUBS;
    return list.slice(0, 60);
  }, [query]);

  function selectClub(name: string) {
    setQuery(name);
    setOpen(false);
    setHighlight(-1);
  }

  return (
    <div className="relative" ref={wrapRef}>
      {/* Hidden field carries the actual value submitted with the form */}
      <input type="hidden" name={name} value={query} />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        required={required}
        value={query}
        placeholder="Start typing — e.g. Lahinch, Portmarnock, Waterville…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault();
            selectClub(matches[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface text-[15px] focus:outline-none focus:border-green-600"
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-0 right-0 bg-surface border border-line rounded-lg shadow-lg max-h-64 overflow-y-auto z-20 p-1.5"
        >
          <div className="px-2 pt-1 pb-1.5 text-xs text-ink-500">
            {matches.length} club{matches.length === 1 ? "" : "s"}
            {query ? " match" : " · start typing to narrow it down"}
          </div>
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-500">No club matches &ldquo;{query}&rdquo;</div>
          ) : (
            matches.map((c, i) => (
              <button
                type="button"
                key={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectClub(c)}
                className={`block w-full text-left px-3 py-2.5 rounded-md text-[14.5px] ${
                  i === highlight ? "bg-green-100 text-green-800" : "hover:bg-green-100 hover:text-green-800"
                }`}
              >
                {c}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
