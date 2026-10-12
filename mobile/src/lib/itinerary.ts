import type { ItemKind, OutingKind, PlayFormat } from "@/lib/itinerary-rules";
import { supabase } from "@/lib/supabase";

/**
 * Trip itineraries (0126): reads under RLS (the society's members), writes
 * through save_outing_item / delete_outing_item / set_outing_item_people.
 * The database's messages are written for members and shown as they come.
 */

export type ItemPerson = {
  memberId: string;
  name: string;
  firstName: string;
  /** A round's tee group, a stay's room; null on a flight or transfer. */
  slot: number | null;
  position: number | null;
};

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
  people: { member_id: string; slot: number | null; position: number | null; profile: { first_name: string | null; last_name: string | null } | null }[];
};

const ITEM = "id, outing_id, on_date, kind, starts_at, ends_at, title, details, club_id, from_place, to_place, carrier, nights, tee_interval, play_format";

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

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
  people: (r.people ?? []).map((p) => ({
    memberId: p.member_id,
    name: [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(" ") || "A member",
    firstName: p.profile?.first_name || "A member",
    slot: p.slot,
    position: p.position,
  })),
});

/** Everything on a trip, with who is on what. Unsorted: use sortItems(). */
export async function loadItinerary(outingId: number): Promise<ItineraryItem[]> {
  const { data, error } = await supabase
    .from("society_outing_items")
    .select(`${ITEM}, people:society_outing_item_people(member_id, slot, position, profile:profiles(first_name, last_name))`)
    .eq("outing_id", outingId)
    .overrideTypes<ItemRow[]>();
  if (error) fail(error, "Couldn't load the itinerary.");
  return (data ?? []).map(toItem);
}

export async function loadItineraryItem(itemId: number): Promise<ItineraryItem | null> {
  const { data, error } = await supabase
    .from("society_outing_items")
    .select(`${ITEM}, people:society_outing_item_people(member_id, slot, position, profile:profiles(first_name, last_name))`)
    .eq("id", itemId)
    .maybeSingle<ItemRow>();
  if (error) fail(error, "Couldn't load that.");
  return data ? toItem(data) : null;
}

export type ItemInput = {
  onDate: string;
  kind: ItemKind;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  details: string | null;
  clubId: number | null;
  fromPlace: string | null;
  toPlace: string | null;
  carrier: string | null;
  nights: number | null;
  teeInterval: number | null;
  playFormat: PlayFormat | null;
};

export async function saveItineraryItem(outingId: number, itemId: number | null, input: ItemInput): Promise<number> {
  const { data, error } = await supabase.rpc("save_outing_item", {
    p_outing_id: outingId,
    p_id: itemId,
    p: {
      on_date: input.onDate,
      kind: input.kind,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      details: input.details,
      club_id: input.clubId,
      from_place: input.fromPlace,
      to_place: input.toPlace,
      carrier: input.carrier,
      nights: input.nights,
      tee_interval: input.teeInterval,
      play_format: input.playFormat,
    },
  });
  if (error) fail(error, "Couldn't save that.");
  return Number(data);
}

export async function deleteItineraryItem(itemId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_outing_item", { p_item_id: itemId });
  if (error) fail(error, "Couldn't remove that.");
}

/** Replaces who is on an item; order within a slot is the order given. */
export async function setItemPeople(itemId: number, people: { memberId: string; slot: number | null }[]): Promise<void> {
  const { error } = await supabase.rpc("set_outing_item_people", {
    p_item_id: itemId,
    p_people: people.map((p) => ({ member: p.memberId, slot: p.slot })),
  });
  if (error) fail(error, "Couldn't save who's on it.");
}

// ---------------------------------------------------------------------------
// Profile › My trips
// ---------------------------------------------------------------------------

export type MyTrip = {
  outingId: number;
  groupId: number;
  groupName: string | null;
  kind: OutingKind;
  title: string;
  playsOn: string;
  endsOn: string;
  location: string | null;
  /** You set it up. */
  organiser: boolean;
};

/** Trips you're on, across your societies: upcoming soonest first, or past. */
export async function listMyTrips(userId: string, today: string, opts: { past?: boolean } = {}): Promise<MyTrip[]> {
  let q = supabase
    .from("society_outing_entries")
    .select("outing:society_outings!inner(id, group_id, kind, title, plays_on, ends_on, location, status, created_by, group:groups(name))")
    .eq("member_id", userId)
    .neq("outing.kind", "day")
    .eq("outing.status", "open");
  q = opts.past ? q.lt("outing.ends_on", today) : q.gte("outing.ends_on", today);
  const { data, error } = await q.limit(40).overrideTypes<
    {
      outing: {
        id: number;
        group_id: number;
        kind: OutingKind;
        title: string;
        plays_on: string;
        ends_on: string;
        location: string | null;
        created_by: string | null;
        group: { name: string } | null;
      };
    }[]
  >();
  if (error) fail(error, "Couldn't load your trips.");
  const trips = (data ?? []).map(({ outing: o }) => ({
    outingId: o.id,
    groupId: o.group_id,
    groupName: o.group?.name ?? null,
    kind: o.kind,
    title: o.title,
    playsOn: o.plays_on,
    endsOn: o.ends_on,
    location: o.location,
    organiser: o.created_by === userId,
  }));
  return trips.sort((a, b) => (opts.past ? b.playsOn.localeCompare(a.playsOn) : a.playsOn.localeCompare(b.playsOn)));
}
