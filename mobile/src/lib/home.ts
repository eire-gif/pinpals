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
};

export type HomeSummary = {
  nextRound: NextRound | null;
  /** Members waiting on an answer from me, on rounds I host. */
  requestsWaiting: number;
  /** Places I have been offered and not yet confirmed. */
  offersWaiting: number;
  /** Null when the count couldn't be read — the hero says nothing rather than
   *  "0 clubs", which would be a lie about the best asset the site has. */
  courseCount: number | null;
};

const INVITE_SELECT =
  "id, club_name, play_date, time_from, time_to, exact_tee_time, club:clubs!tee_time_invites_club_id_fkey (name)";

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
  const { count } = await supabase
    .from("tee_time_interests")
    .select("id", { count: "exact", head: true })
    .eq("member_id", userId)
    .eq("status", "accepted");

  return count ?? 0;
}

/** Read, never written down. The website's homepage said 373 for months after
 *  the directory passed 2,600; a stale figure on the first thing anyone reads
 *  is worse than no figure. `head: true` fetches no rows. */
async function courseCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from("clubs")
    .select("id", { count: "exact", head: true });

  return error ? null : (count ?? null);
}

/**
 * One await for the whole screen. Every part is independent, so they run
 * together and a failure in any one leaves the rest of the page intact —
 * a home screen that renders nothing because a count query timed out is a
 * worse outcome than a home screen missing a count.
 */
export async function loadHome(userId: string): Promise<HomeSummary> {
  const [round, requests, offers, courses] = await Promise.all([
    nextRound(userId).catch(() => null),
    requestsWaiting(userId).catch(() => 0),
    offersWaiting(userId).catch(() => 0),
    courseCount().catch(() => null),
  ]);

  return {
    nextRound: round,
    requestsWaiting: requests,
    offersWaiting: offers,
    courseCount: courses,
  };
}
