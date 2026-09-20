import { supabase } from "./supabase";
// Lives in tee-time-post.ts today because that form needed it first. Worth
// moving somewhere shared the moment a third caller appears; copying it here
// would be the wrong fix.
import { COUNTRY_NAMES } from "./tee-time-post";

/**
 * The course directory, read natively.
 *
 * `clubs` is world-readable — the same table the website's /courses browses
 * and the same one the tee-time form searches. Nothing here decides
 * visibility; there is nothing to decide.
 *
 * NO `clubs_near` RPC EXISTS. `invites_near` (0068) answers a different
 * question — which tee times are close — so the distance work happens here
 * instead: a bounding box narrows the query server-side, and haversine in JS
 * turns that square into an actual circle. At 2,655 rows that is cheap, and
 * it needs no migration.
 *
 * These queries mirror src/lib/courses.ts on the website deliberately, down
 * to the page size — a member who browses Scotland on the site and then in
 * the app should not find them disagreeing about what page two is.
 */

export type Club = {
  id: number;
  name: string;
  slug: string;
  country: string;
  region: string | null;
  town: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Only set by coursesNear(). */
  distance_km?: number;
};

// `holes` is in the table and is deliberately NOT selected. Three rows out of
// 2,655 have a value, so a "18 holes" line would be blank on 99.9% of cards —
// a column that exists is not the same as a fact worth showing.
const SELECT = "id, name, slug, country, region, town, latitude, longitude";

/** Same order as the website's country picker: home first. */
export const COUNTRY_CODES = [
  "ireland",
  "northern-ireland",
  "england",
  "scotland",
  "wales",
] as const;

export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;

/**
 * Where a club is, in one line — "Donabate · Ireland".
 *
 * `region` is null for all but fifteen rows in the whole table and `town` for
 * about six in ten, so for most clubs there is nothing to say but the
 * country.
 *
 * Which is why `hideCountry` exists. Browsing Ireland, a column of cards each
 * captioned "Ireland" is noise: it repeats the chip the member just tapped,
 * on every row, and buries the one in six that has something to add. With the
 * country suppressed this returns "" for those rows and the caller drops the
 * line rather than printing an empty one. In search and "near me" the results
 * span countries, so there the country is the point and stays.
 */
export const placeLabel = (club: Club, hideCountry = false): string => {
  const local = [club.town, club.region].filter(Boolean).join(", ");
  if (hideCountry) return local;
  const country = countryName(club.country);
  return local ? `${local} · ${country}` : country;
};

export const distanceLabel = (km?: number): string | null => {
  if (km === undefined) return null;
  return km < 1 ? "Under 1 km" : `${Math.round(km)} km away`;
};

/** Matches the website's COURSES_PER_PAGE. */
export const PAGE_SIZE = 60;

export type CoursePage = {
  clubs: Club[];
  /** Every club in the country, not just this page — it's the header line. */
  total: number;
  /** True when there is nothing after this page. */
  done: boolean;
};

/** One page of a country's clubs, alphabetical. `page` is zero-based. */
export async function listCourses(
  country: string,
  page = 0
): Promise<CoursePage> {
  const from = page * PAGE_SIZE;

  const { data, count, error } = await supabase
    .from("clubs")
    .select(SELECT, { count: "exact" })
    .eq("country", country)
    .order("name")
    .range(from, from + PAGE_SIZE - 1)
    .overrideTypes<Club[]>();

  if (error) throw error;

  const clubs = data ?? [];
  const total = count ?? 0;

  return { clubs, total, done: from + clubs.length >= total };
}

/**
 * PostgREST's `or()` takes a comma-separated filter string, so a comma or a
 * bracket inside the search term ends the clause early and the query either
 * errors or silently matches the wrong thing. "Ballybunion, Co. Kerry" is a
 * perfectly reasonable thing to type. Stripping them is blunt and right: no
 * club is found by typing a bracket.
 */
const sanitise = (query: string): string =>
  query
    .trim()
    .replace(/[%,()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Search, across every country at once.
 *
 * The country chips below the search box are a browsing aid; the search box
 * is not scoped by them. A member who types "Birkdale" while the chips say
 * Ireland means "find Birkdale", not "prove Birkdale isn't in Ireland" — and
 * the screen says out loud that a search looks everywhere.
 *
 * Name *or* town, because "Killarney" is a town with three clubs in it and
 * none of them is called Killarney alone. The trigram index from 0061 is
 * what makes the leading wildcard viable at this size.
 */
export async function searchCourses(query: string, limit = 60): Promise<Club[]> {
  const q = sanitise(query);
  if (q.length < 2) return [];

  const { data, error } = await supabase
    .from("clubs")
    .select(SELECT)
    .or(`name.ilike.%${q}%,town.ilike.%${q}%`)
    .order("name")
    .limit(limit)
    .overrideTypes<Club[]>();

  if (error) throw error;
  return data ?? [];
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type NearResult = {
  clubs: Club[];
  /** Everything inside the circle, before `limit` trims it — so the screen
   *  can say "200 nearest of 277" instead of quietly showing 200. */
  total: number;
};

/**
 * Clubs within `radiusKm`, nearest first.
 *
 * The box is a square and the answer is a circle, so the second filter below
 * is not belt and braces — without it a club 70 km away diagonally comes back
 * from a 50 km search. The box exists only to keep the query small.
 *
 * Sizes, measured against production: 50 km of London puts 307 clubs in the
 * box and 277 in the circle; Dublin 120 and 115; Belfast 67 and 62. So the
 * 1,000-row ceiling below is roughly triple the worst real case — it is there
 * to stop a pathological query, not to trim an ordinary one, which matters
 * because PostgREST would apply it before we know which rows are nearest.
 *
 * 109 Irish clubs have no coordinates at all and cannot appear here. That is
 * a gap in the imported data, not a bug in this function, and the screen says
 * so rather than letting a member conclude there is no golf near them.
 */
export async function coursesNear(
  lat: number,
  lng: number,
  radiusKm = 50,
  limit = 200
): Promise<NearResult> {
  const dLat = radiusKm / 111;
  // A degree of longitude shrinks towards the poles. The floor stops a
  // division by ~0 somewhere no golf is played.
  const dLng = radiusKm / (111 * Math.max(Math.cos(toRad(lat)), 0.05));

  const { data, error } = await supabase
    .from("clubs")
    .select(SELECT)
    .gte("latitude", lat - dLat)
    .lte("latitude", lat + dLat)
    .gte("longitude", lng - dLng)
    .lte("longitude", lng + dLng)
    .limit(1000)
    .overrideTypes<Club[]>();

  if (error) throw error;

  const inCircle = (data ?? [])
    .filter((club) => club.latitude !== null && club.longitude !== null)
    .map((club) => ({
      ...club,
      distance_km: distanceKm(lat, lng, club.latitude!, club.longitude!),
    }))
    .filter((club) => (club.distance_km ?? Infinity) <= radiusKm)
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

  return { clubs: inCircle.slice(0, limit), total: inCircle.length };
}

/**
 * How many members call each of these clubs home.
 *
 * This is the line that makes the directory a community rather than a phone
 * book: "Lahinch — 4 members play here" is the reason to tap a row. Matched
 * on `home_club_id` and never on the name, because names stopped being unique
 * across five countries in 0062 and every "Manor Golf Club" would otherwise
 * share one another's members.
 *
 * `profiles` is readable by signed-in members only, and every caller here is
 * past the auth gate. It still returns {} rather than throwing on error:
 * a missing badge is a smaller failure than a directory that won't load.
 */
export async function memberCounts(
  clubIds: number[]
): Promise<Record<number, number>> {
  if (clubIds.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("home_club_id")
    .in("home_club_id", clubIds)
    .overrideTypes<{ home_club_id: number | null }[]>();

  if (error || !data) return {};

  const counts: Record<number, number> = {};
  for (const row of data) {
    if (row.home_club_id === null) continue;
    counts[row.home_club_id] = (counts[row.home_club_id] ?? 0) + 1;
  }
  return counts;
}
