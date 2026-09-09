"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { REVIEW_REPORT_CATEGORIES, parseEvidenceRefs, type ReportCategory } from "@/lib/admin/reports";
import type { Review } from "@/lib/types";

export type ReviewReportState = { error?: string; success?: boolean };

const REPORT_REVIEW_MAX_ATTEMPTS = 10; // same window/shape as every other report-* rate limit in this app
const REPORT_REVIEW_WINDOW_SECONDS = 60 * 60;

// The task spec's "review actions". A plain, regular-client INSERT — no
// service-role client, no re-implemented eligibility check here at all.
// reviews' own RLS ("participants can review their completed orders",
// 0041_reviews.sql) plus its validate_review() trigger already enforce
// everything that matters (the order must be status='completed', and
// reviewer/reviewee must actually be that order's buyer/seller) — this
// action's only job is shaping the insert and turning a constraint
// violation into a friendly message, never pre-checking those rules itself
// in TS (which would just be a second copy that could drift from the DB's
// own, same discipline as everywhere else in this schema).
export async function submitReview(
  orderId: number,
  revieweeId: string,
  rating: number,
  body: string
): Promise<{ error: string } | { success: true }> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Choose a rating between 1 and 5 stars." };
  }
  const trimmedBody = body.trim();
  if (trimmedBody.length > 2000) {
    return { error: "Reviews can be at most 2000 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to leave a review." };

  const { error } = await supabase.from("reviews").insert({
    order_id: orderId,
    reviewer_id: user.id,
    reviewee_id: revieweeId,
    rating,
    body: trimmedBody || null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You've already reviewed this order." };
    }
    return {
      error: "Couldn't submit your review — the order needs to be completed and you can only review your own orders.",
    };
  }

  revalidatePath("/dashboard/buying");
  // submitReview() is reused as-is by the seller-facing sales-history tab
  // (LeaveReviewForm there posts through this same action — see
  // src/app/dashboard/selling/sales-history-tab.tsx's own comment on why),
  // so both tabs need to stop showing the "leave a review" form once one is
  // posted, not just the buyer's own.
  revalidatePath("/dashboard/selling");
  return { success: true };
}

/**
 * The member-facing report entry point for `target_type = 'review'`
 * (marketplace-notifications-reviews, 0056) — same "anyone who can see the
 * content can report it" shape as reportListing() (src/app/marketplace/[id]/
 * actions.ts), not the participancy-gated shape reportUser()/reportMessage()
 * use, since a review (like a listing) is public content rather than a
 * private conversation. The RLS-scoped select below IS the participancy
 * check: reviews' own SELECT policy (0056) already excludes a hidden review
 * from this read for anyone but its reviewer/reviewee/staff, so a stranger
 * reporting an already-hidden review just gets "Review not found" — there's
 * nothing left to escalate that isn't already actioned.
 */
export async function reportReview(reviewId: number, _prev: ReviewReportState, formData: FormData): Promise<ReviewReportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to report a review." };

  const rateLimit = await checkRateLimit({
    action: "report-review",
    identifier: user.id,
    maxHits: REPORT_REVIEW_MAX_ATTEMPTS,
    windowSeconds: REPORT_REVIEW_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const category = String(formData.get("category") ?? "") as ReportCategory;
  const description = String(formData.get("description") ?? "").trim();
  const evidenceRefs = parseEvidenceRefs(String(formData.get("evidence") ?? ""));

  if (!REVIEW_REPORT_CATEGORIES.includes(category)) return { error: "Please choose a reason." };
  if (description.length > 4000) return { error: "Please keep the description under 4000 characters." };

  const { data: review } = await supabase
    .from("reviews")
    .select("id")
    .eq("id", reviewId)
    .maybeSingle<Pick<Review, "id">>();
  if (!review) return { error: "Review not found." };

  const admin = createAdminClient();
  const { error } = await admin.from("reports").insert({
    reporter_id: user.id,
    target_type: "review",
    target_id: String(reviewId),
    category,
    description: description || null,
    evidence_refs: evidenceRefs.length ? evidenceRefs : null,
  });

  if (error) return { error: "Couldn't file that report — please try again." };

  return { success: true };
}
