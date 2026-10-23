import { distanceM, fixIsUsable, holeGeometry, type LatLng, type LayoutPoint } from "./hole-geo";

/**
 * Moving on to the next hole by GPS (Oct 2026, after a live test): once a
 * hole is scored and you walk onto the next tee, the round and the hole map
 * follow you there — no tapping "Next hole".
 *
 * Deliberately cautious, because jumping you off a hole you're still on is
 * worse than not jumping at all:
 *   - only forward, only to the next hole in this group's order (a shotgun
 *     group plays from its own hole), never to a hole further on;
 *   - only once the hole being shown has its scores in;
 *   - only from a usable fix (±30 m or better), and never while you're
 *     still on or beside the green just played (next tees are often a
 *     few steps from it);
 *   - only when you're on the next hole's tee — within TEE_RADIUS_M of
 *     either tee marker — or, with the tee markers a little out, clearly
 *     nearer that tee than this green and well off this green.
 * The screens also remember each hole they've moved on from, so tapping
 * back to a scored hole while standing on the next tee doesn't bounce you
 * forward again.
 */

/** On the tee box: generous, because golfapi's tee is one box of several. */
export const TEE_RADIUS_M = 60;
/** Heading for the tee: near it, and well off the green just played. */
export const NEAR_TEE_M = 140;
export const OFF_GREEN_M = 50;
/** Still on (or right beside) the green just played: never move on. */
export const ON_GREEN_M = 25;

export type HoleSpots = { tees: LatLng[]; green: LatLng | null };

/** Each hole's tee markers and green centre, from a course layout's points. */
export function holeSpots(points: readonly LayoutPoint[], holes: readonly number[]): Map<number, HoleSpots> {
  const out = new Map<number, HoleSpots>();
  for (const n of holes) {
    const g = holeGeometry(points, n);
    const tees = [g.teeBack, g.teeFront].filter((t): t is LatLng => t != null);
    if (tees.length || g.greenCentre) out.set(n, { tees, green: g.greenCentre });
  }
  return out;
}

/**
 * Merge two sets of spots, the first winning hole by hole (golfapi.io's
 * layout first, OpenStreetMap's where golfapi has nothing).
 */
export function mergeSpots(first: Map<number, HoleSpots>, second: Map<number, HoleSpots>): Map<number, HoleSpots> {
  const out = new Map(second);
  for (const [n, s] of first) if (s.tees.length) out.set(n, s);
  return out;
}

export type Fix = LatLng & { accuracyM: number | null };

/**
 * The hole to move on to, or null to stay put.
 *
 * @param showing  the hole on screen
 * @param order    the holes in the order this group plays them
 * @param scored   whether a hole has its scores in (everyone's, on the
 *                 round screen; the player's own, on the hole map)
 * @param movedOnFrom holes already moved on from once — never again
 */
export function gpsNextHole({
  showing,
  order,
  scored,
  spots,
  fix,
  movedOnFrom,
}: {
  showing: number;
  order: readonly number[];
  scored: (hole: number) => boolean;
  spots: ReadonlyMap<number, HoleSpots>;
  fix: Fix | null;
  movedOnFrom?: ReadonlySet<number>;
}): number | null {
  if (!fix || !fixIsUsable(fix.accuracyM)) return null;
  if (movedOnFrom?.has(showing)) return null;
  const at = order.indexOf(showing);
  if (at < 0 || at >= order.length - 1) return null;
  if (!scored(showing)) return null;
  const next = order[at + 1];
  const tees = spots.get(next)?.tees ?? [];
  if (!tees.length) return null;
  const toTee = Math.min(...tees.map((t) => distanceM(fix, t)));
  const green = spots.get(showing)?.green ?? null;
  const toGreen = green ? distanceM(fix, green) : null;
  if (toGreen != null && toGreen < ON_GREEN_M) return null;
  if (toTee <= TEE_RADIUS_M) return next;
  if (toGreen != null && toTee <= NEAR_TEE_M && toGreen >= OFF_GREEN_M && toTee < toGreen) return next;
  return null;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/**
 * The colour a hole gets on the round screen's hole strip (Oct 2026): eagle
 * or better gold, birdie red — the TV leaderboard's colours — anything else
 * just "scored". Gross against par, as the card marks it.
 */
export type StripMark = "eagle" | "birdie" | "scored";
export function stripMark(strokes: number | null | undefined, par: number): StripMark {
  if (strokes == null) return "scored";
  const d = strokes - par;
  return d <= -2 ? "eagle" : d === -1 ? "birdie" : "scored";
}
