import { supabase } from "./supabase";
import type { Club } from "./courses";
import { loadMyProfile, saveMyProfile, type ProfileEdits } from "./profile";

/**
 * The profile builder a new member walks through after joining, and the
 * reads and writes behind it: courses played, the bucket list, ratings, how
 * often they play, and the PinPals we suggest.
 *
 * Direct writes, like connections and favourites already are: every one is a
 * member changing their own rows, RLS decides (0093), and nothing anybody
 * else needs telling about follows from them. Home club and handicap are the
 * exception — they go through saveMyProfile() and the website's validator,
 * because a home club has to be a real club in the right country.
 */

// ============ Home club and handicap ============

/**
 * Change a few profile fields without the member re-entering the rest.
 *
 * /api/app/profile replaces the whole profile — it is the edit-profile form's
 * endpoint — so this reads the current profile, applies the patch, and sends
 * the lot back. The website's validator then checks the home club exists and
 * is in the country given, exactly as for the full form.
 */
export async function patchProfile(userId: string, patch: Partial<ProfileEdits>): Promise<void> {
  const current = await loadMyProfile(userId);
  if (!current) throw new Error("Couldn't load your profile. Please try again.");

  await saveMyProfile({
    firstName: current.firstName,
    lastName: current.lastName,
    homeClubId: current.homeClubId,
    country: current.country,
    county: current.county ?? "",
    handicap: current.handicap === null ? "" : String(current.handicap),
    handicapVisible: current.handicapVisible,
    bio: current.bio ?? "",
    guiNumber: current.guiNumber ?? "",
    dateOfBirth: current.dateOfBirth ?? "",
    ageRangeVisible: current.ageRangeVisible,
    photo: null,
    removePhoto: false,
    ...patch,
  });
}

// ============ "Your game" ============

export const FREQUENCIES = [
  { code: "weekly", label: "Every week" },
  { code: "monthly", label: "A few times a month" },
  { code: "occasionally", label: "Now and then" },
] as const;

export type Frequency = (typeof FREQUENCIES)[number]["code"];

export const INTERESTS = [
  { code: "casual", label: "Casual rounds" },
  { code: "competitive", label: "Competitive golf" },
  { code: "society", label: "Society outings" },
  { code: "trips", label: "Golf trips away" },
  { code: "marketplace", label: "Buying & selling gear" },
  { code: "ladies", label: "Ladies golf" },
] as const;

export type Interest = (typeof INTERESTS)[number]["code"];

export async function saveGameDetails(
  userId: string,
  frequency: Frequency | null,
  interests: Interest[]
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ play_frequency: frequency, play_interests: interests })
    .eq("id", userId);
  if (error) throw new Error("Couldn't save that. Please try again.");
}

export async function loadGameDetails(
  userId: string
): Promise<{ frequency: Frequency | null; interests: Interest[] }> {
  const { data } = await supabase
    .from("profiles")
    .select("play_frequency, play_interests")
    .eq("id", userId)
    .maybeSingle<{ play_frequency: Frequency | null; play_interests: Interest[] | null }>();
  return { frequency: data?.play_frequency ?? null, interests: data?.play_interests ?? [] };
}

/**
 * Set when the member finishes or skips the last step. It answers "have we
 * walked them through it?", not "is the profile complete" — Home's
 * Finish-your-profile card looks at the profile for that.
 */
export async function markOnboarded(userId: string): Promise<void> {
  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId)
    .is("onboarded_at", null);
}

// ============ Courses played and the bucket list ============

export type CourseKind = "played" | "bucket";

/** The member's two lists, as sets of club ids. */
export async function loadMyCourses(
  userId: string
): Promise<{ played: Set<number>; bucket: Set<number>; ratings: Map<number, number> }> {
  const [{ data: lists }, { data: reviews }] = await Promise.all([
    supabase
      .from("member_courses")
      .select("club_id, kind")
      .eq("member_id", userId)
      .overrideTypes<{ club_id: number; kind: CourseKind }[]>(),
    supabase
      .from("course_reviews")
      .select("club_id, rating")
      .eq("member_id", userId)
      .overrideTypes<{ club_id: number; rating: number }[]>(),
  ]);

  const played = new Set<number>();
  const bucket = new Set<number>();
  for (const row of lists ?? []) (row.kind === "played" ? played : bucket).add(row.club_id);
  const ratings = new Map<number, number>((reviews ?? []).map((r) => [r.club_id, r.rating]));
  return { played, bucket, ratings };
}

export async function setCourse(
  userId: string,
  clubId: number,
  kind: CourseKind,
  on: boolean
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from("member_courses")
      .upsert(
        { member_id: userId, club_id: clubId, kind },
        { onConflict: "member_id,club_id,kind", ignoreDuplicates: true }
      );
    if (error) throw new Error("Couldn't save that course. Please try again.");
    return;
  }

  const { error } = await supabase
    .from("member_courses")
    .delete()
    .eq("member_id", userId)
    .eq("club_id", clubId)
    .eq("kind", kind);
  if (error) throw new Error("Couldn't update that course. Please try again.");
}

// ============ Ratings and reviews ============

export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Superb"] as const;

export const REVIEW_TAGS = [
  { code: "condition", label: "Course condition" },
  { code: "greens", label: "Greens" },
  { code: "views", label: "Views" },
  { code: "welcome", label: "Welcome" },
  { code: "value", label: "Value" },
  { code: "pace", label: "Pace of play" },
] as const;

export type ReviewTag = (typeof REVIEW_TAGS)[number]["code"];

export type ReviewDraft = {
  rating: number;
  body?: string | null;
  tags?: ReviewTag[];
  /** "YYYY-MM-01", or null. */
  playedMonth?: string | null;
};

/**
 * Write the member's review of a course, creating or replacing it.
 *
 * NOT an upsert. The member's column grant on course_reviews (0093) covers
 * rating, body, tags and played_month on UPDATE — not club_id or member_id —
 * and an upsert names every column in its SET list, so Postgres refuses it.
 * Look first, then insert or update.
 *
 * Writing a review also records the course as played; the database does that
 * (course_reviews_after_change), so it cannot be forgotten here.
 */
export async function saveReview(userId: string, clubId: number, draft: ReviewDraft): Promise<void> {
  const fields: Record<string, unknown> = { rating: draft.rating };
  if (draft.body !== undefined) fields.body = draft.body?.trim() ? draft.body.trim() : null;
  if (draft.tags !== undefined) fields.tags = draft.tags;
  if (draft.playedMonth !== undefined) fields.played_month = draft.playedMonth;

  const { data: existing } = await supabase
    .from("course_reviews")
    .select("id")
    .eq("member_id", userId)
    .eq("club_id", clubId)
    .maybeSingle<{ id: number }>();

  const { error } = existing
    ? await supabase.from("course_reviews").update(fields).eq("id", existing.id)
    : await supabase.from("course_reviews").insert({ club_id: clubId, member_id: userId, ...fields });

  if (error) throw new Error("Couldn't save your rating. Please try again.");
}

export async function deleteReview(userId: string, clubId: number): Promise<void> {
  await supabase.from("course_reviews").delete().eq("member_id", userId).eq("club_id", clubId);
}

// ============ Courses worth offering ============

/**
 * Courses most Irish golfers have either played or want to — offered on the
 * Played and Bucket list steps so nobody faces an empty search box.
 *
 * Ids, not names, because the directory holds duplicates for several of these
 * (an early seed row and a later OpenStreetMap row: two Old Heads, four
 * Portmarnocks). These are the rows chosen as canonical on 4 Oct 2026 — the
 * ones with coordinates. When the duplicates are merged, this list should
 * follow the survivors. See claude/onboarding-flow-design.md.
 */
export const FEATURED_CLUB_IDS = [
  219, // Lahinch
  26, // Ballybunion
  611, // Old Head Golf Links
  307, // Royal County Down
  309, // Royal Portrush
  343, // The European Club
  362, // Waterville
  605, // Portmarnock
  72, // Carne
  155, // Enniscrone
  115, // County Sligo
  33, // Ballyliffin
  299, // Rosapenna
  351, // Tralee
  657, // Adare Manor
  650, // Doonbeg
  308, // Royal Dublin
  135, // Druids Glen
] as const;

const CLUB_SELECT =
  "id, name, slug, country, region, town, latitude, longitude, rating_count, rating_avg";

export async function clubsById(ids: readonly number[]): Promise<Club[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("clubs")
    .select(CLUB_SELECT)
    .in("id", ids as number[])
    .overrideTypes<Club[]>();
  const byId = new Map<number, Club>((data ?? []).map((c) => [c.id, c]));
  // Keep the caller's order — the list above is in a deliberate order.
  const ordered: Club[] = [];
  for (const id of ids) {
    const club = byId.get(id);
    if (club) ordered.push(club);
  }
  return ordered;
}

// ============ Suggested PinPals ============

export type Suggestion = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  avatar_color: string | null;
  home_club: string | null;
  home_club_id: number | null;
  handicap: number | null;
  same_club: boolean;
  distance_km: number | null;
  shared_courses: number;
};

/** Ranked server-side by suggested_pinpals() (0093): same club, then near, then shared courses. */
export async function suggestedPinPals(limit = 20, radiusKm = 25): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc("suggested_pinpals", {
    p_limit: limit,
    p_radius_km: radiusKm,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Suggestion[]).map((s) => ({
    ...s,
    distance_km: s.distance_km === null ? null : Number(s.distance_km),
    handicap: s.handicap === null ? null : Number(s.handicap),
  }));
}

/** The one line under a suggestion's name that says why they're there. */
export function suggestionReason(s: Suggestion): string {
  if (s.same_club) return "Same home club";
  if (s.distance_km !== null && s.distance_km <= 25) {
    return `${Math.max(1, Math.round(s.distance_km))} km from your club`;
  }
  if (s.shared_courses > 0) {
    return s.shared_courses === 1 ? "A course in common" : `${s.shared_courses} courses in common`;
  }
  return "Plays near you";
}
