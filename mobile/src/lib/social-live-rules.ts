/**
 * Social's live pieces (Oct 2026, claude/social-live.md) — the rules, with no
 * React, no Supabase and no expo-router, so they're tested on their own
 * (social-live-rules.test.ts).
 *
 *   - which circles go across the top of Social, in what order;
 *   - the full-screen live view's leaderboard rows, its movement arrows and
 *     the gold "Birdie" banner;
 *   - where society results sit among the posts.
 */
import { dayBoard } from "./live-day-board";
import type { MatchDayData } from "./live-match-days";
import { toParLabel } from "./live-scoring";

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

export type LiveCircle =
  /** You, with a +: share a post. Always first. */
  | { kind: "post" }
  /** The round you're playing now (the MY ROUND pill's). */
  | { kind: "mine"; roundId: number; hole: number }
  /** A day your group is playing now: opens the full-screen live view. */
  | { kind: "day"; dayId: number; title: string; groupName: string | null; logoUrl: string | null; playing: number; shared?: boolean }
  /** Someone's own round, shared on Social (0195): opens the live view. */
  | { kind: "round"; roundId: number; name: string; others: number; courseName: string }
  /** A card someone shared with you (Follow my round, 0158). */
  | { kind: "follow"; followId: number; name: string; detail: string }
  /** Results your group published in the last two days. */
  | { kind: "results"; dayId: number; groupId: number; groupName: string; title: string };

/** Mine first, then live days (busiest first), shared rounds, cards shared with you, then results. */
export function orderCircles(circles: readonly LiveCircle[]): LiveCircle[] {
  const rank = (c: LiveCircle) => ({ post: 0, mine: 1, day: 2, round: 3, follow: 4, results: 5 })[c.kind];
  return [...circles].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (a.kind === "day" && b.kind === "day") return b.playing - a.playing || a.dayId - b.dayId;
    return 0;
  });
}

/** "PGS" for "Portmarnock Golf Society"; "SB" for "Saturday Buddies". */
export function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** The line under a circle's name. */
export function circleDetail(c: LiveCircle): string {
  switch (c.kind) {
    case "post":
      return "Post";
    case "mine":
      return `H${c.hole}`;
    case "day":
      return `${c.playing} playing`;
    case "follow":
      return c.detail;
    case "round":
      return c.courseName;
    case "results":
      return "Results in";
  }
}

// ---------------------------------------------------------------------------
// The live view's leaderboard
// ---------------------------------------------------------------------------

export type ViewRow = {
  /** Stable across refreshes: a player's or a team's round + player id. */
  key: string;
  position: string;
  name: string;
  /** "34" points, or "-2" net to par. */
  value: string;
  /** "15", "F", or "–" before they start. */
  thru: string;
  /** The live round to open for this row's card. */
  roundId: number;
};

export type ViewBoard = { heading: string; rows: ViewRow[] };

/** A society day (fourballs): every player on one table, as the day's own board. */
export function fourballRows(data: MatchDayData): ViewBoard {
  const board = dayBoard(data.matches);
  const holes = data.day.holes;
  return {
    heading: board.format === "stroke" ? "NET" : "PTS",
    rows: board.rows.map((r) => ({
      key: `${r.roundId}:${r.playerId}`,
      position: r.position,
      name: r.name,
      value: r.thru === 0 ? "–" : board.format === "stroke" ? toParLabel(r.netToPar) : String(r.points),
      thru: r.thru === 0 ? "–" : r.thru >= holes ? "F" : String(r.thru),
      roundId: r.roundId,
    })),
  };
}

/** "1", "T2" → 1, 2; "" → null. */
export function positionNumber(position: string): number | null {
  const n = Number(position.replace(/^T/, ""));
  return position && Number.isFinite(n) && n > 0 ? n : null;
}

/** Up or down since the last look (the board refreshes every 15 seconds). */
export function movesSince(before: ReadonlyMap<string, number>, rows: readonly ViewRow[]): Map<string, "up" | "down"> {
  const moves = new Map<string, "up" | "down">();
  for (const r of rows) {
    const now = positionNumber(r.position);
    const was = before.get(r.key);
    if (now == null || was == null || now === was) continue;
    moves.set(r.key, now < was ? "up" : "down");
  }
  return moves;
}

export const positionsOf = (rows: readonly ViewRow[]): Map<string, number> =>
  new Map(rows.flatMap((r) => {
    const n = positionNumber(r.position);
    return n == null ? [] : [[r.key, n] as const];
  }));

// ---------------------------------------------------------------------------
// Birdies
// ---------------------------------------------------------------------------

export type Highlight = { key: string; name: string; hole: number; word: string };

const WORDS: Record<number, string> = { [-1]: "Birdie", [-2]: "Eagle", [-3]: "Albatross" };

/** Every birdie or better on the day so far: "round:player:hole". */
export function highlightsOf(data: MatchDayData): Highlight[] {
  const out: Highlight[] = [];
  for (const m of data.matches) {
    const par = new Map(m.card.map((c) => [c.hole, c.par]));
    for (const p of m.players) {
      const holes = m.scores.get(p.id);
      if (!holes) continue;
      for (const [hole, gross] of holes) {
        const holePar = par.get(hole);
        if (gross == null || holePar == null) continue;
        const word = gross === 1 ? "Hole in one" : WORDS[gross - holePar];
        if (!word) continue;
        const name = m.round.scramble?.teamName ?? p.name;
        out.push({ key: `${m.round.id}:${p.id}:${hole}`, name, hole, word });
      }
    }
  }
  return out;
}

/**
 * The banner to show after a refresh: one birdie (or better) that wasn't
 * there before, the rarest if there are several. Null on the first look —
 * the banner is for what happens while you're watching.
 */
export function newHighlight(before: ReadonlySet<string> | null, now: readonly Highlight[]): Highlight | null {
  if (!before) return null;
  const fresh = now.filter((h) => !before.has(h.key));
  if (fresh.length === 0) return null;
  const weight = (h: Highlight) => (h.word === "Hole in one" ? 4 : h.word === "Albatross" ? 3 : h.word === "Eagle" ? 2 : 1);
  return [...fresh].sort((a, b) => weight(b) - weight(a) || b.hole - a.hole)[0];
}

// ---------------------------------------------------------------------------
// Results among the posts
// ---------------------------------------------------------------------------

/**
 * Puts dated extras (society results) among posts that are newest first.
 * Each extra goes before the first post older than it. An extra older than
 * every post on the page goes at the end only when this is the last page —
 * otherwise it waits for the page it belongs on (the caller passes the extras
 * again with the next page's cursor).
 */
export function placeByDate<P, X>(
  posts: readonly P[],
  extras: readonly X[],
  postAt: (p: P) => string,
  extraAt: (x: X) => string,
  lastPage: boolean
): ({ kind: "post"; item: P } | { kind: "extra"; item: X })[] {
  const sorted = [...extras].sort((a, b) => extraAt(b).localeCompare(extraAt(a)));
  const out: ({ kind: "post"; item: P } | { kind: "extra"; item: X })[] = [];
  let i = 0;
  for (const p of posts) {
    while (i < sorted.length && extraAt(sorted[i]) >= postAt(p)) out.push({ kind: "extra", item: sorted[i++] });
    out.push({ kind: "post", item: p });
  }
  if (lastPage) while (i < sorted.length) out.push({ kind: "extra", item: sorted[i++] });
  return out;
}
