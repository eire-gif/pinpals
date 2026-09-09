"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ClubSummary } from "@/lib/types";

/**
 * Home-club picker, scoped to a country.
 *
 * ============ What changed and why ============
 *
 * This used to import `CLUBS` — a bundled array of 373 Irish club names — and
 * filter it in the browser. That is no longer possible or desirable: the
 * directory is ~3,000 clubs across five countries, and shipping all of them
 * to render a dropdown would dwarf the rest of the page.
 *
 * So it asks the server, and it asks it for one country at a time. The
 * country comes from a separate select the caller owns (`country` prop) —
 * hence the two-step "country, then club" flow: narrowing by country first is
 * what keeps the list short enough to skim and stops "Woodbrook" offering you
 * the wrong one of two.
 *
 * ============ Two hidden fields, not one ============
 *
 * The form submits the club's **id**, which is what the profile actually
 * references. It also submits the display name, purely so a server action can
 * write the denormalised `home_club` column without a second round trip. The
 * id is the value that is validated server-side; the name is re-read from the
 * club row there rather than trusted.
 *
 * A club is only "chosen" when it has an id. Typing a name that matches
 * nothing leaves the id empty, and the caller's validation rejects it — which
 * is the point: `home_club_id` is a foreign key, and a member cannot be at a
 * club that doesn't exist.
 */
export default function ClubCombobox({
  name,
  country,
  defaultClubId = null,
  defaultValue = "",
  required = false,
}: {
  /** Field name for the club id. The display name is submitted as `${name}Name`. */
  name: string;
  country: string;
  defaultClubId?: number | null;
  defaultValue?: string;
  required?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultValue);
  const [chosen, setChosen] = useState<{ id: number; name: string } | null>(
    defaultClubId && defaultValue ? { id: defaultClubId, name: defaultValue } : null
  );
  const [matches, setMatches] = useState<ClubSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Changing country invalidates whatever club was picked — a club in
  // Scotland is not a club in Wales. Clearing it is the honest behaviour;
  // leaving a stale name in the box next to a new country would submit a
  // mismatch the server then has to reject.
  const previousCountry = useRef(country);
  useEffect(() => {
    if (previousCountry.current !== country) {
      previousCountry.current = country;
      setQuery("");
      setChosen(null);
      setMatches([]);
    }
  }, [country]);

  useEffect(() => {
    if (!open || !country) return;

    // Debounced so a fast typist makes one request, not eight. Aborted on
    // the next keystroke so an early slow response can't overwrite the
    // results of a later, narrower query.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/clubs?country=${encodeURIComponent(country)}&q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("lookup failed");
        const payload = (await response.json()) as { clubs: ClubSummary[] };
        setMatches(payload.clubs ?? []);
      } catch {
        // An aborted or failed lookup leaves the previous suggestions in
        // place rather than emptying the list, which would read as "no such
        // club" when the truth is "we couldn't ask".
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, country, open]);

  function selectClub(club: ClubSummary) {
    setChosen({ id: club.id, name: club.name });
    setQuery(club.name);
    setOpen(false);
    setHighlight(-1);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input type="hidden" name={name} value={chosen?.id ?? ""} />
      <input type="hidden" name={`${name}Name`} value={chosen?.name ?? ""} />

      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        required={required}
        disabled={!country}
        value={query}
        placeholder={country ? "Start typing your club's name…" : "Choose a country first"}
        onChange={(event) => {
          setQuery(event.target.value);
          // Editing the text un-chooses the club: the box now says something
          // other than what was picked, and submitting the old id would save
          // a club the member is no longer looking at.
          setChosen(null);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (event.key === "Enter" && highlight >= 0 && matches[highlight]) {
            event.preventDefault();
            selectClub(matches[highlight]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface text-[15px] focus:outline-none focus:border-green-600 disabled:bg-cream-100 disabled:text-ink-500"
      />

      {open && country && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-0 right-0 bg-surface border border-line rounded-lg shadow-lg max-h-64 overflow-y-auto z-20 p-1.5"
        >
          <div className="px-2 pt-1 pb-1.5 text-xs text-ink-500">
            {loading
              ? "Searching…"
              : query.trim()
                ? `${matches.length} club${matches.length === 1 ? "" : "s"} match`
                : "Start typing to narrow it down"}
          </div>

          {!loading && matches.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-500">
              No club matches &ldquo;{query}&rdquo;
            </div>
          ) : (
            matches.map((club, index) => (
              <button
                type="button"
                key={club.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectClub(club)}
                className={`block w-full text-left px-3 py-2.5 rounded-md text-[14.5px] ${
                  index === highlight
                    ? "bg-green-100 text-green-800"
                    : "hover:bg-green-100 hover:text-green-800"
                }`}
              >
                {club.name}
                {/* The region is part of the identity now, not decoration:
                    names are no longer unique (0062), so two entries reading
                    only "Manor Golf Club" would be unpickable. */}
                {club.region || club.town ? (
                  <span className="block text-[12.5px] text-ink-500">
                    {[club.town, club.region].filter(Boolean).join(", ")}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
