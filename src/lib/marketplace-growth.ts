import type { SupabaseClient } from "@supabase/supabase-js";

import type { Listing } from "@/lib/types";

/**
 * The marketplace's paid extras and New Gear (0115), shared by the website's
 * pages, the Stripe webhook and the admin console.
 *
 *   Promotions  — Featured (€4.99, 7 days at the top) and Bump (€1.99, back
 *                 to the top of Fresh today). Bought on the website only:
 *                 a promotion is a digital service, so App Store rule 3.1.1
 *                 keeps it out of the app.
 *   Pro shops   — approved by PinPals, sell new stock, pay commission
 *                 (stores.commission_rate, 8% by default) instead of the
 *                 buyer paying Buyer Protection.
 *   Retailers   — affiliate products; the url carries the affiliate tag.
 *   Banners     — sponsored, flat fee recorded in fee_eur.
 */

export type PromotionKind = "featured" | "bump";

export const PROMOTIONS: Record<PromotionKind, { eur: number; days: number; title: string; blurb: string }> = {
  featured: {
    eur: 4.99,
    days: 7,
    title: "Featured",
    blurb: "Top of Used Gear for 7 days, with a gold Featured badge — and a bump to Fresh today.",
  },
  bump: {
    eur: 1.99,
    days: 3,
    title: "Bump",
    blurb: "Back to the top of Fresh today, as if you'd just listed it.",
  },
};

export function isPromotionKind(value: unknown): value is PromotionKind {
  return value === "featured" || value === "bump";
}

export type Store = {
  id: number;
  slug: string;
  name: string;
  club_id: number | null;
  owner_id: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  email: string | null;
  offers_fittings: boolean;
  status: "pending" | "active" | "suspended";
  commission_rate: number;
  approved_at: string | null;
  created_at: string;
  clubs?: { name: string; county: string | null } | null;
};

export const STORE_COLUMNS =
  "id, slug, name, club_id, owner_id, description, logo_url, cover_url, phone, email, offers_fittings, status, commission_rate, approved_at, created_at, clubs ( name, county )";

export type AffiliateProduct = {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  price_eur: number | null;
  was_price_eur: number | null;
  image_url: string | null;
  retailer: string;
  url: string;
  active: boolean;
  sort_order: number;
  clicks: number;
  created_at: string;
};

export type Banner = {
  id: number;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  link_url: string;
  sponsor: string;
  placement: "new_gear" | "used_gear";
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  impressions: number;
  clicks: number;
  fee_eur: number | null;
  created_at: string;
};

export function isFeatured(listing: { featured_until?: string | null }, now = Date.now()): boolean {
  return !!listing.featured_until && Date.parse(listing.featured_until) > now;
}

/** "Portmarnock Golf Club" → "Portmarnock GC" (same as the app). */
export function shortClub(name: string): string {
  return name
    .replace(/\bGolf (and|&) Country Club\b/i, "G&CC")
    .replace(/\bGolf Club\b/i, "GC")
    .replace(/\bGolf Links\b/i, "Links")
    .trim();
}

export async function loadActiveStores(supabase: SupabaseClient, limit = 60): Promise<Store[]> {
  const { data } = await supabase
    .from("stores")
    .select(STORE_COLUMNS)
    .eq("status", "active")
    .order("name")
    .limit(limit)
    .returns<Store[]>();
  return data ?? [];
}

export async function loadAffiliateDeals(supabase: SupabaseClient, limit = 12): Promise<AffiliateProduct[]> {
  const { data } = await supabase
    .from("affiliate_products")
    .select("id, title, brand, category, price_eur, was_price_eur, image_url, retailer, url, active, sort_order, clicks, created_at")
    .eq("active", true)
    .order("sort_order")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AffiliateProduct[]>();
  return data ?? [];
}

export async function loadLiveBanner(supabase: SupabaseClient, placement: Banner["placement"]): Promise<Banner | null> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("marketplace_banners")
    .select("*")
    .eq("placement", placement)
    .eq("active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<Banner>();
  return data ?? null;
}

/** Rounded to the cent, as Stripe and numeric(10,2) both want it. */
export function commissionFor(amountEur: number, rate: number): number {
  return Math.round(amountEur * rate * 100) / 100;
}

/**
 * Shop stock and Featured used gear, shaped like the search results so the
 * same ListingCard draws them. Fixed-price only, so no auction lookups.
 */
export async function loadListingsForCards(
  supabase: SupabaseClient,
  which: { storeId?: number; anyShop?: boolean; featured?: boolean },
  userId: string | null,
  limit = 12
): Promise<(Listing & { auction: null; currentBidCents: null; isFavourited: boolean })[]> {
  let q = supabase.from("listings").select("*").eq("status", "active");
  if (which.storeId) q = q.eq("store_id", which.storeId);
  else if (which.anyShop) q = q.not("store_id", "is", null);
  else q = q.is("store_id", null);
  if (which.featured) q = q.gt("featured_until", new Date().toISOString()).order("featured_until", { ascending: false });
  const { data } = await q.order("created_at", { ascending: false }).limit(limit).returns<Listing[]>();
  const rows = data ?? [];
  let favourites = new Set<number>();
  if (userId && rows.length > 0) {
    const { data: favs } = await supabase
      .from("listing_favourites")
      .select("listing_id")
      .eq("user_id", userId)
      .in("listing_id", rows.map((r) => r.id));
    favourites = new Set((favs ?? []).map((f: { listing_id: number }) => f.listing_id));
  }
  return rows.map((r) => ({ ...r, auction: null, currentBidCents: null, isFavourited: favourites.has(r.id) }));
}
