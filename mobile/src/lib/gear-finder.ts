import {
  MODEL_COLUMNS,
  chooseTopPicks,
  countsFrom,
  modelsFrom,
  topPicksSeed,
  type FinderCount,
  type FinderModel,
} from "@/lib/finder";
import { brandsFor } from "@/lib/listings";
import { CARD_COLUMNS, rowsToCards, type Card, type Filters } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";

/**
 * Find by club, brand and model, and Top picks (0163) — the app's data. The
 * same rules as the website (src/lib/finder.ts, shared byte for byte).
 *
 * Everything returns empty rather than throwing: the finder sits above the
 * listings and must never take them down with it.
 */

export type FinderBrand = { id: string; label: string; logoUrl: string | null };

let brandCache: Map<string, FinderBrand> | null = null;

/** Every brand with its logo (uploaded in Admin → Brands on the website). */
export async function loadFinderBrands(): Promise<Map<string, FinderBrand>> {
  if (brandCache) return brandCache;
  const withLogos = await supabase.from("marketplace_brands").select("id, label, logo_url").eq("is_fallback", false);
  const rows = withLogos.error
    ? ((await supabase.from("marketplace_brands").select("id, label").eq("is_fallback", false)).data ?? []).map((b: { id: string; label: string }) => ({ ...b, logo_url: null }))
    : (withLogos.data ?? []);
  const map = new Map<string, FinderBrand>(
    (rows as { id: string; label: string; logo_url: string | null }[]).map((b) => [b.id, { id: b.id, label: b.label, logoUrl: b.logo_url }])
  );
  if (map.size > 0) brandCache = map;
  return map;
}

export async function loadFinderCounts(category: string, brand: string): Promise<FinderCount[]> {
  const { data, error } = await supabase.rpc("marketplace_finder_counts", { p_category: category || null, p_brand: brand || null });
  return error ? [] : countsFrom(data);
}

export async function loadFinderModels(brand: string, category: string): Promise<FinderModel[]> {
  if (!brand || !category) return [];
  const { data, error } = await supabase
    .from("marketplace_models")
    .select(MODEL_COLUMNS)
    .eq("brand_id", brand)
    .eq("category", category)
    .eq("active", true);
  return error ? [] : modelsFrom(data);
}

/** The brand order for a category — the same list the sell form offers. */
export async function categoryBrandOrder(category: string): Promise<string[]> {
  return (await brandsFor(category)).map((b) => b.id);
}

/** Paid adverts matching what's picked, Premium Plus first, three at most. */
export async function loadTopPicks(filters: Filters, userId: string | null): Promise<Card[]> {
  let q = supabase
    .from("listings")
    .select(`${CARD_COLUMNS}, top_pick_until`)
    .eq("status", "active")
    .is("store_id", null)
    .gt("top_pick_until", new Date().toISOString());
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.brands.length === 1) q = q.eq("brand", filters.brands[0]);
  else if (filters.brands.length > 1) q = q.in("brand", filters.brands);
  if (filters.model) q = q.eq("model_id", filters.model);
  const { data, error } = await q.order("top_pick_until", { ascending: false }).limit(40);
  if (error || !data || data.length === 0) return [];
  const rows = data as unknown as { id: number; featured_until: string | null }[];
  const picks = chooseTopPicks(
    rows.map((r) => ({ ...r, premiumPlus: !!r.featured_until && Date.parse(r.featured_until) > Date.now() })),
    topPicksSeed()
  );
  const cards = await rowsToCards(picks, userId);
  return cards.map((c) => ({ ...c, topPick: true }));
}

/** When this listing's Top picks placement ends, if it has one running. */
export async function topPickUntil(listingId: number): Promise<string | null> {
  const { data, error } = await supabase.from("listings").select("top_pick_until").eq("id", listingId).maybeSingle();
  if (error || !data) return null;
  const until = (data as { top_pick_until: string | null }).top_pick_until;
  return until && Date.parse(until) > Date.now() ? until : null;
}
