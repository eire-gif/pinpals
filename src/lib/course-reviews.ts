import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

/**
 * Course ratings and reviews (0093) — the server half, shared by the club
 * page's Server Actions and the app's /api/app/course-reviews routes.
 *
 * Reads and writes run as the member (their own client), so RLS and the
 * column grants on course_reviews decide what is allowed. Only reporting uses
 * the service role, because `reports` is not member-writable.
 */

export const REVIEW_TAGS = ["condition", "greens", "views", "welcome", "value", "pace"] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

export const REVIEW_TAG_LABELS: Record<ReviewTag, string> = {
  condition: "Course condition",
  greens: "Greens",
  views: "Views",
  welcome: "Welcome",
  value: "Value",
  pace: "Pace of play",
};

export const MAX_REVIEW_LENGTH = 1000;

export type CourseReview = {
  id: number;
  rating: number;
  body: string | null;
  tags: ReviewTag[];
  played_month: string | null;
  created_at: string;
  member_id: string;
  hidden_at: string | null;
  member: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
    avatar_color: string | null;
    home_club: string | null;
  } | null;
};

// Named FK: course_reviews has two references to profiles (member_id and
// hidden_by), so a bare `profiles(...)` embed is ambiguous and PostgREST
// refuses it.
const REVIEW_SELECT = `id, rating, body, tags, played_month, created_at, member_id, hidden_at,
  member:profiles!course_reviews_member_id_fkey ( first_name, last_name, avatar_url, avatar_color, home_club )`;

/** Most recent first. Hidden reviews come back only to their author (RLS). */
export async function listCourseReviews(
  supabase: SupabaseClient,
  clubId: number,
  limit = 20
): Promise<CourseReview[]> {
  const { data } = await supabase
    .from("course_reviews")
    .select(REVIEW_SELECT)
    .eq("club_id", clubId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as CourseReview[];
}

/** How many members have played it and have it on their bucket list. */
export async function courseListCounts(
  supabase: SupabaseClient,
  clubId: number
): Promise<{ played: number; bucket: number }> {
  const [played, bucket] = await Promise.all([
    supabase.from("member_courses").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("kind", "played"),
    supabase.from("member_courses").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("kind", "bucket"),
  ]);
  return { played: played.count ?? 0, bucket: bucket.count ?? 0 };
}

export async function myCourseState(
  supabase: SupabaseClient,
  userId: string,
  clubId: number
): Promise<{ played: boolean; bucket: boolean }> {
  const { data } = await supabase
    .from("member_courses")
    .select("kind")
    .eq("member_id", userId)
    .eq("club_id", clubId)
    .overrideTypes<{ kind: "played" | "bucket" }[]>();
  const kinds = new Set((data ?? []).map((r) => r.kind));
  return { played: kinds.has("played"), bucket: kinds.has("bucket") };
}

export type ReviewInput = {
  rating: number;
  body: string;
  tags: string[];
  /** "YYYY-MM" or "". */
  playedMonth: string;
};

export type ReviewResult = { ok: true } | { ok: false; error: string };

/** Turns form input into columns, or says what is wrong with it. */
export function parseReview(input: ReviewInput):
  | { ok: true; value: { rating: number; body: string | null; tags: ReviewTag[]; played_month: string | null } }
  | { ok: false; error: string } {
  const rating = Math.round(Number(input.rating));
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Choose a rating from one to five stars." };
  }
  const body = input.body.trim();
  if (body.length > MAX_REVIEW_LENGTH) {
    return { ok: false, error: `Please keep it under ${MAX_REVIEW_LENGTH} characters.` };
  }
  const tags = [...new Set(input.tags)].filter((t): t is ReviewTag => (REVIEW_TAGS as readonly string[]).includes(t));

  let playedMonth: string | null = null;
  if (input.playedMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.playedMonth)) {
      return { ok: false, error: "That month doesn't look right." };
    }
    playedMonth = `${input.playedMonth}-01`;
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    if (playedMonth > thisMonth) return { ok: false, error: "That month is in the future." };
  }

  return { ok: true, value: { rating, body: body || null, tags, played_month: playedMonth } };
}

/**
 * Create or replace the member's review of a course.
 *
 * Not an upsert: the member's UPDATE grant covers rating, body, tags and
 * played_month only, and an upsert puts club_id and member_id in its SET
 * list. Look, then insert or update.
 */
export async function saveCourseReview(
  supabase: SupabaseClient,
  userId: string,
  clubId: number,
  input: ReviewInput
): Promise<ReviewResult> {
  const parsed = parseReview(input);
  if (!parsed.ok) return parsed;

  const limit = await checkRateLimit({
    action: "course-review",
    identifier: userId,
    maxHits: 30,
    windowSeconds: 3600,
  });
  if (!limit.allowed) return { ok: false, error: rateLimitMessage(limit.retryAfterSeconds) };

  const { data: existing } = await supabase
    .from("course_reviews")
    .select("id")
    .eq("member_id", userId)
    .eq("club_id", clubId)
    .maybeSingle<{ id: number }>();

  const { error } = existing
    ? await supabase.from("course_reviews").update(parsed.value).eq("id", existing.id)
    : await supabase.from("course_reviews").insert({ club_id: clubId, member_id: userId, ...parsed.value });

  if (error) return { ok: false, error: "Couldn't save your review. Please try again." };
  return { ok: true };
}

export async function deleteCourseReview(supabase: SupabaseClient, userId: string, clubId: number): Promise<void> {
  await supabase.from("course_reviews").delete().eq("member_id", userId).eq("club_id", clubId);
}

export async function setCourseList(
  supabase: SupabaseClient,
  userId: string,
  clubId: number,
  kind: "played" | "bucket",
  on: boolean
): Promise<ReviewResult> {
  const { error } = on
    ? await supabase
        .from("member_courses")
        .upsert({ member_id: userId, club_id: clubId, kind }, { onConflict: "member_id,club_id,kind", ignoreDuplicates: true })
    : await supabase.from("member_courses").delete().eq("member_id", userId).eq("club_id", clubId).eq("kind", kind);
  return error ? { ok: false, error: "Couldn't update that. Please try again." } : { ok: true };
}

export const REVIEW_REPORT_CATEGORIES = ["spam", "harassment", "inappropriate_content", "other"] as const;

/**
 * Into the same moderation queue as every other report. The reporter must be
 * able to see the review they are reporting — a hidden one is not theirs to
 * report again.
 */
export async function reportCourseReview(input: {
  supabase: SupabaseClient;
  userId: string;
  reviewId: number;
  category: string;
  description?: string;
}): Promise<ReviewResult> {
  if (!(REVIEW_REPORT_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: "Please choose a reason." };
  }
  const description = (input.description ?? "").trim();
  if (description.length > 4000) return { ok: false, error: "Please keep the description under 4000 characters." };

  const limit = await checkRateLimit({
    action: "report-course-review",
    identifier: input.userId,
    maxHits: 20,
    windowSeconds: 3600,
  });
  if (!limit.allowed) return { ok: false, error: rateLimitMessage(limit.retryAfterSeconds) };

  const { data: visible } = await input.supabase
    .from("course_reviews")
    .select("id, member_id")
    .eq("id", input.reviewId)
    .is("hidden_at", null)
    .maybeSingle<{ id: number; member_id: string }>();
  if (!visible) return { ok: false, error: "That review is no longer available." };
  if (visible.member_id === input.userId) return { ok: false, error: "You can't report your own review." };

  const { error } = await createAdminClient().from("reports").insert({
    reporter_id: input.userId,
    target_type: "course_review",
    target_id: String(input.reviewId),
    category: input.category,
    description: description || null,
  });
  return error ? { ok: false, error: "Couldn't file that report — please try again." } : { ok: true };
}
