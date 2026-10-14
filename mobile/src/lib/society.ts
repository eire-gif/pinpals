import { postToSite } from "@/lib/api";
import type { Results } from "@/lib/competition-results";
import { flushSocietyAlerts } from "@/lib/outings";
import { supabase } from "@/lib/supabase";
import type { SocietyArea } from "@/lib/groups";
import { DEFAULT_MERIT_RULES, type MeritEvent, type MeritRules } from "@/lib/order-of-merit";

/**
 * A society's committee tools and members' extras (0143–0145): the
 * noticeboard, alert settings, targeted messages, annual membership, what
 * you owe, the treasurer's figures, the members list, exports and the order
 * of merit. Reads under RLS or through the functions; every rule (who may)
 * is the database's, and its messages are shown as they come.
 *
 * A database without these migrations answers "could not find the
 * function" or "relation does not exist"; the reads here return empty for
 * that, so the society page simply doesn't show the new parts yet.
 */

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

const missing = (error: { message: string; code?: string } | null) =>
  !!error && (error.code === "PGRST202" || error.code === "42P01" || error.code === "PGRST205" || /could not find|does not exist/i.test(error.message));

// ---------------------------------------------------------------------------
// Your areas
// ---------------------------------------------------------------------------

export async function mySocietyAreas(groupId: number): Promise<SocietyArea[]> {
  const { data, error } = await supabase.rpc("my_society_areas", { p_group_id: groupId });
  if (error) return [];
  return (data ?? []) as SocietyArea[];
}

export async function mySocietyHandicap(groupId: number): Promise<{ index: number | null; setAt: string | null; setBy: string | null } | null> {
  const { data, error } = await supabase.rpc("my_society_handicap", { p_group_id: groupId });
  if (error) return null;
  const r = ((data ?? []) as { society_index: number | string | null; set_at: string | null; set_by_name: string | null }[])[0];
  if (!r) return null;
  return { index: r.society_index == null ? null : Number(r.society_index), setAt: r.set_at, setBy: r.set_by_name };
}

// ---------------------------------------------------------------------------
// The noticeboard
// ---------------------------------------------------------------------------

export type NoticeKind = "general" | "change" | "reminder" | "result";
export const NOTICE_KINDS: { kind: NoticeKind; label: string }[] = [
  { kind: "general", label: "General" },
  { kind: "change", label: "Change" },
  { kind: "reminder", label: "Reminder" },
  { kind: "result", label: "Result" },
];

export type Notice = { id: number; kind: NoticeKind; title: string; body: string | null; pinned: boolean; createdAt: string; editedAt: string | null; author: string | null };

export async function listNotices(groupId: number, limit = 50): Promise<Notice[]> {
  const { data, error } = await supabase
    .from("society_notices")
    .select("id, kind, title, body, pinned, created_at, edited_at, author:profiles(first_name, last_name)")
    .eq("group_id", groupId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<
      { id: number; kind: NoticeKind; title: string; body: string | null; pinned: boolean; created_at: string; edited_at: string | null; author: { first_name: string | null; last_name: string | null } | null }[]
    >();
  if (missing(error)) return [];
  if (error) fail(error, "Couldn't load the noticeboard.");
  return (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    pinned: n.pinned,
    createdAt: n.created_at,
    editedAt: n.edited_at,
    author: [n.author?.first_name, n.author?.last_name].filter(Boolean).join(" ") || null,
  }));
}

export async function saveNotice(groupId: number, id: number | null, n: { kind: NoticeKind; title: string; body: string | null; pinned: boolean; alert: boolean }): Promise<number> {
  const { data, error } = await supabase.rpc("save_society_notice", { p_group_id: groupId, p_id: id, p: n });
  if (error) fail(error, "Couldn't post that.");
  if (n.alert && id == null) flushSocietyAlerts();
  return Number(data);
}

export async function deleteNotice(id: number): Promise<void> {
  const { error } = await supabase.rpc("delete_society_notice", { p_id: id });
  if (error) fail(error, "Couldn't take it down.");
}

// ---------------------------------------------------------------------------
// Alert settings
// ---------------------------------------------------------------------------

export type AlertPrefKind = "new_event" | "entries_closing" | "tee_times" | "payment_reminders" | "noticeboard" | "results";
export const ALERT_PREFS: { kind: AlertPrefKind; label: string; hint?: string }[] = [
  { kind: "new_event", label: "New events" },
  { kind: "entries_closing", label: "Entries closing", hint: "The day before, if you haven't entered" },
  { kind: "tee_times", label: "Tee times out · your tee time tomorrow" },
  { kind: "payment_reminders", label: "Payment reminders", hint: "At most once a week" },
  { kind: "noticeboard", label: "Noticeboard posts" },
  { kind: "results", label: "Results published" },
];

export async function myAlertPrefs(groupId: number, userId: string): Promise<Map<AlertPrefKind, boolean>> {
  const { data, error } = await supabase.from("society_alert_prefs").select("kind, enabled").eq("group_id", groupId).eq("member_id", userId).overrideTypes<{ kind: AlertPrefKind; enabled: boolean }[]>();
  if (error) return new Map();
  return new Map((data ?? []).map((p) => [p.kind, p.enabled]));
}

export async function setAlertPref(groupId: number, kind: AlertPrefKind, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_society_alert_pref", { p_group_id: groupId, p_kind: kind, p_enabled: enabled });
  if (error) fail(error, "Couldn't change that.");
}

// ---------------------------------------------------------------------------
// Targeted messages
// ---------------------------------------------------------------------------

export type Audience = "everyone" | "entrants" | "waiting" | "fees_unpaid" | "membership_unpaid" | "committee";
export const AUDIENCES: { audience: Audience; label: string; needsEvent?: boolean; needsMembership?: boolean }[] = [
  { audience: "everyone", label: "Everyone" },
  { audience: "entrants", label: "Entered in an event", needsEvent: true },
  { audience: "waiting", label: "Asking or waiting for a place", needsEvent: true },
  { audience: "fees_unpaid", label: "Event fees unpaid" },
  { audience: "membership_unpaid", label: "Membership unpaid", needsMembership: true },
  { audience: "committee", label: "The committee" },
];

export async function audienceCount(groupId: number, audience: Audience, outingId: number | null): Promise<number> {
  const { data, error } = await supabase.rpc("society_audience_count", { p_group_id: groupId, p_audience: audience, p_outing_id: outingId });
  if (error) fail(error, "Couldn't count them.");
  return Number(data);
}

export async function sendSocietyMessage(groupId: number, audience: Audience, outingId: number | null, title: string, body: string | null, postNotice: boolean): Promise<number> {
  const { data, error } = await supabase.rpc("send_society_message", {
    p_group_id: groupId,
    p_audience: audience,
    p_outing_id: outingId,
    p_title: title,
    p_body: body,
    p_post_notice: postNotice,
  });
  if (error) fail(error, "Couldn't send it.");
  flushSocietyAlerts();
  return Number(data);
}

export type SentMessage = { id: number; audience: Audience; title: string; recipients: number; sentAt: string };

export async function sentMessages(groupId: number): Promise<SentMessage[]> {
  const { data, error } = await supabase
    .from("society_messages")
    .select("id, audience, title, recipients, sent_at")
    .eq("group_id", groupId)
    .order("sent_at", { ascending: false })
    .limit(20)
    .overrideTypes<{ id: number; audience: Audience; title: string; recipients: number; sent_at: string }[]>();
  if (error) return [];
  return (data ?? []).map((m) => ({ id: m.id, audience: m.audience, title: m.title, recipients: m.recipients, sentAt: m.sent_at }));
}

// ---------------------------------------------------------------------------
// Annual membership
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

export const NO_MEMBERSHIP: MembershipSettings = {
  enabled: false,
  feeCents: null,
  seasonStartMonth: 1,
  dueAfterDays: 30,
  unpaidPolicy: "allow",
  payRevtag: null,
  payIban: null,
  payAccountName: null,
  payCash: true,
  payNote: null,
};

export async function loadMembershipSettings(groupId: number): Promise<MembershipSettings> {
  const { data, error } = await supabase
    .from("society_membership_settings")
    .select("enabled, fee_cents, season_start_month, due_after_days, unpaid_policy, pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note")
    .eq("group_id", groupId)
    .maybeSingle<{
      enabled: boolean;
      fee_cents: number | null;
      season_start_month: number;
      due_after_days: number;
      unpaid_policy: "allow" | "block";
      pay_revtag: string | null;
      pay_iban: string | null;
      pay_account_name: string | null;
      pay_cash: boolean;
      pay_note: string | null;
    }>();
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

export async function saveMembershipSettings(groupId: number, s: MembershipSettings): Promise<void> {
  const { error } = await supabase.rpc("save_membership_settings", {
    p_group_id: groupId,
    p: {
      enabled: s.enabled,
      fee_cents: s.feeCents,
      season_start_month: s.seasonStartMonth,
      due_after_days: s.dueAfterDays,
      unpaid_policy: s.unpaidPolicy,
      pay_revtag: s.payRevtag,
      pay_iban: s.payIban,
      pay_account_name: s.payAccountName,
      pay_cash: s.payCash,
      pay_note: s.payNote,
    },
  });
  if (error) fail(error, "Couldn't save membership.");
}

export type MembershipStatus = "paid" | "honorary" | "lapsed" | "claimed" | "unpaid";

export const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = {
  paid: "Paid up",
  honorary: "Honorary",
  lapsed: "Lapsed",
  claimed: "Says paid",
  unpaid: "Unpaid",
};

export async function billingSeason(groupId: number): Promise<number | null> {
  const { data, error } = await supabase.rpc("membership_billing_season", { p_group_id: groupId });
  if (error || data == null) return null;
  return Number(data);
}

/** "2027", or "2026–27" when the season doesn't start in January. */
export function seasonLabel(season: number, startMonth: number): string {
  return startMonth === 1 ? String(season) : `${season}–${String((season + 1) % 100).padStart(2, "0")}`;
}

/** Your own membership for a season: your row, or a claim, else unpaid. */
export async function myMembership(groupId: number, userId: string, season: number): Promise<{ status: MembershipStatus; method: string | null; markedAt: string | null; history: { season: number; status: string; method: string | null; markedAt: string }[] }> {
  const [rows, claim] = await Promise.all([
    supabase
      .from("society_memberships")
      .select("season, status, method, marked_at")
      .eq("group_id", groupId)
      .eq("member_id", userId)
      .order("season", { ascending: false })
      .overrideTypes<{ season: number; status: "paid" | "honorary" | "lapsed"; method: string | null; marked_at: string }[]>(),
    supabase.from("society_membership_claims").select("season").eq("group_id", groupId).eq("member_id", userId).eq("season", season).maybeSingle(),
  ]);
  const list = rows.data ?? [];
  const now = list.find((r) => r.season === season);
  const honoraryBefore = list.some((r) => r.season < season && r.status === "honorary");
  const status: MembershipStatus = now ? now.status : honoraryBefore ? "honorary" : claim.data ? "claimed" : "unpaid";
  return {
    status,
    method: now?.method ?? null,
    markedAt: now?.marked_at ?? null,
    history: list.map((r) => ({ season: r.season, status: r.status, method: r.method, markedAt: r.marked_at })),
  };
}

export async function claimMembershipPaid(groupId: number, method: "revolut" | "transfer" | "cash" | null, memberId?: string): Promise<void> {
  const { error } = await supabase.rpc("claim_membership_paid", { p_group_id: groupId, p_method: method, p_member: memberId ?? null });
  if (error) fail(error, "Couldn't save that.");
}

export async function markMembership(groupId: number, memberId: string, season: number, status: "paid" | "honorary" | "lapsed" | null, method?: "cash" | "transfer"): Promise<void> {
  const { error } = await supabase.rpc("mark_membership", { p_group_id: groupId, p_member: memberId, p_season: season, p_status: status, p_method: method ?? null });
  if (error) fail(error, "Couldn't mark that.");
}

export async function remindMembership(groupId: number, memberId: string): Promise<void> {
  const { error } = await supabase.rpc("remind_membership", { p_group_id: groupId, p_member: memberId });
  if (error) fail(error, "Couldn't send the reminder.");
  flushSocietyAlerts();
}

// ---------------------------------------------------------------------------
// What you owe
// ---------------------------------------------------------------------------

export type Due = { kind: "membership" | "event" | "guest"; label: string; amountCents: number; outingId: number | null; playsOn: string | null; claimed: boolean; season: number | null };

export async function myDues(groupId: number): Promise<Due[]> {
  const { data, error } = await supabase.rpc("my_society_dues", { p_group_id: groupId });
  if (error) return [];
  return ((data ?? []) as { kind: Due["kind"]; label: string; amount_cents: number; outing_id: number | null; plays_on: string | null; claimed: boolean; season: number | null }[]).map((d) => ({
    kind: d.kind,
    label: d.label,
    amountCents: d.amount_cents,
    outingId: d.outing_id,
    playsOn: d.plays_on,
    claimed: d.claimed,
    season: d.season,
  }));
}

// ---------------------------------------------------------------------------
// The treasurer
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

export async function loadMoney(groupId: number, season?: number): Promise<Money> {
  const { data, error } = await supabase.rpc("society_money", { p_group_id: groupId, p_season: season ?? null });
  if (error) fail(error, "Couldn't load the money.");
  return data as Money;
}

export type PaymentClaim = { kind: "event" | "membership"; outingId: number | null; title: string; memberId: string; name: string; method: "revolut" | "transfer" | "cash"; amountCents: number | null; season: number | null; claimedAt: string };

export async function loadPaymentClaims(groupId: number): Promise<PaymentClaim[]> {
  const { data, error } = await supabase.rpc("society_payment_claims", { p_group_id: groupId });
  if (error) fail(error, "Couldn't load the payments to confirm.");
  return ((data ?? []) as { kind: PaymentClaim["kind"]; outing_id: number | null; title: string; member_id: string; name: string; method: PaymentClaim["method"]; amount_cents: number | null; season: number | null; claimed_at: string }[]).map((c) => ({
    kind: c.kind,
    outingId: c.outing_id,
    title: c.title,
    memberId: c.member_id,
    name: c.name || "A member",
    method: c.method,
    amountCents: c.amount_cents,
    season: c.season,
    claimedAt: c.claimed_at,
  }));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type SocietyMember = {
  id: string;
  name: string;
  role: string;
  office: string | null;
  joinedAt: string;
  ownIndex: number | null;
  societyIndex: number | null;
  membership: MembershipStatus | null;
};

export async function loadSocietyMembers(groupId: number): Promise<SocietyMember[]> {
  const { data, error } = await supabase.rpc("society_member_list", { p_group_id: groupId });
  if (error) fail(error, "Couldn't load the members.");
  return ((data ?? []) as { member_id: string; first_name: string | null; last_name: string | null; role: string; office: string | null; joined_at: string; own_index: number | string | null; society_index: number | string | null; membership: MembershipStatus | null }[]).map((m) => ({
    id: m.member_id,
    name: [m.first_name, m.last_name].filter(Boolean).join(" ") || "A member",
    role: m.role,
    office: m.office,
    joinedAt: m.joined_at,
    ownIndex: m.own_index == null ? null : Number(m.own_index),
    societyIndex: m.society_index == null ? null : Number(m.society_index),
    membership: m.membership,
  }));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type ExportFile = "members" | "booking" | "attendance" | "payments" | "results";

export const EXPORTS: { file: ExportFile; title: string; detail: string; area: SocietyArea | "any"; who: string; needsEvent?: boolean }[] = [
  { file: "members", title: "Members list", detail: "Name, role, joined, membership, handicaps and mobiles you can see", area: "people", who: "Captain, secretary & treasurer" },
  { file: "booking", title: "Course booking sheet", detail: "One event: groups, tee times, names, handicaps, guests and meals — for the club", area: "events", who: "Whoever runs events", needsEvent: true },
  { file: "attendance", title: "Attendance", detail: "Who entered, withdrew or came as a guest, event by event, this season", area: "events", who: "Whoever runs events" },
  { file: "payments", title: "Payments & accounts", detail: "Every payment and refund this season, and membership", area: "money", who: "Treasurer, captain & secretary" },
  { file: "results", title: "Results", detail: "This season's published results and prizes", area: "any", who: "The committee" },
];

/** Makes the file on the website and returns a ten-minute download link. */
export async function makeExport(groupId: number, file: ExportFile, outingId: number | null): Promise<{ url: string; filename: string; rows: number }> {
  return postToSite<{ url: string; filename: string; rows: number }>(`/api/app/societies/${groupId}/export`, { file, outingId });
}

export type ExportLog = { id: number; file: ExportFile; rows: number; createdAt: string; who: string | null };

export async function exportLog(groupId: number): Promise<ExportLog[]> {
  const { data, error } = await supabase
    .from("society_exports")
    .select("id, file, rows, created_at, who:profiles(first_name, last_name)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(10)
    .overrideTypes<{ id: number; file: ExportFile; rows: number; created_at: string; who: { first_name: string | null; last_name: string | null } | null }[]>();
  if (error) return [];
  return (data ?? []).map((e) => ({ id: e.id, file: e.file, rows: e.rows, createdAt: e.created_at, who: [e.who?.first_name, e.who?.last_name].filter(Boolean).join(" ") || null }));
}

// ---------------------------------------------------------------------------
// The order of merit
// ---------------------------------------------------------------------------

export async function loadMeritRules(groupId: number): Promise<MeritRules> {
  const { data, error } = await supabase
    .from("society_merit_settings")
    .select("points, attendance_points, best_of, include_team, season_start_month")
    .eq("group_id", groupId)
    .maybeSingle<{ points: number[]; attendance_points: number; best_of: number | null; include_team: boolean; season_start_month: number }>();
  if (error || !data) return DEFAULT_MERIT_RULES;
  return { points: data.points, attendancePoints: data.attendance_points, bestOf: data.best_of, includeTeam: data.include_team, seasonStartMonth: data.season_start_month };
}

export async function saveMeritRules(groupId: number, r: MeritRules): Promise<void> {
  const { error } = await supabase.rpc("save_order_of_merit", {
    p_group_id: groupId,
    p: { points: r.points, attendance_points: r.attendancePoints, best_of: r.bestOf, include_team: r.includeTeam, season_start_month: r.seasonStartMonth },
  });
  if (error) fail(error, "Couldn't save the rules.");
}

/** The society's published results from `from` (YYYY-MM-DD) to before `to`. */
export async function loadSeasonResults(groupId: number, from: string, to: string): Promise<MeritEvent[]> {
  const { data, error } = await supabase
    .from("competition_results")
    .select("match_day_id, results, published_at")
    .eq("group_id", groupId)
    .eq("status", "published")
    .order("published_at")
    .overrideTypes<{ match_day_id: number; results: Results; published_at: string }[]>();
  if (error) fail(error, "Couldn't load the results.");
  return (data ?? [])
    .map((r) => ({ id: r.match_day_id, results: r.results, playedOn: r.results?.event?.playedOn ?? r.published_at.slice(0, 10) }))
    .filter((e) => e.playedOn >= from && e.playedOn < to);
}
