/**
 * Competitions (0148): the rules worked out on the phone.
 *
 * DELIBERATELY A PURE MODULE — no React, no supabase — so it is unit-tested
 * in the website's vitest run (matchplay.test.ts), the same way
 * order-of-merit.ts and competition-results.ts are. The database keeps the
 * facts (who entered, every match and its result) and makes the moves that
 * must not depend on whose phone is open (knockout winners, ladder places).
 * What a member SEES — the group tables, who qualifies, the suggested draw
 * and bracket, how many shots — is worked out here from those facts.
 *
 * Margins mirror competition_margin_holes() in 0148 exactly; the test keeps
 * them in step.
 */

export type LeagueKind = "league" | "ladder";
export type LeagueStatus = "entries" | "running" | "knockout" | "finished" | "cancelled";
export type MatchStage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "ladder";
export type MatchStatus = "open" | "reported" | "confirmed" | "disputed" | "void";

export type Entry = {
  userId: string;
  name: string;
  handicapIndex: number;
  groupLabel: string | null;
  ladderPosition: number | null;
  withdrawn: boolean;
};

export type Match = {
  id: number;
  stage: MatchStage;
  groupLabel: string | null;
  roundNo: number;
  slot: number;
  playerA: string | null;
  playerB: string | null;
  playBy: string | null;
  status: MatchStatus;
  winner: "a" | "b" | "half" | null;
  margin: string | null;
  holesUp: number;
  reportedBy: string | null;
  standsAt: string | null;
};

export type PointsRules = { pointsWin: number; pointsHalf: number; qualifiersPerGroup: number };

// ---------------------------------------------------------------- margins

/** Holes up for a margin, or null if it isn't a real matchplay result. */
export function marginHoles(margin: string, knockout: boolean): number | null {
  const v = margin.trim().toLowerCase();
  if (v === "1 up" || v === "2 up") return Number(v[0]);
  const m = /^([1-9]|10)&([1-9])$/.exec(v);
  if (m) {
    const n = Number(m[1]);
    const left = Number(m[2]);
    return left >= 1 && (n === left + 1 || n === left + 2) && n + left <= 18 ? n : null;
  }
  if (knockout && /^(19th|20th|21st|22nd|23rd|2[4-7]th)$/.test(v)) return 1;
  return null;
}

/** The common margins first, as chips; the rarer ones under "More". */
export const COMMON_MARGINS = ["1 up", "2 up", "2&1", "3&2", "3&1", "4&3", "5&4", "6&5"] as const;
export const MORE_MARGINS = ["4&2", "5&3", "6&4", "7&6", "7&5", "8&7", "8&6", "9&8", "9&7", "10&8"] as const;
export const EXTRA_HOLES = ["19th", "20th", "21st", "22nd", "23rd"] as const;

export const isKnockout = (stage: MatchStage): boolean => stage !== "group" && stage !== "ladder";

export const STAGE_LABEL: Record<MatchStage, string> = {
  group: "Group",
  r32: "Last 32",
  r16: "Last 16",
  qf: "Quarter-final",
  sf: "Semi-final",
  final: "Final",
  ladder: "Challenge",
};

// ---------------------------------------------------------------- results

/** A result that counts in the table: confirmed, or reported and not yet disputed. */
export const counts = (m: Match): boolean =>
  (m.status === "confirmed" || m.status === "reported") && m.winner != null && m.margin !== "bye";

/** "Eire won 3&2", "Halved", "Bye" — from the players' names. */
export function resultLine(m: Match, nameOf: (id: string | null) => string): string {
  if (m.margin === "bye") return "Bye";
  if (m.winner === "half") return "Halved";
  if (!m.winner) return "";
  const who = m.winner === "a" ? m.playerA : m.playerB;
  return m.margin === "w/o" ? `${nameOf(who)}, walkover` : `${nameOf(who)} won ${m.margin}`;
}

// ---------------------------------------------------------------- tables

export type TableRow = {
  userId: string;
  name: string;
  handicapIndex: number;
  played: number;
  won: number;
  halved: number;
  lost: number;
  holes: number;
  points: number;
  /** Includes at least one result not yet confirmed. */
  provisional: boolean;
  position: number;
  qualifies: boolean;
};

/**
 * One group's table. Order: points, then holes +/-, then wins, then the
 * result between the players level (when exactly two are level), then name.
 */
export function groupTable(entries: Entry[], matches: Match[], label: string, rules: PointsRules): TableRow[] {
  const players = entries.filter((e) => e.groupLabel === label && !e.withdrawn);
  const rows = new Map<string, TableRow>(
    players.map((e) => [
      e.userId,
      { userId: e.userId, name: e.name, handicapIndex: e.handicapIndex, played: 0, won: 0, halved: 0, lost: 0, holes: 0, points: 0, provisional: false, position: 0, qualifies: false },
    ]),
  );
  const ours = matches.filter((m) => m.stage === "group" && m.groupLabel === label && counts(m));
  for (const m of ours) {
    const a = m.playerA ? rows.get(m.playerA) : undefined;
    const b = m.playerB ? rows.get(m.playerB) : undefined;
    if (!a || !b) continue;
    for (const r of [a, b]) {
      r.played += 1;
      if (m.status !== "confirmed") r.provisional = true;
    }
    if (m.winner === "half") {
      a.halved += 1;
      b.halved += 1;
      a.points += rules.pointsHalf;
      b.points += rules.pointsHalf;
    } else {
      const [w, l] = m.winner === "a" ? [a, b] : [b, a];
      w.won += 1;
      l.lost += 1;
      w.points += rules.pointsWin;
      w.holes += m.holesUp;
      l.holes -= m.holesUp;
    }
  }

  const headToHead = (x: TableRow, y: TableRow): number => {
    const m = ours.find((mm) => [mm.playerA, mm.playerB].includes(x.userId) && [mm.playerA, mm.playerB].includes(y.userId));
    if (!m || m.winner === "half") return 0;
    const winner = m.winner === "a" ? m.playerA : m.playerB;
    return winner === x.userId ? -1 : 1;
  };

  const list = [...rows.values()];
  list.sort((x, y) => y.points - x.points || y.holes - x.holes || y.won - x.won || x.name.localeCompare(y.name));
  // Head to head only settles a straight two-way tie.
  for (let i = 0; i < list.length - 1; i++) {
    const x = list[i];
    const y = list[i + 1];
    const level = (p: TableRow, q: TableRow) => p.points === q.points && p.holes === q.holes && p.won === q.won;
    const three = (i > 0 && level(list[i - 1], x)) || (i + 2 < list.length && level(y, list[i + 2]));
    if (level(x, y) && !three && headToHead(x, y) > 0) {
      list[i] = y;
      list[i + 1] = x;
    }
  }
  list.forEach((r, i) => {
    r.position = i + 1;
    r.qualifies = i < rules.qualifiersPerGroup;
  });
  return list;
}

export const groupLabels = (entries: Entry[]): string[] =>
  [...new Set(entries.filter((e) => e.groupLabel && !e.withdrawn).map((e) => e.groupLabel as string))].sort();

// ---------------------------------------------------------------- the draw

/**
 * How many groups for n players: as close to `preferred` a group as
 * possible, every group 3 to 8, sizes differing by at most one.
 */
export function groupCount(n: number, preferred = 4): number {
  if (n < 3) return 0;
  let best = 1;
  let bestScore = Infinity;
  for (let g = 1; g <= Math.min(26, Math.floor(n / 3)); g++) {
    const small = Math.floor(n / g);
    const big = Math.ceil(n / g);
    if (small < 3 || big > 8) continue;
    const score = Math.abs(n / g - preferred);
    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return best;
}

/**
 * Groups balanced by handicap: sorted lowest first, dealt out in a snake
 * (A B C C B A …) so every group gets a spread. `shuffle` breaks ties among
 * equal handicaps; pass a seeded one for a draw anyone can reproduce.
 */
export function balancedGroups(entries: Entry[], count: number, shuffle: <T>(xs: T[]) => T[] = (xs) => xs): string[][] {
  const active = shuffle(entries.filter((e) => !e.withdrawn));
  active.sort((a, b) => a.handicapIndex - b.handicapIndex);
  const groups: string[][] = Array.from({ length: count }, () => []);
  active.forEach((e, i) => {
    const lap = Math.floor(i / count);
    const pos = i % count;
    groups[lap % 2 === 0 ? pos : count - 1 - pos].push(e.userId);
  });
  return groups;
}

// ---------------------------------------------------------------- the knockout

/** Standard seeding positions: seed 1 and 2 can only meet in the final. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * The knockout from the group tables: group winners seeded first (best
 * record first), then runners-up, and so on. Seeding keeps a group's winner
 * and runner-up apart in the first round. Byes (null) go to the top seeds
 * when the qualifiers don't fill a power of two.
 */
export function knockoutBracket(tables: Record<string, TableRow[]>, qualifiersPerGroup: number): (string | null)[] {
  const seeds: string[] = [];
  for (let place = 0; place < qualifiersPerGroup; place++) {
    const atPlace = Object.values(tables)
      .map((t) => t[place])
      .filter((r): r is TableRow => !!r);
    atPlace.sort((x, y) => y.points / Math.max(1, y.played) - x.points / Math.max(1, x.played) || y.holes - x.holes);
    seeds.push(...atPlace.map((r) => r.userId));
  }
  if (seeds.length < 2) return seeds;
  let size = 2;
  while (size < seeds.length) size *= 2;
  return seedOrder(size).map((s) => seeds[s - 1] ?? null);
}

// ---------------------------------------------------------------- shots

/**
 * Shots in singles matchplay: the full difference between the two players'
 * course handicaps (WHS, Golf Ireland). Course handicaps need the tees'
 * slope and rating, which the players settle on the day; from handicap
 * indexes this is an estimate, and the screens say so.
 */
export function shotsFromIndexes(a: number, b: number, slope = 113): number {
  return Math.round(Math.abs(a - b) * (slope / 113));
}

// ---------------------------------------------------------------- ladders

/** Who `me` may challenge: up to `reach` places above, neither with a challenge to play. */
export function challengeable(entries: Entry[], matches: Match[], me: string, reach: number): Entry[] {
  const mine = entries.find((e) => e.userId === me && !e.withdrawn);
  if (!mine?.ladderPosition) return [];
  const busy = new Set(
    matches
      .filter((m) => m.stage === "ladder" && (m.status === "open" || m.status === "reported" || m.status === "disputed"))
      .flatMap((m) => [m.playerA, m.playerB]),
  );
  if (busy.has(me)) return [];
  const myPos = mine.ladderPosition;
  return entries
    .filter((e) => !e.withdrawn && e.ladderPosition != null && e.ladderPosition < myPos && e.ladderPosition >= myPos - reach && !busy.has(e.userId))
    .sort((a, b) => (a.ladderPosition ?? 0) - (b.ladderPosition ?? 0));
}

// ---------------------------------------------------------------- a match, for one player

export type MyMatchState =
  | "arrange" // open, no time agreed
  | "arranged" // open, time agreed
  | "confirm" // the other player reported; I confirm or dispute
  | "waiting" // I reported; waiting for them
  | "disputed"
  | "done"
  | "waiting-for-opponent"; // knockout: opponent not known yet

export function myMatchState(m: Match & { arrangedAt?: string | null }, me: string): MyMatchState {
  if (m.status === "confirmed" || m.status === "void") return "done";
  if (m.status === "disputed") return "disputed";
  if (!m.playerA || !m.playerB) return "waiting-for-opponent";
  if (m.status === "reported") return m.reportedBy === me ? "waiting" : "confirm";
  return m.arrangedAt ? "arranged" : "arrange";
}

/** Hours until a reported result stands, rounded up; 0 once due. */
export function hoursUntilStands(standsAt: string | null, now: Date = new Date()): number {
  if (!standsAt) return 0;
  return Math.max(0, Math.ceil((new Date(standsAt).getTime() - now.getTime()) / 3_600_000));
}

/** Entry fee for display: "€15", "€12.50", or null when free. */
export function feeLabel(cents: number | null): string | null {
  if (!cents) return null;
  return `€${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}

export const PROVINCES = [
  { id: "leinster", label: "Leinster" },
  { id: "munster", label: "Munster" },
  { id: "connacht", label: "Connacht" },
  { id: "ulster", label: "Ulster" },
] as const;
export type Province = (typeof PROVINCES)[number]["id"];
