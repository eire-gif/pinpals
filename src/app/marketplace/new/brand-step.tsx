"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { BRAND_TILES } from "@/lib/sell-flow";
import { createClient } from "@/lib/supabase/client";
import { FIELD_CLASS } from "@/lib/ui";

type Brand = { id: string; label: string };
const FALLBACK_IDS = new Set(["other", "unknown", "mixed"]);

/**
 * Selling, step 3: which brand (approved mock-up "Sell 3 · Brand").
 *
 * Logo tiles for the brands most listed in this kind of item, a search box,
 * then everything else A–Z — never a wall of chips. Brands three or more
 * sellers have typed (0164) are offered under "Suggested by members", and
 * picking one fills in "Other" with that name. "Other", "Unbranded" and
 * (where it makes sense) "Mixed brands" are always at the end.
 *
 * The list comes from /api/brands, the same one the app uses, so a brand
 * staff added from member suggestions is here too.
 */
export default function BrandStep({
  category,
  subcategory,
  brand,
  brandOther,
  onPick,
}: {
  category: string;
  subcategory: string;
  brand: string;
  brandOther: string;
  onPick: (brand: string, brandOther: string, label: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; brands: Brand[] }>({ key: "", brands: [] });
  const [logos, setLogos] = useState<Map<string, string>>(new Map());
  const [suggested, setSuggested] = useState<{ key: string; list: { label: string; sellers: number }[] }>({ key: "", list: [] });
  const [search, setSearch] = useState("");
  const key = `${category}|${subcategory}`;

  useEffect(() => {
    if (!category) return;
    let live = true;
    const qs = new URLSearchParams({ category, ...(subcategory ? { subcategory } : {}) });
    void fetch(`/api/brands?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : { brands: [] }))
      .then((j: { brands?: Brand[] }) => live && setLoaded({ key, brands: j.brands ?? [] }))
      .catch(() => live && setLoaded({ key, brands: [] }));
    const supabase = createClient();
    void supabase
      .rpc("marketplace_member_suggestions", { p_category: category, p_brand: null })
      .then(({ data, error }) => live && setSuggested({ key, list: error ? [] : ((data ?? []) as { label: string; sellers: number }[]) }));
    return () => {
      live = false;
    };
  }, [category, subcategory, key]);

  useEffect(() => {
    let live = true;
    void createClient()
      .from("marketplace_brands")
      .select("id, logo_url")
      .not("logo_url", "is", null)
      .then(({ data, error }) => {
        if (!live || error) return;
        setLogos(new Map(((data ?? []) as { id: string; logo_url: string }[]).map((b) => [b.id, b.logo_url])));
      });
    return () => {
      live = false;
    };
  }, []);

  const all = loaded.key === key ? loaded.brands : [];
  const real = all.filter((b) => !FALLBACK_IDS.has(b.id));
  const fallbacks = all.filter((b) => FALLBACK_IDS.has(b.id));
  const tiles = real.slice(0, BRAND_TILES);
  const rest = [...real.slice(BRAND_TILES)].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  const term = search.trim().toLowerCase();
  const matches = term ? real.filter((b) => b.label.toLowerCase().includes(term)) : [];
  const memberSuggestions = suggested.key === key ? suggested.list : [];

  const row = (b: Brand) => (
    <button
      key={b.id}
      type="button"
      onClick={() => onPick(b.id, "", b.label)}
      aria-pressed={brand === b.id}
      className={`flex items-center justify-between px-3 py-2.5 border-b border-cream-100 text-left text-[15px] ${brand === b.id ? "font-extrabold text-green-700" : "font-semibold hover:bg-cream-100"}`}
    >
      {b.label}
      {brand === b.id ? <span aria-hidden>✓</span> : null}
    </button>
  );

  return (
    <div className="grid gap-4">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={real.length ? `Search ${real.length} brands` : "Search brands"}
        aria-label="Search brands"
        className={FIELD_CLASS}
      />

      {term ? (
        <div className="grid border border-line rounded-xl bg-surface overflow-hidden">
          {matches.length ? matches.map(row) : <p className="px-3 py-3 text-sm text-ink-500">Not on our list — pick Other below and type it.</p>}
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider text-ink-500 mb-2">Most listed</p>
            <div className="grid grid-cols-3 gap-2">
              {tiles.map((b) => {
                const on = brand === b.id;
                const logo = logos.get(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onPick(b.id, "", b.label)}
                    aria-pressed={on}
                    className={`relative h-16 rounded-xl bg-white flex items-center justify-center px-2 transition ${on ? "border-2 border-green-700" : "border border-line hover:border-navy-900"}`}
                  >
                    {logo ? (
                      <Image src={logo} alt={b.label} fill unoptimized className="object-contain p-2.5" />
                    ) : (
                      <span className={`font-extrabold text-navy-900 text-center leading-tight ${b.label.length > 10 ? "text-xs" : "text-sm"}`}>{b.label}</span>
                    )}
                    {on ? <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-green-700 text-white text-[11px] flex items-center justify-center" aria-hidden>✓</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          {memberSuggestions.length > 0 ? (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-ink-500 mb-2">Suggested by members</p>
              <div className="flex flex-wrap gap-2">
                {memberSuggestions.map((s) => {
                  const on = brand === "other" && brandOther.trim().toLowerCase() === s.label.toLowerCase();
                  return (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => onPick("other", s.label, s.label)}
                      aria-pressed={on}
                      className={`px-3.5 py-2 rounded-full text-sm font-bold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line"}`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {rest.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-bold text-green-700">All brands A–Z ({rest.length} more)</summary>
              <div className="mt-2 grid border border-line rounded-xl bg-surface overflow-hidden max-h-72 overflow-y-auto">{rest.map(row)}</div>
            </details>
          ) : null}
        </>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {fallbacks.map((b) => {
          const on = brand === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b.id, b.id === "other" ? brandOther : "", b.label)}
              aria-pressed={on}
              className={`px-3.5 py-2 rounded-full text-sm font-bold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line"}`}
            >
              {b.id === "other" ? "Not listed — type it" : b.label}
            </button>
          );
        })}
      </div>
      {brand === "other" ? (
        <label className="grid gap-1.5 text-[13.5px] font-bold">
          Brand name
          <input
            value={brandOther}
            onChange={(e) => onPick("other", e.target.value, e.target.value || "Other")}
            maxLength={60}
            placeholder="As it's written on the item"
            className={FIELD_CLASS}
          />
          <span className="text-xs font-normal text-ink-500">
            Your ad uses it straight away. When a few sellers type the same brand, it joins the list for everyone.
          </span>
        </label>
      ) : null}
    </div>
  );
}
