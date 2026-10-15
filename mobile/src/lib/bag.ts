/**
 * My bag (Oct 2026, 0153) — pure, tested in bag.test.ts.
 *
 * A club's distance is what the member's own tagged shots say once there
 * are a few (median of the last year), else the number they typed in. The
 * suggestion is the club whose distance is nearest the plays-like number,
 * with the next one up when the shot sits between two.
 */

import { METRES_PER_YARD } from "./hole-geo";

export const CLUBS: ReadonlyArray<{ key: string; short: string; name: string }> = [
  { key: "driver", short: "D", name: "Driver" },
  { key: "3w", short: "3w", name: "3 wood" },
  { key: "5w", short: "5w", name: "5 wood" },
  { key: "7w", short: "7w", name: "7 wood" },
  { key: "2h", short: "2h", name: "2 hybrid" },
  { key: "3h", short: "3h", name: "3 hybrid" },
  { key: "4h", short: "4h", name: "4 hybrid" },
  { key: "5h", short: "5h", name: "5 hybrid" },
  { key: "6h", short: "6h", name: "6 hybrid" },
  { key: "2i", short: "2i", name: "2 iron" },
  { key: "3i", short: "3i", name: "3 iron" },
  { key: "4i", short: "4i", name: "4 iron" },
  { key: "5i", short: "5i", name: "5 iron" },
  { key: "6i", short: "6i", name: "6 iron" },
  { key: "7i", short: "7i", name: "7 iron" },
  { key: "8i", short: "8i", name: "8 iron" },
  { key: "9i", short: "9i", name: "9 iron" },
  { key: "pw", short: "PW", name: "Pitching wedge" },
  { key: "gw", short: "GW", name: "Gap wedge" },
  { key: "sw", short: "SW", name: "Sand wedge" },
  { key: "lw", short: "LW", name: "Lob wedge" },
];

export const clubInfo = (key: string) => CLUBS.find((c) => c.key === key) ?? { key, short: key, name: key };

/** A row of my_bag(). */
export type BagClub = {
  club: string;
  inBag: boolean;
  /** Typed in by the member. */
  yards: number | null;
  shots: number;
  medianM: number | null;
  lowM: number | null;
  highM: number | null;
};

/** Shots needed before the learned distance takes over from the typed one. */
export const LEARNED_FROM = 3;

/** The distance to go by for a club, in metres, or null if there's none. */
export function clubDistanceM(c: BagClub): number | null {
  if (c.medianM != null && c.shots >= LEARNED_FROM) return c.medianM;
  if (c.yards != null) return c.yards * METRES_PER_YARD;
  return c.medianM;
}

export type Suggestion = { club: BagClub; distanceM: number; /** The club up, when the shot is beyond this one's usual. */ longer: BagClub | null };

/** The club for a shot that plays like `targetM`, from the clubs in the bag. */
export function suggestClub(bag: readonly BagClub[], targetM: number): Suggestion | null {
  const usable = bag
    .filter((c) => c.inBag)
    .map((c) => ({ c, d: clubDistanceM(c) }))
    .filter((x): x is { c: BagClub; d: number } => x.d != null)
    .sort((a, b) => b.d - a.d);
  if (usable.length === 0) return null;
  // Too far for anything: the longest club. Shorter than everything: the shortest.
  let best = usable[0];
  for (const x of usable) if (Math.abs(x.d - targetM) < Math.abs(best.d - targetM)) best = x;
  const i = usable.indexOf(best);
  const longer = best.d < targetM - 4 && i > 0 ? usable[i - 1].c : null;
  return { club: best.c, distanceM: best.d, longer };
}

/** The clubs to offer when tagging a shot of `distanceM`: the likeliest first. */
export function likelyClubs(bag: readonly BagClub[], distanceM: number, n = 4): string[] {
  const inBag = bag.filter((c) => c.inBag);
  const withD = inBag.map((c) => ({ key: c.club, d: clubDistanceM(c) }));
  if (withD.every((x) => x.d == null)) {
    // Nothing known yet: offer a sensible default set for the distance.
    const guess = distanceM > 200 ? ["driver", "3w", "5w", "4h"] : distanceM > 150 ? ["5i", "6i", "4h", "7i"] : distanceM > 100 ? ["7i", "8i", "9i", "pw"] : ["pw", "gw", "sw", "lw"];
    const keys = inBag.length ? guess.filter((k) => inBag.some((c) => c.club === k)) : guess;
    return (keys.length ? keys : guess).slice(0, n);
  }
  return withD
    .filter((x) => x.d != null)
    .sort((a, b) => Math.abs(a.d! - distanceM) - Math.abs(b.d! - distanceM))
    .slice(0, n)
    .map((x) => x.key);
}
