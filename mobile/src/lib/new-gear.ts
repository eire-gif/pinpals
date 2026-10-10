import { Linking } from "react-native";

import { distanceKm } from "@/lib/courses";
import type { Coords } from "@/lib/location";
import { CARD_COLUMNS, rowsToCards, type Card } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";

/**
 * New Gear (0115): pro shop storefronts and their stock, retailer
 * (affiliate) products, and the sponsored banner.
 */

export type Store = {
  id: number;
  slug: string;
  name: string;
  clubId: number | null;
  clubName: string | null;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  offersFittings: boolean;
  distanceKm: number | null;
};

export type AffiliateProduct = {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  priceEur: number | null;
  wasPriceEur: number | null;
  imageUrl: string | null;
  retailer: string;
};

export type Banner = {
  id: number;
  eyebrow: string | null;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  sponsor: string;
};

type StoreRow = {
  id: number;
  slug: string;
  name: string;
  club_id: number | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  offers_fittings: boolean;
  clubs: { name: string; latitude: number | null; longitude: number | null } | null;
};

export async function loadStores(from: Coords | null): Promise<Store[]> {
  const { data } = await supabase
    .from("stores")
    .select("id, slug, name, club_id, description, logo_url, cover_url, offers_fittings, clubs ( name, latitude, longitude )")
    .eq("status", "active")
    .limit(60)
    .overrideTypes<StoreRow[]>();
  const stores = (data ?? []).map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    clubId: s.club_id,
    clubName: s.clubs?.name ?? null,
    description: s.description,
    logoUrl: s.logo_url,
    coverUrl: s.cover_url,
    offersFittings: s.offers_fittings,
    distanceKm:
      from && s.clubs?.latitude != null && s.clubs?.longitude != null ? distanceKm(from.lat, from.lng, s.clubs.latitude, s.clubs.longitude) : null,
  }));
  // Nearest first when we know where the member is; otherwise A–Z.
  return stores.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name));
}

export async function loadStore(slugOrId: string): Promise<Store | null> {
  const query = supabase
    .from("stores")
    .select("id, slug, name, club_id, description, logo_url, cover_url, offers_fittings, clubs ( name, latitude, longitude )");
  const { data } = await (/^\d+$/.test(slugOrId) ? query.eq("id", Number(slugOrId)) : query.eq("slug", slugOrId)).maybeSingle<StoreRow>();
  if (!data) return null;
  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    clubId: data.club_id,
    clubName: data.clubs?.name ?? null,
    description: data.description,
    logoUrl: data.logo_url,
    coverUrl: data.cover_url,
    offersFittings: data.offers_fittings,
    distanceKm: null,
  };
}

/** Shop stock: one shop's, or every shop's newest. */
export async function loadShopListings(userId: string | null, storeId?: number, limit = 24): Promise<Card[]> {
  let q = supabase.from("listings").select(CARD_COLUMNS).eq("status", "active").not("store_id", "is", null);
  if (storeId) q = q.eq("store_id", storeId);
  const { data } = await q.order("featured_until", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(limit);
  return rowsToCards(data ?? [], userId);
}

export async function loadAffiliates(limit = 24): Promise<AffiliateProduct[]> {
  const { data } = await supabase
    .from("affiliate_products")
    .select("id, title, brand, category, price_eur, was_price_eur, image_url, retailer")
    .eq("active", true)
    .order("sort_order")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(
    (p: { id: number; title: string; brand: string | null; category: string | null; price_eur: number | null; was_price_eur: number | null; image_url: string | null; retailer: string }) => ({
      id: p.id,
      title: p.title,
      brand: p.brand,
      category: p.category,
      priceEur: p.price_eur == null ? null : Number(p.price_eur),
      wasPriceEur: p.was_price_eur == null ? null : Number(p.was_price_eur),
      imageUrl: p.image_url,
      retailer: p.retailer,
    })
  );
}

export async function loadBanner(placement: "new_gear" | "used_gear" = "new_gear"): Promise<Banner | null> {
  const { data } = await supabase
    .from("marketplace_banners")
    .select("id, eyebrow, title, subtitle, image_url, sponsor")
    .eq("placement", placement)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: number; eyebrow: string | null; title: string; subtitle: string | null; image_url: string | null; sponsor: string }>();
  if (!data) return null;
  void supabase.rpc("banner_seen", { p_banner_id: data.id });
  return { id: data.id, eyebrow: data.eyebrow, title: data.title, subtitle: data.subtitle, imageUrl: data.image_url, sponsor: data.sponsor };
}

/** Count the tap, then open the sponsor's page. */
export async function openBanner(id: number): Promise<void> {
  const { data } = await supabase.rpc("banner_clicked", { p_banner_id: id });
  if (typeof data === "string" && data.startsWith("https://")) await Linking.openURL(data);
}

/** Count the tap, then open the retailer (the URL carries the affiliate tag). */
export async function openAffiliate(id: number): Promise<void> {
  const { data } = await supabase.rpc("affiliate_clicked", { p_product_id: id, p_source: "app" });
  if (typeof data === "string" && data.startsWith("https://")) await Linking.openURL(data);
}
