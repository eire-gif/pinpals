/**
 * MY ROUND (Oct 2026): the green pill in the header of every screen while a
 * round you are playing in is live. These are the rules it draws from, kept
 * apart from the loading so they can be tested (my-round-rules.test.ts).
 *
 * Only rounds you are PLAYING in — a round you are following or watching
 * stays under "Watch live" on Home. The pill is "yours".
 */

export type MyRoundCandidate = {
  id: number;
  status: "live" | "finished";
  /** yyyy-mm-dd */
  playedOn: string;
  holes: number;
  /** Shotgun start: the hole this group went out on. Null = the 1st. */
  startHole: number | null;
};

export type MyRound = {
  id: number;
  /** The hole being played now, as best the scores can tell. */
  hole: number;
};

/** yyyy-mm-dd for a local date. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The live round to point the pill at, or null.
 *
 * A round nobody pressed Finish on stays "live" in the database for ever,
 * and a pill pulsing for last Saturday's fourball would be wrong — so only
 * rounds played today or yesterday (a twilight round past midnight) count.
 * Only one game is ever open per tee time, so more than one live round is
 * rare; when it happens the newest wins.
 */
export function pickMyRound(rounds: readonly MyRoundCandidate[], today: Date): MyRoundCandidate | null {
  const todayIso = isoDay(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = isoDay(yesterday);
  const live = rounds.filter((r) => r.status === "live" && (r.playedOn === todayIso || r.playedOn === yesterdayIso));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => (a.playedOn === b.playedOn ? b.id - a.id : a.playedOn < b.playedOn ? 1 : -1))[0];
}

/**
 * The hole being played: the first hole, in playing order, that nobody in
 * the group has a score on yet. Playing order starts at the shotgun hole and
 * wraps (start on the 7th: 7…18, then 1…6). Every hole scored → the last
 * hole in that order, while they walk in.
 */
export function holeInPlay(holes: number, startHole: number | null, scored: Iterable<number>): number {
  const total = holes === 9 ? 9 : 18;
  const start = startHole && startHole >= 1 && startHole <= total ? startHole : 1;
  const done = new Set(scored);
  const order = Array.from({ length: total }, (_, i) => ((start - 1 + i) % total) + 1);
  return order.find((h) => !done.has(h)) ?? order[order.length - 1];
}

/** The pill's words. Compact on a busy bar: the hole alone. */
export function myRoundLabel(round: MyRound, compact: boolean): { text: string; detail: string | null } {
  return compact ? { text: `H${round.hole}`, detail: null } : { text: "MY ROUND", detail: `H${round.hole}` };
}

/** "/live/round/12" — what the pill opens, and the screen it goes still on. */
export const myRoundPath = (id: number) => `/live/round/${id}`;

/** Already on this round's scoring screen? Then the pill stops pulsing. */
export function onMyRoundScreen(pathname: string | null | undefined, id: number): boolean {
  if (!pathname) return false;
  const clean = pathname.replace(/\/+$/, "");
  return clean === myRoundPath(id) || clean === `/(tabs)${myRoundPath(id)}`;
}
