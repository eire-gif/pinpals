import type { Club } from "./courses";
import { rateableCourses, toRate, type RateableCourse } from "./course-rating-rules";
import { clubsById, loadMyCourses, type ReviewTag } from "./onboarding";
import { supabase } from "./supabase";

/**
 * The reads behind Home's social sections (Oct 2026): the composer's face,
 * the courses waiting for the member's stars, and the latest reviews.
 * Posts for the photo strip and "most liked" live in feed.ts, beside the
 * rest of the post reading.
 */

export type Me = { firstName: string; name: string; avatarUrl: string | null; avatarColor: string | null };

/** Just enough of the member to put their face on the composer. */
export async function loadMe(userId: string): Promise<Me | null> {
  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name, avatar_url, avatar_color")
    .eq("id", userId)
    .maybeSingle<{ first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null }>();
  if (!data) return null;
  const firstName = (data.first_name ?? "").trim();
  return {
    firstName,
    name: `${firstName} ${data.last_name ?? ""}`.trim(),
    avatarUrl: data.avatar_url,
    avatarColor: data.avatar_color,
  };
}

/** Every course the member has played, with their rating — unrated first. */
export async function loadRateable(userId: string): Promise<RateableCourse<Club>[]> {
  const { played, ratings } = await loadMyCourses(userId);
  // A rated course counts as played even if the list row is missing (the
  // database adds it on review, but older reviews may predate that).
  const ids = [...new Set([...played, ...ratings.keys()])];
  const clubs = await clubsById(ids);
  clubs.sort((a, b) => a.name.localeCompare(b.name));
  return rateableCourses(clubs, ratings);
}

/** The first few played courses still without the member's stars. */
export async function loadCoursesToRate(userId: string, limit = 3): Promise<Club[]> {
  const { played, ratings } = await loadMyCourses(userId);
  if (played.size === 0) return [];
  const candidates = [...played].filter((id) => !ratings.has(id));
  if (candidates.length === 0) return [];
  const clubs = await clubsById(candidates.slice(0, 20));
  return toRate(clubs, ratings, limit);
}

export type LatestReview = {
  id: number;
  rating: number;
  body: string;
  tags: ReviewTag[];
  playedMonth: string | null;
  createdAt: string;
  club: { id: number; name: string };
  member: { firstName: string | null; lastName: string | null };
};

type LatestReviewRow = {
  id: number;
  rating: number;
  body: string | null;
  tags: ReviewTag[] | null;
  played_month: string | null;
  created_at: string;
  club: { id: number; name: string } | null;
  member: { first_name: string | null; last_name: string | null } | null;
};

/**
 * The newest reviews anyone has written with a comment — a bare star rating
 * makes a thin card. Hidden reviews are excluded outright: RLS would still
 * show the viewer their own, with a moderation note Home has no room for.
 */
export async function latestCourseReviews(limit = 8): Promise<LatestReview[]> {
  const { data } = await supabase
    .from("course_reviews")
    .select(
      `id, rating, body, tags, played_month, created_at,
       club:clubs ( id, name ),
       member:profiles!course_reviews_member_id_fkey ( first_name, last_name )`
    )
    .is("hidden_at", null)
    .not("body", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<LatestReviewRow[]>();

  const out: LatestReview[] = [];
  for (const row of data ?? []) {
    if (!row.club || !row.body?.trim()) continue;
    out.push({
      id: row.id,
      rating: row.rating,
      body: row.body.trim(),
      tags: row.tags ?? [],
      playedMonth: row.played_month,
      createdAt: row.created_at,
      club: row.club,
      member: { firstName: row.member?.first_name ?? null, lastName: row.member?.last_name ?? null },
    });
  }
  return out;
}
