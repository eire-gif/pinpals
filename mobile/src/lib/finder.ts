/**
 * Find by club, brand and model, with Top picks (0163) — the logic both the
 * website and the app use. This file is copied byte for byte to
 * mobile/src/lib/finder.ts (finder.test.ts checks), so it imports nothing.
 *
 * The flow: pick a club type or other item, then a brand, then a model. The
 * listings are always shown underneath and narrow at each step. Above them,
 * "Top picks": up to three paid adverts that match what's picked, each with
 * a PREMIUM badge. Premium Plus adverts come first; the rest take turns.
 */

/** The nine marketplace categories, in the order the first step shows them. */
export const FINDER_CATEGORIES: readonly { key: string; short: string; clubs: boolean }[] = [
  { key: "Drivers", short: "Drivers", clubs: true },
  { key: "Woods & hybrids", short: "Woods & hybrids", clubs: true },
  { key: "Irons", short: "Irons", clubs: true },
  { key: "Wedges", short: "Wedges", clubs: true },
  { key: "Putters", short: "Putters", clubs: true },
  { key: "Full sets", short: "Full sets", clubs: true },
  { key: "Bags & trolleys", short: "Bags & trolleys", clubs: false },
  { key: "Shoes & apparel", short: "Shoes & clothing", clubs: false },
  { key: "Balls & accessories", short: "Balls, GPS & more", clubs: false },
];

/** What the paid tiers are called, everywhere they're shown. */
export const TOP_PICKS = {
  title: "Top picks",
  badge: "PREMIUM",
  /** How many paid adverts the row holds. */
  slots: 3,
  /** Shown under the row heading. */
  note: "Sellers paid to show these first",
} as const;

export type FinderModel = {
  id: string;
  brandId: string;
  category: string;
  family: string;
  year: number | null;
  versions: string[];
};

export type FinderCount = {
  level: "category" | "brand" | "model";
  key: string;
  count: number;
  minPriceCents: number | null;
  maxPriceCents: number | null;
};

export type FinderStep = "category" | "brand" | "model" | "done";

export type FinderState = { category: string; brand: string; model: string };

/** Which step is waiting for an answer. */
export function finderStep(state: FinderState): FinderStep {
  if (!state.category) return "category";
  if (!state.brand) return "brand";
  if (!state.model) return "model";
  return "done";
}

/** Rows from marketplace_finder_counts(), tidied. Anything odd is dropped. */
export function countsFrom(rows: unknown): FinderCount[] {
  if (!Array.isArray(rows)) return [];
  const out: FinderCount[] = [];
  for (const raw of rows) {
    const r = raw as { level?: unknown; key?: unknown; listing_count?: unknown; min_price_cents?: unknown; max_price_cents?: unknown };
    if ((r.level !== "category" && r.level !== "brand" && r.level !== "model") || typeof r.key !== "string" || !r.key) continue;
    const n = Number(r.listing_count);
    out.push({
      level: r.level,
      key: r.key,
      count: Number.isFinite(n) ? n : 0,
      minPriceCents: r.min_price_cents == null ? null : Number(r.min_price_cents),
      maxPriceCents: r.max_price_cents == null ? null : Number(r.max_price_cents),
    });
  }
  return out;
}

export function countFor(counts: readonly FinderCount[], level: FinderCount["level"], key: string): FinderCount | undefined {
  return counts.find((c) => c.level === level && c.key === key);
}

/** Total listings for sale across every category. */
export function totalForSale(counts: readonly FinderCount[]): number {
  return counts.filter((c) => c.level === "category").reduce((sum, c) => sum + c.count, 0);
}

/**
 * The brand tiles for a category: brands with something for sale first
 * (most first), then the rest of the category's brands in their usual order.
 * `order` is the category's curated brand list.
 */
export function brandTiles(order: readonly string[], counts: readonly FinderCount[]): { id: string; count: number }[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  const ids = new Set(order);
  for (const c of counts) if (c.level === "brand") ids.add(c.key);
  return [...ids]
    .map((id) => ({ id, count: countFor(counts, "brand", id)?.count ?? 0 }))
    .sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0) || b.count - a.count || (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
}

/**
 * The model tiles for a brand: newest first. `forSale` has listings now;
 * `older` is the rest of the catalogue, for "see every model".
 */
export function modelTiles(
  models: readonly FinderModel[],
  counts: readonly FinderCount[]
): { forSale: (FinderModel & { count: number })[]; older: (FinderModel & { count: number })[] } {
  const withCounts = models
    .map((m) => ({ ...m, count: countFor(counts, "model", m.id)?.count ?? 0 }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.family.localeCompare(b.family));
  return { forSale: withCounts.filter((m) => m.count > 0), older: withCounts.filter((m) => m.count === 0) };
}

/** "€180–€290", "€250", or "" when there's no price. */
export function priceRange(minCents: number | null | undefined, maxCents: number | null | undefined): string {
  const euro = (c: number) => `€${Math.round(c / 100).toLocaleString("en-IE")}`;
  if (minCents == null && maxCents == null) return "";
  if (minCents == null || maxCents == null || minCents === maxCents) return euro((minCents ?? maxCents) as number);
  return `${euro(minCents)}–${euro(maxCents)}`;
}

/** "TaylorMade Qi10 drivers", "PING putters", "Irons", "Golf gear". */
export function finderHeading(state: FinderState, brandLabel: string, modelFamily: string): string {
  const cat = state.category ? state.category.toLowerCase() : "";
  if (state.model && modelFamily) return `${brandLabel} ${modelFamily} ${cat}`.trim();
  if (state.brand && brandLabel) return `${brandLabel} ${cat}`.trim();
  if (state.category) return state.category;
  return "Golf gear";
}

/** A small, repeatable shuffle, so Top picks take turns without jumping on every render. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Which paid adverts fill the Top picks row. Premium Plus first, then
 * Premium; within each, they take turns — `seed` changes every few minutes
 * (see topPicksSeed) so everyone who paid gets seen.
 */
export function chooseTopPicks<T extends { id: number; premiumPlus: boolean }>(
  candidates: readonly T[],
  seed: number,
  slots: number = TOP_PICKS.slots
): T[] {
  const rand = seeded(seed);
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  const plus = shuffle(unique.filter((c) => c.premiumPlus), rand);
  const rest = shuffle(unique.filter((c) => !c.premiumPlus), rand);
  return [...plus, ...rest].slice(0, Math.max(0, slots));
}

/** Changes every ten minutes. */
export function topPicksSeed(now: number = Date.now()): number {
  return Math.floor(now / 600_000);
}

/** The listings below Top picks: everything else, so no advert shows twice. */
export function withoutTopPicks<T extends { id: number }>(listings: readonly T[], picks: readonly { id: number }[]): T[] {
  const taken = new Set(picks.map((p) => p.id));
  return listings.filter((l) => !taken.has(l.id));
}

/**
 * Selling: the catalogue models a seller can pick for this brand and
 * category, newest first, matched against what they've typed so far.
 */
export function suggestModels(models: readonly FinderModel[], typed: string, limit = 8): FinderModel[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = models
    .map((m) => {
      const hay = [m.family, ...m.versions].join(" ").toLowerCase();
      const hit = words.every((w) => hay.includes(w));
      return { m, hit };
    })
    .filter((x) => words.length === 0 || x.hit)
    .map((x) => x.m)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.family.localeCompare(b.family));
  return scored.slice(0, limit);
}

/**
 * The catalogue model a listing's own words name, if any — the longest
 * family name that appears wins, so "Stealth 2" beats "Stealth".
 */
export function matchModel(models: readonly FinderModel[], text: string): FinderModel | null {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}.+-]+/gu, " ")} `;
  let best: FinderModel | null = null;
  for (const m of models) {
    const fam = m.family.toLowerCase();
    if (fam.length < 2) continue;
    if (hay.includes(` ${fam} `) || hay.includes(` ${fam}`)) {
      if (!best || fam.length > best.family.length) best = m;
    }
  }
  return best;
}

/** Rows from marketplace_models to FinderModel. */
export function modelsFrom(rows: unknown): FinderModel[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => raw as { id?: unknown; brand_id?: unknown; category?: unknown; family?: unknown; year?: unknown; versions?: unknown })
    .filter((r) => typeof r.id === "string" && typeof r.brand_id === "string" && typeof r.family === "string")
    .map((r) => ({
      id: r.id as string,
      brandId: r.brand_id as string,
      category: String(r.category ?? ""),
      family: r.family as string,
      year: r.year == null ? null : Number(r.year),
      versions: Array.isArray(r.versions) ? (r.versions as unknown[]).map(String) : [],
    }));
}

export const MODEL_COLUMNS = "id, brand_id, category, family, year, versions";
