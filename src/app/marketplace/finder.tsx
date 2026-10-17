import Image from "next/image";
import Link from "next/link";

import {
  FINDER_CATEGORIES,
  TOP_PICKS,
  brandTiles,
  countFor,
  finderStep,
  modelTiles,
  priceRange,
  type FinderCount,
  type FinderModel,
} from "@/lib/finder";
import { brandIdsFor } from "@/lib/marketplace-brands";
import { marketplaceFiltersToSearchParams, type MarketplaceFilters } from "@/lib/marketplace-discovery";
import type { BrandRow, TopPick } from "@/lib/marketplace-finder";
import ListingCard from "./listing-card";

/**
 * Find by club, brand and model (approved mock-up "Flow · Website", 0163).
 *
 * Three steps — club type or item, brand, model — each a link, so the URL
 * is the state and every step can be shared or bookmarked. The listings are
 * always on the page underneath and narrow as each step is picked; any step
 * can be skipped. Above the listings, Top picks: paid adverts that match.
 */

/** Category photos (approved mock-ups): the club on grass, or a studio shot. */
export const CATEGORY_PHOTOS: Record<string, string> = {
  Drivers: "/images/marketplace/drivers.jpg",
  "Woods & hybrids": "/images/marketplace/woods.jpg",
  Irons: "/images/marketplace/irons.jpg",
  Wedges: "/images/marketplace/wedges.jpg",
  Putters: "/images/marketplace/putters.jpg",
  "Full sets": "/images/marketplace/sets.jpg",
  "Bags & trolleys": "/images/marketplace/bags.jpg",
  "Shoes & apparel": "/images/marketplace/apparel.jpg",
  "Balls & accessories": "/images/marketplace/balls.jpg",
};

/** How many brand tiles show before "Show every brand". */
const BRAND_TILES_SHOWN = 12;

function hrefFor(filters: MarketplaceFilters, patch: Partial<MarketplaceFilters>): string {
  const next: MarketplaceFilters = { ...filters, ...patch };
  const qs = marketplaceFiltersToSearchParams(next).toString();
  return qs ? `/marketplace?${qs}#finder` : "/marketplace#finder";
}

export function BrandLogo({ brand, size = "md" }: { brand: Pick<BrandRow, "label" | "logo_url">; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "w-48 h-24" : size === "sm" ? "w-24 h-10" : "w-full h-16";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-xs" : "text-[15px]";
  return (
    <span className={`relative ${box} rounded-xl bg-white border border-line flex items-center justify-center overflow-hidden px-3`}>
      {brand.logo_url ? (
        <Image src={brand.logo_url} alt={brand.label} fill sizes="200px" unoptimized className="object-contain p-2.5" />
      ) : (
        <span className={`${text} font-extrabold text-navy-900 text-center leading-tight`}>{brand.label}</span>
      )}
    </span>
  );
}

export default function Finder({
  filters,
  counts,
  brands,
  models,
  model,
  forSaleNow,
}: {
  filters: MarketplaceFilters;
  counts: FinderCount[];
  brands: Map<string, BrandRow>;
  models: FinderModel[];
  model: FinderModel | null;
  /** How many listings match, when only the finder is narrowing them. */
  forSaleNow: number | null;
}) {
  const brand = filters.brands.length === 1 ? filters.brands[0] : "";
  const state = { category: filters.category, brand, model: model ? filters.model : "" };
  const step = finderStep(state);
  const brandRow = brand ? brands.get(brand) : undefined;
  const label = (id: string) => brands.get(id)?.label ?? id;
  const reset = { subcategory: "", model: "" };

  const steps = [
    {
      n: "1 · Club or item",
      short: "1 · Club",
      value: filters.category ? FINDER_CATEGORIES.find((c) => c.key === filters.category)?.short ?? filters.category : "",
      key: "category" as const,
      href: hrefFor(filters, { ...reset, category: "", brands: filters.brands.length === 1 && !filters.category ? filters.brands : [] }),
    },
    {
      n: "2 · Brand",
      short: "2 · Brand",
      value: brand ? label(brand) : filters.brands.length > 1 ? `${filters.brands.length} brands` : "",
      key: "brand" as const,
      href: hrefFor(filters, { ...reset, brands: [] }),
    },
    { n: "3 · Model", short: "3 · Model", value: model?.family ?? "", key: "model" as const, href: hrefFor(filters, { model: "" }) },
  ];

  return (
    <section id="finder" aria-labelledby="finder-h" className="scroll-mt-20 mb-8 rounded-3xl bg-surface border border-line overflow-hidden">
      <nav aria-label="Steps" className="grid grid-cols-3 gap-2 p-3 bg-navy-900">
        {steps.map((s) => {
          const on = step === s.key;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={on ? "step" : undefined}
              className={`rounded-2xl px-3 sm:px-4 py-2.5 min-w-0 transition ${
                on ? "bg-gold-500 text-navy-900" : s.value ? "bg-cream-50/15 text-cream-50 hover:bg-cream-50/25" : "bg-cream-50/5 text-cream-50/80 hover:bg-cream-50/15"
              }`}
            >
              <span className="block text-[11px] font-extrabold uppercase tracking-wider opacity-75 truncate">
                <span className="hidden sm:inline">{s.n}</span>
                <span className="sm:hidden">{s.short}</span>
              </span>
              <span className="block font-extrabold truncate">{s.value || (on ? "Choose…" : "Any")}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-5 sm:p-6">
        {step === "category" ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 id="finder-h" className="font-display font-semibold text-2xl text-navy-900">
                {brandRow ? `What ${brandRow.label} are you after?` : "What are you looking for?"}
              </h2>
              <Link href="/marketplace/brands" className="text-sm font-bold text-green-700">
                Shop by brand →
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
              {FINDER_CATEGORIES.map((c) => {
                const n = countFor(counts, "category", c.key)?.count ?? 0;
                return (
                  <Link
                    key={c.key}
                    href={hrefFor(filters, { ...reset, category: c.key, brands: brandRow ? [brand] : [] })}
                    className="group rounded-2xl overflow-hidden border border-line bg-surface hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(12,32,56,0.10)] transition"
                  >
                    <span className="relative block aspect-[4/3]">
                      <Image src={CATEGORY_PHOTOS[c.key]} alt="" fill sizes="180px" className="object-cover group-hover:scale-105 transition duration-300" />
                    </span>
                    <span className="block px-3 py-2.5">
                      <span className="block font-bold text-[15px] leading-tight">{c.short}</span>
                      <span className="block text-xs text-ink-500">{n ? `${n} for sale` : "None right now"}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : step === "brand" ? (
          <BrandStep filters={filters} counts={counts} brands={brands} />
        ) : step === "model" ? (
          <ModelStep filters={filters} counts={counts} models={models} brandLabel={label(brand)} />
        ) : model ? (
          <ModelSummary filters={filters} counts={counts} model={model} brand={brandRow ?? { id: brand, label: label(brand), logo_url: null, is_fallback: false }} />
        ) : null}

        {forSaleNow != null ? (
          <p className="mt-5 text-sm text-ink-500">
            <b className="text-ink-900">{forSaleNow.toLocaleString("en-IE")}</b> {forSaleNow === 1 ? "listing matches" : "listings match"} — they&rsquo;re all below.
            {step !== "done" ? " Pick to narrow them, or keep scrolling." : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function BrandStep({ filters, counts, brands }: { filters: MarketplaceFilters; counts: FinderCount[]; brands: Map<string, BrandRow> }) {
  const tiles = brandTiles(brandIdsFor(filters.category), counts).filter((t) => brands.has(t.id) && !brands.get(t.id)!.is_fallback);
  const shown = tiles.slice(0, Math.max(BRAND_TILES_SHOWN, tiles.filter((t) => t.count > 0).length));
  const more = tiles.slice(shown.length);
  const tile = (t: { id: string; count: number }) => {
    const b = brands.get(t.id)!;
    return (
      <Link
        key={t.id}
        href={hrefFor(filters, { brands: [t.id], model: "" })}
        className="group flex flex-col gap-1.5 rounded-2xl p-2 hover:bg-cream-100 transition"
        aria-label={`${b.label}, ${t.count} for sale`}
      >
        <BrandLogo brand={b} />
        <span className="text-xs text-center text-ink-500">{t.count ? `${t.count} for sale` : "None right now"}</span>
      </Link>
    );
  };
  return (
    <>
      <h2 id="finder-h" className="font-display font-semibold text-2xl text-navy-900 mb-4">
        Which brand of {filters.category.toLowerCase()}?
      </h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">{shown.map(tile)}</div>
      {more.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-green-700">Show every brand ({more.length} more)</summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">{more.map(tile)}</div>
        </details>
      ) : null}
    </>
  );
}

function ModelStep({ filters, counts, models, brandLabel }: { filters: MarketplaceFilters; counts: FinderCount[]; models: FinderModel[]; brandLabel: string }) {
  const { forSale, older } = modelTiles(models, counts);
  const tile = (m: FinderModel & { count: number }) => {
    const c = countFor(counts, "model", m.id);
    return (
      <Link
        key={m.id}
        href={hrefFor(filters, { model: m.id })}
        className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3 hover:border-navy-900 transition"
      >
        <span className="flex items-center gap-2">
          {m.year ? <span className="text-[11px] font-extrabold text-gold-600 bg-cream-100 rounded-md px-1.5 py-0.5">{m.year}</span> : null}
          <span className="font-extrabold text-navy-900 truncate">{m.family}</span>
        </span>
        <span className="text-xs text-ink-500 truncate">{m.versions.slice(0, 3).join(" · ") || " "}</span>
        <span className="flex justify-between text-xs mt-0.5">
          <span className={m.count ? "font-bold text-green-700" : "text-ink-500"}>{m.count ? `${m.count} for sale` : "None right now"}</span>
          <span className="text-ink-500">{c ? priceRange(c.minPriceCents, c.maxPriceCents) : ""}</span>
        </span>
      </Link>
    );
  };
  return (
    <>
      <h2 id="finder-h" className="font-display font-semibold text-2xl text-navy-900 mb-4">
        Which {brandLabel} model?
      </h2>
      {models.length === 0 ? (
        <p className="text-ink-500">We don&rsquo;t have {brandLabel}&rsquo;s {filters.category.toLowerCase()} by model yet — every one for sale is below.</p>
      ) : (
        <>
          {forSale.length > 0 ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{forSale.map(tile)}</div>
          ) : (
            <p className="text-ink-500">None listed by model right now — every {brandLabel} for sale is below.</p>
          )}
          {older.length > 0 ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-bold text-green-700">
                Every {brandLabel} model ({older.length} with none for sale right now)
              </summary>
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">{older.map(tile)}</div>
            </details>
          ) : null}
        </>
      )}
    </>
  );
}

function ModelSummary({ filters, counts, model, brand }: { filters: MarketplaceFilters; counts: FinderCount[]; model: FinderModel; brand: BrandRow }) {
  const c = countFor(counts, "model", model.id);
  const sell = `/marketplace/new?${new URLSearchParams({ category: model.category, brand: model.brandId, model: model.id }).toString()}`;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <BrandLogo brand={brand} size="lg" />
      <div className="flex-1 min-w-[240px]">
        <p className="flex items-center gap-2">
          {model.year ? <span className="text-xs font-extrabold text-gold-600 bg-cream-100 rounded-md px-2 py-0.5">{model.year}</span> : null}
          <span className="text-sm text-ink-500">{filters.category}</span>
        </p>
        <h2 id="finder-h" className="font-display font-semibold text-3xl text-navy-900 mt-1">
          {brand.label} {model.family}
        </h2>
        {model.versions.length > 0 ? (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {model.versions.map((v) => (
              <span key={v} className="text-xs font-bold px-2.5 py-1 rounded-full border border-line">
                {v}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 min-w-[240px]">
        <span className="rounded-2xl bg-cream-100 px-4 py-3">
          <span className="block text-xs text-ink-500">For sale</span>
          <span className="block font-display font-semibold text-2xl text-green-700">{c?.count ?? 0}</span>
        </span>
        <span className="rounded-2xl bg-cream-100 px-4 py-3">
          <span className="block text-xs text-ink-500">Asking</span>
          <span className="block font-display font-semibold text-2xl text-navy-900">{c ? priceRange(c.minPriceCents, c.maxPriceCents) || "—" : "—"}</span>
        </span>
        <Link href={sell} className="col-span-2 text-sm font-bold text-green-700">
          Selling a {model.family}? List it — the model&rsquo;s filled in →
        </Link>
      </div>
    </div>
  );
}

export function TopPicks({ picks, signedIn }: { picks: TopPick[]; signedIn: boolean }) {
  if (picks.length === 0) return null;
  return (
    <section aria-labelledby="top-picks-h" className="mb-8 rounded-3xl bg-[#fbf3df] border border-[#ecd9a8] p-5">
      <div className="flex flex-wrap items-baseline gap-3 mb-4">
        <h2 id="top-picks-h" className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.14em] text-[#8a6a1f]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b6862a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          {TOP_PICKS.title}
        </h2>
        <span className="text-[13px] text-[#8a6a1f]">{TOP_PICKS.note}</span>
        <Link href={signedIn ? "/dashboard/listings" : "/signup"} className="ml-auto text-sm font-bold text-green-700">
          Get your ad in Top picks →
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {picks.map((l) => (
          <ListingCard key={l.id} listing={l} signedIn={signedIn} topPick />
        ))}
      </div>
    </section>
  );
}
