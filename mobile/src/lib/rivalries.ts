/**
 * Rivalries (claude/rivalries.md): loading. The rules are in rivalry-rules.ts.
 *
 * No migration: the member can already read every live round they played
 * in, with everyone's scores (0103), and other members' names. Loaded on
 * the phone from the member's finished rounds of the last two years.
 */
import { PLAYER_SELECT, ROUND_SELECT, toPlayer, toRound, type PlayerRow, type RoundRow } from "@/lib/live-rounds";
import { supabase } from "@/lib/supabase";
import type { RivalRound } from "@/lib/rivalry-rules";

/** Rounds per request for scores: 8 players × 18 holes × 6 stays under the API's 1,000 rows. */
const CHUNK = 6;
const MAX_ROUNDS = 240;

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type RivalProfile = { id: string; name: string; firstName: string; avatarUrl: string | null; avatarColor: string | null; handicap: number | null };

/** The member's finished rounds of the last two years, with every player's scores. */
export async function loadRivalRounds(me: string): Promise<RivalRound[]> {
  const since = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
  const { data: mine, error } = await supabase.from("live_round_players").select("round_id").eq("member_id", me).order("round_id", { ascending: false }).limit(MAX_ROUNDS);
  if (error) throw error;
  const ids = [...new Set((mine ?? []).map((r: { round_id: number }) => r.round_id))];
  if (ids.length === 0) return [];

  const roundRows: RoundRow[] = [];
  for (const part of chunks(ids, 100)) {
    const { data, error: e } = await supabase.from("live_rounds").select(ROUND_SELECT).in("id", part).eq("status", "finished").gte("played_on", since).overrideTypes<RoundRow[]>();
    if (e) throw e;
    roundRows.push(...(data ?? []));
  }
  // Only rounds with someone else in them who could be a rival.
  const finished = roundRows.map(toRound);
  if (finished.length === 0) return [];

  const parts = await Promise.all(
    chunks(
      finished.map((r) => r.id),
      CHUNK
    ).map(async (part) => {
      const [players, holes, scores] = await Promise.all([
        supabase.from("live_round_players").select(PLAYER_SELECT).in("round_id", part).overrideTypes<PlayerRow[]>(),
        supabase.from("live_round_holes").select("round_id, hole, par, stroke_index").in("round_id", part).overrideTypes<{ round_id: number; hole: number; par: number; stroke_index: number | null }[]>(),
        supabase.from("live_round_scores").select("round_id, player_id, hole, strokes").in("round_id", part).overrideTypes<{ round_id: number; player_id: number; hole: number; strokes: number | null }[]>(),
      ]);
      for (const r of [players, holes, scores]) if (r.error) throw r.error;
      return { players: players.data ?? [], holes: holes.data ?? [], scores: scores.data ?? [] };
    })
  );
  const players = parts.flatMap((p) => p.players);
  const holes = parts.flatMap((p) => p.holes);
  const scores = parts.flatMap((p) => p.scores);

  return finished
    .map((round): RivalRound | null => {
      const ps = players.filter((p) => p.round_id === round.id).map(toPlayer);
      if (ps.length < 2) return null;
      const sheet = new Map<number, Map<number, number | null>>();
      for (const s of scores) {
        if (s.round_id !== round.id) continue;
        if (!sheet.has(s.player_id)) sheet.set(s.player_id, new Map());
        sheet.get(s.player_id)!.set(s.hole, s.strokes);
      }
      return {
        id: round.id,
        playedOn: round.playedOn,
        courseName: round.courseName,
        finished: round.status === "finished",
        format: round.format,
        matchFormat: round.matchFormat,
        teamCard: round.scramble != null,
        card: holes
          .filter((h) => h.round_id === round.id)
          .sort((a, b) => a.hole - b.hole)
          .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index })),
        players: ps.map((p) => ({ id: p.id, memberId: p.memberId, name: p.name, side: p.side ?? null, courseHandicap: p.courseHandicap, playingHandicap: p.playingHandicap, position: p.position })),
        scores: sheet,
      };
    })
    .filter((r): r is RivalRound => r != null);
}

/** Names, pictures and (when they share it) handicaps for the rivals who are members. */
export async function loadRivalProfiles(ids: readonly string[]): Promise<Map<string, RivalProfile>> {
  const out = new Map<string, RivalProfile>();
  if (ids.length === 0) return out;
  for (const part of chunks(ids, 100)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url, avatar_color, handicap, handicap_visible")
      .in("id", part)
      .overrideTypes<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null; handicap: number | null; handicap_visible: boolean | null }[]>();
    if (error) throw error;
    for (const p of data ?? []) {
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "A member";
      out.set(p.id, { id: p.id, name, firstName: p.first_name || name, avatarUrl: p.avatar_url, avatarColor: p.avatar_color, handicap: p.handicap_visible ? p.handicap : null });
    }
  }
  return out;
}

let cache: { me: string; at: number; rounds: RivalRound[]; profiles: Map<string, RivalProfile> } | null = null;

/** Rounds and rivals' profiles, kept for a minute so the list and a rival's page share one load. */
export async function loadRivalData(me: string, fresh = false): Promise<{ rounds: RivalRound[]; profiles: Map<string, RivalProfile> }> {
  if (!fresh && cache && cache.me === me && Date.now() - cache.at < 60_000) return cache;
  const rounds = await loadRivalRounds(me);
  const ids = [...new Set(rounds.flatMap((r) => r.players.map((p) => p.memberId)).filter((id): id is string => !!id && id !== me))];
  const profiles = await loadRivalProfiles(ids);
  cache = { me, at: Date.now(), rounds, profiles };
  return cache;
}
