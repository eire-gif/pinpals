import type { Entry, LeagueKind, LeagueStatus, Match, MatchStage, MatchStatus, Province } from "@/lib/matchplay";
import { postToSite } from "@/lib/api";
import { supabase } from "@/lib/supabase";

/**
 * Competitions (0148): reads under RLS, writes through its functions. Every
 * rule — who may, entries closing, real margins, ladder reach — is the
 * database's, and its messages are written for members and shown as they
 * come. The tables and suggested draws are worked out in lib/matchplay.ts.
 *
 * A database without 0148 answers "relation does not exist"; the lists here
 * return empty for that, so the Compete screen says nothing is running
 * rather than showing an error.
 */

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

const missing = (error: { message: string; code?: string } | null) =>
  !!error && (error.code === "PGRST202" || error.code === "42P01" || error.code === "PGRST205" || /could not find|does not exist/i.test(error.message));

type Person = { first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null;
const nameOf = (p: Person): string => [p?.first_name, p?.last_name?.slice(0, 1) ? `${p.last_name.slice(0, 1)}.` : null].filter(Boolean).join(" ") || "A member";

export type League = {
  id: number;
  kind: LeagueKind;
  name: string;
  about: string | null;
  groupId: number | null;
  groupName: string | null;
  province: Province | null;
  clubId: number | null;
  clubName: string | null;
  createdBy: string;
  entryFeeCents: number | null;
  entriesCloseAt: string | null;
  startsOn: string | null;
  maxHandicap: number | null;
  qualifiersPerGroup: number;
  roundDays: number;
  pointsWin: number;
  pointsHalf: number;
  challengeReach: number;
  challengeDays: number;
  status: LeagueStatus;
};

type LeagueRow = {
  id: number;
  kind: LeagueKind;
  name: string;
  about: string | null;
  group_id: number | null;
  province: Province | null;
  club_id: number | null;
  created_by: string;
  entry_fee_cents: number | null;
  entries_close_at: string | null;
  starts_on: string | null;
  max_handicap: number | string | null;
  qualifiers_per_group: number;
  round_days: number;
  points_win: number;
  points_half: number;
  challenge_reach: number;
  challenge_days: number;
  status: LeagueStatus;
  group: { name: string } | null;
  club: { name: string } | null;
};

const LEAGUE =
  "id, kind, name, about, group_id, province, club_id, created_by, entry_fee_cents, entries_close_at, starts_on, max_handicap, qualifiers_per_group, round_days, points_win, points_half, challenge_reach, challenge_days, status, group:groups(name), club:clubs(name)";

const toLeague = (r: LeagueRow): League => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  about: r.about,
  groupId: r.group_id,
  groupName: r.group?.name ?? null,
  province: r.province,
  clubId: r.club_id,
  clubName: r.club?.name ?? null,
  createdBy: r.created_by,
  entryFeeCents: r.entry_fee_cents,
  entriesCloseAt: r.entries_close_at,
  startsOn: r.starts_on,
  maxHandicap: r.max_handicap == null ? null : Number(r.max_handicap),
  qualifiersPerGroup: r.qualifiers_per_group,
  roundDays: r.round_days,
  pointsWin: r.points_win,
  pointsHalf: r.points_half,
  challengeReach: r.challenge_reach,
  challengeDays: r.challenge_days,
  status: r.status,
});

export type LeagueEntry = Entry & { avatarUrl: string | null; avatarColor: string | null; paid: "cash" | "transfer" | "waived" | null };

export type LeagueMatch = Match & { leagueId: number; arrangedAt: string | null; arrangedClubId: number | null; arrangedClubName: string | null; disputeNote: string | null; nextMatchId: number | null };

type MatchRow = {
  id: number;
  league_id: number;
  stage: MatchStage;
  group_label: string | null;
  round_no: number;
  slot: number;
  player_a: string | null;
  player_b: string | null;
  play_by: string | null;
  status: MatchStatus;
  winner: "a" | "b" | "half" | null;
  margin: string | null;
  holes_up: number;
  reported_by: string | null;
  stands_at: string | null;
  arranged_at: string | null;
  arranged_club_id: number | null;
  dispute_note: string | null;
  next_match_id: number | null;
  club: { name: string } | null;
};

const MATCH =
  "id, league_id, stage, group_label, round_no, slot, player_a, player_b, play_by, status, winner, margin, holes_up, reported_by, stands_at, arranged_at, arranged_club_id, dispute_note, next_match_id, club:clubs(name)";

const toMatch = (r: MatchRow): LeagueMatch => ({
  id: r.id,
  leagueId: r.league_id,
  stage: r.stage,
  groupLabel: r.group_label,
  roundNo: r.round_no,
  slot: r.slot,
  playerA: r.player_a,
  playerB: r.player_b,
  playBy: r.play_by,
  status: r.status,
  winner: r.winner,
  margin: r.margin,
  holesUp: r.holes_up,
  reportedBy: r.reported_by,
  standsAt: r.stands_at,
  arrangedAt: r.arranged_at,
  arrangedClubId: r.arranged_club_id,
  arrangedClubName: r.club?.name ?? null,
  disputeNote: r.dispute_note,
  nextMatchId: r.next_match_id,
});

// ---------------------------------------------------------------- lists

export type CompeteHome = {
  /** Competitions I'm in (not withdrawn), running or finished recently. */
  mine: League[];
  /** Open for entries, and visible to me, that I haven't entered. */
  enterable: League[];
  /** Matches with something for me to do, soonest first. */
  myMatches: LeagueMatch[];
  /** Names for every player in myMatches. */
  names: Record<string, string>;
  /** Whether I may start a PinPals-wide competition. */
  staff: boolean;
};

export async function loadCompeteHome(me: string): Promise<CompeteHome> {
  const empty: CompeteHome = { mine: [], enterable: [], myMatches: [], names: {}, staff: false };
  const [entriesRes, leaguesRes, staffRes] = await Promise.all([
    supabase.from("competition_entries").select("league_id").eq("user_id", me).is("withdrawn_at", null).overrideTypes<{ league_id: number }[]>(),
    supabase.from("competition_leagues").select(LEAGUE).in("status", ["entries", "running", "knockout", "finished"]).order("created_at", { ascending: false }).limit(100).overrideTypes<LeagueRow[]>(),
    supabase.rpc("competition_staff"),
  ]);
  if (missing(entriesRes.error) || missing(leaguesRes.error)) return empty;
  if (entriesRes.error) fail(entriesRes.error, "Couldn't load your competitions.");
  if (leaguesRes.error) fail(leaguesRes.error, "Couldn't load competitions.");
  const entered = new Set((entriesRes.data ?? []).map((e) => e.league_id));
  const leagues = (leaguesRes.data ?? []).map(toLeague);
  const mine = leagues.filter((l) => entered.has(l.id));
  const enterable = leagues.filter(
    (l) => !entered.has(l.id) && (l.kind === "ladder" ? l.status === "running" : l.status === "entries" && (!l.entriesCloseAt || new Date(l.entriesCloseAt) > new Date())),
  );

  const { data: ms, error: mErr } = await supabase
    .from("competition_matches")
    .select(MATCH)
    .or(`player_a.eq.${me},player_b.eq.${me}`)
    .in("status", ["open", "reported", "disputed"])
    .order("play_by", { ascending: true, nullsFirst: false })
    .limit(30)
    .overrideTypes<MatchRow[]>();
  if (mErr && !missing(mErr)) fail(mErr, "Couldn't load your matches.");
  const myMatches = (ms ?? []).map(toMatch).filter((m) => mine.some((l) => l.id === m.leagueId && l.status !== "finished"));
  const names = await namesFor(myMatches.flatMap((m) => [m.playerA, m.playerB]));
  return { mine, enterable, myMatches, names, staff: staffRes.data === true };
}

async function namesFor(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return {};
  const { data } = await supabase.from("profiles").select("id, first_name, last_name, avatar_url, avatar_color").in("id", unique);
  return Object.fromEntries((data ?? []).map((p) => [p.id as string, nameOf(p as Person)]));
}

// ---------------------------------------------------------------- one competition

export type LeaguePage = {
  league: League;
  entries: LeagueEntry[];
  matches: LeagueMatch[];
  organiser: boolean;
};

export async function loadLeague(id: number): Promise<LeaguePage | null> {
  const { data: row, error } = await supabase.from("competition_leagues").select(LEAGUE).eq("id", id).maybeSingle<LeagueRow>();
  if (error) fail(error, "Couldn't load this competition.");
  if (!row) return null;
  const [entriesRes, matchesRes, orgRes] = await Promise.all([
    supabase
      .from("competition_entries")
      .select("user_id, handicap_index, group_label, ladder_position, withdrawn_at, paid, profile:profiles(first_name, last_name, avatar_url, avatar_color)")
      .eq("league_id", id)
      .order("entered_at")
      .overrideTypes<
        {
          user_id: string;
          handicap_index: number | string;
          group_label: string | null;
          ladder_position: number | null;
          withdrawn_at: string | null;
          paid: LeagueEntry["paid"];
          profile: Person;
        }[]
      >(),
    supabase.from("competition_matches").select(MATCH).eq("league_id", id).order("stage").order("round_no").order("slot").overrideTypes<MatchRow[]>(),
    supabase.rpc("competition_is_organiser", { p_league_id: id }),
  ]);
  if (entriesRes.error) fail(entriesRes.error, "Couldn't load the entries.");
  if (matchesRes.error) fail(matchesRes.error, "Couldn't load the matches.");
  return {
    league: toLeague(row),
    entries: (entriesRes.data ?? []).map((e) => ({
      userId: e.user_id,
      name: nameOf(e.profile),
      handicapIndex: Number(e.handicap_index),
      groupLabel: e.group_label,
      ladderPosition: e.ladder_position,
      withdrawn: !!e.withdrawn_at,
      paid: e.paid,
      avatarUrl: e.profile?.avatar_url ?? null,
      avatarColor: e.profile?.avatar_color ?? null,
    })),
    matches: (matchesRes.data ?? []).map(toMatch),
    organiser: orgRes.data === true,
  };
}

export type MatchPage = { match: LeagueMatch; league: League; players: Record<string, LeagueEntry | undefined>; organiser: boolean };

export async function loadMatch(id: number): Promise<MatchPage | null> {
  const { data, error } = await supabase.from("competition_matches").select(MATCH).eq("id", id).maybeSingle<MatchRow>();
  if (error) fail(error, "Couldn't load this match.");
  if (!data) return null;
  const page = await loadLeague(data.league_id);
  if (!page) return null;
  const match = toMatch(data);
  const players = Object.fromEntries([match.playerA, match.playerB].filter((x): x is string => !!x).map((u) => [u, page.entries.find((e) => e.userId === u)]));
  return { match, league: page.league, players, organiser: page.organiser };
}

// ---------------------------------------------------------------- writes

/** Ask the website to send what the change just queued (0148's outbox), now
 *  rather than at the next scheduled run. Fire and forget. */
function flushCompetitionAlerts(): void {
  void postToSite("/api/app/competitions/alerts", {}).catch(() => undefined);
}

async function call<T = unknown>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) fail(error, fallback);
  flushCompetitionAlerts();
  return data as T;
}

export type LeagueDraft = {
  kind: LeagueKind;
  name: string;
  about: string | null;
  groupId: number | null;
  province: Province | null;
  clubId: number | null;
  entryFeeCents: number | null;
  entriesCloseAt: string | null;
  startsOn: string | null;
  maxHandicap: number | null;
  qualifiersPerGroup: number;
  roundDays: number;
  challengeReach: number;
  challengeDays: number;
};

export const saveLeague = (id: number | null, d: LeagueDraft) =>
  call<number>(
    "competition_league_save",
    {
      p_id: id,
      p: {
        kind: d.kind,
        name: d.name,
        about: d.about,
        group_id: d.groupId,
        province: d.province,
        club_id: d.clubId,
        entry_fee_cents: d.entryFeeCents,
        entries_close_at: d.entriesCloseAt,
        starts_on: d.startsOn,
        max_handicap: d.maxHandicap,
        qualifiers_per_group: d.qualifiersPerGroup,
        round_days: d.roundDays,
        challenge_reach: d.challengeReach,
        challenge_days: d.challengeDays,
      },
    },
    "Couldn't save the competition.",
  );

export const cancelLeague = (id: number) => call("competition_cancel", { p_league_id: id }, "Couldn't cancel it.");
export const enterLeague = (id: number, enter: boolean, handicap: number | null) =>
  call("competition_enter", { p_league_id: id, p_in: enter, p_handicap: handicap }, enter ? "Couldn't enter you." : "Couldn't take you out.");
export const markPaid = (id: number, userId: string, how: LeagueEntry["paid"]) =>
  call("competition_mark_paid", { p_league_id: id, p_user_id: userId, p_how: how }, "Couldn't mark the fee.");
export const makeDraw = (id: number, groups: string[][]) => call("competition_draw", { p_league_id: id, p_groups: groups }, "Couldn't make the draw.");
export const startKnockout = (id: number, bracket: (string | null)[]) =>
  call("competition_start_knockout", { p_league_id: id, p_bracket: bracket }, "Couldn't start the knockout.");
export const arrangeMatch = (id: number, at: string | null, clubId: number | null) =>
  call("competition_arrange", { p_match_id: id, p_at: at, p_club_id: clubId }, "Couldn't save the time.");
export const reportResult = (id: number, winner: "me" | "them" | "half", margin: string | null) =>
  call<"reported" | "confirmed" | "disputed">("competition_report", { p_match_id: id, p_winner: winner, p_margin: margin }, "Couldn't report the result.");
/** Confirms the result as shown: if the reporter changed it meanwhile, the database refuses. */
export const confirmResult = (id: number, winner: "a" | "b" | "half", margin: string | null) =>
  call("competition_confirm", { p_match_id: id, p_winner: winner, p_margin: margin }, "Couldn't confirm the result.");
export const disputeResult = (id: number, note: string | null) => call("competition_dispute", { p_match_id: id, p_note: note }, "Couldn't send the dispute.");
export const resolveMatch = (id: number, winner: "a" | "b" | "half" | null, margin: string | null, voidIt = false) =>
  call("competition_resolve", { p_match_id: id, p_winner: winner, p_margin: margin, p_void: voidIt }, "Couldn't settle the match.");
export const challenge = (leagueId: number, opponent: string) =>
  call<number>("competition_challenge", { p_league_id: leagueId, p_opponent: opponent }, "Couldn't send the challenge.");

// ---------------------------------------------------------------- opens

export type Open = {
  id: number;
  clubId: number;
  clubName: string;
  clubTown: string | null;
  playsOn: string;
  title: string;
  entryFee: string | null;
  bookingUrl: string | null;
  province: Province | null;
  source: "member" | "club";
  postedBy: string;
  partners: { userId: string; name: string; note: string | null }[];
};

export async function loadOpens(): Promise<Open[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("open_competitions")
    .select("id, club_id, plays_on, title, entry_fee, booking_url, province, source, posted_by, club:clubs(name, town), partners:open_partner_requests(user_id, note, profile:profiles(first_name, last_name, avatar_url, avatar_color))")
    .gte("plays_on", today)
    .order("plays_on")
    .limit(200)
    .overrideTypes<
      {
        id: number;
        club_id: number;
        plays_on: string;
        title: string;
        entry_fee: string | null;
        booking_url: string | null;
        province: Province | null;
        source: "member" | "club";
        posted_by: string;
        club: { name: string; town: string | null } | null;
        partners: { user_id: string; note: string | null; profile: Person }[];
      }[]
    >();
  if (missing(error)) return [];
  if (error) fail(error, "Couldn't load the opens.");
  return (data ?? []).map((o) => ({
    id: o.id,
    clubId: o.club_id,
    clubName: o.club?.name ?? "A club",
    clubTown: o.club?.town ?? null,
    playsOn: o.plays_on,
    title: o.title,
    entryFee: o.entry_fee,
    bookingUrl: o.booking_url,
    province: o.province,
    source: o.source,
    postedBy: o.posted_by,
    partners: (o.partners ?? []).map((p) => ({ userId: p.user_id, name: nameOf(p.profile), note: p.note })),
  }));
}

export type OpenDraft = { clubId: number; playsOn: string; title: string; entryFee: string | null; bookingUrl: string | null; province: Province | null };

export const shareOpen = (d: OpenDraft) =>
  call<number>(
    "open_competition_share",
    { p: { club_id: d.clubId, plays_on: d.playsOn, title: d.title, entry_fee: d.entryFee, booking_url: d.bookingUrl, province: d.province } },
    "Couldn't share the open.",
  );
export const removeOpen = (id: number) => call("open_competition_remove", { p_id: id }, "Couldn't take it down.");
export const setOpenSource = (id: number, source: "member" | "club") => call("open_competition_set_source", { p_id: id, p_source: source }, "Couldn't change it.");
export const setPartnerRequest = (id: number, on: boolean, note: string | null) =>
  call("open_partner_request_set", { p_open_id: id, p_on: on, p_note: note }, on ? "Couldn't add you." : "Couldn't take you off.");

/** Whether I may start a PinPals-wide competition (an active staff admin). */
export async function amCompetitionStaff(): Promise<boolean> {
  const { data, error } = await supabase.rpc("competition_staff");
  return !error && data === true;
}
