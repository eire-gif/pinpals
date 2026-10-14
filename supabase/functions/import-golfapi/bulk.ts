// Bulk import decisions — pure, tested in bulk.test.ts. Oct 2026.
//
// The single-club `search` → `import` flow leaves the match to a person.
// Doing that 3,201 times isn't realistic, so `bulk` decides on its own —
// but only when there is no real doubt, and anything else goes on a review
// list without spending another call:
//
//   - golfapi gives locations: exactly ONE club within MATCH_KM of ours →
//     that club; none, two or more, or our club has no location → review
//   - no locations (the usual case): exactly ONE club with the same name →
//     that club; none or two or more → review
//   - the matched club has 1–3 courses → import them all (tee names are
//     prefixed with the course name when there's more than one)
//   - more than 3 courses (Malahide, Donabate: every combination of their
//     loops) → review, so staff pick the combination members actually play
//
// Distance decides when golfapi gives a location. Its search results don't
// (seen 14 Oct 2026: lat/lng absent), and then the NAME decides instead:
// exactly one candidate whose name, without the generic words ("Golf Club",
// "The", "GC"…), is the same as ours. "Grange Golf Club" picks Grange GC
// (Rathfarnham) over Grange Castle; two exact matches go to review.

import type { ClubCandidate } from "./mapping.ts";

export const MATCH_KM = 2;
export const MAX_AUTO_COURSES = 3;

/** Countries in the order the bulk run works through them. */
export const COUNTRY_ORDER = ["ireland", "northern-ireland", "england", "scotland", "wales", "spain", "portugal"] as const;

export type Located = ClubCandidate & { km_away: number | null };

export type Decision =
  | { kind: "import"; candidate: Located; courseIds: string[] }
  | { kind: "review"; reason: string; candidates: Located[] };

/** A club name without the words every club has, for comparing names. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(golf|country|club|clube|links|course|courses|resort|and|the|gc|g c|de|del|la|el|campo|real)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What to do with one of our clubs, given golfapi's search results. */
export function decide(candidates: Located[], clubHasLocation: boolean, clubName: string): Decision {
  if (candidates.length === 0) return { kind: "review", reason: "not found on golfapi", candidates };

  let match: Located;
  if (candidates.some((c) => c.lat != null && c.lng != null)) {
    if (!clubHasLocation) return { kind: "review", reason: "our club has no location to check the match against", candidates };
    const near = candidates.filter((c) => c.km_away != null && c.km_away <= MATCH_KM);
    if (near.length === 0) {
      const nearest = candidates.find((c) => c.km_away != null);
      return { kind: "review", reason: `no golfapi club within ${MATCH_KM} km (nearest is ${nearest?.km_away} km away)`, candidates };
    }
    if (near.length > 1) return { kind: "review", reason: `${near.length} golfapi clubs within ${MATCH_KM} km`, candidates };
    match = near[0];
  } else {
    const key = nameKey(clubName);
    const same = key ? candidates.filter((c) => nameKey(c.name) === key) : [];
    if (same.length === 0) return { kind: "review", reason: `no golfapi club with the same name (${candidates.length} similar)`, candidates };
    if (same.length > 1) return { kind: "review", reason: `${same.length} golfapi clubs with the same name`, candidates };
    match = same[0];
  }

  const courseIds = match.courses.map((c) => c.providerCourseId).filter(Boolean);
  if (courseIds.length === 0) return { kind: "review", reason: "golfapi lists no courses for this club", candidates: [match] };
  if (courseIds.length > MAX_AUTO_COURSES)
    return { kind: "review", reason: `${courseIds.length} courses (loop combinations?) — pick the one members play`, candidates: [match] };
  return { kind: "import", candidate: match, courseIds };
}

/** golfapi calls a club costs: the search(es) plus one per course, no GPS. */
export function clubCost(searches: number, courses: number): number {
  return Math.round((searches * 0.1 + courses) * 10) / 10;
}

/** The name sent to golfapi's search: our name without the generic words. */
export const searchName = (name: string) =>
  name.replace(/\b(golf|country|club|links|course|resort|and|&|the|gc|g\.c\.)\b/gi, " ").replace(/\s+/g, " ").trim() || name;
