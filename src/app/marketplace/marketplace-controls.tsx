"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CATEGORIES, SUBCATEGORIES, CONDITIONS, SALE_TYPES, DELIVERY_OPTIONS } from "@/lib/marketplace";
import { COUNTIES } from "@/lib/clubs";
import { MARKETPLACE_BADGE_LABELS, DELIVERY_OPTION_LABELS } from "@/lib/format";
import {
  MARKETPLACE_SORTS,
  MARKETPLACE_SORT_LABELS,
  marketplaceFiltersToSearchParams,
  type BrandFacets,
  type MarketplaceFilters,
} from "@/lib/marketplace-discovery";
import { ALL_BRAND_IDS, brandIdsFor, brandLabel } from "@/lib/marketplace-brands";

const SEARCH_DEBOUNCE_MS = 400;

/**
 * Every filter/search/sort control on /marketplace, all URL-synchronised
 * (this phase's spec) — the URL built from `filters` state here is the
 * single source of truth a shared link or the browser's own back/forward
 * reproduces exactly. Deliberately one component owning the whole set
 * rather than one per field: a category chip and the "clear filters" link
 * both need to change several fields (a chip resets subcategory; a sale
 * type of "auction"-family has no meaningful min/max price) in one
 * navigation, not a race between several independent pushes.
 *
 * Every change here calls router.push, i.e. a real Next.js navigation — the
 * server component (./page.tsx) re-runs and re-queries on every one, so
 * "server-render the initial result set" holds for every subsequent filter
 * change too, not just the first load. Only the free-text search and the
 * two price inputs are debounced; selects and category chips apply
 * immediately, since there's no risk of firing a query per keystroke there.
 */
export default function MarketplaceControls({
  filters,
  brandFacets = {},
}: {
  filters: MarketplaceFilters;
  brandFacets?: BrandFacets;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [qInput, setQInput] = useState(filters.q);
  const [minInput, setMinInput] = useState(filters.minPriceCents !== null ? String(filters.minPriceCents / 100) : "");
  const [maxInput, setMaxInput] = useState(filters.maxPriceCents !== null ? String(filters.maxPriceCents / 100) : "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the local echo of debounced fields in sync when the URL changes
  // from elsewhere (a chip click, "Clear all", the browser's own
  // back/forward) rather than from this component's own debounce firing.
  // Deliberately done during render (React's own "adjusting state when a
  // prop changes" pattern — https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than in a useEffect: a setState-in-effect here would commit the
  // stale input once, then immediately re-render and commit again, which is
  // exactly the cascading-render pattern that pattern's guidance warns
  // against — a plain render-phase comparison against the last-seen filters
  // resolves in the same commit instead.
  const filtersKey = `${filters.q}|${filters.minPriceCents}|${filters.maxPriceCents}`;
  const [syncedFiltersKey, setSyncedFiltersKey] = useState(filtersKey);
  if (filtersKey !== syncedFiltersKey) {
    setSyncedFiltersKey(filtersKey);
    setQInput(filters.q);
    setMinInput(filters.minPriceCents !== null ? String(filters.minPriceCents / 100) : "");
    setMaxInput(filters.maxPriceCents !== null ? String(filters.maxPriceCents / 100) : "");
  }

  function navigate(next: MarketplaceFilters) {
    const params = marketplaceFiltersToSearchParams(next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function updateNow(patch: Partial<MarketplaceFilters>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate({ ...filters, ...patch });
  }

  function updateDebounced(patch: Partial<MarketplaceFilters>) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ ...filters, ...patch }), SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const hasActiveFilters =
    !!filters.q ||
    !!filters.category ||
    !!filters.subcategory ||
    filters.brands.length > 0 ||
    !!filters.county ||
    !!filters.condition ||
    !!filters.saleType ||
    !!filters.delivery ||
    filters.minPriceCents !== null ||
    filters.maxPriceCents !== null;

  const subcategoryOptions = filters.category
    ? (SUBCATEGORIES[filters.category as keyof typeof SUBCATEGORIES] as readonly string[] | undefined) ?? []
    : [];

  // Which brands this filter panel offers: the chosen category's own list
  // (narrowed by subcategory where that means something — "Rangefinders /
  // GPS" offers Bushnell, not Titleist), or the deduplicated union across
  // every category on the "All" tab.
  //
  // Brands with no matching listings are still listed, just greyed and
  // count-less, rather than hidden: a buyer looking for a Mizuno needs to
  // be told there are none right now, not left wondering whether the filter
  // is broken. A brand that IS selected always stays visible even at zero,
  // so a selection can always be undone from the panel that made it.
  const brandOptions = filters.category
    ? brandIdsFor(filters.category, filters.subcategory || undefined)
    : ALL_BRAND_IDS;

  const brandSearch = brandQuery.trim().toLowerCase();
  const visibleBrands = brandOptions.filter(
    (id) => !brandSearch || brandLabel(id).toLowerCase().includes(brandSearch)
  );

  function toggleBrand(brandId: string) {
    const next = filters.brands.includes(brandId)
      ? filters.brands.filter((b) => b !== brandId)
      : [...filters.brands, brandId].sort();
    updateNow({ brands: next });
  }

  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <label htmlFor="marketplace-search" className="sr-only">
            Search clubs, bags and gear
          </label>
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500 pointer-events-none"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="marketplace-search"
            type="search"
            value={qInput}
            onChange={(e) => {
              setQInput(e.target.value);
              updateDebounced({ q: e.target.value });
            }}
            placeholder="Search clubs, bags, gear…"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
          />
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="marketplace-more-filters"
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full border-[1.5px] text-sm font-bold transition ${
            hasActiveFilters ? "border-green-700 text-green-700 bg-green-100" : "border-line text-ink-900 bg-surface"
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filters
        </button>

        <label htmlFor="marketplace-sort" className="sr-only">
          Sort by
        </label>
        <select
          id="marketplace-sort"
          value={filters.sort}
          onChange={(e) => updateNow({ sort: e.target.value as MarketplaceFilters["sort"] })}
          className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm font-semibold"
        >
          {MARKETPLACE_SORTS.map((s) => (
            <option key={s} value={s}>
              {MARKETPLACE_SORT_LABELS[s]}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => navigate({ ...filters, q: "", category: "", subcategory: "", brands: [], county: "", condition: "", saleType: "", delivery: "", minPriceCents: null, maxPriceCents: null })}
            className="text-sm font-bold text-ink-500 hover:text-ink-900 transition px-2"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Horizontal category chips — always visible in the first viewport,
       * per this phase's spec, distinct from the "More filters" panel below. */}
      <div className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Category">
        <button
          type="button"
          onClick={() => updateNow({ category: "", subcategory: "", brands: [] })}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-bold border-[1.5px] transition ${
            !filters.category ? "bg-navy-900 border-navy-900 text-white" : "border-line text-ink-900 bg-surface hover:bg-cream-100"
          }`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => updateNow({ category: filters.category === c ? "" : c, subcategory: "", brands: [] })}
            aria-pressed={filters.category === c}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-bold border-[1.5px] transition ${
              filters.category === c ? "bg-navy-900 border-navy-900 text-white" : "border-line text-ink-900 bg-surface hover:bg-cream-100"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {filters.brands.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap items-center" aria-label="Selected brands">
          {filters.brands.map((brandId) => (
            <button
              key={brandId}
              type="button"
              onClick={() => toggleBrand(brandId)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border-[1.5px] border-green-700 text-green-800 bg-green-100"
            >
              {brandLabel(brandId)}
              <span aria-hidden="true">×</span>
              <span className="sr-only">Remove {brandLabel(brandId)} filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => updateNow({ brands: [] })}
            className="text-xs font-bold text-ink-500 hover:text-ink-900 transition px-1"
          >
            Clear brands
          </button>
        </div>
      )}

      {filtersOpen && (
        <div
          id="marketplace-more-filters"
          className="mt-3 bg-surface border border-line rounded-2xl p-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <fieldset className="sm:col-span-2 lg:col-span-4">
            <legend className="block text-xs font-bold text-ink-500 mb-1">
              Brand{filters.brands.length > 0 ? ` (${filters.brands.length} selected)` : ""}
            </legend>
            <label htmlFor="mp-brand-search" className="sr-only">
              Search brands
            </label>
            <input
              id="mp-brand-search"
              type="search"
              value={brandQuery}
              onChange={(e) => setBrandQuery(e.target.value)}
              placeholder={filters.category ? `Search ${filters.category.toLowerCase()} brands…` : "Search brands…"}
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm mb-2"
            />
            <div className="max-h-48 overflow-y-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 pr-1">
              {visibleBrands.length === 0 ? (
                <p className="text-sm text-ink-500 py-2">No brand matches &ldquo;{brandQuery}&rdquo;.</p>
              ) : (
                visibleBrands.map((brandId) => {
                  const count = brandFacets[brandId] ?? 0;
                  const checked = filters.brands.includes(brandId);
                  return (
                    <label
                      key={brandId}
                      className={`flex items-center gap-2 text-sm py-1 cursor-pointer ${
                        count === 0 && !checked ? "text-ink-500" : "text-ink-900"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBrand(brandId)}
                        className="shrink-0"
                      />
                      <span className="truncate">{brandLabel(brandId)}</span>
                      {count > 0 && <span className="text-xs text-ink-500 tabular-nums">({count})</span>}
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>

          {subcategoryOptions.length > 0 && (
            <div>
              <label htmlFor="mp-subcategory" className="block text-xs font-bold text-ink-500 mb-1">
                Subcategory
              </label>
              <select
                id="mp-subcategory"
                value={filters.subcategory}
                onChange={(e) => updateNow({ subcategory: e.target.value, brands: [] })}
                className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
              >
                <option value="">Any</option>
                {subcategoryOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="mp-county" className="block text-xs font-bold text-ink-500 mb-1">
              Location
            </label>
            <select
              id="mp-county"
              value={filters.county}
              onChange={(e) => updateNow({ county: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            >
              <option value="">Any county</option>
              {COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mp-condition" className="block text-xs font-bold text-ink-500 mb-1">
              Condition
            </label>
            <select
              id="mp-condition"
              value={filters.condition}
              onChange={(e) => updateNow({ condition: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            >
              <option value="">Any condition</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mp-sale-type" className="block text-xs font-bold text-ink-500 mb-1">
              Sale type
            </label>
            <select
              id="mp-sale-type"
              value={filters.saleType}
              onChange={(e) => updateNow({ saleType: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            >
              <option value="">Any</option>
              {SALE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {MARKETPLACE_BADGE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mp-delivery" className="block text-xs font-bold text-ink-500 mb-1">
              Delivery
            </label>
            <select
              id="mp-delivery"
              value={filters.delivery}
              onChange={(e) => updateNow({ delivery: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            >
              <option value="">Post or collection</option>
              {DELIVERY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {DELIVERY_OPTION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mp-min-price" className="block text-xs font-bold text-ink-500 mb-1">
              Min price (€)
            </label>
            <input
              id="mp-min-price"
              type="number"
              min="0"
              inputMode="decimal"
              value={minInput}
              onChange={(e) => {
                setMinInput(e.target.value);
                const eur = e.target.value.trim() === "" ? null : Number(e.target.value);
                updateDebounced({ minPriceCents: eur !== null && Number.isFinite(eur) && eur >= 0 ? Math.round(eur * 100) : null });
              }}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            />
          </div>

          <div>
            <label htmlFor="mp-max-price" className="block text-xs font-bold text-ink-500 mb-1">
              Max price (€)
            </label>
            <input
              id="mp-max-price"
              type="number"
              min="0"
              inputMode="decimal"
              value={maxInput}
              onChange={(e) => {
                setMaxInput(e.target.value);
                const eur = e.target.value.trim() === "" ? null : Number(e.target.value);
                updateDebounced({ maxPriceCents: eur !== null && Number.isFinite(eur) && eur >= 0 ? Math.round(eur * 100) : null });
              }}
              placeholder="No limit"
              className="w-full px-3 py-2 rounded-lg border-[1.5px] border-line bg-surface text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
