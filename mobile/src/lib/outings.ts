import type { Club } from "@/lib/courses";
import type { OutingKind } from "@/lib/itinerary-rules";
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
  first_tee: string | null;
  details: string | null;
  entry_fee_cents: number | null;
  max_entries: number | null;
  status: "open" | "cancelled";
  draw_published_at: string | null;
  match_day_id: number | null;
};

const OUTING = "id, group_id, kind, title, club_id, course_name, plays_on, ends_on, location, first_tee, details, entry_fee_cents, max_entries, status, draw_published_at, match_day_id";

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
    return { ...toOuting(r), entered: r.entries.length, mine: !!me, myTeeGroup: me?.tee_group ?? null, myTeeTime: me?.tee_time ?? null };
  });
}

// ---------------------------------------------------------------------------
// One outing
// ---------------------------------------------------------------------------

export type OutingPage = {
  outing: Outing;
  entries: OutingEntry[];
  /** Your own payment; or, for officers, everyone's. Keyed by member. */
  payments: Map<string, PaidStatus>;
};

export async function loadOuting(outingId: number): Promise<OutingPage | null> {
  const { data: row, error } = await supabase.from("society_outings").select(OUTING).eq("id", outingId).maybeSingle<OutingRow>();
  if (error) fail(error, "Couldn't load this outing.");
  if (!row) return null;
  const [entries, payments] = await Promise.all([
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
      partners: o.entries
        .filter((e) => e.tee_group === me.tee_group && e.member_id !== userId)
        .sort((a, b) => (a.tee_position ?? 0) - (b.tee_position ?? 0))
        .map((e) => [e.profile?.first_name, e.profile?.last_name].filter(Boolean).join(" ") || "A member"),
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

/** Groups in tee order, each with its tee time and members. */
export async function publishOutingDraw(outingId: number, groups: { teeTime: string | null; members: string[] }[]): Promise<void> {
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
