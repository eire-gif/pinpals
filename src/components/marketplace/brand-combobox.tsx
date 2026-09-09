"use client";

import { useId, useMemo, useState } from "react";
import { brandLabel, isLegacyResale, sellableBrandsFor } from "@/lib/marketplace-brands";

/**
 * The seller-side brand picker: type to search, click to choose, and a
 * hidden input carries the chosen brand's slug id into the form. Same shape
 * and keyboard behaviour as ClubCombobox (src/components/club-combobox.tsx)
 * — 30-odd options per category is exactly the size where a plain <select>
 * becomes a scroll-hunt and a free-text box invites "Taylor Made" — but
 * with one important difference: this control's submitted value is an id,
 * not the text in the box, so it can never submit a brand that doesn't
 * exist.
 *
 * The list re-derives from category/subcategory on every render rather than
 * being frozen at mount, so switching category ("Drivers" -> "Balls &
 * accessories") swaps Krank and Orlimar out for Bushnell and Golf Pride.
 * A selection that's no longer valid for the new category is cleared by the
 * parent form, not silently carried over.
 */
export default function BrandCombobox({
  category,
  subcategory,
  value,
  onChange,
  disabled = false,
  name = "brand",
}: {
  category: string;
  subcategory?: string | null;
  value: string;
  onChange: (brandId: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const options = useMemo(() => sellableBrandsFor(category, subcategory), [category, subcategory]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Label first, then aliases — so typing "taylor made" or "FJ" lands on
    // the right brand without the seller having to know the exact spelling.
    return options.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        b.aliases.some((alias) => alias.toLowerCase().includes(q))
    );
  }, [options, query]);

  const selectedLabel = value ? brandLabel(value) : "";

  function choose(brandId: string) {
    onChange(brandId);
    setQuery("");
    setOpen(false);
    setHighlight(-1);
  }

  if (!category) {
    return (
      <input
        disabled
        placeholder="Choose a category first"
        className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface opacity-50"
      />
    );
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Brand"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : selectedLabel}
        placeholder="Search brands — e.g. TaylorMade, PING…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && highlight >= 0) {
            e.preventDefault();
            choose(matches[highlight].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600 disabled:opacity-60"
      />

      {value && !open && !disabled && (
        <button
          type="button"
          onClick={() => choose("")}
          aria-label="Clear brand"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-900 text-sm font-bold"
        >
          ×
        </button>
      )}

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-0 right-0 bg-surface border border-line rounded-lg shadow-lg max-h-64 overflow-y-auto z-20 p-1.5"
        >
          {matches.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-500">
              No brand matches &ldquo;{query}&rdquo; — choose <strong>Other</strong> and type the name.
            </div>
          ) : (
            matches.map((b, i) => (
              <button
                type="button"
                key={b.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(b.id)}
                className={`flex w-full items-center justify-between gap-2 text-left px-3 py-2.5 rounded-md text-[14.5px] ${
                  i === highlight ? "bg-green-100 text-green-800" : "hover:bg-green-100 hover:text-green-800"
                }`}
              >
                <span>{b.label}</span>
                {/* Answers "why is Nike in the driver list?" in place, rather
                 * than leaving a seller wondering whether they picked wrong. */}
                {isLegacyResale(b.id, category) && (
                  <span className="text-[11px] font-semibold text-ink-500 shrink-0">no longer made</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
