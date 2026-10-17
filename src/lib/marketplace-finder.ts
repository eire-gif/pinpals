import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MODEL_COLUMNS,
  chooseTopPicks,
  countsFrom,
  modelsFrom,
  topPicksSeed,
  type FinderCount,
  type FinderModel,
} from "@/lib/finder";
import { enrichListings, type MarketplaceFilters, type MarketplaceListing } from "@/lib/marketplace-discovery";
import { isFeatured } from "@/lib/marketplace-growth";
import type { Listing } from "@/lib/types";

/**
 * Find by club, brand and model, and Top picks (0163) — the website's data.
 * The shared rules (what counts, who goes first) are in src/lib/finder.ts.
 *
 * Every loader here returns empty rather than throwing: the finder sits
 * above the listings, and a hiccup in it (or a database without 0163 yet)
 * must never take the listings down with it.
 */

export type BrandRow = { id: string; label: string; logo_url: string | null; is_fallback: boolean };

/** Every brand, with its logo if one's been uploaded. */
export async function loadBrandRows(supabase: SupabaseClient): Promise<BrandRow[]> {
  const withLogos = await supabase.from("marketplace_brands").select("id, label, logo_url, is_fallback").order("label");
  if (!withLogos.error) return (withLogos.data ?? []) as BrandRow[];
  // Before 0163 there's no logo_url column.
  const plain = await supabase.from("marketplace_brands").select("id, label, is_fallback").order("label");
  return ((plain.data ?? []) as Omit<BrandRow, "logo_url">[]).map((b) => ({ ...b, logo_url: null }));
}

export async function loadFinderCounts(supabase: SupabaseClient, category: string, brand: string): Promise<FinderCount[]> {
  const { data, error } = await supabase.rpc("marketplace_finder_counts", {
    p_category: category || null,
    p_brand: brand || null,
  });
  return error ? [] : countsFrom(data);
}

/** A brand's catalogue models in one category. */
export async function loadModels(supabase: SupabaseClient, brand: string, category: string): Promise<FinderModel[]> {
  if (!brand || !category) return [];
  const { data, error } = await supabase
    .from("marketplace_models")
    .select(MODEL_COLUMNS)
    .eq("brand_id", brand)
    .eq("category", category)
    .eq("active", true);
  return error ? [] : modelsFrom(data);
}

export async function loadModel(supabase: SupabaseClient, id: string): Promise<FinderModel | null> {
  if (!id) return null;
  const { data, error } = await supabase.from("marketplace_models").select(MODEL_COLUMNS).eq("id", id).maybeSingle();
  return error || !data ? null : modelsFrom([data])[0] ?? null;
}

export type TopPick = MarketplaceListing & { premiumPlus: boolean };

/**
 * The Top picks row for what's picked: paid adverts (top_pick_until in the
 * future) matching the club type, brand and model. Premium Plus first, the
 * rest taking turns.
 */
export async function loadTopPicks(supabase: SupabaseClient, filters: MarketplaceFilters, userId: string | null): Promise<TopPick[]> {
  let q = supabase
    .from("listings")
    .select("*")
    .eq("status", "active")
    .is("store_id", null)
    .gt("top_pick_until", new Date().toISOString());
  if (filters.category) q = q.eq("category", filters.category);
  if (filters.brands.length === 1) q = q.eq("brand", filters.brands[0]);
  else if (filters.brands.length > 1) q = q.in("brand", filters.brands);
  if (filters.model) q = q.eq("model_id", filters.model);
  const { data, error } = await q.order("top_pick_until", { ascending: false }).limit(40).returns<Listing[]>();
  if (error || !data || data.length === 0) return [];

  const picks = chooseTopPicks(
    data.map((l) => ({ ...l, premiumPlus: isFeatured(l) })),
    topPicksSeed()
  );
  const enriched = await enrichListings(supabase, picks, userId);
  return enriched.map((l) => ({ ...l, premiumPlus: isFeatured(l) }));
}
