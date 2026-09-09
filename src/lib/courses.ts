import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Club, ClubSummary } from "@/lib/types";
import { COUNTRY_CODES, type CountryCode } from "@/lib/regions";

/**
 * Reads for the Courses directory.
 *
 * ============ Why these queries live here and not in the pages ============
 *
 * The directory went from 373 club names bundled into the browser to ~3,000
 * rows in Postgres. That is the whole reason this file exists: the old
 * `/courses` page imported `CLUBS` from a JSON file and filtered it
 * client-side, which is fine for 373 strings and completely wrong for 3,000
 * records with a website, coordinates and a region each. England alone would
 * have been a several-hundred-kilobyte payload shipped on every page load,
 * before anyone typed a letter.
 *
 * So every list here is filtered, sorted and paged in the database, and the
 * page components receive only the rows they render.
 */

/** How many courses a country page shows before "load more". */
export const COURSES_PER_PAGE = 60;

const SUMMARY_COLUMNS = "id, slug, name, country, region, town, website, latitude, longitude, holes";

export type CourseListFilters = {
  country: CountryCode;
  region?: string;
  q?: string;
  page?: number;
};

export type CourseListResult = {
  courses: ClubSummary[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * One page of a country's courses, alphabetical.
 *
 * `q` matches on name *or* town, because "Ballybunion" and "Killarney" are
 * both things people type and only one of them is a club name. The trigram
 * index added in 0061 is what makes the leading-wildcard `ilike` viable
 * across a table this size.
 */
export async function listCourses(filters: CourseListFilters): Promise<CourseListResult> {
  const supabase = await createClient();
  const page = Math.max(1, filters.page ?? 1);
  const from = (page - 1) * COURSES_PER_PAGE;

  let query = supabase
    .from("clubs")
    .select(SUMMARY_COLUMNS, { count: "exact" })
    .eq("country", filters.country);

  if (filters.region) {
    query = query.eq("region", filters.region);
  }

  const search = filters.q?.trim();
  if (search) {
    // Escaped because a member typing "Ballybunion, Co. Kerry" would
    // otherwise inject a comma into PostgREST's `or` list and break the
    // whole filter rather than simply finding nothing.
    const escaped = search.replace(/[%,()]/g, " ").trim();
    if (escaped) {
      query = query.or(`name.ilike.%${escaped}%,town.ilike.%${escaped}%`);
    }
  }

  const { data, count } = await query
    .order("name", { ascending: true })
    .range(from, from + COURSES_PER_PAGE - 1)
    .returns<ClubSummary[]>();

  const total = count ?? 0;

  return {
    courses: data ?? [],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / COURSES_PER_PAGE)),
  };
}

/**
 * How many courses each country holds, for the /courses landing page.
 *
 * Five head-only counts rather than one grouped query: PostgREST has no
 * GROUP BY, and five counts against the `(country, region)` index are
 * cheaper than pulling 3,000 rows back to count them in JavaScript.
 */
export async function countCoursesByCountry(): Promise<Record<CountryCode, number>> {
  const supabase = await createClient();

  const entries = await Promise.all(
    COUNTRY_CODES.map(async (code) => {
      const { count } = await supabase
        .from("clubs")
        .select("id", { count: "exact", head: true })
        .eq("country", code);
      return [code, count ?? 0] as const;
    })
  );

  return Object.fromEntries(entries) as Record<CountryCode, number>;
}

/**
 * The regions of a country that actually have courses in them, with counts.
 *
 * Deliberately derived from the data rather than rendered from the full
 * region list in src/lib/regions.ts. Region coverage on imported rows is
 * partial — it comes from OSM address tags, which plenty of courses don't
 * carry — and offering all 48 English counties when only 30 have anything
 * behind them produces a filter that mostly returns nothing.
 */
export async function listRegionsWithCourses(
  country: CountryCode
): Promise<{ region: string; count: number }[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("clubs")
    .select("region")
    .eq("country", country)
    .not("region", "is", null)
    .returns<{ region: string }[]>();

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.region, (counts.get(row.region) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

/** A single course by its slug. Slugs are unique across all five countries. */
export async function getCourseBySlug(slug: string): Promise<Club | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("clubs")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Club>();

  return data ?? null;
}

/**
 * Members whose home club this is.
 *
 * Matched on `home_club_id`, not on the club's name: names are no longer
 * unique across five countries (0062), so a name match would show the
 * members of every "Manor Golf Club" on each of their pages.
 *
 * Returns an empty list for a signed-out visitor rather than throwing —
 * `profiles` is readable by authenticated members only, so this query
 * legitimately returns nothing to the public, and the course page renders a
 * "join to see who plays here" prompt in its place.
 */
export async function listMembersAtCourse(clubId: number, limit = 12) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, home_club, county, country, handicap, handicap_visible, avatar_url, avatar_color")
    .eq("home_club_id", clubId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

/** Count of members at a course, for the header line. */
export async function countMembersAtCourse(clubId: number): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("clubs")
    .select("id", { count: "exact", head: true })
    .eq("id", clubId);

  // Guard against a caller passing an id that no longer exists — the count
  // below is the one that matters, this one just proves the club is real.
  if (!count) return 0;

  const { count: members } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("home_club_id", clubId);

  return members ?? 0;
}

/**
 * Open tee-time invites at this course.
 *
 * Matched on `club_id` where it's set and falling back to `club_name`:
 * 0061 backfilled `club_id` for every existing invite, but the tee-time form
 * still writes the name today, so a newly posted invite can arrive with the
 * name and no id until that form is migrated.
 */
export async function listTeeTimesAtCourse(club: Pick<Club, "id" | "name">, limit = 6) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("tee_time_invites")
    .select("*")
    .or(`club_id.eq.${club.id},club_name.eq.${club.name}`)
    .eq("status", "open")
    .gte("play_date", new Date().toISOString().slice(0, 10))
    .order("play_date", { ascending: true })
    .limit(limit);

  return data ?? [];
}

/**
 * Club name/region suggestions for the home-club picker, scoped to a country.
 *
 * Capped at 20 because it feeds a dropdown someone reads, not a data export —
 * and because the old combobox shipped all 373 names to the browser and then
 * sliced 60 off the front, which is exactly what stops working at 3,000.
 */
export async function searchClubsInCountry(
  country: CountryCode,
  q: string,
  limit = 20
): Promise<ClubSummary[]> {
  const supabase = await createClient();
  const escaped = q.replace(/[%,()]/g, " ").trim();

  let query = supabase
    .from("clubs")
    .select(SUMMARY_COLUMNS)
    .eq("country", country)
    .order("name", { ascending: true })
    .limit(limit);

  if (escaped) {
    query = query.ilike("name", `%${escaped}%`);
  }

  const { data } = await query.returns<ClubSummary[]>();
  return data ?? [];
}

/** A club by id, for validating a submitted home club server-side. */
export async function getClubById(id: number): Promise<Club | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("clubs").select("*").eq("id", id).maybeSingle<Club>();
  return data ?? null;
}

/**
 * A maps link for a course.
 *
 * Coordinates when we have them — they point at the course itself rather
 * than at whatever a search engine guesses from the name — and a name search
 * when we don't, which is still better than no link at all. Google Maps
 * rather than an embedded map because an embed means a third-party script and
 * an API key on a page that is otherwise entirely server-rendered.
 */
export function mapsUrlFor(club: Pick<Club, "name" | "town" | "region" | "latitude" | "longitude">): string {
  if (club.latitude != null && club.longitude != null) {
    const query = encodeURIComponent(`${club.latitude},${club.longitude}`);
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }

  const parts = [club.name, club.town, club.region].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts)}`;
}

/** "Lahinch, Co. Clare" — the one-line location under a course's name. */
export function locationLine(club: Pick<Club, "town" | "region" | "country">): string | null {
  const parts = [club.town, club.region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
