import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ItemKind, PlayFormat } from "./events-trips";

/**
 * Reads for the console's events pages that data.ts doesn't have — the same
 * tables and columns the app reads (groups-data.loadGroupRoster,
 * outings.loadClub, itinerary.loadItinerary), with the member's own client.
 */

type Db = SupabaseClient;

const fullName = (p: { first_name: string | null; last_name: string | null } | null | undefined): string =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member";

export type RosterPlayer = { id: string; name: string; index: number | null; fromSociety: boolean; avatarUrl: string | null };

/**
 * Everyone in the society with the index the draw uses: the society's own
 * figure (set by its handicap secretary) first, then the member's own index
 * where they share it. Exactly the app's loadGroupRoster — readable by any
 * member, so an event organiser (no "people" area) gets it too.
 */
export async function loadRoster(db: Db, groupId: number): Promise<RosterPlayer[]> {
  const { data, error } = await db
    .from("group_members")
    .select("member_id, society_index, profile:profiles(first_name, last_name, handicap, handicap_visible, avatar_url)")
    .eq("group_id", groupId)
    .overrideTypes<
      {
        member_id: string;
        society_index: number | string | null;
        profile: { first_name: string | null; last_name: string | null; handicap: number | string | null; handicap_visible: boolean | null; avatar_url: string | null } | null;
      }[]
    >();
  if (error) throw new Error(error.message || "Couldn't load the society's members.");
  return (data ?? [])
    .map((r) => ({
      id: r.member_id,
      name: fullName(r.profile),
      index: r.society_index != null ? Number(r.society_index) : r.profile?.handicap_visible && r.profile.handicap != null ? Number(r.profile.handicap) : null,
      fromSociety: r.society_index != null,
      avatarUrl: r.profile?.avatar_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
}

export type ClubRef = { id: number; name: string; country: string | null; place: string | null };

/** A club as the course picker wants it (world-readable, as on /courses). */
export async function loadClub(db: Db, clubId: number | null): Promise<ClubRef | null> {
  if (!clubId) return null;
  const { data } = await db.from("clubs").select("id, name, country, region, town").eq("id", clubId).maybeSingle<{ id: number; name: string; country: string | null; region: string | null; town: string | null }>();
  return data ? { id: data.id, name: data.name, country: data.country, place: [data.town, data.region].filter(Boolean).join(", ") || null } : null;
}

// ---------------------------------------------------------------------------
// Trip itineraries (0126)
// ---------------------------------------------------------------------------

export type ItemPerson = { memberId: string; name: string; slot: number | null; position: number | null };

export type ItineraryItem = {
  id: number;
  outingId: number;
  onDate: string;
  kind: ItemKind;
  startsAt: string | null;
  endsAt: string | null;
  title: string;
  details: string | null;
  clubId: number | null;
  fromPlace: string | null;
  toPlace: string | null;
  carrier: string | null;
  nights: number | null;
  teeInterval: number | null;
  playFormat: PlayFormat | null;
  people: ItemPerson[];
};

type ItemRow = {
  id: number;
  outing_id: number;
  on_date: string;
  kind: ItemKind;
  starts_at: string | null;
  ends_at: string | null;
  title: string;
  details: string | null;
  club_id: number | null;
  from_place: string | null;
  to_place: string | null;
  carrier: string | null;
  nights: number | null;
  tee_interval: number | null;
  play_format: PlayFormat | null;
  people: { member_id: string; slot: number | null; position: number | null; profile: { first_name: string | null; last_name: string | null } | null }[] | null;
};

const ITEM =
  "id, outing_id, on_date, kind, starts_at, ends_at, title, details, club_id, from_place, to_place, carrier, nights, tee_interval, play_format, people:society_outing_item_people(member_id, slot, position, profile:profiles(first_name, last_name))";

const toItem = (r: ItemRow): ItineraryItem => ({
  id: r.id,
  outingId: r.outing_id,
  onDate: r.on_date,
  kind: r.kind,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  title: r.title,
  details: r.details,
  clubId: r.club_id,
  fromPlace: r.from_place,
  toPlace: r.to_place,
  carrier: r.carrier,
  nights: r.nights,
  teeInterval: r.tee_interval,
  playFormat: r.play_format,
  people: (r.people ?? []).map((p) => ({ memberId: p.member_id, name: fullName(p.profile), slot: p.slot, position: p.position })),
});

/** Everything on a trip, with who's on what. Unsorted: use sortItems(). */
export async function loadItinerary(db: Db, outingId: number): Promise<ItineraryItem[]> {
  const { data, error } = await db.from("society_outing_items").select(ITEM).eq("outing_id", outingId).overrideTypes<ItemRow[]>();
  if (error) throw new Error(error.message || "Couldn't load the itinerary.");
  return (data ?? []).map(toItem);
}

/** One item, only if it's on this outing. */
export async function loadItineraryItem(db: Db, outingId: number, itemId: number): Promise<ItineraryItem | null> {
  const { data, error } = await db.from("society_outing_items").select(ITEM).eq("id", itemId).eq("outing_id", outingId).maybeSingle<ItemRow>();
  if (error) throw new Error(error.message || "Couldn't load that.");
  return data ? toItem(data) : null;
}
