/**
 * Skins, Wolf and Nassau (0201, claude/side-games.md): the pure half.
 *
 * Scored like 0196's side games, on Stableford points from each player's own
 * handicap (`pointsByHole` in side-games.ts), hole by hole:
 *
 *   Skins   the one player with the most points on a hole wins its skin —
 *           plus any carried. A tie carries the skin on ("carry") or loses
 *           it ("void"). A skin is worth the amount from every other player.
 *   Wolf    four players; the Wolf is the hole's player in turn by playing
 *           order (wolfOn). With a partner: better ball, two v two, the
 *           winners take a point from each loser. Lone Wolf: one v the best
 *           of the other three, two points from each. A halved hole moves
 *           nothing; a hole with no pick doesn't count yet.
 *   Nassau  every two players: front 9, back 9 and the 18, each a match on
 *           holes won. Whoever goes two down in a bet starts a press — a new
 *           bet from the next hole to the end of that nine (or the 18).
 *           A bet is worth the amount; halved moves nothing.
 *
 * Money is in cents, + won and − lost, and always adds to zero.
 *
 * Pure: tested in side-games-extra.test.ts.
 */

import type { CardHole, LivePlayer, ScoreSheet } from "./live-scoring";
import { NO_EXTRA, balances, pointsByHole, sideGames, sidePoints, type SideGame, type SideGamesConfig } from "./side-games";

export type Pts = ReadonlyMap<number, ReadonlyMap<number, number | null>>;

const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);

const add = (m: Map<number, number>, id: number, v: number) => m.set(id, (m.get(id) ?? 0) + v);

/** Every player's points on a hole, or null when someone hasn't finished it. */
function holePoints(pts: Pts, ids: readonly number[], hole: number): number[] | null {
  const out: number[] = [];
  for (const id of ids) {
    const v = pts.get(id)?.get(hole);
    if (v == null) return null;
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

export type SkinHole = {
  hole: number;
  /** Who won it, or null (tied, or not finished). */
  winner: number | null;
  /** Skins it was worth: 1 plus any carried in. */
  value: number;
  /** Tied: carried on, or lost (void). */
  tied: boolean;
  played: boolean;
};

export type SkinsResult = {
  holes: SkinHole[];
  /** Skins each player has won. */
  won: Map<number, number>;
  /** Skins riding on the next hole to be played (carry), 0 if none. */
  riding: number;
  /** Every hole played. */
  final: boolean;
  money: Map<number, number>;
};

export function skins(pts: Pts, ids: readonly number[], mode: "carry" | "void", stakeCents: number): SkinsResult {
  const won = new Map<number, number>(ids.map((id) => [id, 0]));
  const money = new Map<number, number>(ids.map((id) => [id, 0]));
  const holes: SkinHole[] = [];
  let carried = 0;
  let stopped = false;
  for (const h of HOLES) {
    const vals = stopped ? null : holePoints(pts, ids, h);
    if (!vals) {
      // Skins are won in order: nothing after the first unfinished hole counts yet.
      stopped = true;
      holes.push({ hole: h, winner: null, value: 1 + carried, tied: false, played: false });
      continue;
    }
    const best = Math.max(...vals);
    const leaders = ids.filter((_, i) => vals[i] === best);
    const value = 1 + carried;
    if (leaders.length === 1) {
      const w = leaders[0]!;
      holes.push({ hole: h, winner: w, value, tied: false, played: true });
      add(won, w, value);
      for (const id of ids) add(money, id, id === w ? stakeCents * value * (ids.length - 1) : -stakeCents * value);
      carried = 0;
    } else {
      holes.push({ hole: h, winner: null, value, tied: true, played: true });
      carried = mode === "carry" ? value : 0;
    }
  }
  const final = holes.every((h) => h.played);
  return { holes, won, riding: final ? 0 : 1 + carried, final, money };
}

// ---------------------------------------------------------------------------
// Wolf
// ---------------------------------------------------------------------------

/** The Wolf on a hole: the players in playing order, in turn. */
export function wolfOn(hole: number, ids: readonly number[]): number {
  return ids[(hole - 1) % ids.length]!;
}

export type WolfHole = {
  hole: number;
  wolf: number;
  /** undefined: no pick yet; null: Lone Wolf. */
  partner: number | null | undefined;
  /** Who took it: the Wolf's side, the others, halved, or null (not played or no pick). */
  result: "wolf" | "others" | "halved" | null;
};

export type WolfResult = { holes: WolfHole[]; points: Map<number, number>; money: Map<number, number>; final: boolean };

export function wolf(pts: Pts, ids: readonly number[], picks: ReadonlyMap<number, number | null>, stakeCents: number): WolfResult {
  const points = new Map<number, number>(ids.map((id) => [id, 0]));
  const holes: WolfHole[] = [];
  if (ids.length !== 4) return { holes, points, money: new Map(points), final: false };
  for (const h of HOLES) {
    const w = wolfOn(h, ids);
    const partner = picks.has(h) ? (picks.get(h) ?? null) : undefined;
    const vals = holePoints(pts, ids, h);
    if (!vals || partner === undefined) {
      holes.push({ hole: h, wolf: w, partner, result: null });
      continue;
    }
    const of = (id: number) => vals[ids.indexOf(id)]!;
    const mine = partner == null ? [w] : [w, partner];
    const theirs = ids.filter((id) => !mine.includes(id));
    const a = Math.max(...mine.map(of));
    const b = Math.max(...theirs.map(of));
    const result: WolfHole["result"] = a > b ? "wolf" : b > a ? "others" : "halved";
    holes.push({ hole: h, wolf: w, partner, result });
    if (result === "halved") continue;
    const [winners, losers] = result === "wolf" ? [mine, theirs] : [theirs, mine];
    // A pair's win: a point from each loser to each winner (two v two).
    // A Lone Wolf's: two from each of the three, or two to each of them.
    const unit = partner == null ? 2 : 1;
    if (partner == null) {
      const lone = mine[0]!;
      for (const o of theirs) {
        add(points, lone, result === "wolf" ? unit : -unit);
        add(points, o, result === "wolf" ? -unit : unit);
      }
    } else {
      for (const x of winners) add(points, x, unit);
      for (const x of losers) add(points, x, -unit);
    }
  }
  const money = new Map<number, number>([...points].map(([id, p]) => [id, p * stakeCents]));
  return { holes, points, money, final: holes.every((h) => h.result != null) };
}

/** The first hole whose Wolf hasn't picked, among holes not yet played by everyone. */
export function wolfToPick(holes: readonly WolfHole[]): WolfHole | null {
  return holes.find((h) => h.partner === undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Nassau
// ---------------------------------------------------------------------------

export type NassauBet = {
  a: number;
  b: number;
  label: string;
  from: number;
  to: number;
  /** Holes won by a minus holes won by b so far. */
  up: number;
  played: number;
  /** Decided or every hole played. */
  done: boolean;
  /** Who won it (a or b's id), null when halved or not done. */
  winner: number | null;
  /** 0 for the main bet, 1, 2… for presses. */
  press: number;
};

export type NassauResult = { bets: NassauBet[]; money: Map<number, number>; points: Map<number, number> };

/** One pair's bets: the front, back and 18, and the presses they started. */
function pairBets(pts: Pts, a: number, b: number): NassauBet[] {
  type Live = NassauBet & { pressed: boolean };
  const make = (label: string, from: number, to: number, press: number): Live => ({ a, b, label, from, to, up: 0, played: 0, done: false, winner: null, press, pressed: false });
  const bets: Live[] = [make("Front 9", 1, 9, 0), make("Back 9", 10, 18, 0), make("18 holes", 1, 18, 0)];
  let presses = 0;
  for (const h of HOLES) {
    const pa = pts.get(a)?.get(h);
    const pb = pts.get(b)?.get(h);
    if (pa == null || pb == null) break; // in order: stop at the first hole not finished by both
    const res = pa > pb ? 1 : pb > pa ? -1 : 0;
    for (const bet of [...bets]) {
      if (h < bet.from || h > bet.to || bet.done) continue;
      bet.up += res;
      bet.played += 1;
      const left = bet.to - bet.from + 1 - bet.played;
      if (Math.abs(bet.up) > left || left === 0) {
        bet.done = true;
        bet.winner = bet.up > 0 ? a : bet.up < 0 ? b : null;
      }
      // Two down with holes still to play in it: the one behind presses.
      if (!bet.pressed && Math.abs(bet.up) === 2 && left > 0 && !bet.done) {
        bet.pressed = true;
        presses += 1;
        bets.push(make(`Press · holes ${h + 1}–${bet.to}`, h + 1, bet.to, presses));
      }
    }
  }
  return bets.map(({ pressed: _p, ...rest }) => rest);
}

export function nassau(pts: Pts, ids: readonly number[], stakeCents: number): NassauResult {
  const money = new Map<number, number>(ids.map((id) => [id, 0]));
  const points = new Map<number, number>(ids.map((id) => [id, 0]));
  const bets: NassauBet[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (const bet of pairBets(pts, ids[i]!, ids[j]!)) {
        bets.push(bet);
        if (!bet.done) continue;
        if (bet.winner == null) {
          add(points, bet.a, 0.5);
          add(points, bet.b, 0.5);
          continue;
        }
        const loser = bet.winner === bet.a ? bet.b : bet.a;
        add(money, bet.winner, stakeCents);
        add(money, loser, -stakeCents);
        add(points, bet.winner, 1);
      }
    }
  }
  return { bets, money, points };
}

/** "2 up thru 5", "All square", "Won 3&2", "Halved". From a's side when `forA`, else b's. */
export function betLine(bet: NassauBet, forA = true): string {
  const up = forA ? bet.up : -bet.up;
  const left = bet.to - bet.from + 1 - bet.played;
  if (bet.done) {
    if (bet.winner == null) return "Halved";
    const by = Math.abs(up);
    return `${up > 0 ? "Won" : "Lost"} ${left > 0 ? `${by}&${left}` : `${by} up`}`;
  }
  if (bet.played === 0) return "Not started";
  if (up === 0) return `All square · thru ${bet.from + bet.played - 1}`;
  return `${Math.abs(up)} ${up > 0 ? "up" : "down"} · thru ${bet.from + bet.played - 1}`;
}

// ---------------------------------------------------------------------------
// Together
// ---------------------------------------------------------------------------

/** Adds money maps together, for the settle-up. */
export function sumMoney(ids: readonly number[], ...maps: ReadonlyMap<number, number>[]): Map<number, number> {
  const out = new Map<number, number>(ids.map((id) => [id, 0]));
  for (const m of maps) for (const [id, c] of m) add(out, id, c);
  return out;
}

/** Most a player can lose (and win) on these games, for the set-up screen. Nassau leaves out presses. */
export function extraExposure(
  g: { skins: boolean; wolf: boolean; nassau: boolean; stakes: { skins: number; wolf: number; nassau: number } },
  playerCount: number
): { maxLoss: number; maxWin: number } {
  if (playerCount < 2) return { maxLoss: 0, maxWin: 0 };
  const others = playerCount - 1;
  let maxLoss = 0;
  let maxWin = 0;
  if (g.skins) {
    maxLoss += 18 * g.stakes.skins;
    maxWin += 18 * g.stakes.skins * others;
  }
  if (g.wolf && playerCount === 4) {
    // Wolf on 4 or 5 holes: alone and beaten, six points each; the other holes two at most.
    maxLoss += (5 * 6 + 13 * 2) * g.stakes.wolf;
    maxWin += (5 * 6 + 13 * 2) * g.stakes.wolf;
  }
  if (g.nassau) {
    maxLoss += 3 * others * g.stakes.nassau;
    maxWin += 3 * others * g.stakes.nassau;
  }
  return { maxLoss, maxWin };
}

// ---------------------------------------------------------------------------
// Everything on a round
// ---------------------------------------------------------------------------

export type SideSummary = {
  games: SideGame[];
  skins: SkinsResult | null;
  wolf: WolfResult | null;
  nassau: NassauResult | null;
  /** Every game over (every hole of them played). */
  allFinal: boolean;
  /** Cents per player across every game; live games as they stand when `asItStands`. */
  money: Map<number, number>;
  /** Points mode: a game won is a point (shared on a tie), a skin a point, Wolf's own points, a Nassau bet a point. */
  points: Map<number, number>;
};

/** All the side games on a round, scored, with the totals. */
export function sideSummary(
  config: SideGamesConfig,
  card: readonly CardHole[],
  players: readonly LivePlayer[],
  scores: ScoreSheet,
  picks: ReadonlyMap<number, number | null>,
  asItStands: boolean
): SideSummary {
  const ids = players.map((p) => p.id);
  const games = sideGames(config, card, players, scores);
  const x = config.extra ?? NO_EXTRA;
  const money = config.mode === "money";
  const pts = card.length === 18 && players.length >= 2 ? pointsByHole(card, players, scores) : null;
  const sk = pts && x.skins ? skins(pts, ids, x.skins, money ? x.stakes.skins : 0) : null;
  const wf = pts && x.wolf && ids.length === 4 ? wolf(pts, ids, picks, money ? x.stakes.wolf : 0) : null;
  const ns = pts && x.nassau ? nassau(pts, ids, money ? x.stakes.nassau : 0) : null;
  const allFinal = games.every((g) => g.status === "final") && (!sk || sk.final) && (!wf || wf.final) && (!ns || ns.bets.every((b) => b.done));
  const zero = new Map<number, number>();
  const totalMoney = sumMoney(ids, balances(games, ids, asItStands), sk?.money ?? zero, wf?.money ?? zero, ns?.money ?? zero);
  const totalPoints = sumMoney(ids, sidePoints(games, ids), sk?.won ?? zero, wf?.points ?? zero, ns?.points ?? zero);
  return { games, skins: sk, wolf: wf, nassau: ns, allFinal, money: totalMoney, points: totalPoints };
}
