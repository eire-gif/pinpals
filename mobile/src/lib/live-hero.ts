/**
 * The round in play, pinned to the top of Live Scoring (Oct 2026).
 *
 * While you're playing in a live round, the hub leads with it — course, how
 * far the group has got, the top of the leaderboard — and the three ways to
 * start a new game are locked until it's finished or deleted. Which round
 * counts is the MY ROUND pill's (my-round-rules.ts: today or yesterday, the
 * newest), so the pill and this card always point at the same game.
 *
 * Pure, so it can be tested (live-hero.test.ts).
 */
import {
  buildBoard,
  holesStillToScore,
  playOrder,
  scoringPlayerIds,
  toParLabel,
  type CardHole,
  type LiveFormat,
  type LivePlayer,
  type ScoreSheet,
} from "./live-scoring";

export type HeroHole = { hole: number; state: "done" | "next" | "todo" };

export type HeroRow = { position: string; name: string; value: string; me: boolean };

export type HeroSummary = {
  /** Holes every scoring player has a score on. */
  thru: number;
  total: number;
  /** The hole to carry on from, and its par. Null once every hole is in. */
  next: { hole: number; par: number } | null;
  /** Every hole, in this group's playing order. */
  holes: HeroHole[];
  /** Top three, plus you if you're further down. Null for matches and team
   *  games, whose standing lives on the round screen. */
  board: HeroRow[] | null;
};

export type HeroInput = {
  format: LiveFormat;
  matchFormat: LiveFormat | null;
  scramble: boolean;
  startHole: number | null;
  card: readonly CardHole[];
  players: readonly (LivePlayer & { position: number; memberId: string | null })[];
  scores: ScoreSheet;
};

export function heroSummary(input: HeroInput, me: string | null): HeroSummary {
  const ids = scoringPlayerIds(input.players, { scramble: input.scramble, matchFormat: input.matchFormat });
  const missing = new Set(holesStillToScore(input.card, ids, input.scores).map((m) => m.hole));
  const order = playOrder(input.card, input.startHole);
  // The next hole: the first, in playing order, nobody in the group has
  // scored yet — the same rule as the MY ROUND pill's "H12".
  const touched = new Set<number>();
  for (const id of ids) for (const hole of input.scores.get(id)?.keys() ?? []) touched.add(hole);
  const next = order.find((h) => !touched.has(h.hole)) ?? order.find((h) => missing.has(h.hole)) ?? null;

  const holes: HeroHole[] = order.map((h) => ({
    hole: h.hole,
    state: next && h.hole === next.hole ? "next" : missing.has(h.hole) ? "todo" : "done",
  }));

  const individual = (input.format === "stableford" || input.format === "stroke") && !input.scramble && input.matchFormat == null;
  let board: HeroRow[] | null = null;
  if (individual) {
    const rows = buildBoard(input.format, input.card, input.players, input.scores).rows;
    const mineId = input.players.find((p) => me != null && p.memberId === me)?.id ?? null;
    const shown = rows.slice(0, 3);
    const mine = rows.find((r) => r.playerId === mineId);
    if (mine && !shown.includes(mine)) shown.push(mine);
    board = shown.map((r) => ({
      position: r.position || "–",
      name: r.playerId === mineId ? "You" : r.name,
      value: r.thru === 0 ? "–" : input.format === "stroke" ? toParLabel(r.netToPar) : `${r.points} pts`,
      me: r.playerId === mineId,
    }));
  }

  return {
    thru: input.card.length - missing.size,
    total: input.card.length,
    next: next ? { hole: next.hole, par: next.par } : null,
    holes,
    board,
  };
}
