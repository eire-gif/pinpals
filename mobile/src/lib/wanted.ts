/**
 * Wanted ads (0203, claude/wanted-ads.md): loading and saving.
 *
 * A member says what they're looking for; listings that fit tell them as
 * they go live (the database does that); a seller sees who's looking for
 * what they've listed and can send it to them.
 */
import type { Category } from "@/lib/listings";
import { supabase } from "@/lib/supabase";

export const FLEXES = ["Ladies", "Senior", "Regular", "Stiff", "Extra stiff"] as const;
export type Flex = (typeof FLEXES)[number];
export type Hand = "Right-handed" | "Left-handed";

export type WantedAd = {
  id: number;
  memberId: string;
  firstName: string | null;
  category: Category;
  details: string | null;
  flex: Flex | null;
  hand: Hand | null;
  maxPriceCents: number | null;
  county: string | null;
  status: "open" | "closed";
  expiresAt: string;
  createdAt: string;
};

export type WantedInput = { category: Category; details: string; flex: Flex | null; hand: Hand | null; maxPriceCents: number | null; county: string | null };

type Row = {
  id: number;
  member_id: string;
  category: Category;
  details: string | null;
  shaft_flex: Flex | null;
  dexterity: Hand | null;
  max_price_cents: number | null;
  county: string | null;
  status: "open" | "closed";
  expires_at: string;
  created_at: string;
  profile?: { first_name: string | null } | null;
};

const COLS = "id, member_id, category, details, shaft_flex, dexterity, max_price_cents, county, status, expires_at, created_at";

const toAd = (r: Row): WantedAd => ({
  id: r.id,
  memberId: r.member_id,
  firstName: r.profile?.first_name ?? null,
  category: r.category,
  details: r.details,
  flex: r.shaft_flex,
  hand: r.dexterity,
  maxPriceCents: r.max_price_cents,
  county: r.county,
  status: r.status,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

/** The database hasn't had 0203 yet. */
const missing = (e: { code?: string; message: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /does not exist|could not find/i.test(e.message));

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** My wanted ads, open first. Null before 0203. */
export async function loadMyWanted(me: string): Promise<WantedAd[] | null> {
  const { data, error } = await supabase.from("wanted_ads").select(COLS).eq("member_id", me).order("status", { ascending: false }).order("created_at", { ascending: false }).limit(30).overrideTypes<Row[]>();
  if (missing(error)) return null;
  if (error) fail(error, "Couldn't load your wanted ads.");
  return (data ?? []).map(toAd);
}

/** Open wanted ads from other members, newest first; in a county when given. */
export async function loadWantedBoard(me: string, county: string | null): Promise<WantedAd[]> {
  let q = supabase
    .from("wanted_ads")
    .select(`${COLS}, profile:profiles!wanted_ads_member_id_fkey(first_name)`)
    .eq("status", "open")
    .gt("expires_at", new Date().toISOString())
    .neq("member_id", me)
    .order("created_at", { ascending: false })
    .limit(60);
  if (county) q = q.or(`county.eq.${county},county.is.null`);
  const { data, error } = await q.overrideTypes<Row[]>();
  if (missing(error)) return [];
  if (error) fail(error, "Couldn't load the wanted ads.");
  return (data ?? []).map(toAd);
}

export async function saveWanted(id: number | null, w: WantedInput): Promise<number> {
  const { data, error } = await supabase.rpc("wanted_save", {
    p_id: id,
    p: { category: w.category, details: w.details.trim() || null, shaft_flex: w.flex, dexterity: w.hand, max_price_cents: w.maxPriceCents, county: w.county },
  });
  if (error) fail(error, "Couldn't save your wanted ad.");
  return Number(data);
}

export async function closeWanted(id: number): Promise<void> {
  const { error } = await supabase.rpc("wanted_close", { p_id: id });
  if (error) fail(error, "Couldn't take it down.");
}

export type ListingLite = { id: number; title: string; priceCents: number | null; county: string | null; imageUrl: string | null };

/** Live listings that would fit a wanted ad (or come close, when `close` is set), cheapest first. */
export async function listingsFor(w: Pick<WantedInput, "category" | "flex" | "hand" | "maxPriceCents" | "county">, me: string | null, limit = 5): Promise<ListingLite[]> {
  let q = supabase.from("listings").select("id, title, price_cents, price_eur, county, image_url, seller_id").eq("status", "active").eq("category", w.category);
  if (w.flex) q = q.eq("shaft_flex", w.flex);
  if (w.hand) q = q.eq("dexterity", w.hand);
  if (w.county) q = q.eq("county", w.county);
  if (w.maxPriceCents != null) q = q.lte("price_cents", w.maxPriceCents);
  if (me) q = q.neq("seller_id", me);
  const { data, error } = await q.order("price_cents", { ascending: true, nullsFirst: false }).limit(limit).overrideTypes<{ id: number; title: string; price_cents: number | null; price_eur: number | null; county: string | null; image_url: string | null }[]>();
  if (error) return [];
  return (data ?? []).map((l) => ({ id: l.id, title: l.title, priceCents: l.price_cents ?? (l.price_eur != null ? Math.round(l.price_eur * 100) : null), county: l.county, imageUrl: l.image_url }));
}

export type WantedMatch = {
  wantedId: number;
  memberId: string;
  firstName: string;
  county: string | null;
  details: string | null;
  flex: Flex | null;
  maxPriceCents: number | null;
  createdAt: string;
  fit: "fits" | "close";
  told: boolean;
};

/** A seller's listing: who's looking for one. Empty for anyone but the seller. */
export async function wantedMatches(listingId: number): Promise<WantedMatch[]> {
  const { data, error } = await supabase.rpc("wanted_matches_for_listing", { p_listing_id: listingId });
  if (error) return [];
  return ((data ?? []) as { wanted_id: number; member_id: string; first_name: string; county: string | null; details: string | null; shaft_flex: Flex | null; max_price_cents: number | null; created_at: string; fit: "fits" | "close"; told: boolean }[]).map((r) => ({
    wantedId: Number(r.wanted_id),
    memberId: r.member_id,
    firstName: r.first_name,
    county: r.county,
    details: r.details,
    flex: r.shaft_flex,
    maxPriceCents: r.max_price_cents,
    createdAt: r.created_at,
    fit: r.fit,
    told: r.told,
  }));
}

export async function sendListingTo(wantedId: number, listingId: number): Promise<void> {
  const { error } = await supabase.rpc("wanted_send_listing", { p_wanted_id: wantedId, p_listing_id: listingId });
  if (error) fail(error, "Couldn't send it.");
}

/** "3-wood, 15° · stiff · up to €100 · Dublin" */
export function wantedLine(w: Pick<WantedAd, "details" | "category" | "flex" | "hand" | "maxPriceCents" | "county">): string {
  return [
    w.details?.trim() || w.category,
    w.flex ? w.flex.toLowerCase() : null,
    w.hand === "Left-handed" ? "left-handed" : null,
    w.maxPriceCents != null ? `up to €${Math.round(w.maxPriceCents / 100)}` : null,
    w.county ?? "anywhere",
  ]
    .filter(Boolean)
    .join(" · ");
}
