/**
 * Which played courses to ask a member to rate. Pure — no React, no
 * Supabase — so the mobile vitest project can test it.
 */

export type RateableCourse<C> = { club: C; rating: number | null };

/**
 * Every played course with the member's rating (or null), unrated first,
 * each group in the order given. Home shows the first few unrated ones; the
 * Rate a course screen shows them all.
 */
export function rateableCourses<C extends { id: number }>(
  played: readonly C[],
  ratings: ReadonlyMap<number, number>
): RateableCourse<C>[] {
  const unrated: RateableCourse<C>[] = [];
  const rated: RateableCourse<C>[] = [];
  for (const club of played) {
    const rating = ratings.get(club.id);
    if (rating) rated.push({ club, rating });
    else unrated.push({ club, rating: null });
  }
  return [...unrated, ...rated];
}

/** Just the ones still waiting for stars, at most `limit`. */
export function toRate<C extends { id: number }>(
  played: readonly C[],
  ratings: ReadonlyMap<number, number>,
  limit: number
): C[] {
  return rateableCourses(played, ratings)
    .filter((c) => c.rating === null)
    .slice(0, limit)
    .map((c) => c.club);
}

/** "Declan M." — a first name and an initial, as reviews are signed. */
export function reviewerName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (!f && !l) return "A PinPals member";
  return l ? `${f} ${l[0].toUpperCase()}.`.trim() : f;
}

/** "Sep 2026" from "2026-09-01" — written out, not Intl (see feed-rules ago()). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}
