"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import brandsJson from "@/data/golf-brands.json";
import { EMPTY_MARKETPLACE_FILTERS, marketplaceFiltersToSearchParams, type MarketplaceFilters } from "@/lib/marketplace-discovery";
import { SUBCATEGORIES } from "@/lib/marketplace";
import { completeSearch, parseSearch, understoodSomething, type SmartBrand, type SmartSearch } from "@/lib/smart-search";
import { createClient } from "@/lib/supabase/client";

/**
 * The marketplace's smart search (approved mock-up Web 2). Type it the way
 * you'd say it — "tm drvier under 300 dublin" — and the dropdown shows what
 * it understood, fixes the spelling, finishes the word you're typing and
 * lists matches as you go. Search turns it into the page's own filters
 * (?brand=…&category=…&maxPrice=…), so the result is a normal, shareable URL.
 */

const BRANDS = brandsJson.brands as SmartBrand[];

type Hit = { id: number; title: string; price_cents: number | null; image_url: string | null; county: string | null; condition: string };

/** A parsed search as the page's filters. */
export function filtersFromSmart(s: SmartSearch): MarketplaceFilters {
  const hand = s.leftHanded && s.category && (SUBCATEGORIES[s.category] as readonly string[]).includes("Left-handed") && !s.subcategory;
  return {
    ...EMPTY_MARKETPLACE_FILTERS,
    q: s.text,
    category: s.category,
    subcategory: hand ? "Left-handed" : s.subcategory,
    brands: [...s.brands].sort(),
    county: s.nearMe ? "" : s.county,
    condition: s.condition,
    minPriceCents: s.minPriceCents,
    maxPriceCents: s.maxPriceCents,
  };
}

export default function SmartSearchBox({ initial = "", size = "hero" }: { initial?: string; size?: "hero" | "bar" }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const token = useRef(0);

  const parsed = useMemo(() => parseSearch(q, BRANDS), [q]);
  const completions = useMemo(() => completeSearch(q, BRANDS, 4), [q]);
  const typed = q.trim().length > 0;

  useEffect(() => {
    if (!typed) return;
    const mine = ++token.current;
    const timer = setTimeout(async () => {
      const f = filtersFromSmart(parsed);
      const { data } = await createClient().rpc("search_marketplace_listings", {
        p_query: f.q.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim() || null,
        p_category: f.category || null,
        p_subcategory: f.subcategory || null,
        p_brands: f.brands.length ? f.brands : null,
        p_county: f.county || null,
        p_condition: f.condition || null,
        p_sale_type: null,
        p_delivery: null,
        p_min_price_cents: f.minPriceCents,
        p_max_price_cents: f.maxPriceCents,
        p_sort: "newest",
        p_cursor_created_at: null,
        p_cursor_price_cents: null,
        p_cursor_id: null,
        p_limit: 4,
      });
      if (mine === token.current) setHits(((data ?? []) as Hit[]).slice(0, 4));
    }, 250);
    return () => clearTimeout(timer);
  }, [parsed, typed]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function go(text: string) {
    const words = text.trim();
    setOpen(false);
    if (!words) {
      router.push("/marketplace");
      return;
    }
    const qs = marketplaceFiltersToSearchParams(filtersFromSmart(parseSearch(words, BRANDS)));
    qs.set("search", words);
    router.push(`/marketplace?${qs.toString()}#results`);
  }

  // Keyboard: arrows move through the completions, Enter takes one.
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || completions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % completions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? completions.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      setQ(`${completions[active]} `);
      setActive(-1);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const hero = size === "hero";
  const showHits = typed ? hits : [];

  return (
    <div ref={box} className="relative w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go(q);
        }}
        className={`flex items-center gap-3 bg-surface rounded-2xl ${hero ? "min-h-16 pl-5 pr-2 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.25)]" : "h-12 pl-4 pr-1.5 ring-2 ring-gold-500"}`}
      >
        <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0c2038" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <label htmlFor={`${listId}-input`} className="sr-only">
          Search the marketplace
        </label>
        <input
          id={`${listId}-input`}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && typed}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          placeholder={hero ? "Search like you'd say it — “ping irons under €400 in Cork”" : "Search clubs, brands, prices, places…"}
          className={`flex-1 min-w-0 bg-transparent outline-none text-ink-900 placeholder:text-ink-500 ${hero ? "text-[17px]" : "text-[15px]"}`}
        />
        <button type="submit" className={`shrink-0 rounded-xl bg-green-700 text-cream-50 font-bold hover:bg-green-800 transition ${hero ? "h-12 px-6 text-base" : "h-9 px-4 text-sm"}`}>
          Search
        </button>
      </form>

      {open && typed ? (
        <div id={`${listId}-list`} className="absolute left-0 right-0 top-full mt-2 z-30 bg-surface border border-line rounded-2xl shadow-[0_24px_60px_rgba(12,32,56,0.22)] p-4 flex flex-wrap gap-4 text-left">
          <div className="flex-[1_1_280px] min-w-0 grid gap-1 content-start">
            <span className="text-xs font-bold tracking-widest uppercase text-gold-600 px-2 pb-1">Suggestions</span>
            <button type="button" onClick={() => go(q)} className="flex items-center gap-3 min-h-11 px-2 rounded-lg text-left font-bold text-green-700 hover:bg-cream-50">
              Search “{q.trim()}” <span aria-hidden className="ml-auto">→</span>
            </button>
            {completions.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => setQ(`${c} `)}
                className={`flex items-center gap-3 min-h-11 px-2 rounded-lg text-left text-ink-900 hover:bg-cream-50 ${active === i ? "bg-cream-50" : ""}`}
              >
                <span aria-hidden className="text-ink-500">⌕</span>
                <span className="truncate">{c}</span>
              </button>
            ))}
            {showHits.length ? (
              <>
                <span className="text-xs font-bold tracking-widest uppercase text-gold-600 px-2 pt-3 pb-1">Listed now</span>
                {showHits.map((h) => (
                  <a key={h.id} href={`/marketplace/${h.id}`} className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-cream-50">
                    {h.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={h.image_url} alt="" className="w-11 h-11 rounded-lg object-cover" />
                    ) : (
                      <span className="w-11 h-11 rounded-lg bg-cream-100" />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{h.title}</span>
                      <span className="block text-xs text-ink-500 truncate">{[h.condition, h.county].filter(Boolean).join(" · ")}</span>
                    </span>
                    {h.price_cents != null ? <span className="font-display font-bold text-navy-900">€{Math.round(h.price_cents / 100)}</span> : null}
                  </a>
                ))}
              </>
            ) : null}
          </div>
          {understoodSomething(parsed) ? (
            <div className="flex-[1_1_240px] min-w-0 bg-cream-50 rounded-xl p-3.5 grid gap-2.5 content-start">
              <span className="text-xs font-bold tracking-widest uppercase text-gold-600">We understood</span>
              <div className="flex flex-wrap gap-1.5">
                {parsed.chips.map((c) => (
                  <span key={c.key} className="bg-green-100 text-green-800 text-sm font-bold px-2.5 py-1 rounded-full">
                    <span className="font-normal text-green-700">{c.label} </span>
                    {c.value}
                  </span>
                ))}
              </div>
              {parsed.corrections.length ? (
                <span className="text-sm text-ink-500">Spelling fixed: {parsed.corrections.map((c) => `${c.from} → ${c.to}`).join(", ")}</span>
              ) : null}
              {parsed.nearMe ? <span className="text-xs text-ink-500">“Near me” works in the app; here, add a county or town.</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
