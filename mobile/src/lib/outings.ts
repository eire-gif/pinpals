import type { Club } from "@/lib/courses";
import type { OutingKind } from "@/lib/itinerary-rules";
import type { ClaimMethod } from "@/lib/outing-payments";
import type { PaidStatus } from "@/lib/outing-rules";
import { supabase } from "@/lib/supabase";

/**
 * Society outings (0125): reads under RLS, writes through its functions.
 * Every rule (who may, entries closing at midnight, places) is the
 * database's; its messages are written for members and shown as they come.
 */

export type Outing = {
  id: number;
  groupId: number;
  /** A day out, or a trip (overnight / abroad) with an itinerary (0126). */
  kind: OutingKind;
  title: string;
  clubId: number | null;
  /** A day out's course. Null on a trip: its courses are on its rounds. */
  courseName: string | null;
  playsOn: string;
  /** A trip's last day; null on a day out. */
  endsOn: string | null;
  /** A trip's place, e.g. "Vale do Lobo, Portugal". */
  location: string | null;
  /** How to pay (0127): Revolut username, bank details, cash, a note. Members only. */
  payRevtag: string | null;
  payIban: string | null;
  payAccountName: string | null;
  payCash: boolean;
  payNote: string | null;
  firstTee: string | null;
  details: string | null;
  entryFeeCents: number | null;
  maxEntries: number | null;
  status: "open" | "cancelled";
  drawPublishedAt: string | null;
  matchDayId: number | null;
};

export type OutingEntry = {
  memberId: string;
  name: string;
  homeClub: string | null;
  avatarUrl: string | null;
  avatarColor: string | null;
  enteredAt: string;
  teeGroup: number | null;
  teeTime: string | null;
  teePosition: number | null;
};

/**
 * A guest on an event (0131): someone not on PinPals, entered by the
 * captain or secretary. They take a place and go in the draw like anyone.
 */
export type OutingGuest = {
  id: number;
  name: string;
  handicapIndex: number | null;
  teeGroup: number | null;
  teeTime: string | null;
  teePosition: number | null;
};

type GuestRow = {
  id: number;
  name: string;
  handicap_index: number | string | null;
  tee_group: number | null;
  tee_time: string | null;
  tee_position: number | null;
};

const toGuest = (g: GuestRow): OutingGuest => ({
  id: g.id,
  name: g.name,
  handicapIndex: g.handicap_index == null ? null : Number(g.handicap_index),
  teeGroup: g.tee_group,
  teeTime: g.tee_time,
  teePosition: g.tee_position,
});

const GUEST = "id, name, handicap_index, tee_group, tee_time, tee_position";

type OutingRow = {
  id: number;
  group_id: number;
  kind: OutingKind;
  title: string;
  club_id: number | null;
  course_name: string | null;
  plays_on: string;
  ends_on: string | null;
  location: string | null;
  pay_revtag: string | null;
  pay_iban: string | null;
  pay_account_name: string | null;
  pay_cash: boolean | null;
  pay_note: string | null;
  first_tee: string | null;
  details: string | null;
  entry_fee_cents: number | null;
  max_entries: number | null;
  status: "open" | "cancelled";
  draw_published_at: string | null;
  match_day_id: number | null;
};

const OUTING = "id, group_id, kind, title, club_id, course_name, plays_on, ends_on, location, first_tee, details, entry_fee_cents, max_entries, status, draw_published_at, match_day_id, pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note";

const toOuting = (r: OutingRow): Outing => ({
  id: r.id,
  groupId: r.group_id,
  kind: r.kind ?? "day",
  title: r.title,
  clubId: r.club_id,
  courseName: r.course_name,
  playsOn: r.plays_on,
  endsOn: r.ends_on,
  location: r.location,
  payRevtag: r.pay_revtag ?? null,
  payIban: r.pay_iban ?? null,
  payAccountName: r.pay_account_name ?? null,
  payCash: r.pay_cash ?? true,
  payNote: r.pay_note ?? null,
  firstTee: r.first_tee,
  details: r.details,
  entryFeeCents: r.entry_fee_cents,
  maxEntries: r.max_entries,
  status: r.status,
  drawPublishedAt: r.draw_published_at,
  matchDayId: r.match_day_id,
});

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type OutingSummary = Outing & {
  entered: number;
  /** You're in it. */
  mine: boolean;
  /** Your tee time, once the draw is out. */
  myTeeGroup: number | null;
  myTeeTime: string | null;
};

/** A society's outings from `fromDate` on (or all past ones), soonest first. */
export async function listOutings(groupId: number, userId: string, opts: { fromDate: string; past?: boolean }): Promise<OutingSummary[]> {
  const counts = await guestCounts(groupId);
  let q = supabase.from("society_outings").select(`${OUTING}, entries:society_outing_entries(member_id, tee_group, tee_time)`).eq("group_id", groupId);
  // A trip counts as upcoming until its last day is over (0126).
  const d = opts.fromDate;
  q = opts.past
    ? q.lt("plays_on", d).or(`ends_on.is.null,ends_on.lt.${d}`).order("plays_on", { ascending: false }).limit(30)
    : q.or(`plays_on.gte.${d},ends_on.gte.${d}`).order("plays_on");
  const { data, error } = await q.overrideTypes<(OutingRow & { entries: { member_id: string; tee_group: number | null; tee_time: string | null }[] })[]>();
  if (error) fail(error, "Couldn't load the outings.");
  return (data ?? []).map((r) => {
    const me = r.entries.find((e) => e.member_id === userId);
    return { ...toOuting(r), entered: r.entries.length + (counts.get(r.id) ?? 0), mine: !!me, myTeeGroup: me?.tee_group ?? null, myTeeTime: me?.tee_time ?? null };
  });
}

/** Guests per outing in one group. Empty on a database without 0131. */
async function guestCounts(groupId: number): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("society_outing_guests")
    .select("outing_id, outing:society_outings!inner(group_id)")
    .eq("outing.group_id", groupId)
    .overrideTypes<{ outing_id: number }[]>();
  const out = new Map<number, number>();
  if (error) return out;
  for (const g of data ?? []) out.set(g.outing_id, (out.get(g.outing_id) ?? 0) + 1);
  return out;
}

// ---------------------------------------------------------------------------
// One outing
// ---------------------------------------------------------------------------

export type OutingPage = {
  outing: Outing;
  entries: OutingEntry[];
  /** Guests (0131), in the order they were added. */
  guests: OutingGuest[];
  /** Guest payments — the officers only. Keyed by guest id. */
  guestPayments: Map<number, Exclude<PaidStatus, "card">>;
  /** Your own payment; or, for officers, everyone's. Keyed by member. */
  payments: Map<string, PaidStatus>;
  /** "I've paid" not yet confirmed (0127): your own, or for officers everyone's. */
  claims: Map<string, ClaimMethod>;
};

export async function loadOuting(outingId: number): Promise<OutingPage | null> {
  const { data: row, error } = await supabase.from("society_outings").select(OUTING).eq("id", outingId).maybeSingle<OutingRow>();
  if (error) fail(error, "Couldn't load this outing.");
  if (!row) return null;
  const [entries, payments, claims, guests, guestPayments] = await Promise.all([
    supabase
      .from("society_outing_entries")
      .select("member_id, entered_at, tee_group, tee_time, tee_position, profile:profiles(first_name, last_name, home_club, avatar_url, avatar_color)")
      .eq("outing_id", outingId)
      .order("entered_at")
      .overrideTypes<
        {
          member_id: string;
          entered_at: string;
          tee_group: number | null;
          tee_time: string | null;
          tee_position: number | null;
          profile: { first_name: string | null; last_name: string | null; home_club: string | null; avatar_url: string | null; avatar_color: string | null } | null;
        }[]
      >(),
    supabase.from("society_outing_payments").select("member_id, status").eq("outing_id", outingId).overrideTypes<{ member_id: string; status: PaidStatus }[]>(),
    // A database without 0127 just has no claims.
    supabase.from("society_outing_payment_claims").select("member_id, method").eq("outing_id", outingId).overrideTypes<{ member_id: string; method: ClaimMethod }[]>(),
    // A database without 0131 just has no guests.
    supabase.from("society_outing_guests").select(GUEST).eq("outing_id", outingId).order("id").overrideTypes<GuestRow[]>(),
    supabase
      .from("society_outing_guest_payments")
      .select("guest_id, status, guest:society_outing_guests!inner(outing_id)")
      .eq("guest.outing_id", outingId)
      .overrideTypes<{ guest_id: number; status: Exclude<PaidStatus, "card"> }[]>(),
  ]);
  if (entries.error) fail(entries.error, "Couldn't load who's in.");
  return {
    outing: toOuting(row),
    entries: (entries.data ?? []).map((e) => ({
      memberId: e.member_id,
      name: [e.profile?.first_name, e.profile?.last_name].filter(Boolean).join(" ") || "A member",
      homeClub: e.profile?.home_club ?? null,
      avatarUrl: e.profile?.avatar_url ?? null,
      avatarColor: e.profile?.avatar_color ?? null,
      enteredAt: e.entered_at,
      teeGroup: e.tee_group,
      teeTime: e.tee_time,
      teePosition: e.tee_position,
    })),
    payments: new Map((payments.data ?? []).map((p) => [p.member_id, p.status])),
    claims: new Map((claims.data ?? []).map((c) => [c.member_id, c.method])),
    guests: guests.error ? [] : (guests.data ?? []).map(toGuest),
    guestPayments: new Map(guestPayments.error ? [] : (guestPayments.data ?? []).map((p) => [p.guest_id, p.status])),
  };
}

/** The course of an outing as the course picker wants it. */
export async function loadClub(clubId: number): Promise<Club | null> {
  const { data } = await supabase
    .from("clubs")
    .select("id, name, slug, country, region, town, latitude, longitude")
    .eq("id", clubId)
    .maybeSingle<Club>();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Your tee times, across your societies
// ---------------------------------------------------------------------------

export type MyTeeTime = {
  outingId: number;
  title: string;
  courseName: string | null;
  playsOn: string;
  teeGroup: number;
  teeTime: string | null;
  matchDayId: number | null;
  /** Everyone else in your group, in tee order. */
  partners: string[];
};

/** Tee times you've been given for outings from `fromDate` on, in one society. */
export async function loadMyTeeTimes(groupId: number, userId: string, fromDate: string): Promise<MyTeeTime[]> {
  const { data, error } = await supabase
    .from("society_outings")
    .select(
      `id, title, course_name, plays_on, match_day_id, status, entries:society_outing_entries(member_id, tee_group, tee_time, tee_position, profile:profiles(first_name, last_name))`
    )
    .eq("group_id", groupId)
    .eq("status", "open")
    .gte("plays_on", fromDate)
    .not("draw_published_at", "is", null)
    .order("plays_on")
    .overrideTypes<
      {
        id: number;
        title: string;
        course_name: string | null;
        plays_on: string;
        match_day_id: number | null;
        entries: { member_id: string; tee_group: number | null; tee_time: string | null; tee_position: number | null; profile: { first_name: string | null; last_name: string | null } | null }[];
      }[]
    >();
  if (error) fail(error, "Couldn't load your tee times.");
  // Guests drawn alongside you (0131). None on a database without it.
  const ids = (data ?? []).map((o) => o.id);
  const guestRows =
    ids.length === 0
      ? []
      : ((await supabase.from("society_outing_guests").select(`outing_id, ${GUEST}`).in("outing_id", ids).not("tee_group", "is", null).overrideTypes<(GuestRow & { outing_id: number })[]>()).data ?? []);
  const out: MyTeeTime[] = [];
  for (const o of data ?? []) {
    const me = o.entries.find((e) => e.member_id === userId);
    if (!me?.tee_group) continue;
    out.push({
      outingId: o.id,
      title: o.title,
      courseName: o.course_name,
      playsOn: o.plays_on,
      teeGroup: me.tee_group,
      teeTime: me.tee_time,
      matchDayId: o.match_day_id,
      partners: [
        ...o.entries
          .filter((e) => e.tee_group === me.tee_group && e.member_id !== userId)
          .map((e) => ({ pos: e.tee_position ?? 0, name: [e.profile?.first_name, e.profile?.last_name].filter(Boolean).join(" ") || "A member" })),
        ...guestRows.filter((g) => g.outing_id === o.id && g.tee_group === me.tee_group).map((g) => ({ pos: g.tee_position ?? 0, name: `${g.name} (guest)` })),
      ]
        .sort((a, b) => a.pos - b.pos)
        .map((p) => p.name),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export type OutingInput = {
  kind: OutingKind;
  title: string;
  clubId: number | null;
  courseName: string | null;
  playsOn: string;
  endsOn: string | null;
  location: string | null;
  payRevtag: string | null;
  payIban: string | null;
  payAccountName: string | null;
  payCash: boolean;
  payNote: string | null;
  firstTee: string | null;
  details: string | null;
  entryFeeCents: number | null;
  maxEntries: number | null;
};

export async function saveOuting(groupId: number, outingId: number | null, input: OutingInput): Promise<number> {
  const { data, error } = await supabase.rpc("save_outing", {
    p_group_id: groupId,
    p_id: outingId,
    p: {
      kind: input.kind,
      title: input.title,
      club_id: input.clubId,
      course_name: input.courseName,
      plays_on: input.playsOn,
      ends_on: input.endsOn,
      location: input.location,
      pay_revtag: input.payRevtag,
      pay_iban: input.payIban,
      pay_account_name: input.payAccountName,
      pay_cash: input.payCash,
      pay_note: input.payNote,
      first_tee: input.firstTee,
      details: input.details,
      entry_fee_cents: input.entryFeeCents,
      max_entries: input.maxEntries,
    },
  });
  if (error) fail(error, "Couldn't save the outing.");
  return Number(data);
}

export async function cancelOuting(outingId: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_outing", { p_outing_id: outingId });
  if (error) fail(error, "Couldn't cancel the outing.");
}

/** Join (true) or cancel (false); with memberId, an officer for someone else. */
export async function setOutingEntry(outingId: number, inIt: boolean, memberId?: string): Promise<void> {
  const { error } = await supabase.rpc("set_outing_entry", { p_outing_id: outingId, p_in: inIt, p_member: memberId ?? null });
  if (error) fail(error, inIt ? "Couldn't put you in." : "Couldn't take you out.");
}

/** One seat in a published draw: a member's id, or a guest on the outing (0131). */
export type DrawSeat = string | { guest: number };

/** Groups in tee order, each with its tee time and players in order. */
export async function publishOutingDraw(outingId: number, groups: { teeTime: string | null; members: DrawSeat[] }[]): Promise<void> {
  const { error } = await supabase.rpc("publish_outing_draw", {
    p_outing_id: outingId,
    p_groups: groups.map((g) => ({ tee_time: g.teeTime, members: g.members })),
  });
  if (error) fail(error, "Couldn't publish the tee times.");
}

export async function linkOutingMatchDay(outingId: number, matchDayId: number): Promise<void> {
  const { error } = await supabase.rpc("link_outing_match_day", { p_outing_id: outingId, p_match_day_id: matchDayId });
  if (error) fail(error, "Couldn't link the round to the outing.");
}

export async function markOutingPaid(outingId: number, memberId: string, status: Exclude<PaidStatus, "card"> | null): Promise<void> {
  const { error } = await supabase.rpc("mark_outing_paid", { p_outing_id: outingId, p_member: memberId, p_status: status });
  if (error) fail(error, "Couldn't mark that.");
}

/** "I've paid" (a method), or withdraw it (null). With memberId, an officer clears someone's claim. */
export async function claimOutingPaid(outingId: number, method: ClaimMethod | null, memberId?: string): Promise<void> {
  const { error } = await supabase.rpc("claim_outing_paid", { p_outing_id: outingId, p_method: method, p_member: memberId ?? null });
  if (error) fail(error, "Couldn't save that.");
}

/** The payment details on this society's most recent outing that had any — to start a new one with. */
export async function lastPaymentDetails(groupId: number): Promise<Pick<Outing, "payRevtag" | "payIban" | "payAccountName" | "payCash" | "payNote"> | null> {
  const { data } = await supabase
    .from("society_outings")
    .select("pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note")
    .eq("group_id", groupId)
    .or("pay_revtag.not.is.null,pay_iban.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ pay_revtag: string | null; pay_iban: string | null; pay_account_name: string | null; pay_cash: boolean; pay_note: string | null }>();
  return data ? { payRevtag: data.pay_revtag, payIban: data.pay_iban, payAccountName: data.pay_account_name, payCash: data.pay_cash, payNote: data.pay_note } : null;
}

// ---------------------------------------------------------------------------
// Guests (0131)
// ---------------------------------------------------------------------------

/** "Could not find the function" — a database without 0131 yet. */
function guestsMissing(error: { message: string; code?: string } | null): boolean {
  return !!error && (error.code === "PGRST202" || /could not find the function/i.test(error.message));
}

const NOT_YET = "Guests on events need the latest update to PinPals. Add them on the day for now.";

export async function addOutingGuest(outingId: number, name: string, handicapIndex: number | null): Promise<number> {
  const { data, error } = await supabase.rpc("add_outing_guest", { p_outing_id: outingId, p_name: name, p_index: handicapIndex });
  if (guestsMissing(error)) throw new Error(NOT_YET);
  if (error) fail(error, "Couldn't add the guest.");
  return Number(data);
}

export async function updateOutingGuest(guestId: number, name: string, handicapIndex: number | null): Promise<void> {
  const { error } = await supabase.rpc("update_outing_guest", { p_guest_id: guestId, p_name: name, p_index: handicapIndex });
  if (error) fail(error, "Couldn't change the guest.");
}

export async function removeOutingGuest(guestId: number): Promise<void> {
  const { error } = await supabase.rpc("remove_outing_guest", { p_guest_id: guestId });
  if (error) fail(error, "Couldn't take the guest off.");
}

export async function markOutingGuestPaid(guestId: number, status: Exclude<PaidStatus, "card"> | null): Promise<void> {
  const { error } = await supabase.rpc("mark_outing_guest_paid", { p_guest_id: guestId, p_status: status });
  if (error) fail(error, "Couldn't mark that.");
}
