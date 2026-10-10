import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyUser } from "./notifications-server";
import {
  buildBoard,
  formatInfo,
  matchPoints,
  pointsLabel,
  teamMatchState,
  toParLabel,
  type CardHole,
  type LiveFormat,
  type MatchFormat,
  type MatchPlayer,
} from "./live-scoring";

/**
 * Live scoring notifications (0103/0104), sent with the admin client after
 * the app has written the round or match day itself.
 *
 * Three moments:
 *   - someone adds you to a round          → live_round_added
 *   - someone adds you to a match day      → live_match_added (one per match)
 *   - a match in your match day finishes   → live_match_result, to everyone
 *                                            in the day, with the team score
 *
 * All three are in the tee_times category, so a member can switch them off
 * alongside tee-time alerts. Each carries a dedupe key, so a retried request
 * (a phone on one bar of signal) never buzzes anyone twice.
 *
 * Text is built only from names, course names, formats and results — the
 * same safe fields the app already shows to everyone in the round. Nothing
 * here reaches anyone who couldn't already see the round: recipients are
 * read from the round's own player list.
 *
 * The caller has already checked, under RLS with the member's own client,
 * that the member is allowed to trigger this (see the routes in
 * src/app/api/app/live/).
 */

type PlayerRow = {
  id: number;
  round_id: number;
  member_id: string | null;
  display_name: string;
  course_handicap: number;
  playing_handicap: number;
  position: number;
  side: number | null;
};

type RoundRow = {
  id: number;
  created_by: string | null;
  course_name: string;
  format: string;
  status: string;
  played_on: string;
  match_day_id: number | null;
  match_number: number | null;
  match_type: "singles" | "fourball" | "foursomes" | "greensomes" | null;
  tee_time: string | null;
  /** Scramble (0113): set when this round is one scramble team. */
  scramble_size: number | null;
  team_name: string | null;
  team_number: number | null;
  team_handicap: number | null;
};

const ROUND_COLUMNS = "id, created_by, course_name, format, status, played_on, match_day_id, match_number, match_type, tee_time, scramble_size, team_name, team_number, team_handicap";

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });

const toMatchFormat = (t: RoundRow["match_type"]): MatchFormat => (t === "singles" || t == null ? "matchplay" : t);

async function organiserName(admin: SupabaseClient, memberId: string | null): Promise<string> {
  if (!memberId) return "Your group";
  const { data } = await admin.from("profiles").select("first_name").eq("id", memberId).maybeSingle<{ first_name: string | null }>();
  return data?.first_name?.trim() || "A PinPal";
}

/** "Eire added you to a round": every member player except whoever started it. */
export async function notifyRoundPlayers(admin: SupabaseClient, roundId: number): Promise<number> {
  const { data: round } = await admin.from("live_rounds").select(ROUND_COLUMNS).eq("id", roundId).maybeSingle<RoundRow>();
  if (!round || round.match_day_id != null) return 0;
  const { data: players } = await admin
    .from("live_round_players")
    .select("id, member_id, display_name")
    .eq("round_id", roundId)
    .overrideTypes<{ id: number; member_id: string | null; display_name: string }[]>();
  const by = await organiserName(admin, round.created_by);
  const format = round.scramble_size ? `${round.scramble_size}-person scramble` : formatInfo(round.format as LiveFormat).label;
  let sent = 0;
  for (const p of players ?? []) {
    if (!p.member_id || p.member_id === round.created_by) continue;
    await notifyUser(admin, {
      userId: p.member_id,
      type: "live_round_added",
      title: `You're scoring with ${by} at ${round.course_name}`,
      body: `${format}, ${shortDate(round.played_on)}. Tap to open the scorecard and put your scores in.`,
      href: `/live/rounds/${round.id}`,
      dedupeKey: `live_round_added:${round.id}:${p.member_id}`,
    });
    sent += 1;
  }
  return sent;
}

type DayRow = { id: number; created_by: string | null; title: string; course_name: string; played_on: string; team_names: string[] | null };

/** "You're in Match 2": each member player, about their own match. */
export async function notifyMatchDayPlayers(admin: SupabaseClient, dayId: number): Promise<number> {
  const { data: day } = await admin
    .from("live_match_days")
    .select("id, created_by, title, course_name, played_on, team_names")
    .eq("id", dayId)
    .maybeSingle<DayRow>();
  if (!day) return 0;
  const { data: rounds } = await admin
    .from("live_rounds")
    .select(ROUND_COLUMNS)
    .eq("match_day_id", dayId)
    .order("match_number")
    .overrideTypes<RoundRow[]>();
  const ids = (rounds ?? []).map((r) => r.id);
  if (ids.length === 0) return 0;
  const { data: players } = await admin
    .from("live_round_players")
    .select("id, round_id, member_id, display_name, course_handicap, playing_handicap, position, side")
    .in("round_id", ids)
    .overrideTypes<PlayerRow[]>();
  const by = await organiserName(admin, day.created_by);

  let sent = 0;
  for (const r of rounds ?? []) {
    const inMatch = (players ?? []).filter((p) => p.round_id === r.id);
    for (const p of inMatch) {
      if (!p.member_id || p.member_id === day.created_by) continue;
      if (r.scramble_size) {
        // A scramble day: you're in a team, not a match.
        const mates = inMatch.filter((o) => o.id !== p.id).map((o) => firstName(o.display_name));
        const teamName = r.team_name ?? `Team ${r.team_number ?? ""}`.trim();
        const time = r.tee_time ? ` at ${r.tee_time.slice(0, 5)}` : "";
        await notifyUser(admin, {
          userId: p.member_id,
          type: "live_match_added",
          title: `${day.title}: you're in ${teamName}`,
          body: `${by} put you in a ${r.scramble_size}-person scramble with ${mates.join(" & ")}, ${shortDate(day.played_on)}${time}. Tap to open your team's card.`,
          href: `/live/rounds/${r.id}`,
          dedupeKey: `live_match_added:${r.id}:${p.member_id}`,
        });
        sent += 1;
        continue;
      }
      const partners = inMatch.filter((o) => o.side === p.side && o.id !== p.id).map((o) => firstName(o.display_name));
      const opponents = inMatch.filter((o) => o.side !== p.side).map((o) => firstName(o.display_name));
      const team = day.team_names && p.side ? ` Team ${day.team_names[p.side - 1]}.` : "";
      const format = formatInfo(toMatchFormat(r.match_type)).label;
      const withWho = partners.length ? ` with ${partners.join(" & ")}` : "";
      const time = r.tee_time ? ` at ${r.tee_time.slice(0, 5)}` : "";
      await notifyUser(admin, {
        userId: p.member_id,
        type: "live_match_added",
        title: `${day.title}: you're in Match ${r.match_number ?? ""}`.trim(),
        body: `${by} put you in a ${format.toLowerCase()} match${withWho} v ${opponents.join(" & ")}, ${shortDate(day.played_on)}${time}.${team} Tap to open your scorecard.`,
        href: `/live/rounds/${r.id}`,
        dedupeKey: `live_match_added:${r.id}:${p.member_id}`,
      });
      sent += 1;
    }
  }
  return sent;
}

/** "Match 3: Golds win 3&2" — to everyone in the day, with the team score. */
export async function notifyMatchResult(admin: SupabaseClient, roundId: number): Promise<number> {
  const { data: round } = await admin.from("live_rounds").select(ROUND_COLUMNS).eq("id", roundId).maybeSingle<RoundRow>();
  if (!round || round.match_day_id == null || round.status !== "finished") return 0;
  const { data: day } = await admin
    .from("live_match_days")
    .select("id, created_by, title, course_name, played_on, team_names")
    .eq("id", round.match_day_id)
    .maybeSingle<DayRow>();
  if (!day) return 0;

  const { data: rounds } = await admin.from("live_rounds").select(ROUND_COLUMNS).eq("match_day_id", day.id).overrideTypes<RoundRow[]>();
  const ids = (rounds ?? []).map((r) => r.id);
  const [{ data: players }, { data: holes }, { data: scores }] = await Promise.all([
    admin
      .from("live_round_players")
      .select("id, round_id, member_id, display_name, course_handicap, playing_handicap, position, side")
      .in("round_id", ids)
      .overrideTypes<PlayerRow[]>(),
    admin
      .from("live_round_holes")
      .select("round_id, hole, par, stroke_index")
      .in("round_id", ids)
      .overrideTypes<{ round_id: number; hole: number; par: number; stroke_index: number | null }[]>(),
    admin
      .from("live_round_scores")
      .select("round_id, player_id, hole, strokes")
      .in("round_id", ids)
      .overrideTypes<{ round_id: number; player_id: number; hole: number; strokes: number | null }[]>(),
  ]);

  const stateOf = (r: RoundRow) => {
    const card: CardHole[] = (holes ?? []).filter((h) => h.round_id === r.id).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }));
    const ps: MatchPlayer[] = (players ?? [])
      .filter((p) => p.round_id === r.id)
      .map((p) => ({ id: p.id, name: p.display_name, playingHandicap: p.playing_handicap, courseHandicap: p.course_handicap, side: p.side ?? 1, position: p.position }));
    const sheet = new Map<number, Map<number, number | null>>();
    for (const s of (scores ?? []).filter((x) => x.round_id === r.id)) {
      if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
      sheet.get(s.player_id)!.set(s.hole, s.strokes);
    }
    return { state: teamMatchState(toMatchFormat(r.match_type), card, ps, sheet), ps };
  };

  if (round.scramble_size) {
    // A scramble team is in: its score, and where it sits among the teams
    // finished so far (net, then gross).
    const teamScore = (r: RoundRow) => {
      const card: CardHole[] = (holes ?? []).filter((h) => h.round_id === r.id).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }));
      const lead = (players ?? []).filter((p) => p.round_id === r.id).sort((a, b) => a.position - b.position)[0];
      if (!lead) return null;
      const sheet = new Map<number, Map<number, number | null>>();
      for (const s of (scores ?? []).filter((x) => x.round_id === r.id && x.player_id === lead.id)) {
        if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
        sheet.get(s.player_id)!.set(s.hole, s.strokes);
      }
      const row = buildBoard("stroke", card, [{ id: lead.id, name: r.team_name ?? "", playingHandicap: r.team_handicap ?? 0 }], sheet).rows[0];
      return row && row.thru > 0 ? row : null;
    };
    const mineRow = teamScore(round);
    const teamName = round.team_name ?? `Team ${round.team_number ?? ""}`.trim();
    const headline = mineRow ? `${teamName} are in: net ${toParLabel(mineRow.netToPar)} (${mineRow.gross} gross)` : `${teamName} have finished`;
    const done = (rounds ?? [])
      .filter((r) => r.status === "finished")
      .map((r) => ({ r, row: teamScore(r) }))
      .filter((x) => x.row != null)
      .sort((a, b) => a.row!.netToPar - b.row!.netToPar || a.row!.gross - b.row!.gross);
    const place = done.findIndex((x) => x.r.id === round.id) + 1;
    const out = (rounds ?? []).filter((r) => r.status !== "finished").length;
    const body =
      place > 0
        ? `${place === 1 ? "Leading" : `${place}${place === 2 ? "nd" : place === 3 ? "rd" : "th"}`} of ${done.length} ${done.length === 1 ? "team" : "teams"} in${out > 0 ? `, ${out} still out` : ". That's everyone"}. Tap for the board.`
        : `${day.title} at ${day.course_name}. Tap for the board.`;
    const recipients = new Set((players ?? []).map((p) => p.member_id).filter((m): m is string => !!m));
    if (day.created_by) recipients.add(day.created_by);
    let sent = 0;
    for (const memberId of recipients) {
      await notifyUser(admin, {
        userId: memberId,
        type: "live_match_result",
        title: headline,
        body,
        href: `/live/days/${day.id}`,
        dedupeKey: `live_match_result:${round.id}:${memberId}`,
      });
      sent += 1;
    }
    return sent;
  }

  const mine = stateOf(round);
  const sideName = (n: 1 | 2, ps: MatchPlayer[]) =>
    day.team_names?.[n - 1] ?? ps.filter((p) => p.side === n).map((p) => firstName(p.name)).join(" & ");
  let headline: string;
  const st = mine.state;
  if (!st || st.leader === 0) headline = `Match ${round.match_number} is halved`;
  else headline = `Match ${round.match_number}: ${sideName(st.leader, mine.ps)} win ${st.margin}`;

  let totals = "";
  if (day.team_names) {
    let a = 0;
    let b = 0;
    let out = 0;
    for (const r of rounds ?? []) {
      if (r.status !== "finished") {
        out += 1;
        continue;
      }
      const [x, y] = matchPoints(stateOf(r).state);
      a += x;
      b += y;
    }
    totals = `${day.team_names[0]} ${pointsLabel(a)} – ${day.team_names[1]} ${pointsLabel(b)}`;
    totals += out === 0 ? ". That's the final score." : out === 1 ? ", one match still out." : `, ${out} matches still out.`;
  }

  const recipients = new Set((players ?? []).map((p) => p.member_id).filter((m): m is string => !!m));
  if (day.created_by) recipients.add(day.created_by);
  let sent = 0;
  for (const memberId of recipients) {
    await notifyUser(admin, {
      userId: memberId,
      type: "live_match_result",
      title: headline,
      body: totals || `${day.title} at ${day.course_name}. Tap for the board.`,
      href: `/live/days/${day.id}`,
      dedupeKey: `live_match_result:${round.id}:${memberId}`,
    });
    sent += 1;
  }
  return sent;
}
