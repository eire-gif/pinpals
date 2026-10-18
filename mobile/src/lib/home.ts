import { isGroupKind, type GroupKind } from "./groups";
import { supabase } from "./supabase";
import { clockTime, todayIso } from "./tee-times";

/**
 * Everything the home screen reads, in one call.
 *
 * The website's homepage is a shop window: hero, how it works, why you should
 * join. Nobody sees it signed out here — the auth gate sends a stranger to
 * login before any tab renders — so the app's version keeps the brand and the
 * actions and replaces the pitch with the member's own state. "What have I got
 * on, and who is waiting on me" is the question someone opens this app to ask.
 *
 * Nothing here decides who may see what. RLS on `tee_time_invites` and
 * `tee_time_interests` (0065, 0066, 0074, 0078) does that; these queries just
 * ask, and get fewer rows when they aren't entitled to them.
 */

type InviteRow = {
  id: number;
  member_id: string;
  club_name: string | null;
  play_date: string;
  time_from: string | null;
  time_to: string | null;
  exact_tee_time: string | null;
  club: { name: string } | null;
};

export type NextRound = {
  inviteId: number;
  club: string;
  playDate: string;
  when: string;
  role: "hosting" | "playing";
  /** Exact tee time ("09:00:00") when there is one — for "in 42 min". */
  exactTime: string | null;
  /** The host, needed for the players on the day's card. */
  hostId: string;
};

/** A golfer shown on Home's top card: a face, or initials on their colour. */
export type HomePlayer = { name: string; avatarUrl: string | null; avatarColor: string | null };

/**
 * A group event the member is entered in (society outing, crew round or a
 * trip day — all society_outings since 0125/0142), the soonest in the next
 * week. Drives the top of Home: the full card on the day, "Up next" before.
 */
export type HomeEvent = {
  outingId: number;
  groupId: number;
  groupName: string;
  groupKind: GroupKind;
  title: string;
  course: string | null;
  playsOn: string;
  /** The event's first tee ("10:00:00"), if set. */
  firstTee: string | null;
  /** Your group's tee time once the draw is out. */
  myTeeTime: string | null;
  myTeeGroup: number | null;
  /** Shotgun start (0173): the hole your group starts on. */
  start: { hole: number; letter: string | null } | null;
  matchDayId: number | null;
  /** Everyone entered. */
  playing: number;
  /** The rest of your tee group, once drawn. */
  partners: HomePlayer[];
  /** There's an entry fee. */
  hasFee: boolean;
  /** There's a fee and it isn't marked paid. */
  paymentDue: boolean;
};

export type HomeSummary = {
  nextRound: NextRound | null;
  /** Players on nextRound, read only when it is today (host first). */
  todayPlayers: HomePlayer[];
  /** The soonest group event you're entered in, within the next week. */
  nextEvent: HomeEvent | null;
  /** Members waiting on an answer from me, on rounds I host. */
  requestsWaiting: number;
  /** Places I have been offered and not yet confirmed. */
  offersWaiting: number;
  /** Null when the count couldn't be read — the hero says nothing rather than
   *  "0 clubs", which would be a lie about the best asset the site has. */
  courseCount: number | null;
  /**
   * How much of the optional half of the profile is filled in, 0-100.
   *
   * The same five fields the website's own meter counts, so a member does
   * not see two different percentages for the same profile. Null when it
   * could not be read, and the nudge simply does not appear.
   */
  profileCompletion: number | null;
  /** Has the member been through the profile builder (or skipped it)? */
  onboarded: boolean;
};

/** Home club, handicap, bio, GUI number. First and last name are
 *  required at signup and so are not part of the score — everyone would
 *  start above zero for having done nothing. Kept in step with
 *  src/lib/profile.ts on the website. */
const COMPLETION_FIELDS = [
  "home_club",
  // County left the edit screens (Oct 2026, country only), so it no longer
  // counts — a field nobody can fill must not hold the meter below 100.
  "handicap",
  "bio",
  "gui_membership_number",
] as const;

async function profileCompletion(userId: string): Promise<number | null> {
  // The columns are listed rather than joined from COMPLETION_FIELDS so the
  // generated types can resolve them; the array below is still the single
  // list that decides the score.
  // Handicap and membership number are yours alone (member_private, 0133).
  const [{ data, error }, { data: mine }] = await Promise.all([
    supabase.from("profiles").select("home_club, bio").eq("id", userId).maybeSingle<Record<string, unknown>>(),
    supabase.from("member_private").select("handicap, gui_membership_number").eq("member_id", userId).maybeSingle<Record<string, unknown>>(),
  ]);

  if (error || !data) return null;

  const row: Record<string, unknown> = { ...data, ...(mine ?? {}) };
  const filled = COMPLETION_FIELDS.filter((field) => {
    const value = row[field];
    return value !== null && value !== undefined && value !== "";
  }).length;

  return Math.round((filled / COMPLETION_FIELDS.length) * 100);
}

const INVITE_SELECT =
  "id, member_id, club_name, play_date, time_from, time_to, exact_tee_time, club:clubs!tee_time_invites_club_id_fkey (name)";

/** The club embed is the reliable one: an invite posted from the app carries
 *  `club_id` and leaves `club_name` null, while older website rows have the
 *  text. Both are checked so neither kind renders as blank. */
const clubOf = (row: InviteRow): string =>
  row.club?.name ?? row.club_name ?? "Your tee time";

const whenOf = (row: InviteRow): string => {
  const exact = clockTime(row.exact_tee_time);
  if (exact) return exact;
  const from = clockTime(row.time_from);
  const to = clockTime(row.time_to);
  if (from && to) return `${from} – ${to}`;
  return from ?? "Time flexible";
};

const toRound = (row: InviteRow, role: NextRound["role"]): NextRound => ({
  inviteId: row.id,
  club: clubOf(row),
  playDate: row.play_date,
  when: whenOf(row),
  role,
  exactTime: row.exact_tee_time,
  hostId: row.member_id,
});

/**
 * There are two ways to be in a round — you posted it, or you asked to join
 * one and confirmed — and they are different rows in different tables. No
 * single query reaches both, so both run and the earlier one wins. A member
 * who hosts one and joins another wants the next one by date, not the one
 * that happens to be on the side of the invite they sit on.
 */
async function nextRound(userId: string): Promise<NextRound | null> {
  const today = todayIso();

  const [hostedResult, joinedResult] = await Promise.all([
    supabase
      .from("tee_time_invites")
      .select(INVITE_SELECT)
      .eq("member_id", userId)
      .in("status", ["open", "full"])
      .gte("play_date", today)
      .order("play_date", { ascending: true })
      .limit(1)
      .overrideTypes<InviteRow[]>(),

    supabase
      .from("tee_time_interests")
      .select(`invite:tee_time_invites!inner (${INVITE_SELECT})`)
      .eq("member_id", userId)
      .eq("status", "confirmed")
      .gte("invite.play_date", today)
      .limit(5)
      .overrideTypes<{ invite: InviteRow }[]>(),
  ]);

  const candidates: NextRound[] = [];

  const hosted = hostedResult.data?.[0];
  if (hosted) candidates.push(toRound(hosted, "hosting"));

  for (const row of joinedResult.data ?? []) {
    if (row.invite) candidates.push(toRound(row.invite, "playing"));
  }

  candidates.sort((a, b) => a.playDate.localeCompare(b.playDate));
  return candidates[0] ?? null;
}

async function requestsWaiting(userId: string): Promise<number> {
  const { data: mine } = await supabase
    .from("tee_time_invites")
    .select("id")
    .eq("member_id", userId)
    .gte("play_date", todayIso())
    .overrideTypes<{ id: number }[]>();

  const ids = (mine ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from("tee_time_interests")
    .select("id", { count: "exact", head: true })
    .in("invite_id", ids)
    .eq("status", "pending");

  return count ?? 0;
}

async function offersWaiting(userId: string): Promise<number> {
  // Same rule as the Offered places screen (listOfferedPlaces): rounds still
  // to come only, so the number on Home matches the cards behind it.
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await supabase
    .from("tee_time_interests")
    .select("id, invite:tee_time_invites!inner(play_date)", { count: "exact", head: true })
    .eq("member_id", userId)
    .eq("status", "accepted")
    .gte("invite.play_date", today);

  return count ?? 0;
}

/** Read, never written down. The website's homepage said 373 for months after
 *  the directory passed 2,600; a stale figure on the first thing anyone reads
 *  is worse than no figure. `head: true` fetches no rows. */
async function courseCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from("clubs")
    .select("id", { count: "exact", head: true })
    .is("hidden_at", null);

  return error ? null : (count ?? null);
}

/**
 * Whether the member has been through the profile builder. False sends the
 * Finish-your-profile row to the builder rather than to the edit form — the
 * builder asks for courses played and PinPals, which the form does not.
 * Members who joined before the builder existed have never seen it, and that
 * is the point: they get it too.
 */
async function onboarded(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle<{ onboarded_at: string | null }>();
  return Boolean(data?.onboarded_at);
}

/** YYYY-MM-DD, `days` from today, in local time (as todayIso). */
const isoInDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type ProfileBits = { first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null };
const toPlayer = (p: ProfileBits | null): HomePlayer => ({
  name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member",
  avatarUrl: p?.avatar_url ?? null,
  avatarColor: p?.avatar_color ?? null,
});

/** Host first, then everyone confirmed — the fourball on the day's card. */
async function playersFor(round: NextRound): Promise<HomePlayer[]> {
  const [host, joined] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name, avatar_url, avatar_color").eq("id", round.hostId).maybeSingle<ProfileBits>(),
    supabase
      .from("tee_time_interests")
      .select("member_id, profiles (first_name, last_name, avatar_url, avatar_color)")
      .eq("invite_id", round.inviteId)
      .eq("status", "confirmed")
      .overrideTypes<{ member_id: string; profiles: ProfileBits | null }[]>(),
  ]);
  return [...(host.data ? [toPlayer(host.data)] : []), ...(joined.data ?? []).map((r) => toPlayer(r.profiles))];
}

type EntryRow = {
  tee_group: number | null;
  tee_time: string | null;
  start_hole: number | null;
  start_letter: string | null;
  outing: {
    id: number;
    group_id: number;
    title: string;
    course_name: string | null;
    plays_on: string;
    first_tee: string | null;
    match_day_id: number | null;
    entry_fee_cents: number | null;
  };
};

/**
 * The soonest group event you're entered in, today or within a week. Reads
 * from your own entries (RLS lets a member see their group's), then the
 * group, the field and your payment, together.
 */
async function nextEvent(userId: string): Promise<HomeEvent | null> {
  const { data, error } = await supabase
    .from("society_outing_entries")
    .select(
      "tee_group, tee_time, start_hole, start_letter, outing:society_outings!inner(id, group_id, title, course_name, plays_on, first_tee, match_day_id, entry_fee_cents, status)"
    )
    .eq("member_id", userId)
    .eq("outing.status", "open")
    .gte("outing.plays_on", todayIso())
    .lte("outing.plays_on", isoInDays(7))
    .overrideTypes<EntryRow[]>();
  if (error || !data || data.length === 0) return null;

  const mine = [...data].sort(
    (a, b) => a.outing.plays_on.localeCompare(b.outing.plays_on) || (a.tee_time ?? a.outing.first_tee ?? "").localeCompare(b.tee_time ?? b.outing.first_tee ?? "")
  )[0];
  const o = mine.outing;

  const [group, field, paid] = await Promise.all([
    supabase.from("groups").select("name, kind").eq("id", o.group_id).maybeSingle<{ name: string; kind: string }>(),
    supabase
      .from("society_outing_entries")
      .select("member_id, tee_group, tee_position, profile:profiles(first_name, last_name, avatar_url, avatar_color)")
      .eq("outing_id", o.id)
      .overrideTypes<{ member_id: string; tee_group: number | null; tee_position: number | null; profile: ProfileBits | null }[]>(),
    supabase
      .from("society_outing_payments")
      .select("status")
      .eq("outing_id", o.id)
      .eq("member_id", userId)
      .overrideTypes<{ status: string }[]>(),
  ]);

  const entries = field.data ?? [];
  const partners =
    mine.tee_group == null
      ? []
      : entries
          .filter((e) => e.tee_group === mine.tee_group && e.member_id !== userId)
          .sort((a, b) => (a.tee_position ?? 0) - (b.tee_position ?? 0))
          .map((e) => toPlayer(e.profile));
  const hasFee = (o.entry_fee_cents ?? 0) > 0;
  const isPaid = (paid.data ?? []).some((p) => p.status !== "refunded");

  return {
    outingId: o.id,
    groupId: o.group_id,
    groupName: group.data?.name ?? "Your group",
    groupKind: group.data && isGroupKind(group.data.kind) ? group.data.kind : "society",
    title: o.title,
    course: o.course_name,
    playsOn: o.plays_on,
    firstTee: o.first_tee,
    myTeeTime: mine.tee_time,
    myTeeGroup: mine.tee_group,
    start: mine.start_hole == null ? null : { hole: mine.start_hole, letter: mine.start_letter },
    matchDayId: o.match_day_id,
    playing: entries.length,
    partners,
    hasFee,
    paymentDue: hasFee && !isPaid,
  };
}

/**
 * One await for the whole screen. Every part is independent, so they run
 * together and a failure in any one leaves the rest of the page intact —
 * a home screen that renders nothing because a count query timed out is a
 * worse outcome than a home screen missing a count.
 */
export async function loadHome(userId: string): Promise<HomeSummary> {
  const [round, event, requests, offers, courses, completion, builderDone] = await Promise.all([
    nextRound(userId).catch(() => null),
    nextEvent(userId).catch(() => null),
    requestsWaiting(userId).catch(() => 0),
    offersWaiting(userId).catch(() => 0),
    courseCount().catch(() => null),
    profileCompletion(userId).catch(() => null),
    onboarded(userId).catch(() => true),
  ]);

  // The fourball's faces only matter on the day, so only then are they read.
  const todayPlayers = round && round.playDate === todayIso() ? await playersFor(round).catch(() => []) : [];

  return {
    nextRound: round,
    todayPlayers,
    nextEvent: event,
    requestsWaiting: requests,
    offersWaiting: offers,
    courseCount: courses,
    profileCompletion: completion,
    onboarded: builderDone,
  };
}
