import { distanceKm } from "@/lib/courses";
import type { Coords } from "@/lib/location";
import { CARD_COLUMNS, rowsToCards, type Card } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";

/**
 * Used Gear's home (Oct 2026 redesign): the rails above the full search —
 * Featured, "Collect at <your club>", near you, and fresh today — plus the
 * club and distance on every card.
 *
 * Where an item can be collected is its seller's home club: members meet at
 * the club (Buyer Protection, 0114). So distance is club to club (or to the
 * member's own position when they've shared it).
 */

export async function loadFeatured(userId: string | null, limit = 10): Promise<Card[]> {
  const { data } = await supabase
    .from("listings")
    .select(CARD_COLUMNS)
    .eq("status", "active")
    .is("store_id", null)
    .gt("featured_until", new Date().toISOString())
    .order("featured_until", { ascending: false })
    .limit(limit);
  return rowsToCards(data ?? [], userId);
}

/** Newest first — new listings and freshly bumped ones (0115) together. */
export async function loadFresh(userId: string | null, limit = 12): Promise<Card[]> {
  const [recent, bumped] = await Promise.all([
    supabase.from("listings").select(`${CARD_COLUMNS}, bumped_at`).eq("status", "active").is("store_id", null).order("created_at", { ascending: false }).limit(limit),
    supabase
      .from("listings")
      .select(`${CARD_COLUMNS}, bumped_at`)
      .eq("status", "active")
      .is("store_id", null)
      .not("bumped_at", "is", null)
      .order("bumped_at", { ascending: false })
      .limit(limit),
  ]);
  const byId = new Map<number, { row: Record<string, unknown>; at: number }>();
  for (const row of [...(recent.data ?? []), ...(bumped.data ?? [])] as Record<string, unknown>[]) {
    const at = Math.max(Date.parse(String(row.created_at)), row.bumped_at ? Date.parse(String(row.bumped_at)) : 0);
    byId.set(Number(row.id), { row, at });
  }
  const rows = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, limit).map((x) => x.row);
  return rowsToCards(rows, userId);
}

/** Members' listings whose seller calls one of these clubs home. */
export async function loadAtClubs(clubIds: number[], userId: string | null, limit = 20): Promise<Card[]> {
  if (clubIds.length === 0) return [];
  const { data: sellers } = await supabase.from("profiles").select("id").in("home_club_id", clubIds.slice(0, 200)).limit(500);
  const ids = (sellers ?? []).map((s: { id: string }) => s.id).filter((id) => id !== userId);
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("listings")
    .select(CARD_COLUMNS)
    .eq("status", "active")
    .is("store_id", null)
    .in("seller_id", ids)
    .order("created_at", { ascending: false })
    .limit(limit);
  return rowsToCards(data ?? [], userId);
}

/**
 * Fill in each card's collection club and distance. `from` is the member's
 * position, or their own club's — whichever we have.
 */
export async function decorateCards(cards: Card[], from: Coords | null): Promise<Card[]> {
  const sellerIds = [...new Set(cards.map((c) => c.sellerId).filter((x): x is string => !!x))];
  if (sellerIds.length === 0) return cards;
  const { data: profiles } = await supabase.from("profiles").select("id, home_club_id").in("id", sellerIds);
  const clubOf = new Map((profiles ?? []).map((p: { id: string; home_club_id: number | null }) => [p.id, p.home_club_id]));
  const clubIds = [...new Set([...clubOf.values()].filter((x): x is number => x != null))];
  const { data: clubs } = clubIds.length
    ? await supabase.from("clubs").select("id, name, latitude, longitude").in("id", clubIds)
    : { data: [] };
  const club = new Map((clubs ?? []).map((c: { id: number; name: string; latitude: number | null; longitude: number | null }) => [c.id, c]));
  return cards.map((card) => {
    const c = card.sellerId ? club.get(clubOf.get(card.sellerId) ?? -1) : undefined;
    if (!c) return card;
    const km = from && c.latitude != null && c.longitude != null ? distanceKm(from.lat, from.lng, c.latitude, c.longitude) : null;
    return { ...card, clubName: shortClub(c.name), distanceKm: km };
  });
}

/** "Portmarnock Golf Club" → "Portmarnock GC". */
export function shortClub(name: string): string {
  return name.replace(/\bGolf (and|&) Country Club\b/i, "G&CC").replace(/\bGolf Club\b/i, "GC").replace(/\bGolf Links\b/i, "Links").trim();
}

export function kmLabel(km: number | null | undefined): string | null {
  if (km == null) return null;
  return km < 1 ? "<1 km" : `${Math.round(km)} km`;
}
