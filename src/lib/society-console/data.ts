import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Results } from "@/lib/competition-results";
import type { ClaimMethod } from "./outing-payments";
import type { PaidStatus } from "./outing-rules";
import { isGroupOffice, type GroupOffice, type GroupRole } from "./rules";
import { DEFAULT_MERIT_RULES, type MeritEvent, type MeritRules } from "./order-of-merit";

/**
 * The society console's reads — the same tables and functions the app reads
 * (mobile/src/lib/society.ts, outings.ts, groups-data.ts), with the member's
 * own client, so RLS and 0144's functions decide what comes back. Nothing
 * here uses the service role.
 */

type Db = SupabaseClient;

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

const fullName = (p: { first_name: string | null; last_name: string | null } | null | undefined): string =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member";

// ---------------------------------------------------------------------------
// Members and join requests
// ---------------------------------------------------------------------------

export type MembershipStatus = "paid" | "honorary" | "lapsed" | "claimed" | "unpaid";
export const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = { paid: "Paid up", honorary: "Honorary", lapsed: "Lapsed", claimed: "Says paid", unpaid: "Unpaid" };

export type ConsoleMember = {
  id: string;
  name: string;
  role: GroupRole;
  office: GroupOffice | null;
  joinedAt: string;
  ownIndex: number | null;
  societyIndex: number | null;
  membership: MembershipStatus | null;
  avatarUrl: string | null;
  homeClub: string | null;
};

/** Everyone in the society with what the committee may see (0144's society_member_list). */
export async function loadMembers(db: Db, groupId: number): Promise<ConsoleMember[]> {
  const [list, people] = await Promise.all([
    db.rpc("society_member_list", { p_group_id: groupId }),
    db
      .from("group_members")
      .select("member_id, role, office, joined_at, profile:profiles(first_name, last_name, avatar_url, home_club)")
      .eq("group_id", groupId)
      .overrideTypes<{ member_id: string; role: GroupRole; office: string | null; joined_at: string; profile: { first_name: string | null; last_name: string | null; avatar_url: string | null; home_club: string | null } | null }[]>(),
  ]);
  if (people.error) fail(people.error, "Couldn't load the members.");
  const extra = new Map(
    ((list.data ?? []) as { member_id: string; own_index: number | string | null; society_index: number | string | null; membership: MembershipStatus | null }[]).map((m) => [m.member_id, m])
  );
  const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
  const rank = (m: ConsoleMember) => (m.role === "owner" ? 0 : m.office === "captain" ? 1 : m.office === "secretary" ? 2 : m.office ? 3 : 4);
  return (people.data ?? [])
    .map((m) => {
      const x = extra.get(m.member_id);
      return {
        id: m.member_id,
        name: fullName(m.profile),
        role: m.role,
        office: isGroupOffice(m.office) ? m.office : null,
        joinedAt: m.joined_at,
        ownIndex: num(x?.own_index),
        societyIndex: num(x?.society_index),
        membership: x?.membership ?? null,
        avatarUrl: m.profile?.avatar_url ?? null,
        homeClub: m.profile?.home_club ?? null,
      };
    })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en-IE"));
}

export type JoinRequest = { memberId: string; name: string; homeClub: string | null; avatarUrl: string | null; askedAt: string };

export async function loadJoinRequests(db: Db, groupId: number): Promise<JoinRequest[]> {
  const { data, error } = await db
    .from("group_invitations")
    .select("member_id, created_at, profile:profiles!group_invitations_member_id_fkey(first_name, last_name, home_club, avatar_url)")
    .eq("group_id", groupId)
    .eq("direction", "request")
    .eq("status", "pending")
    .order("created_at")
    .overrideTypes<{ member_id: string; created_at: string; profile: { first_name: string | null; last_name: string | null; home_club: string | null; avatar_url: string | null } | null }[]>();
  if (error) return [];
  return (data ?? []).map((r) => ({ memberId: r.member_id, name: fullName(r.profile), homeClub: r.profile?.home_club ?? null, avatarUrl: r.profile?.avatar_url ?? null, askedAt: r.created_at }));
}

export type PendingInvite = { memberId: string; name: string; invitedAt: string };

export async function loadPendingInvites(db: Db, groupId: number): Promise<PendingInvite[]> {
  const { data, error } = await db
    .from("group_invitations")
    .select("member_id, created_at, profile:profiles!group_invitations_member_id_fkey(first_name, last_name)")
    .eq("group_id", groupId)
    .eq("direction", "invite")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .overrideTypes<{ member_id: string; created_at: string; profile: { first_name: string | null; last_name: string | null } | null }[]>();
  if (error) return [];
  return (data ?? []).map((r) => ({ memberId: r.member_id, name: fullName(r.profile), invitedAt: r.created_at }));
}

/** PinPals members by name, to invite (profiles are readable to signed-in members). */
export async function searchGolfers(db: Db, query: string): Promise<{ id: string; name: string; homeClub: string | null; avatarUrl: string | null }[]> {
  const q = query.trim().replace(/[%_\\,()]/g, " ").trim();
  if (q.length < 2) return [];
  const parts = q.split(/\s+/).slice(0, 2);
  let req = db.from("profiles").select("id, first_name, last_name, home_club, avatar_url").limit(20);
  req = parts.length === 2 ? req.ilike("first_name", `${parts[0]}%`).ilike("last_name", `${parts[1]}%`) : req.or(`first_name.ilike.${parts[0]}%,last_name.ilike.${parts[0]}%`);
  const { data } = await req.overrideTypes<{ id: string; first_name: string | null; last_name: string | null; home_club: string | null; avatar_url: string | null }[]>();
  return (data ?? []).map((p) => ({ id: p.id, name: fullName(p), homeClub: p.home_club, avatarUrl: p.avatar_url }));
}

// ---------------------------------------------------------------------------
// Handicaps (0122/0144)
// ---------------------------------------------------------------------------

export type HandicapRow = { memberId: string; ownIndex: number | null; indicator: number | null; rounds: number; societyIndex: number | null; societyIndexSetAt: string | null };

export async function loadHandicaps(db: Db, groupId: number): Promise<Map<string, HandicapRow>> {
  const { data, error } = await db.rpc("society_handicaps", { p_group_id: groupId });
  if (error) fail(error, "Couldn't load the handicaps.");
  const num = (v: number | string | null) => (v == null ? null : Number(v));
  return new Map(
    ((data ?? []) as { member_id: string; own_index: number | null; indicator: number | null; rounds: number | null; society_index: number | null; society_index_set_at: string | null }[]).map((r) => [
      r.member_id,
      { memberId: r.member_id, ownIndex: num(r.own_index), indicator: num(r.indicator), rounds: r.rounds ?? 0, societyIndex: num(r.society_index), societyIndexSetAt: r.society_index_set_at },
    ])
  );
}

// ---------------------------------------------------------------------------
// Events (0125–0142)
// ---------------------------------------------------------------------------

export type OutingKind = "day" | "overnight" | "abroad";
export type EntryMode = "join" | "request";

export type Outing = {
  id: number;
  groupId: number;
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
  status: "open" | "cancelled";
  drawPublishedAt: string | null;
  matchDayId: number | null;
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
  /** The Live day set-up saved ahead (0184), as stored — parse before use. */
  liveSetup: unknown;
  liveSetupAt: string | null;
  /** A multi-day championship's day (0187), and which day it is. */
  championshipId: number | null;
  championshipRound: number | null;
  championshipFormat: string | null;
};

type OutingRow = {
  id: number;
  group_id: number;
  kind: OutingKind | null;
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
  entry_mode: EntryMode | null;
  entries_close_at: string | null;
  waiting_list: boolean | null;
  auto_offer: boolean | null;
  guests_allowed: boolean | null;
  guest_fee_cents: number | null;
  arrive_by: string | null;
  format_label: string | null;
  dress_code: string | null;
  meal_options: string[] | null;
  live_setup: unknown;
  live_setup_at: string | null;
  championship_id: number | null;
  championship_round: number | null;
  championship_format: string | null;
};

const OUTING =
  "id, group_id, kind, title, club_id, course_name, plays_on, ends_on, location, first_tee, details, entry_fee_cents, max_entries, status, draw_published_at, match_day_id, pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note, entry_mode, entries_close_at, waiting_list, auto_offer, guests_allowed, guest_fee_cents, arrive_by, format_label, dress_code, meal_options, live_setup, live_setup_at, championship_id, championship_round, championship_format";

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
  payRevtag: r.pay_revtag,
  payIban: r.pay_iban,
  payAccountName: r.pay_account_name,
  payCash: r.pay_cash ?? true,
  payNote: r.pay_note,
  firstTee: r.first_tee,
  details: r.details,
  entryFeeCents: r.entry_fee_cents,
  maxEntries: r.max_entries,
  status: r.status,
  drawPublishedAt: r.draw_published_at,
  matchDayId: r.match_day_id,
  entryMode: r.entry_mode ?? "join",
  entriesCloseAt: r.entries_close_at,
  waitingList: r.waiting_list ?? true,
  autoOffer: r.auto_offer ?? true,
  guestsAllowed: r.guests_allowed ?? true,
  guestFeeCents: r.guest_fee_cents,
  arriveBy: r.arrive_by,
  formatLabel: r.format_label,
  dressCode: r.dress_code,
  mealOptions: r.meal_options ?? [],
  liveSetup: r.live_setup ?? null,
  liveSetupAt: r.live_setup_at ?? null,
  championshipId: r.championship_id ?? null,
  championshipRound: r.championship_round ?? null,
  championshipFormat: r.championship_format ?? null,
});

export type EventSummary = Outing & { entered: number; guests: number; requests: number; waiting: number; offered: number; unpaid: number; claims: number };

/** The society's events: upcoming soonest first, or past newest first. */
export async function listEvents(db: Db, groupId: number, opts: { today: string; past?: boolean; limit?: number }): Promise<EventSummary[]> {
  let q = db
    .from("society_outings")
    .select(`${OUTING}, entries:society_outing_entries(member_id), guests:society_outing_guests(id), queue:society_outing_queue(status), payments:society_outing_payments(member_id, status), claims:society_outing_payment_claims(member_id)`)
    .eq("group_id", groupId);
  const d = opts.today;
  q = opts.past
    ? q.lt("plays_on", d).or(`ends_on.is.null,ends_on.lt.${d}`).order("plays_on", { ascending: false }).limit(opts.limit ?? 40)
    : q.or(`plays_on.gte.${d},ends_on.gte.${d}`).order("plays_on").limit(opts.limit ?? 60);
  const { data, error } = await q.overrideTypes<
    (OutingRow & {
      entries: { member_id: string }[];
      guests: { id: number }[] | null;
      queue: { status: string }[] | null;
      payments: { member_id: string; status: string }[] | null;
      claims: { member_id: string }[] | null;
    })[]
  >();
  if (error) fail(error, "Couldn't load the events.");
  return (data ?? []).map((r) => {
    const o = toOuting(r);
    const paid = new Set((r.payments ?? []).filter((p) => p.status !== "refunded").map((p) => p.member_id));
    const fee = (o.entryFeeCents ?? 0) > 0;
    return {
      ...o,
      entered: r.entries.length,
      guests: (r.guests ?? []).length,
      requests: (r.queue ?? []).filter((x) => x.status === "requested").length,
      waiting: (r.queue ?? []).filter((x) => x.status === "waiting").length,
      offered: (r.queue ?? []).filter((x) => x.status === "offered").length,
      unpaid: fee ? r.entries.filter((e) => !paid.has(e.member_id)).length : 0,
      claims: (r.claims ?? []).length,
    };
  });
}

export type Entry = {
  memberId: string;
  name: string;
  homeClub: string | null;
  avatarUrl: string | null;
  enteredAt: string;
  teeGroup: number | null;
  teeTime: string | null;
  teePosition: number | null;
};
export type Guest = { id: number; name: string; handicapIndex: number | null; teeGroup: number | null; teeTime: string | null; teePosition: number | null };
export type QueueEntry = { id: number; memberId: string; name: string; avatarUrl: string | null; status: "requested" | "waiting" | "offered"; guestName: string | null; guestIndex: number | null; askedAt: string; queuedAt: string; offerExpiresAt: string | null };
export type Choice = { meal: string | null; guestMeal: string | null; playWith: string | null; teePref: "early" | "late" | null; note: string | null };
export type Withdrawal = { id: number; memberId: string; name: string; at: string };

export type EventPage = {
  outing: Outing;
  entries: Entry[];
  guests: Guest[];
  guestPayments: Map<number, Exclude<PaidStatus, "card">>;
  payments: Map<string, PaidStatus>;
  claims: Map<string, ClaimMethod>;
  queue: QueueEntry[];
  choices: Map<string, Choice>;
  withdrawals: Withdrawal[];
};

export async function loadEvent(db: Db, groupId: number, outingId: number): Promise<EventPage | null> {
  const { data: row, error } = await db.from("society_outings").select(OUTING).eq("id", outingId).eq("group_id", groupId).maybeSingle<OutingRow>();
  if (error) fail(error, "Couldn't load this event.");
  if (!row) return null;
  const [entries, payments, claims, guests, guestPayments, queue, choices, withdrawals] = await Promise.all([
    db
      .from("society_outing_entries")
      .select("member_id, entered_at, tee_group, tee_time, tee_position, profile:profiles(first_name, last_name, home_club, avatar_url)")
      .eq("outing_id", outingId)
      .order("entered_at")
      .overrideTypes<{ member_id: string; entered_at: string; tee_group: number | null; tee_time: string | null; tee_position: number | null; profile: { first_name: string | null; last_name: string | null; home_club: string | null; avatar_url: string | null } | null }[]>(),
    db.from("society_outing_payments").select("member_id, status").eq("outing_id", outingId).overrideTypes<{ member_id: string; status: PaidStatus }[]>(),
    db.from("society_outing_payment_claims").select("member_id, method").eq("outing_id", outingId).overrideTypes<{ member_id: string; method: ClaimMethod }[]>(),
    db.from("society_outing_guests").select("id, name, handicap_index, tee_group, tee_time, tee_position").eq("outing_id", outingId).order("id").overrideTypes<{ id: number; name: string; handicap_index: number | string | null; tee_group: number | null; tee_time: string | null; tee_position: number | null }[]>(),
    db
      .from("society_outing_guest_payments")
      .select("guest_id, status, guest:society_outing_guests!inner(outing_id)")
      .eq("guest.outing_id", outingId)
      .overrideTypes<{ guest_id: number; status: Exclude<PaidStatus, "card"> }[]>(),
    db
      .from("society_outing_queue")
      .select("id, member_id, status, guest_name, guest_index, created_at, queued_at, offer_expires_at, profile:profiles(first_name, last_name, avatar_url)")
      .eq("outing_id", outingId)
      .order("queued_at")
      .overrideTypes<{ id: number; member_id: string; status: QueueEntry["status"]; guest_name: string | null; guest_index: number | string | null; created_at: string; queued_at: string; offer_expires_at: string | null; profile: { first_name: string | null; last_name: string | null; avatar_url: string | null } | null }[]>(),
    db.from("society_outing_choices").select("member_id, meal, guest_meal, play_with, tee_pref, note").eq("outing_id", outingId).overrideTypes<{ member_id: string; meal: string | null; guest_meal: string | null; play_with: string | null; tee_pref: "early" | "late" | null; note: string | null }[]>(),
    db
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
      name: fullName(e.profile),
      homeClub: e.profile?.home_club ?? null,
      avatarUrl: e.profile?.avatar_url ?? null,
      enteredAt: e.entered_at,
      teeGroup: e.tee_group,
      teeTime: e.tee_time,
      teePosition: e.tee_position,
    })),
    payments: new Map((payments.data ?? []).map((p) => [p.member_id, p.status])),
    claims: new Map((claims.data ?? []).map((c) => [c.member_id, c.method])),
    guests: (guests.data ?? []).map((g) => ({ id: g.id, name: g.name, handicapIndex: g.handicap_index == null ? null : Number(g.handicap_index), teeGroup: g.tee_group, teeTime: g.tee_time, teePosition: g.tee_position })),
    guestPayments: new Map((guestPayments.data ?? []).map((p) => [p.guest_id, p.status])),
    queue: (queue.data ?? []).map((q) => ({
      id: q.id,
      memberId: q.member_id,
      name: fullName(q.profile),
      avatarUrl: q.profile?.avatar_url ?? null,
      status: q.status,
      guestName: q.guest_name,
      guestIndex: q.guest_index == null ? null : Number(q.guest_index),
      askedAt: q.created_at,
      queuedAt: q.queued_at,
      offerExpiresAt: q.offer_expires_at,
    })),
    choices: new Map((choices.data ?? []).map((c) => [c.member_id, { meal: c.meal, guestMeal: c.guest_meal, playWith: c.play_with, teePref: c.tee_pref, note: c.note }])),
    withdrawals: (withdrawals.data ?? []).map((w) => ({ id: w.id, memberId: w.member_id, name: fullName(w.profile), at: w.withdrawn_at })),
  };
}

/** Payment details from the society's most recent event that had any — to start a new event with. */
export async function lastPaymentDetails(db: Db, groupId: number): Promise<{ payRevtag: string | null; payIban: string | null; payAccountName: string | null; payCash: boolean; payNote: string | null } | null> {
  const { data } = await db
    .from("society_outings")
    .select("pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note")
    .eq("group_id", groupId)
    .or("pay_revtag.not.is.null,pay_iban.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ pay_revtag: string | null; pay_iban: string | null; pay_account_name: string | null; pay_cash: boolean; pay_note: string | null }>();
  return data ? { payRevtag: data.pay_revtag, payIban: data.pay_iban, payAccountName: data.pay_account_name, payCash: data.pay_cash, payNote: data.pay_note } : null;
}

/** Who has been drawn together at the society's last few events, for the draw to spread people out. */
export async function loadDrawHistory(db: Db, groupId: number, outingId: number): Promise<[string, number][]> {
  const { data } = await db
    .from("society_outings")
    .select("id, entries:society_outing_entries(member_id, tee_group)")
    .eq("group_id", groupId)
    .neq("id", outingId)
    .not("draw_published_at", "is", null)
    .order("plays_on", { ascending: false })
    .limit(6)
    .overrideTypes<{ id: number; entries: { member_id: string; tee_group: number | null }[] }[]>();
  const met = new Map<string, number>();
  for (const o of data ?? []) {
    const byGroup = new Map<number, string[]>();
    for (const e of o.entries) if (e.tee_group) byGroup.set(e.tee_group, [...(byGroup.get(e.tee_group) ?? []), e.member_id]);
    for (const ids of byGroup.values())
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = `m:${ids[i]}`;
          const b = `m:${ids[j]}`;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          met.set(k, (met.get(k) ?? 0) + 1);
        }
  }
  return [...met.entries()];
}

export async function loadClubName(db: Db, clubId: number | null): Promise<string | null> {
  if (!clubId) return null;
  const { data } = await db.from("clubs").select("name").eq("id", clubId).maybeSingle<{ name: string }>();
  return data?.name ?? null;
}

// ---------------------------------------------------------------------------
// Money (0144)
// ---------------------------------------------------------------------------

export type MoneyEvent = {
  id: number;
  title: string;
  plays_on: string;
  status: string;
  fee_cents: number;
  entrants: number;
  paid: number;
  waived: number;
  unpaid: number;
  claimed: number;
  collected_cents: number;
  outstanding_cents: number;
  refunded_cents: number;
  played: boolean;
};

export type Money = {
  season: number;
  season_label: string;
  season_from: string;
  season_to: string;
  membership:
    | { enabled: false }
    | { enabled: true; fee_cents: number; due: string; paid: number; unpaid: number; claimed: number; honorary: number; lapsed: number; collected_cents: number; outstanding_cents: number };
  events: MoneyEvent[];
  methods: { cash: number; transfer: number; card: number };
  claims: number;
};

export async function loadMoney(db: Db, groupId: number, season?: number | null): Promise<Money> {
  const { data, error } = await db.rpc("society_money", { p_group_id: groupId, p_season: season ?? null });
  if (error) fail(error, "Couldn't load the money.");
  return data as Money;
}

export type PaymentClaim = { kind: "event" | "membership"; outingId: number | null; title: string; memberId: string; name: string; method: ClaimMethod; amountCents: number | null; season: number | null; claimedAt: string };

export async function loadPaymentClaims(db: Db, groupId: number): Promise<PaymentClaim[]> {
  const { data, error } = await db.rpc("society_payment_claims", { p_group_id: groupId });
  if (error) return [];
  return (
    (data ?? []) as { kind: PaymentClaim["kind"]; outing_id: number | null; title: string; member_id: string; name: string; method: ClaimMethod; amount_cents: number | null; season: number | null; claimed_at: string }[]
  ).map((c) => ({ kind: c.kind, outingId: c.outing_id, title: c.title, memberId: c.member_id, name: c.name || "A member", method: c.method, amountCents: c.amount_cents, season: c.season, claimedAt: c.claimed_at }));
}

// ---------------------------------------------------------------------------
// Annual membership (0144)
// ---------------------------------------------------------------------------

export type MembershipSettings = {
  enabled: boolean;
  feeCents: number | null;
  seasonStartMonth: number;
  dueAfterDays: number;
  unpaidPolicy: "allow" | "block";
  payRevtag: string | null;
  payIban: string | null;
  payAccountName: string | null;
  payCash: boolean;
  payNote: string | null;
};

export const NO_MEMBERSHIP: MembershipSettings = { enabled: false, feeCents: null, seasonStartMonth: 1, dueAfterDays: 30, unpaidPolicy: "allow", payRevtag: null, payIban: null, payAccountName: null, payCash: true, payNote: null };

export async function loadMembershipSettings(db: Db, groupId: number): Promise<MembershipSettings> {
  const { data, error } = await db
    .from("society_membership_settings")
    .select("enabled, fee_cents, season_start_month, due_after_days, unpaid_policy, pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note")
    .eq("group_id", groupId)
    .maybeSingle<{ enabled: boolean; fee_cents: number | null; season_start_month: number; due_after_days: number; unpaid_policy: "allow" | "block"; pay_revtag: string | null; pay_iban: string | null; pay_account_name: string | null; pay_cash: boolean; pay_note: string | null }>();
  if (error || !data) return NO_MEMBERSHIP;
  return {
    enabled: data.enabled,
    feeCents: data.fee_cents,
    seasonStartMonth: data.season_start_month,
    dueAfterDays: data.due_after_days,
    unpaidPolicy: data.unpaid_policy,
    payRevtag: data.pay_revtag,
    payIban: data.pay_iban,
    payAccountName: data.pay_account_name,
    payCash: data.pay_cash,
    payNote: data.pay_note,
  };
}

export async function billingSeason(db: Db, groupId: number): Promise<number | null> {
  const { data, error } = await db.rpc("membership_billing_season", { p_group_id: groupId });
  if (error || data == null) return null;
  return Number(data);
}

/** "2027", or "2026–27" when the season doesn't start in January. */
export function seasonLabel(season: number, startMonth: number): string {
  return startMonth === 1 ? String(season) : `${season}–${String((season + 1) % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Noticeboard and messages (0143)
// ---------------------------------------------------------------------------

export type NoticeKind = "general" | "change" | "reminder" | "result";
export const NOTICE_KINDS: { kind: NoticeKind; label: string }[] = [
  { kind: "general", label: "General" },
  { kind: "change", label: "Change" },
  { kind: "reminder", label: "Reminder" },
  { kind: "result", label: "Result" },
];
export type Notice = { id: number; kind: NoticeKind; title: string; body: string | null; pinned: boolean; createdAt: string; editedAt: string | null; author: string | null };

export async function listNotices(db: Db, groupId: number, limit = 50): Promise<Notice[]> {
  const { data, error } = await db
    .from("society_notices")
    .select("id, kind, title, body, pinned, created_at, edited_at, author:profiles(first_name, last_name)")
    .eq("group_id", groupId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<{ id: number; kind: NoticeKind; title: string; body: string | null; pinned: boolean; created_at: string; edited_at: string | null; author: { first_name: string | null; last_name: string | null } | null }[]>();
  if (error) return [];
  return (data ?? []).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, pinned: n.pinned, createdAt: n.created_at, editedAt: n.edited_at, author: n.author ? fullName(n.author) : null }));
}

export type Audience = "everyone" | "entrants" | "waiting" | "fees_unpaid" | "membership_unpaid" | "committee";
export const AUDIENCES: { audience: Audience; label: string; needsEvent?: boolean; needsMembership?: boolean }[] = [
  { audience: "everyone", label: "Everyone" },
  { audience: "entrants", label: "Entered in an event", needsEvent: true },
  { audience: "waiting", label: "Asking or waiting for a place", needsEvent: true },
  { audience: "fees_unpaid", label: "Event fees unpaid" },
  { audience: "membership_unpaid", label: "Membership unpaid", needsMembership: true },
  { audience: "committee", label: "The committee" },
];
export const isAudience = (v: unknown): v is Audience => typeof v === "string" && AUDIENCES.some((a) => a.audience === v);

export type SentMessage = { id: number; audience: Audience; title: string; recipients: number; sentAt: string };

export async function sentMessages(db: Db, groupId: number): Promise<SentMessage[]> {
  const { data, error } = await db
    .from("society_messages")
    .select("id, audience, title, recipients, sent_at")
    .eq("group_id", groupId)
    .order("sent_at", { ascending: false })
    .limit(20)
    .overrideTypes<{ id: number; audience: Audience; title: string; recipients: number; sent_at: string }[]>();
  if (error) return [];
  return (data ?? []).map((m) => ({ id: m.id, audience: m.audience, title: m.title, recipients: m.recipients, sentAt: m.sent_at }));
}

export async function audienceCount(db: Db, groupId: number, audience: Audience, outingId: number | null): Promise<number | null> {
  const { data, error } = await db.rpc("society_audience_count", { p_group_id: groupId, p_audience: audience, p_outing_id: outingId });
  return error ? null : Number(data);
}

// ---------------------------------------------------------------------------
// Results and the order of merit (0137/0138/0145)
// ---------------------------------------------------------------------------

export type SocietyResult = { matchDayId: number; title: string; courseName: string | null; playedOn: string; publishedAt: string; shareToken: string | null; amended: boolean; winners: string[]; results: Results };

export async function loadSocietyResults(db: Db, groupId: number, limit = 60): Promise<SocietyResult[]> {
  const { data, error } = await db
    .from("competition_results")
    .select("match_day_id, results, published_at, share_token")
    .eq("group_id", groupId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit)
    .overrideTypes<{ match_day_id: number; results: Results; published_at: string; share_token: string | null }[]>();
  if (error) return [];
  return (data ?? []).map((r) => {
    const ev = (r.results?.event ?? {}) as { title?: string; courseName?: string | null; playedOn?: string };
    const prizes = (r.results?.prizes ?? []) as { winners?: { name: string }[] }[];
    const amendments = ((r.results as unknown as { amendments?: unknown[] })?.amendments ?? []) as unknown[];
    return {
      matchDayId: r.match_day_id,
      title: ev.title || "Competition",
      courseName: ev.courseName ?? null,
      playedOn: ev.playedOn ?? r.published_at.slice(0, 10),
      publishedAt: r.published_at,
      shareToken: r.share_token,
      amended: amendments.length > 0,
      winners: prizes.flatMap((p) => (p.winners ?? []).map((w) => w.name)).slice(0, 3),
      results: r.results,
    };
  });
}

export async function loadMeritRules(db: Db, groupId: number): Promise<MeritRules> {
  const { data, error } = await db
    .from("society_merit_settings")
    .select("points, attendance_points, best_of, include_team, season_start_month")
    .eq("group_id", groupId)
    .maybeSingle<{ points: number[]; attendance_points: number; best_of: number | null; include_team: boolean; season_start_month: number }>();
  if (error || !data) return DEFAULT_MERIT_RULES;
  return { points: data.points, attendancePoints: data.attendance_points, bestOf: data.best_of, includeTeam: data.include_team, seasonStartMonth: data.season_start_month };
}

export async function loadSeasonResults(db: Db, groupId: number, from: string, to: string): Promise<MeritEvent[]> {
  const { data, error } = await db
    .from("competition_results")
    .select("match_day_id, results, published_at")
    .eq("group_id", groupId)
    .eq("status", "published")
    .order("published_at")
    .overrideTypes<{ match_day_id: number; results: Results; published_at: string }[]>();
  if (error) return [];
  return (data ?? [])
    .map((r) => ({ id: r.match_day_id, results: r.results, playedOn: r.results?.event?.playedOn ?? r.published_at.slice(0, 10) }))
    .filter((e) => e.playedOn >= from && e.playedOn < to);
}

// ---------------------------------------------------------------------------
// Exports (0144)
// ---------------------------------------------------------------------------

export type ExportLog = { id: number; file: string; rows: number; createdAt: string; who: string | null };

export async function exportLog(db: Db, groupId: number): Promise<ExportLog[]> {
  const { data, error } = await db
    .from("society_exports")
    .select("id, file, rows, created_at, who:profiles(first_name, last_name)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(15)
    .overrideTypes<{ id: number; file: string; rows: number; created_at: string; who: { first_name: string | null; last_name: string | null } | null }[]>();
  if (error) return [];
  return (data ?? []).map((e) => ({ id: e.id, file: e.file, rows: e.rows, createdAt: e.created_at, who: e.who ? fullName(e.who) : null }));
}
