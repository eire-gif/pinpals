// Copied from mobile/src/lib/group-draw.ts (pure) so the website's society console
// applies the same rules. Keep the two in step.
/**
 * The draw (Oct 2026): putting the golfers playing today into tee groups or
 * scramble teams, at random or balanced by handicap.
 *
 * Pure: players in, groups out, with the random source passed in so the
 * tests can pin it. Screens hold the result as state and let the organiser
 * swap any two players before starting (swapPlayers).
 *
 *   RANDOM   shuffle, then fill the groups in tee order. Nobody can say the
 *            secretary fixed it.
 *   BALANCED shuffle first (so equal handicaps land randomly), sort by index,
 *            then deal "snake" style — 1-2-3-3-2-1 — so each group gets one
 *            of the best, one of the next, and so on. Team totals end up
 *            close, which is the point for scrambles and team days.
 *
 * A player with no index known is dealt as if off the middle of the field,
 * so a missing number neither stacks nor weakens a team.
 */

export type DrawPlayer = { key: string; name: string; index: number | null };
export type DrawMode = "random" | "balanced";

/**
 * How many in each tee group: as few groups as the maximum allows, as even
 * as possible, bigger groups first (they go out first). 10 players in fours
 * is 4 · 3 · 3, never 4 · 4 · 2; 9 is 3 · 3 · 3.
 */
export function teeGroupSizes(players: number, max: number): number[] {
  if (players <= 0 || max <= 0) return [];
  const groups = Math.ceil(players / max);
  const base = Math.floor(players / groups);
  const extra = players % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Scramble teams are an exact size. Returns the team sizes, or how many are
 * left over (the organiser adds guests, takes someone out, or changes size).
 */
export function teamSizes(players: number, size: number): { sizes: number[]; leftOver: number } {
  const teams = Math.floor(players / size);
  return { sizes: Array(teams).fill(size), leftOver: players - teams * size };
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 18;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Deals `players` into groups of the given sizes. Uses the first
 *  sum(sizes) players; any beyond that are left out (the caller sizes it). */
export function draw<T extends DrawPlayer>(players: readonly T[], sizes: readonly number[], mode: DrawMode, rng: () => number = Math.random): T[][] {
  const groups: T[][] = sizes.map(() => []);
  const total = sizes.reduce((a, b) => a + b, 0);
  const mixed = shuffle(players, rng).slice(0, total);

  if (mode === "random") {
    let g = 0;
    for (const p of mixed) {
      while (groups[g].length >= sizes[g]) g++;
      groups[g].push(p);
    }
    return groups;
  }

  const middle = median(mixed.map((p) => p.index).filter((x): x is number => x != null));
  const ordered = [...mixed].sort((a, b) => (a.index ?? middle) - (b.index ?? middle));
  // Snake: 0,1,2,…,n-1, n-1,…,1,0, … skipping groups that are already full.
  let g = 0;
  let step = 1;
  for (const p of ordered) {
    let guard = 0;
    while (groups[g].length >= sizes[g] && guard++ < sizes.length * 2) {
      [g, step] = nextSnake(g, step, sizes.length);
    }
    groups[g].push(p);
    [g, step] = nextSnake(g, step, sizes.length);
  }
  return groups;
}

function nextSnake(g: number, step: number, n: number): [number, number] {
  if (n === 1) return [0, 1];
  const next = g + step;
  if (next >= n) return [n - 1, -1];
  if (next < 0) return [0, 1];
  return [next, step];
}

/** A group's handicaps added up (unknown counted as the field's middle). */
export function indexTotal(group: readonly DrawPlayer[], middle = 18): number {
  return Math.round(group.reduce((n, p) => n + (p.index ?? middle), 0) * 10) / 10;
}

export type Seat = { group: number; position: number };

/** Swaps two players between (or within) groups. */
export function swapPlayers<T>(groups: readonly (readonly T[])[], a: Seat, b: Seat): T[][] {
  const out = groups.map((g) => [...g]);
  const x = out[a.group]?.[a.position];
  const y = out[b.group]?.[b.position];
  if (x === undefined || y === undefined) return out;
  out[a.group][a.position] = y;
  out[b.group][b.position] = x;
  return out;
}

/** "09:00" + 10 → "09:10". Empty when the start isn't a time. */
export function addMinutes(time: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
  const total = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Tee times for n groups from a first time and a gap. Empty strings when
 *  there's no first time. */
export function teeTimes(first: string, gap: number, groups: number): string[] {
  return Array.from({ length: groups }, (_, i) => addMinutes(first, gap * i));
}

// ---------------------------------------------------------------------------
// Requests and repeat pairings (0142)
// ---------------------------------------------------------------------------

/**
 * What a society's draw tries to honour, after the deal:
 *   together  pairs who asked to play together ("with Darragh")
 *   early / late  keys who asked for an early or a late tee time
 *   met       how often two players have been drawn together recently,
 *             keyed by pairKey(a, b) — the draw avoids repeating them
 */
export type DrawWishes = {
  together: [string, string][];
  early: ReadonlySet<string>;
  late: ReadonlySet<string>;
  met: ReadonlyMap<string, number>;
};

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const WEIGHT = { split: 10, wrongEnd: 3, repeat: 2 } as const;

/** What a draw costs against the wishes: lower is better. */
export function wishCost<T extends DrawPlayer>(groups: readonly T[][], wishes: DrawWishes): number {
  const where = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((p) => where.set(p.key, i)));
  let cost = 0;
  for (const [a, b] of wishes.together) {
    if (where.has(a) && where.has(b) && where.get(a) !== where.get(b)) cost += WEIGHT.split;
  }
  const half = groups.length / 2;
  for (const [key, i] of where) {
    if (wishes.early.has(key) && i >= half) cost += WEIGHT.wrongEnd;
    if (wishes.late.has(key) && i < Math.floor(half)) cost += WEIGHT.wrongEnd;
  }
  for (const g of groups) {
    for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) cost += WEIGHT.repeat * (wishes.met.get(pairKey(g[x].key, g[y].key)) ?? 0);
  }
  return cost;
}

/**
 * Improves a dealt draw against the wishes by swapping players between
 * groups while it helps — group sizes never change. With `balanced`, only
 * players within 3 shots of each other swap, so the teams stay even.
 * Returns the new groups and what was achieved, for the screen to say.
 */
export function honourWishes<T extends DrawPlayer>(
  dealt: readonly T[][],
  wishes: DrawWishes,
  opts: { balanced?: boolean; maxPasses?: number } = {}
): { groups: T[][]; together: number; togetherAsked: number; repeats: number } {
  const groups = dealt.map((g) => [...g]);
  let cost = wishCost(groups, wishes);
  const passes = opts.maxPasses ?? 6;
  for (let pass = 0; pass < passes && cost > 0; pass++) {
    let improved = false;
    for (let gi = 0; gi < groups.length; gi++) {
      for (let gj = gi + 1; gj < groups.length; gj++) {
        for (let a = 0; a < groups[gi].length; a++) {
          for (let b = 0; b < groups[gj].length; b++) {
            const pa = groups[gi][a];
            const pb = groups[gj][b];
            if (opts.balanced && Math.abs((pa.index ?? 18) - (pb.index ?? 18)) > 3) continue;
            groups[gi][a] = pb;
            groups[gj][b] = pa;
            const next = wishCost(groups, wishes);
            if (next < cost) {
              cost = next;
              improved = true;
            } else {
              groups[gi][a] = pa;
              groups[gj][b] = pb;
            }
          }
        }
      }
    }
    if (!improved) break;
  }
  const where = new Map<string, number>();
  groups.forEach((g, i) => g.forEach((p) => where.set(p.key, i)));
  const asked = wishes.together.filter(([a, b]) => where.has(a) && where.has(b));
  let repeats = 0;
  for (const g of groups) for (let x = 0; x < g.length; x++) for (let y = x + 1; y < g.length; y++) if ((wishes.met.get(pairKey(g[x].key, g[y].key)) ?? 0) > 0) repeats++;
  return { groups, together: asked.filter(([a, b]) => where.get(a) === where.get(b)).length, togetherAsked: asked.length, repeats };
}
