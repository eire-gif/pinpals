/**
 * The handicap indicator (0122): what the World Handicap System would make
 * of a member's last 20 scorecards. The database works it out
 * (handicap_differentials_of / handicap_indicator_of); this file only
 * explains it on screen, so it must agree with the SQL's table.
 *
 * Pure, no imports — tested in handicap-indicator.test.ts.
 *
 *   eligible   18 holes, course rating and slope on the card, 14+ holes scored
 *   per hole   capped at net double bogey (par + 2 + strokes received);
 *              no index anywhere: par + 5; no score on a hole: net double bogey
 *   card       differential = 113 / slope × (adjusted gross − course rating)
 *   indicator  average of the best N of the last 20, adjusted for small
 *              numbers of cards, to one decimal, 54.0 at most
 */

/** Fewer than this many eligible cards: no indicator. */
export const INDICATOR_MIN_ROUNDS = 3;
export const INDICATOR_WINDOW = 20;

/** WHS: how many of the latest `rounds` differentials count, and the adjustment. */
export function bestOf(rounds: number): { count: number; adjustment: number } | null {
  const n = Math.min(Math.max(0, Math.floor(rounds)), INDICATOR_WINDOW);
  if (n < INDICATOR_MIN_ROUNDS) return null;
  if (n === 3) return { count: 1, adjustment: -2 };
  if (n === 4) return { count: 1, adjustment: -1 };
  if (n === 5) return { count: 1, adjustment: 0 };
  if (n === 6) return { count: 2, adjustment: -1 };
  if (n <= 8) return { count: 2, adjustment: 0 };
  if (n <= 11) return { count: 3, adjustment: 0 };
  if (n <= 14) return { count: 4, adjustment: 0 };
  if (n <= 16) return { count: 5, adjustment: 0 };
  if (n <= 18) return { count: 6, adjustment: 0 };
  if (n === 19) return { count: 7, adjustment: 0 };
  return { count: 8, adjustment: 0 };
}

/** "Best 8 of your last 20 scorecards", "Best 1 of 3, less 2.0". */
export function bestOfLabel(rounds: number, whose: "your" | "their" = "your"): string {
  const rule = bestOf(rounds);
  if (!rule) {
    const more = INDICATOR_MIN_ROUNDS - Math.max(0, rounds);
    return `${more} more 18-hole ${more === 1 ? "scorecard" : "scorecards"} with a course rating and slope to go`;
  }
  const n = Math.min(rounds, INDICATOR_WINDOW);
  const base = n === INDICATOR_WINDOW ? `Best 8 of ${whose} last 20 scorecards` : `Best ${rule.count} of ${n} ${n === 1 ? "scorecard" : "scorecards"}`;
  return rule.adjustment < 0 ? `${base}, less ${Math.abs(rule.adjustment).toFixed(1)}` : base;
}

/** "12.4", "+1.2" (a plus handicap), always one decimal — an index, not a course handicap. */
export function indicatorLabel(index: number): string {
  if (index < 0) return `+${Math.abs(index).toFixed(1)}`;
  return index.toFixed(1);
}

/**
 * How the indicator compares with the handicap a member set themselves, in
 * words, or null when there's nothing worth saying. Half a shot either way
 * is noise.
 */
export function comparedWithOwn(indicator: number | null, own: number | null): string | null {
  if (indicator == null || own == null) return null;
  const gap = Math.round((indicator - own) * 10) / 10;
  if (Math.abs(gap) < 0.5) return "In line with your handicap";
  return gap < 0 ? `${Math.abs(gap).toFixed(1)} lower than your handicap` : `${gap.toFixed(1)} higher than your handicap`;
}
