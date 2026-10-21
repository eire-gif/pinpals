import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MY ROUND (Oct 2026): the green pill in the site header while a round the
 * member is PLAYING in is live — the same rules as the app's pill
 * (mobile/src/lib/my-round-rules.ts). Rounds they only follow don't count.
 */

export type MyRound = { id: number; hole: number };

export type MyRoundCandidate = {
  id: number;
  status: "live" | "finished";
  playedOn: string;
  holes: number;
  startHole: number | null;
};

/** yyyy-mm-dd in Ireland, `daysBack` days ago. */
export function irishDay(now: Date, daysBack = 0): string {
  const d = new Date(now.getTime() - daysBack * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Live and played today or yesterday (a round nobody finished doesn't pulse for ever); newest wins. */
export function pickMyRound(rounds: readonly MyRoundCandidate[], now: Date): MyRoundCandidate | null {
  const days = new Set([irishDay(now), irishDay(now, 1)]);
  const live = rounds.filter((r) => r.status === "live" && days.has(r.playedOn));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => (a.playedOn === b.playedOn ? b.id - a.id : a.playedOn < b.playedOn ? 1 : -1))[0];
}

/** The first hole in playing order (from a shotgun hole, wrapping) nobody has scored. */
export function holeInPlay(holes: number, startHole: number | null, scored: Iterable<number>): number {
  const total = holes === 9 ? 9 : 18;
  const start = startHole && startHole >= 1 && startHole <= total ? startHole : 1;
  const done = new Set(scored);
  const order = Array.from({ length: total }, (_, i) => ((start - 1 + i) % total) + 1);
  return order.find((h) => !done.has(h)) ?? order[order.length - 1];
}

/** For the header. Null on any failure: a missing pill beats a broken header. */
export async function loadMyRound(db: SupabaseClient, memberId: string, now = new Date()): Promise<MyRound | null> {
  try {
    const { data, error } = await db
      .from("live_round_players")
      .select("round_id, live_rounds!inner (id, status, played_on, holes, start_hole)")
      .eq("member_id", memberId)
      .eq("live_rounds.status", "live")
      .gte("live_rounds.played_on", irishDay(now, 1));
    if (error || !data) return null;
    type Row = { live_rounds: { id: number; status: "live" | "finished"; played_on: string; holes: number; start_hole: number | null } };
    const round = pickMyRound(
      (data as unknown as Row[]).map((r) => ({
        id: r.live_rounds.id,
        status: r.live_rounds.status,
        playedOn: r.live_rounds.played_on,
        holes: r.live_rounds.holes,
        startHole: r.live_rounds.start_hole,
      })),
      now
    );
    if (!round) return null;
    const { data: scores } = await db.from("live_round_scores").select("hole").eq("round_id", round.id).not("strokes", "is", null);
    return { id: round.id, hole: holeInPlay(round.holes, round.startHole, ((scores ?? []) as { hole: number }[]).map((s) => s.hole)) };
  } catch {
    return null;
  }
}
