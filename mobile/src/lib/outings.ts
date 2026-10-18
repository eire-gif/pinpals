import type { Club } from "@/lib/courses";
import type { OutingKind } from "@/lib/itinerary-rules";
import type { ClaimMethod } from "@/lib/outing-payments";
import type { PaidStatus } from "@/lib/outing-rules";
import { postToSite } from "@/lib/api";
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
  /** 0142: how members get a place, and the event's details. */
  entryMode: EntryMode;
  entriesCloseAt: string | null;
  waitingList: boolean;
  autoOffer: boolean;
  guestsAllowed: boolean;
  guestFeeCents: number | null;
  arriveBy: string | null;
  formatLabel: string | null;
  dressCode: string | null;
  mealOptions: string[];
};

/** 'join': first come, first served. 'request': the officers give out places. */
export type EntryMode = "join" | "request";

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
  /** Shotgun start (0173): the hole this group starts on, and A/B. */
  start: OutingStart;
};

/** Where a group starts in a shotgun draw (0173), or null for a tee-time start. */
export type OutingStart = { hole: number; letter: "A" | "B" | "C" | "D" | null } | null;
const toStart = (hole: number | null | undefined, letter: string | null | undefined): OutingStart =>
  hole == null ? null : { hole, letter: letter === "A" || letter === "B" || letter === "C" || letter === "D" ? letter : null };

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
  start: OutingStart;
};

type GuestRow = {
  id: number;
  name: string;
  handicap_index: number | string | null;
  tee_group: number | null;
  tee_time: string | null;
  tee_position: number | null;
  start_hole: number | null;
  start_letter: string | null;
};

const toGuest = (g: GuestRow): OutingGuest => ({
  id: g.id,
  name: g.name,
  handicapIndex: g.handicap_index == null ? null : Number(g.handicap_index),
  teeGroup: g.tee_group,
  teeTime: g.tee_time,
  teePosition: g.tee_position,
  start: toStart(g.start_hole, g.start_letter),
});

const GUEST = "id, name, handicap_index, tee_group, tee_time, tee_position, start_hole, start_letter";

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
  entry_mode?: EntryMode | null;
  entries_close_at?: string | null;
  waiting_list?: boolean | null;
  auto_offer?: boolean | null;
  guests_allowed?: boolean | null;
  guest_fee_cents?: number | null;
  arrive_by?: string | null;
  format_label?: string | null;
  dress_code?: string | null;
  meal_options?: string[] | null;
};

const OUTING_BASE = "id, group_id, kind, title, club_id, course_name, plays_on, ends_on, location, first_tee, details, entry_fee_cents, max_entries, status, draw_published_at, match_day_id, pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note";
/** With 0142's columns. A database without them falls back to OUTING_BASE. */
const OUTING = `${OUTING_BASE}, entry_mode, entries_close_at, waiting_list, auto_offer, guests_allowed, guest_fee_cents, arrive_by, format_label, dress_code, meal_options`;

/** "column … does not exist": the database hasn't had 0142 yet. */
const missingColumn = (error: { message: string; code?: string } | null) => !!error && (error.code === "42703" || /does not exist/i.test(error.message));

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
  entryMode: r.entry_mode ?? "join",
  entriesCloseAt: r.entries_close_at ?? null,
  waitingList: r.waiting_list ?? true,
  autoOffer: r.auto_offer ?? true,
  guestsAllowed: r.guests_allowed ?? true,
  guestFeeCents: r.guest_fee_cents ?? null,
  arriveBy: r.arrive_by ?? null,
  formatLabel: r.format_label ?? null,
  dressCode: r.dress_code ?? null,
  mealOptions: r.meal_options ?? [],
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
  /** Shotgun start (0173). */
  myStart: OutingStart;
  /** 0142: in, asked, on the list (and where), or offered a place. */
  myPlace: PlaceStatus | null;
  myLinePosition: number | null;
  myOfferExpiresAt: string | null;
  /** In, with a fee, not marked paid. */
  myPaymentDue: boolean;
};

/** A society's outings from `fromDate` on (or all past ones), soonest first. */
export async function listOutings(groupId: number, userId: string, opts: { fromDate: string; past?: boolean }): Promise<OutingSummary[]> {
  const [counts, queue, paid] = await Promise.all([guestCounts(groupId), myOutingQueue(groupId), myPaidOutings(userId)]);
  const run = (cols: string) => {
    let q = supabase.from("society_outings").select(`${cols}, entries:society_outing_entries(member_id, tee_group, tee_time, start_hole, start_letter)`).eq("group_id", groupId);
    // A trip counts as upcoming until its last day is over (0126).
    const d = opts.fromDate;
    q = opts.past
      ? q.lt("plays_on", d).or(`ends_on.is.null,ends_on.lt.${d}`).order("plays_on", { ascending: false }).limit(30)
      : q.or(`plays_on.gte.${d},ends_on.gte.${d}`).order("plays_on");
    return q.overrideTypes<(OutingRow & { entries: { member_id: string; tee_group: number | null; tee_time: string | null; start_hole: number | null; start_letter: string | null }[] })[]>();
  };
  let { data, error } = await run(OUTING);
  if (missingColumn(error)) ({ data, error } = await run(OUTING_BASE));
  if (error) fail(error, "Couldn't load the outings.");
  return (data ?? []).map((r) => {
    const me = r.entries.find((e) => e.member_id === userId);
    const q = queue.get(r.id);
    const o = toOuting(r);
    return {
      ...o,
      entered: r.entries.length + (counts.get(r.id) ?? 0),
      mine: !!me,
      myTeeGroup: me?.tee_group ?? null,
      myTeeTime: me?.tee_time ?? null,
      myStart: toStart(me?.start_hole, me?.start_letter),
      myPlace: me ? "confirmed" : q?.status ?? null,
      myLinePosition: q?.linePosition ?? null,
      myOfferExpiresAt: q?.offerExpiresAt ?? null,
      myPaymentDue: !!me && (o.entryFeeCents ?? 0) > 0 && !paid.has(r.id),
    };
  });
}

/** Where you stand on an event: in, asked, waiting, or offered a place. */
export type PlaceStatus = "confirmed" | "requested" | "waiting" | "offered";

export type QueuePlace = { status: Exclude<PlaceStatus, "confirmed">; linePosition: number | null; offerExpiresAt: string | null; guestName: string | null };

/** Your requests and waiting-list places in one group (0142). Empty before 0142. */
export async function myOutingQueue(groupId: number): Promise<Map<number, QueuePlace>> {
  const { data, error } = await supabase.rpc("my_outing_queue", { p_group_id: groupId });
  const out = new Map<number, QueuePlace>();
  if (error) return out;
  for (const r of (data ?? []) as { outing_id: number; status: QueuePlace["status"]; line_position: number | null; offer_expires_at: string | null; guest_name: string | null }[]) {
    out.set(r.outing_id, { status: r.status, linePosition: r.line_position, offerExpiresAt: r.offer_expires_at, guestName: r.guest_name });
  }
  return out;
}

/** Events you've paid for (or had waived). */
async function myPaidOutings(userId: string): Promise<Set<number>> {
  const { data } = await supabase.from("society_outing_payments").select("outing_id, status").eq("member_id", userId).overrideTypes<{ outing_id: number; status: string }[]>();
  return new Set((data ?? []).filter((p) => p.status !== "refunded").map((p) => p.outing_id));
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
  /** 0142: requests and the waiting list — your own, or the officers' whole list. */
  queue: QueueEntry[];
  /** What each member asked for: your own, or the officers' all. */
  choices: Map<string, OutingChoice>;
  /** Who withdrew: your own, or for officers everyone's. */
  withdrawals: Withdrawal[];
};

export async function loadOuting(outingId: number): Promise<OutingPage | null> {
  let { data: row, error } = await supabase.from("society_outings").select(OUTING).eq("id", outingId).maybeSingle<OutingRow>();
  if (missingColumn(error)) ({ data: row, error } = await supabase.from("society_outings").select(OUTING_BASE).eq("id", outingId).maybeSingle<OutingRow>());
  if (error) fail(error, "Couldn't load this outing.");
  if (!row) return null;
  const [entries, payments, claims, guests, guestPayments, queue, choices, withdrawals] = await Promise.all([
    supabase
      .from("society_outing_entries")
      .select("member_id, entered_at, tee_group, tee_time, tee_position, start_hole, start_letter, profile:profiles(first_name, last_name, home_club, avatar_url, avatar_color)")
      .eq("outing_id", outingId)
      .order("entered_at")
      .overrideTypes<
        {
          member_id: string;
          entered_at: string;
          tee_group: number | null;
          tee_time: string | null;
          tee_position: number | null;
          start_hole: number | null;
          start_letter: string | null;
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
    // 0142: your own place in the queue, or for officers everyone's. Empty before 0142.
    supabase
      .from("society_outing_queue")
      .select("id, member_id, status, guest_name, guest_index, created_at, queued_at, offer_expires_at, profile:profiles(first_name, last_name, avatar_url, avatar_color)")
      .eq("outing_id", outingId)
      .order("queued_at")
      .overrideTypes<
        {
          id: number;
          member_id: string;
          status: QueuePlace["status"];
          guest_name: string | null;
          guest_index: number | string | null;
          created_at: string;
          queued_at: string;
          offer_expires_at: string | null;
          profile: { first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null;
        }[]
      >(),
    supabase.from("society_outing_choices").select("member_id, meal, guest_meal, play_with, tee_pref, note").eq("outing_id", outingId).overrideTypes<ChoiceRow[]>(),
    supabase
      .from("society_outing_withdrawals")
      .select("id, member_id, withdrawn_at, profile:profiles(first_name, last_name)")
      .eq("outing_id", outingId)
      .order("withdrawn_at", { ascending: false })
      .overrideTypes<{ id: number; member_id: string; withdrawn_at: string; profile: { first_name: string | null; last_name: string | null } | null }[]>(),
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
      start: toStart(e.start_hole, e.start_letter),
    })),
    payments: new Map((payments.data ?? []).map((p) => [p.member_id, p.status])),
    claims: new Map((claims.data ?? []).map((c) => [c.member_id, c.method])),
    guests: guests.error ? [] : (guests.data ?? []).map(toGuest),
    guestPayments: new Map(guestPayments.error ? [] : (guestPayments.data ?? []).map((p) => [p.guest_id, p.status])),
    queue: queue.error
      ? []
      : (queue.data ?? []).map((q) => ({
          id: q.id,
          memberId: q.member_id,
          name: [q.profile?.first_name, q.profile?.last_name].filter(Boolean).join(" ") || "A member",
          avatarUrl: q.profile?.avatar_url ?? null,
          avatarColor: q.profile?.avatar_color ?? null,
          status: q.status,
          guestName: q.guest_name,
          guestIndex: q.guest_index == null ? null : Number(q.guest_index),
          askedAt: q.created_at,
          offerExpiresAt: q.offer_expires_at,
        })),
    choices: new Map(choices.error ? [] : (choices.data ?? []).map((c) => [c.member_id, toChoice(c)])),
    withdrawals: withdrawals.error
      ? []
      : (withdrawals.data ?? []).map((w) => ({ id: w.id, memberId: w.member_id, name: [w.profile?.first_name, w.profile?.last_name].filter(Boolean).join(" ") || "A member", at: w.withdrawn_at })),
  };
}

type ChoiceRow = { member_id: string; meal: string | null; guest_meal: string | null; play_with: string | null; tee_pref: "early" | "late" | null; note: string | null };
const toChoice = (c: ChoiceRow): OutingChoice => ({ meal: c.meal, guestMeal: c.guest_meal, playWith: c.play_with, teePref: c.tee_pref, note: c.note });

/** What a member asked for with their place (0142). Theirs and the officers' to see. */
export type OutingChoice = { meal: string | null; guestMeal: string | null; playWith: string | null; teePref: "early" | "late" | null; note: string | null };

/** Someone asking for a place, on the waiting list, or offered one (0142). */
export type QueueEntry = {
  id: number;
  memberId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  status: QueuePlace["status"];
  guestName: string | null;
  guestIndex: number | null;
  askedAt: string;
  offerExpiresAt: string | null;
};

export type Withdrawal = { id: number; memberId: string; name: string; at: string };

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
  /** Shotgun start (0173). */
  start: OutingStart;
  matchDayId: number | null;
  /** Everyone else in your group, in tee order. */
  partners: string[];
};

/** Tee times you've been given for outings from `fromDate` on, in one society. */
export async function loadMyTeeTimes(groupId: number, userId: string, fromDate: string): Promise<MyTeeTime[]> {
  const { data, error } = await supabase
    .from("society_outings")
    .select(
      `id, title, course_name, plays_on, match_day_id, status, entries:society_outing_entries(member_id, tee_group, tee_time, tee_position, start_hole, start_letter, profile:profiles(first_name, last_name))`
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
        entries: { member_id: string; tee_group: number | null; tee_time: string | null; tee_position: number | null; start_hole: number | null; start_letter: string | null; profile: { first_name: string | null; last_name: string | null } | null }[];
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
      start: toStart(me.start_hole, me.start_letter),
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
  /** 0142. Left out (undefined), the database keeps what it has. */
  entryMode?: EntryMode;
  entriesCloseAt?: string | null;
  waitingList?: boolean;
  autoOffer?: boolean;
  guestsAllowed?: boolean;
  guestFeeCents?: number | null;
  arriveBy?: string | null;
  formatLabel?: string | null;
  dressCode?: string | null;
  mealOptions?: string[];
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
      ...(input.entryMode !== undefined ? { entry_mode: input.entryMode } : {}),
      ...(input.entriesCloseAt !== undefined ? { entries_close_at: input.entriesCloseAt } : {}),
      ...(input.waitingList !== undefined ? { waiting_list: input.waitingList } : {}),
      ...(input.autoOffer !== undefined ? { auto_offer: input.autoOffer } : {}),
      ...(input.guestsAllowed !== undefined ? { guests_allowed: input.guestsAllowed } : {}),
      ...(input.guestFeeCents !== undefined ? { guest_fee_cents: input.guestFeeCents } : {}),
      ...(input.arriveBy !== undefined ? { arrive_by: input.arriveBy } : {}),
      ...(input.formatLabel !== undefined ? { format_label: input.formatLabel } : {}),
      ...(input.dressCode !== undefined ? { dress_code: input.dressCode } : {}),
      ...(input.mealOptions !== undefined ? { meal_options: input.mealOptions } : {}),
    },
  });
  if (error) fail(error, "Couldn't save the outing.");
  flushSocietyAlerts();
  return Number(data);
}

export async function cancelOuting(outingId: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_outing", { p_outing_id: outingId });
  if (error) fail(error, "Couldn't cancel the outing.");
  flushSocietyAlerts();
}

/** Join (true) or cancel (false); with memberId, an officer for someone else. */
export async function setOutingEntry(outingId: number, inIt: boolean, memberId?: string): Promise<void> {
  const { error } = await supabase.rpc("set_outing_entry", { p_outing_id: outingId, p_in: inIt, p_member: memberId ?? null });
  if (error) fail(error, inIt ? "Couldn't put you in." : "Couldn't take you out.");
  flushSocietyAlerts();
}

/** One seat in a published draw: a member's id, or a guest on the outing (0131). */
export type DrawSeat = string | { guest: number };

/** Groups in tee order, each with its tee time and players in order. */
export async function publishOutingDraw(outingId: number, groups: { teeTime: string | null; start?: OutingStart; members: DrawSeat[] }[]): Promise<void> {
  const { error } = await supabase.rpc("publish_outing_draw", {
    p_outing_id: outingId,
    p_groups: groups.map((g) => ({ tee_time: g.teeTime, ...(g.start ? { start_hole: g.start.hole, start_letter: g.start.letter } : {}), members: g.members })),
  });
  if (error) fail(error, "Couldn't publish the tee times.");
  flushSocietyAlerts();
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

// ---------------------------------------------------------------------------
// Requests, the waiting list and offers (0142)
// ---------------------------------------------------------------------------

/**
 * Asks the website to send the alerts the database just queued (a request,
 * an offer, a new event…), so they go out now rather than at the next
 * scheduled run. Fire-and-forget: the change is already made.
 */
export function flushSocietyAlerts(): void {
  void postToSite("/api/app/societies/alerts", {}).catch(() => undefined);
}

export type PlaceRequest = {
  meal?: string | null;
  guestMeal?: string | null;
  playWith?: string | null;
  teePref?: "early" | "late" | null;
  note?: string | null;
  guest?: { name: string; index: number | null } | null;
};

/** Ask for a place (or change what you asked for). Says where you are now. */
export async function requestOutingPlace(outingId: number, req: PlaceRequest = {}): Promise<Exclude<PlaceStatus, "offered">> {
  const { data, error } = await supabase.rpc("request_outing_place", {
    p_outing_id: outingId,
    p: {
      meal: req.meal ?? null,
      guest_meal: req.guestMeal ?? null,
      play_with: req.playWith ?? null,
      tee_pref: req.teePref ?? null,
      note: req.note ?? null,
      guest: req.guest ? { name: req.guest.name, index: req.guest.index } : null,
    },
  });
  if (error) fail(error, "Couldn't ask for a place.");
  flushSocietyAlerts();
  return data as Exclude<PlaceStatus, "offered">;
}

export type ReviewDecision = "approve" | "member_only" | "waiting" | "decline";

export async function reviewOutingRequest(outingId: number, memberId: string, decision: ReviewDecision): Promise<string> {
  const { data, error } = await supabase.rpc("review_outing_request", { p_outing_id: outingId, p_member: memberId, p_decision: decision });
  if (error) fail(error, "Couldn't answer that.");
  flushSocietyAlerts();
  return String(data);
}

export async function answerOutingOffer(outingId: number, accept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("answer_outing_offer", { p_outing_id: outingId, p_accept: accept });
  if (error) fail(error, "Couldn't answer the offer.");
  flushSocietyAlerts();
  return String(data);
}

export async function promoteOutingWaiting(outingId: number, memberId: string): Promise<void> {
  const { error } = await supabase.rpc("promote_outing_waiting", { p_outing_id: outingId, p_member: memberId });
  if (error) fail(error, "Couldn't give them a place.");
  flushSocietyAlerts();
}

export async function markOutingRefunded(outingId: number, memberId: string, refunded: boolean): Promise<void> {
  const { error } = await supabase.rpc("mark_outing_refunded", { p_outing_id: outingId, p_member: memberId, p_refunded: refunded });
  if (error) fail(error, "Couldn't mark that.");
}

/**
 * What the draw should honour for an event (0142): who asked to play with
 * whom, early or late, and who has been drawn together at the society's
 * last few events. Officers only can read the choices; anyone else gets
 * just the history.
 */
export async function loadDrawWishes(outingId: number, groupId: number): Promise<{ together: [string, string][]; early: string[]; late: string[]; met: [string, number][] }> {
  const [choices, past] = await Promise.all([
    supabase.from("society_outing_choices").select("member_id, play_with, tee_pref").eq("outing_id", outingId).overrideTypes<{ member_id: string; play_with: string | null; tee_pref: string | null }[]>(),
    supabase
      .from("society_outings")
      .select("id, entries:society_outing_entries(member_id, tee_group)")
      .eq("group_id", groupId)
      .neq("id", outingId)
      .not("draw_published_at", "is", null)
      .order("plays_on", { ascending: false })
      .limit(6)
      .overrideTypes<{ id: number; entries: { member_id: string; tee_group: number | null }[] }[]>(),
  ]);
  const c = choices.error ? [] : choices.data ?? [];
  const met = new Map<string, number>();
  for (const o of past.data ?? []) {
    const byGroup = new Map<number, string[]>();
    for (const e of o.entries) if (e.tee_group) byGroup.set(e.tee_group, [...(byGroup.get(e.tee_group) ?? []), e.member_id]);
    for (const ids of byGroup.values()) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = `m:${ids[i]}`;
          const b = `m:${ids[j]}`;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          met.set(k, (met.get(k) ?? 0) + 1);
        }
    }
  }
  return {
    together: c.filter((x) => x.play_with).map((x) => [`m:${x.member_id}`, `m:${x.play_with}`] as [string, string]),
    early: c.filter((x) => x.tee_pref === "early").map((x) => `m:${x.member_id}`),
    late: c.filter((x) => x.tee_pref === "late").map((x) => `m:${x.member_id}`),
    met: [...met.entries()],
  };
}

// ---------------------------------------------------------------------------
// Kept on the phone for no signal (Oct 2026)
// ---------------------------------------------------------------------------

const CACHE_KEY = (id: number) => `pinpals.outing.${id}.v1`;

/**
 * Keeps an event's details and your own tee group on the phone after each
 * load, so the event page still opens on the course with no signal. Small on
 * purpose (SecureStore values are meant to stay under a couple of KB): the
 * event itself, and only the people in your tee group.
 */
export async function keepOutingOnPhone(page: OutingPage, userId: string): Promise<void> {
  try {
    const me = page.entries.find((e) => e.memberId === userId);
    if (!me) return;
    const mine = me.teeGroup
      ? page.entries.filter((e) => e.teeGroup === me.teeGroup).map((e) => ({ ...e, avatarUrl: null, homeClub: null }))
      : [{ ...me, avatarUrl: null, homeClub: null }];
    const guests = me.teeGroup ? page.guests.filter((g) => g.teeGroup === me.teeGroup) : [];
    const outing = { ...page.outing, details: page.outing.details ? page.outing.details.slice(0, 300) : null };
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(CACHE_KEY(page.outing.id), JSON.stringify({ outing, entries: mine, guests, at: Date.now() }));
  } catch {
    // Best effort.
  }
}

/** The copy kept on the phone, as a page with only your group in it; null if none. */
export async function outingFromPhone(outingId: number): Promise<(OutingPage & { savedAt: number }) | null> {
  try {
    const SecureStore = await import("expo-secure-store");
    const raw = await SecureStore.getItemAsync(CACHE_KEY(outingId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { outing: Outing; entries: OutingEntry[]; guests: OutingGuest[]; at: number };
    return {
      outing: v.outing,
      entries: v.entries,
      guests: v.guests,
      guestPayments: new Map(),
      payments: new Map(),
      claims: new Map(),
      queue: [],
      choices: new Map(),
      withdrawals: [],
      savedAt: v.at,
    };
  } catch {
    return null;
  }
}
