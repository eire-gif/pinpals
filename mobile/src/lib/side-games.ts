/**
 * Side games (Oct 2026, claude/side-games.md, needs 0196).
 *
 * Games that run alongside a round's main game, worked out from the same
 * scores: Best Front 9, Best Back 9, Best Overall, and Sixes — three 6-hole
 * games, played individually (most points on those six holes) or in pairs
 * (a match over those six holes, better ball of each pair, partners
 * rotating so with four players you partner everyone once).
 *
 * Everything is scored on Stableford points from each player's own playing
 * handicap, whatever the round's main format: "most points" is what the
 * group asked for, and points let a 4 handicapper and a 24 play each other.
 *
 * Money: PinPals only keeps the tally. A game won outright collects the
 * stake from each player who didn't win it; tied winners share. In a pairs
 * match each loser pays the stake to one winner. A halved or all-square game
 * moves nothing. `settle()` turns the balances into the fewest payments.
 *
 * Pure (imports only the scoring arithmetic), tested in side-games.test.ts.
 */

import { shotsSoFar, stablefordPoints, type CardHole, type LivePlayer, type ScoreSheet } from "./live-scoring";

export type SixesMode = "individual" | "pairs";
export type SideMode = "pride" | "points" | "money";

export type SideGamesConfig = {
  bestFront: boolean;
  bestBack: boolean;
  bestOverall: boolean;
  sixes: SixesMode | null;
  mode: SideMode;
  /** Cents per game, money mode only. */
  stakes: { front: number; back: number; overall: number; sixes: number };
  /** Skins, Wolf and Nassau (0201). Absent = none of them. */
  extra?: ExtraGames;
};

/** Skins, Wolf and Nassau (0201): scored in side-games-extra.ts. Amounts are a skin, a Wolf point and a Nassau bet. */
export type ExtraGames = {
  skins: "carry" | "void" | null;
  wolf: boolean;
  nassau: boolean;
  stakes: { skins: number; wolf: number; nassau: number };
};

export const NO_EXTRA: ExtraGames = { skins: null, wolf: false, nassau: false, stakes: { skins: 0, wolf: 0, nassau: 0 } };

/** Any of Skins, Wolf or Nassau on. */
export const hasExtra = (c: Pick<SideGamesConfig, "extra">): boolean => !!c.extra && (c.extra.skins != null || c.extra.wolf || c.extra.nassau);

export const NO_STAKES = { front: 0, back: 0, overall: 0, sixes: 0 } as const;

/** Quick picks on the set-up screen, in cents. */
export const STAKE_PICKS: readonly number[] = [200, 500, 1000, 2000];
export const MAX_STAKE_CENTS = 50_000;

export type SideGameKind = "front" | "back" | "overall" | "sixes";

export type SideGameStatus = "not_started" | "live" | "final";

export type Standing = { playerId: number; name: string; points: number; thru: number };

export type PairMatch = {
  sideA: [number, number];
  sideB: [number, number];
  /** Holes won by A minus holes won by B, on holes all four have finished. */
  up: number;
  /** Holes of the six all four have finished. */
  played: number;
  result: "A" | "B" | "halved" | null;
};

export type SideGame = {
  id: string;
  kind: SideGameKind;
  label: string;
  /** First and last hole, inclusive. */
  from: number;
  to: number;
  status: SideGameStatus;
  /** Individual games: best first. Empty for a pairs match. */
  standings: Standing[];
  /** Pairs Sixes only. */
  match: PairMatch | null;
  /** Final: who won. Live: who leads now. Empty when nobody leads (all square / not started). */
  winners: number[];
  stakeCents: number;
};

/** Is this round one side games can run on? Mirrors 0196's live_round_side_games_error. */
export function sideGamesBlocked(round: {
  holes: number;
  format: string;
  matchDayId: number | null;
  scramble: unknown;
  status: string;
}, playerCount: number): string | null {
  if (round.status !== "live") return "This round has finished.";
  if (round.holes !== 18) return "Side games need an 18-hole round.";
  if (round.matchDayId != null || round.scramble != null || ["scramble", "foursomes", "greensomes"].includes(round.format)) {
    return "Side games need everyone playing their own ball.";
  }
  if (playerCount < 2) return "Side games need at least two players.";
  return null;
}

/** Points per player per hole, null for a hole they haven't finished. */
export function pointsByHole(
  card: readonly CardHole[],
  players: readonly LivePlayer[],
  scores: ScoreSheet,
): Map<number, Map<number, number | null>> {
  const parOf = new Map(card.map((h) => [h.hole, h.par]));
  const out = new Map<number, Map<number, number | null>>();
  for (const p of players) {
    const shots = shotsSoFar(p.playingHandicap, card);
    const mine = scores.get(p.id);
    const row = new Map<number, number | null>();
    for (const h of card) {
      if (!mine || !mine.has(h.hole)) {
        row.set(h.hole, null);
        continue;
      }
      row.set(h.hole, stablefordPoints(mine.get(h.hole) ?? null, parOf.get(h.hole) ?? h.par, shots.get(h.hole) ?? 0));
    }
    out.set(p.id, row);
  }
  return out;
}

function holesIn(from: number, to: number): number[] {
  const out: number[] = [];
  for (let h = from; h <= to; h++) out.push(h);
  return out;
}

/** Partners for Sixes in pairs: players in their round order, A1+A2 v B1+B2. */
export function sixesPairs(ids: readonly number[]): [[number, number], [number, number]][] {
  if (ids.length !== 4) return [];
  const [a, b, c, d] = ids as [number, number, number, number];
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
}

function individualGame(
  id: string,
  kind: SideGameKind,
  label: string,
  from: number,
  to: number,
  players: readonly LivePlayer[],
  pts: Map<number, Map<number, number | null>>,
  stakeCents: number,
): SideGame {
  const holes = holesIn(from, to);
  const standings: Standing[] = players.map((p) => {
    const row = pts.get(p.id);
    let points = 0;
    let thru = 0;
    for (const h of holes) {
      const v = row?.get(h);
      if (v == null) continue;
      points += v;
      thru += 1;
    }
    return { playerId: p.id, name: p.name, points, thru };
  });
  standings.sort((x, y) => y.points - x.points || y.thru - x.thru || x.name.localeCompare(y.name));
  const anyStarted = standings.some((s) => s.thru > 0);
  const done = standings.every((s) => s.thru === holes.length);
  const status: SideGameStatus = done ? "final" : anyStarted ? "live" : "not_started";
  let winners: number[] = [];
  if (anyStarted) {
    const best = standings[0]!.points;
    winners = standings.filter((s) => s.points === best).map((s) => s.playerId);
    // Everyone level: nobody is winning anything.
    if (winners.length === standings.length) winners = [];
  }
  return { id, kind, label, from, to, status, standings, match: null, winners, stakeCents };
}

function pairsGame(
  id: string,
  label: string,
  from: number,
  to: number,
  sideA: [number, number],
  sideB: [number, number],
  pts: Map<number, Map<number, number | null>>,
  stakeCents: number,
): SideGame {
  const holes = holesIn(from, to);
  let up = 0;
  let played = 0;
  let anyStarted = false;
  for (const h of holes) {
    const vals = [...sideA, ...sideB].map((pid) => pts.get(pid)?.get(h) ?? null);
    if (vals.some((v) => v != null)) anyStarted = true;
    if (vals.some((v) => v == null)) continue;
    played += 1;
    const a = Math.max(vals[0]!, vals[1]!);
    const b = Math.max(vals[2]!, vals[3]!);
    if (a > b) up += 1;
    else if (b > a) up -= 1;
  }
  const left = holes.length - played;
  // Decided once one side is further up than there are holes left (2&1).
  const decided = Math.abs(up) > left;
  const done = played === holes.length || decided;
  const status: SideGameStatus = done ? "final" : anyStarted ? "live" : "not_started";
  const result: PairMatch["result"] = done ? (up > 0 ? "A" : up < 0 ? "B" : "halved") : null;
  const winners = up > 0 ? [...sideA] : up < 0 ? [...sideB] : [];
  return {
    id,
    kind: "sixes",
    label,
    from,
    to,
    status,
    standings: [],
    match: { sideA, sideB, up, played, result },
    winners,
    stakeCents,
  };
}

/** Every side game on the round, in the order they're played. */
export function sideGames(
  config: SideGamesConfig,
  card: readonly CardHole[],
  players: readonly LivePlayer[],
  scores: ScoreSheet,
): SideGame[] {
  if (card.length !== 18 || players.length < 2) return [];
  const pts = pointsByHole(card, players, scores);
  const money = config.mode === "money";
  const stake = (n: number) => (money ? n : 0);
  const games: SideGame[] = [];

  if (config.sixes === "pairs" && players.length === 4) {
    sixesPairs(players.map((p) => p.id)).forEach(([a, b], i) => {
      games.push(pairsGame(`sixes${i + 1}`, `Sixes · holes ${i * 6 + 1}–${i * 6 + 6}`, i * 6 + 1, i * 6 + 6, a, b, pts, stake(config.stakes.sixes)));
    });
  } else if (config.sixes === "individual") {
    for (let i = 0; i < 3; i++) {
      games.push(individualGame(`sixes${i + 1}`, "sixes", `Sixes · holes ${i * 6 + 1}–${i * 6 + 6}`, i * 6 + 1, i * 6 + 6, players, pts, stake(config.stakes.sixes)));
    }
  }
  if (config.bestFront) games.push(individualGame("front", "front", "Best Front 9", 1, 9, players, pts, stake(config.stakes.front)));
  if (config.bestBack) games.push(individualGame("back", "back", "Best Back 9", 10, 18, players, pts, stake(config.stakes.back)));
  if (config.bestOverall) games.push(individualGame("overall", "overall", "Best Overall", 1, 18, players, pts, stake(config.stakes.overall)));

  // Sixes slot in by where they're played: 1–6, front 9, 7–12, 13–18, back 9, overall.
  const order = (g: SideGame) => (g.kind === "overall" ? 100 : g.to * 2 + (g.kind === "sixes" ? 0 : 1));
  return games.sort((a, b) => order(a) - order(b));
}

/**
 * Money moved by one game, per player, in cents (+ won, − lost). Live games
 * count as if they ended now when `asItStands` is set; otherwise only
 * finished games count.
 */
export function gameMoney(game: SideGame, playerIds: readonly number[], asItStands = false): Map<number, number> {
  const out = new Map<number, number>();
  if (game.stakeCents <= 0 || game.winners.length === 0) return out;
  if (game.status !== "final" && !(asItStands && game.status === "live")) return out;
  const s = game.stakeCents;
  if (game.match) {
    const winners = game.winners;
    const losers = (game.match.up > 0 ? game.match.sideB : game.match.sideA) as readonly number[];
    for (const w of winners) out.set(w, (out.get(w) ?? 0) + s);
    for (const l of losers) out.set(l, (out.get(l) ?? 0) - s);
    return out;
  }
  const winners = game.winners;
  const losers = playerIds.filter((id) => !winners.includes(id));
  if (losers.length === 0) return out;
  const pot = s * losers.length;
  const share = Math.floor(pot / winners.length);
  let remainder = pot - share * winners.length;
  // Odd cents go to the winners in order, so the books still balance.
  for (const w of winners) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    out.set(w, (out.get(w) ?? 0) + share + extra);
  }
  for (const l of losers) out.set(l, (out.get(l) ?? 0) - s);
  return out;
}

/** Each player's balance across all games, in cents. */
export function balances(games: readonly SideGame[], playerIds: readonly number[], asItStands = false): Map<number, number> {
  const out = new Map<number, number>(playerIds.map((id) => [id, 0]));
  for (const g of games) {
    for (const [id, cents] of gameMoney(g, playerIds, asItStands)) out.set(id, (out.get(id) ?? 0) + cents);
  }
  return out;
}

/**
 * Points mode: a game is worth one point, shared between tied winners; a
 * pairs match gives each winner a point, and half each when halved.
 */
export function sidePoints(games: readonly SideGame[], playerIds: readonly number[]): Map<number, number> {
  const out = new Map<number, number>(playerIds.map((id) => [id, 0]));
  for (const g of games) {
    if (g.status !== "final") continue;
    if (g.match) {
      if (g.match.result === "halved") {
        for (const id of [...g.match.sideA, ...g.match.sideB]) out.set(id, (out.get(id) ?? 0) + 0.5);
      } else {
        for (const id of g.winners) out.set(id, (out.get(id) ?? 0) + 1);
      }
      continue;
    }
    if (g.winners.length === 0) continue;
    for (const id of g.winners) out.set(id, (out.get(id) ?? 0) + 1 / g.winners.length);
  }
  return out;
}

export type Payment = { from: number; to: number; cents: number };

/** The fewest payments that square every balance: biggest debt to biggest credit first. */
export function settle(bal: ReadonlyMap<number, number>): Payment[] {
  const debtors = [...bal].filter(([, c]) => c < 0).map(([id, c]) => ({ id, left: -c }));
  const creditors = [...bal].filter(([, c]) => c > 0).map(([id, c]) => ({ id, left: c }));
  const out: Payment[] = [];
  const byLeft = (a: { id: number; left: number }, b: { id: number; left: number }) => b.left - a.left || a.id - b.id;
  while (debtors.some((d) => d.left > 0) && creditors.some((c) => c.left > 0)) {
    debtors.sort(byLeft);
    creditors.sort(byLeft);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const cents = Math.min(d.left, c.left);
    out.push({ from: d.id, to: c.id, cents });
    d.left -= cents;
    c.left -= cents;
  }
  return out;
}

/** The most a player can lose (and win) across the games set up, for the set-up screen. */
export function exposure(config: SideGamesConfig, playerCount: number): { maxLoss: number; maxWin: number } {
  if (config.mode !== "money" || playerCount < 2) return { maxLoss: 0, maxWin: 0 };
  const others = playerCount - 1;
  let maxLoss = 0;
  let maxWin = 0;
  const individual = (s: number) => {
    maxLoss += s;
    maxWin += s * others;
  };
  if (config.bestFront) individual(config.stakes.front);
  if (config.bestBack) individual(config.stakes.back);
  if (config.bestOverall) individual(config.stakes.overall);
  if (config.sixes === "individual") for (let i = 0; i < 3; i++) individual(config.stakes.sixes);
  if (config.sixes === "pairs") {
    maxLoss += 3 * config.stakes.sixes;
    maxWin += 3 * config.stakes.sixes;
  }
  return { maxLoss, maxWin };
}

/** "€5", "€2.50", "−€10", "+€20". */
export function euros(cents: number, signed = false): string {
  const abs = Math.abs(cents);
  const whole = abs % 100 === 0;
  const body = `€${whole ? abs / 100 : (abs / 100).toFixed(2)}`;
  if (!signed) return (cents < 0 ? "−" : "") + body;
  if (cents === 0) return body;
  return (cents > 0 ? "+" : "−") + body;
}

/** "5" or "2.50" typed → cents, or null when it isn't an amount we take. */
export function parseEuros(text: string): number | null {
  const t = text.replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_STAKE_CENTS) return null;
  return cents;
}

/** "½", "1", "1½", "⅓" for points mode. */
export function pointsLabel(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const f = Math.abs(frac - 0.5) < 1e-6 ? "½" : Math.abs(frac - 1 / 3) < 1e-6 ? "⅓" : Math.abs(frac - 2 / 3) < 1e-6 ? "⅔" : Math.abs(frac - 0.25) < 1e-6 ? "¼" : Math.abs(frac - 0.75) < 1e-6 ? "¾" : "";
  if (whole === 0 && f) return f;
  return `${whole}${f}`;
}

/** A pairs match's state in words: "2 UP", "All square", "Won 3&2". */
export function matchLine(m: PairMatch, holes = 6): string {
  const left = holes - m.played;
  if (m.result === "halved") return "Halved";
  if (m.result) {
    const by = Math.abs(m.up);
    return left > 0 ? `Won ${by}&${left}` : `Won ${by} up`;
  }
  if (m.played === 0) return "Not started";
  if (m.up === 0) return "All square";
  return `${Math.abs(m.up)} up`;
}

/** Which members still need to agree before money games count. */
export function waitingToAgree(memberIds: readonly (string | null)[], agreed: ReadonlySet<string>): string[] {
  return memberIds.filter((m): m is string => !!m && !agreed.has(m));
}
