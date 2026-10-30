/**
 * Ryder Cup mode for trips (0200, claude/ryder-cup-mode.md): loading and
 * saving. The rules are in trip-cup-rules.ts.
 *
 * A session is an ordinary match day between the Cup's two teams (side 1 is
 * team 1), so its score comes from loadMatchDay like Match Day Fun's board.
 */
import { loadGroupRoster, type RosterPlayer } from "@/lib/groups-data";
import { loadItinerary, type ItineraryItem } from "@/lib/itinerary";
import { loadMatchDay, subscribeToMatchDay, type MatchDayData } from "@/lib/live-match-days";
import { supabase } from "@/lib/supabase";
import { cupState, matchesFor, type CupFormat, type CupState, type PickMode, type SessionScore, type Team } from "@/lib/trip-cup-rules";

export type Cup = {
  id: number;
  outingId: number;
  groupId: number;
  teamNames: [string, string];
  holders: Team | null;
  pickMode: PickMode;
  secretPairings: boolean;
  status: "open" | "cancelled";
};

export type CupMember = RosterPlayer & { team: Team; captain: boolean };

export type CupSession = {
  id: number;
  itemId: number;
  slot: 1 | 2;
  format: CupFormat;
  matchDayId: number | null;
  /** The round on the itinerary. */
  item: ItineraryItem | null;
  /** The live day, once started (null if it can't be read). */
  day: MatchDayData | null;
  score: SessionScore;
};

export type CupPage = {
  cup: Cup;
  /** Everyone in the trip's group. */
  roster: RosterPlayer[];
  /** Who can be picked: those entered on the trip, or the whole group when nobody is. */
  candidates: RosterPlayer[];
  members: CupMember[];
  sessions: CupSession[];
  /** Rounds on the itinerary, in order, for planning sessions. */
  rounds: ItineraryItem[];
  state: CupState;
  /** The trip's title and first day. */
  tripTitle: string;
  tripStartsOn: string;
};

type CupRow = {
  id: number;
  outing_id: number;
  group_id: number;
  team_names: string[];
  holders: number | null;
  pick_mode: PickMode;
  secret_pairings: boolean;
  status: "open" | "cancelled";
};

const COLS = "id, outing_id, group_id, team_names, holders, pick_mode, secret_pairings, status";

const toCup = (r: CupRow): Cup => ({
  id: r.id,
  outingId: r.outing_id,
  groupId: r.group_id,
  teamNames: [r.team_names[0] ?? "Team 1", r.team_names[1] ?? "Team 2"],
  holders: r.holders === 1 || r.holders === 2 ? r.holders : null,
  pickMode: r.pick_mode,
  secretPairings: r.secret_pairings,
  status: r.status,
});

/** The database hasn't had 0200 yet: there's no Cup to show. */
const missing = (e: { code?: string; message: string } | null) => !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST202" || /does not exist/i.test(e.message));

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** A trip's Cup, if it has one (open or cancelled). */
export async function loadTripCup(outingId: number): Promise<Cup | null> {
  const { data, error } = await supabase.from("trip_cups").select(COLS).eq("outing_id", outingId).maybeSingle<CupRow>();
  if (missing(error)) return null;
  if (error) fail(error, "Couldn't load the Cup.");
  return data ? toCup(data) : null;
}

const byDateThenTime = (a: ItineraryItem, b: ItineraryItem) => a.onDate.localeCompare(b.onDate) || (a.startsAt ?? "").localeCompare(b.startsAt ?? "") || a.id - b.id;

/** Everything on the Cup's pages: the teams, the sessions with their live scores, and the running total. */
export async function loadCupPage(outingId: number): Promise<CupPage | null> {
  const cup = await loadTripCup(outingId);
  if (!cup) return null;
  const [roster, players, sessions, items, trip, entries] = await Promise.all([
    loadGroupRoster(cup.groupId),
    supabase.from("trip_cup_players").select("member_id, team, captain").eq("cup_id", cup.id).overrideTypes<{ member_id: string; team: number; captain: boolean }[]>(),
    supabase.from("trip_cup_sessions").select("id, item_id, slot, format, match_day_id").eq("cup_id", cup.id).overrideTypes<{ id: number; item_id: number; slot: number; format: CupFormat; match_day_id: number | null }[]>(),
    loadItinerary(outingId),
    supabase.from("society_outings").select("title, plays_on").eq("id", outingId).maybeSingle<{ title: string; plays_on: string }>(),
    supabase.from("society_outing_entries").select("member_id").eq("outing_id", outingId).overrideTypes<{ member_id: string }[]>(),
  ]);
  const entered = new Set((entries.data ?? []).map((e) => e.member_id));
  if (players.error) fail(players.error, "Couldn't load the teams.");
  if (sessions.error) fail(sessions.error, "Couldn't load the sessions.");

  const byId = new Map(roster.map((r) => [r.id, r]));
  const members: CupMember[] = (players.data ?? [])
    .map((p) => {
      const r = byId.get(p.member_id);
      return { id: p.member_id, name: r?.name ?? "A member", index: r?.index ?? null, fromSociety: r?.fromSociety ?? false, avatarUrl: r?.avatarUrl ?? null, avatarColor: r?.avatarColor ?? null, team: (p.team === 2 ? 2 : 1) as Team, captain: p.captain };
    })
    .sort((a, b) => a.team - b.team || Number(b.captain) - Number(a.captain) || a.name.localeCompare(b.name));
  const n1 = members.filter((m) => m.team === 1).length;
  const n2 = members.length - n1;

  const rounds = items.filter((i) => i.kind === "round").sort(byDateThenTime);
  const itemById = new Map(rounds.map((i) => [i.id, i]));
  const days = await Promise.all(
    (sessions.data ?? []).map((s) => (s.match_day_id ? loadMatchDay(s.match_day_id).catch(() => null) : Promise.resolve(null))),
  );

  const list: CupSession[] = (sessions.data ?? []).map((s, i) => {
    const day = days[i] ?? null;
    const planned = matchesFor(s.format, n1, n2);
    const score: SessionScore = day
      ? {
          points: day.matches.length,
          final: day.totals.final,
          projected: day.totals.projected,
          started: true,
          done: day.matches.length > 0 && day.totals.finishedCount === day.matches.length,
        }
      : { points: s.match_day_id ? 0 : planned, final: [0, 0], projected: [0, 0], started: s.match_day_id != null, done: false };
    return { id: s.id, itemId: s.item_id, slot: s.slot === 2 ? 2 : 1, format: s.format, matchDayId: s.match_day_id, item: itemById.get(s.item_id) ?? null, day, score };
  });
  list.sort((a, b) => (a.item && b.item ? byDateThenTime(a.item, b.item) : 0) || a.slot - b.slot);

  return {
    cup,
    roster,
    candidates: entered.size > 0 ? roster.filter((r) => entered.has(r.id) || members.some((m) => m.id === r.id)) : roster,
    members,
    sessions: list,
    rounds,
    state: cupState(list.map((s) => s.score), cup.holders),
    tripTitle: trip.data?.title ?? "The trip",
    tripStartsOn: trip.data?.plays_on ?? rounds[0]?.onDate ?? "",
  };
}

/** Live: re-load when any started session's scores change. */
export function subscribeToCup(page: CupPage, onChange: () => void): () => void {
  const offs = page.sessions.filter((s) => s.matchDayId != null && !s.score.done).map((s) => subscribeToMatchDay(s.matchDayId as number, onChange));
  return () => offs.forEach((off) => off());
}

export type CupSettings = { teamNames: [string, string]; holders: Team | null; pickMode: PickMode; secretPairings: boolean };

export async function saveCup(outingId: number, s: CupSettings): Promise<number> {
  const { data, error } = await supabase.rpc("trip_cup_save", {
    p_outing_id: outingId,
    p: { team_names: [s.teamNames[0].trim(), s.teamNames[1].trim()], holders: s.holders, pick_mode: s.pickMode, secret_pairings: s.secretPairings },
  });
  if (error) fail(error, "Couldn't save the Cup.");
  return Number(data);
}

export async function cancelCup(cupId: number): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_cancel", { p_cup_id: cupId });
  if (error) fail(error, "Couldn't cancel the Cup.");
}

export async function setCupTeams(cupId: number, players: { memberId: string; team: Team; captain: boolean }[]): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_set_teams", {
    p_cup_id: cupId,
    p_players: players.map((p) => ({ member_id: p.memberId, team: p.team, captain: p.captain })),
  });
  if (error) fail(error, "Couldn't save the teams.");
}

export async function pickForCup(cupId: number, memberId: string): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_pick", { p_cup_id: cupId, p_member: memberId });
  if (error) fail(error, "Couldn't pick them.");
}

export async function saveCupSessions(cupId: number, sessions: { itemId: number; slot: 1 | 2; format: CupFormat }[]): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_save_sessions", {
    p_cup_id: cupId,
    p_sessions: sessions.map((s) => ({ item_id: s.itemId, slot: s.slot, format: s.format })),
  });
  if (error) fail(error, "Couldn't save the sessions.");
}

export async function submitLineup(sessionId: number, team: Team, lineup: string[][]): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_submit_lineup", { p_session_id: sessionId, p_team: team, p_pairs: lineup });
  if (error) fail(error, "Couldn't send the lineup.");
}

/** Each team's lineup as this member may see it: `pairs` null when it's in but still secret. */
export type Lineup = { team: Team; pairs: string[][] | null; submittedAt: string };

export async function loadLineups(sessionId: number): Promise<Lineup[]> {
  const { data, error } = await supabase.rpc("trip_cup_lineups", { p_session_id: sessionId });
  if (missing(error)) return [];
  if (error) fail(error, "Couldn't load the lineups.");
  return ((data ?? []) as { team: number; pairs: string[][] | null; submitted_at: string }[]).map((r) => ({
    team: r.team === 2 ? 2 : 1,
    pairs: r.pairs,
    submittedAt: r.submitted_at,
  }));
}

export async function linkCupSession(sessionId: number, matchDayId: number): Promise<void> {
  const { error } = await supabase.rpc("trip_cup_link_session", { p_session_id: sessionId, p_match_day_id: matchDayId });
  if (error) fail(error, "Couldn't link the session to the Cup.");
}

/** Day 1 is the trip's first day. */
export function tripDayNumber(startsOn: string, date: string): number | null {
  const a = Date.parse(`${startsOn}T12:00:00Z`);
  const b = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

const FORMAT_NAME: Record<CupFormat, string> = { fourball: "Fourballs", foursomes: "Foursomes", greensomes: "Greensomes", singles: "Singles" };

/** "Day 2 · Foursomes", or "Day 2 · Afternoon foursomes". */
export function sessionTitle(s: Pick<CupSession, "slot" | "format" | "item">, startsOn: string): string {
  const n = s.item ? tripDayNumber(startsOn, s.item.onDate) : null;
  const name = s.slot === 2 ? `Afternoon ${FORMAT_NAME[s.format].toLowerCase()}` : FORMAT_NAME[s.format];
  return `${n && n > 0 ? `Day ${n}` : "Round"} · ${name}`;
}
