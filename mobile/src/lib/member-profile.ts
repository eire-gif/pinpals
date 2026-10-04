import { countryName } from "./courses";
import { sortCourses, toRoundRow, type ProfileCourse, type RoundRow } from "./profile-sections";
import { supabase } from "./supabase";

/**
 * The reads behind a member page's Rounds and Courses sections (phase 10).
 * Reads only, straight to Supabase under the reader's own RLS — the rules
 * are in profile-sections.ts's header. Posts, Highlights and Achievements
 * read through feed.ts loadMemberPosts(), because they draw full post cards.
 */

/** Enough for every member's history on a phone; the list isn't paged. */
const ROUNDS_LIMIT = 100;

/** The member's round posts this reader may see, newest first, as rows.
 *  Before 0095 (no kind/details columns) there are none. */
export async function loadMemberRounds(memberId: string): Promise<RoundRow[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("id, created_at, details, club:clubs ( id, name )")
    .eq("author_id", memberId)
    .eq("kind", "round")
    .is("hidden_at", null)
    .order("created_at", { ascending: false })
    .limit(ROUNDS_LIMIT)
    .overrideTypes<{ id: number; created_at: string; details: unknown; club: { id: number; name: string } | null }[]>();
  if (error) return [];
  return (data ?? []).map(toRoundRow).filter((r): r is RoundRow => r !== null);
}

type CourseRow = {
  club_id: number;
  kind: "played" | "bucket";
  club: { id: number; name: string; town: string | null; country: string } | null;
};

/** Courses played and the bucket list, each with the member's own rating. */
export async function loadMemberCourses(
  memberId: string,
  homeClubId: number | null
): Promise<{ played: ProfileCourse[]; bucket: ProfileCourse[] }> {
  const [{ data: lists }, { data: reviews }] = await Promise.all([
    supabase
      .from("member_courses")
      .select("club_id, kind, club:clubs ( id, name, town, country )")
      .eq("member_id", memberId)
      .overrideTypes<CourseRow[]>(),
    // Hidden reviews are invisible to everyone but their author (0093), so
    // a moderated rating never shows up here for anyone else.
    supabase
      .from("course_reviews")
      .select("club_id, rating")
      .eq("member_id", memberId)
      .overrideTypes<{ club_id: number; rating: number }[]>(),
  ]);
  const ratings = new Map((reviews ?? []).map((r) => [r.club_id, r.rating]));
  const played: ProfileCourse[] = [];
  const bucket: ProfileCourse[] = [];
  for (const row of lists ?? []) {
    if (!row.club) continue;
    const course: ProfileCourse = {
      clubId: row.club.id,
      name: row.club.name,
      place: [row.club.town, countryName(row.club.country)].filter(Boolean).join(", ") || null,
      rating: row.kind === "played" ? (ratings.get(row.club.id) ?? null) : null,
      home: row.club.id === homeClubId,
    };
    (row.kind === "played" ? played : bucket).push(course);
  }
  return { played: sortCourses(played), bucket: sortCourses(bucket) };
}
