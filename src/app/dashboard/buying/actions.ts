"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  return { success: true };
}
