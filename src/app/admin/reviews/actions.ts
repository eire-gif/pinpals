"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

/**
 * hideReview()/restoreReview() — the "support report/moderation without
 * silent deletion" requirement for reviews. Exactly the hidden_at/hidden_by/
 * hidden_reason toggle hideMessage()/restoreMessage() already use for
 * messages (src/app/admin/reports/[id]/actions.ts): the row itself, and its
 * rating/body, is never touched or deleted, only flagged. Reviews differ
 * from messages in one way that matters here — reviews still have an
 * authenticated UPDATE policy (a reviewer can edit their own rating/body),
 * so a non-staff caller is blocked from touching these three columns by a
 * dedicated `prevent_review_moderation_tampering()` trigger (0056) rather
 * than by the complete absence of an UPDATE policy the way messages relies
 * on — these actions still go through the service-role client regardless,
 * same as every other admin mutation in this app.
 */

function revalidateReviewViews() {
  revalidatePath("/admin/reviews");
}

export async function hideReview(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reviewId = Number(formData.get("reviewId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reviewId || Number.isNaN(reviewId)) return { error: "Missing review id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: review } = await admin.from("reviews").select("id, hidden_at").eq("id", reviewId).maybeSingle();
  if (!review) return { error: "Review not found." };
  if (review.hidden_at) return { error: "This review is already hidden." };

  const { error } = await admin
    .from("reviews")
    .update({ hidden_at: new Date().toISOString(), hidden_by: user.id, hidden_reason: reason })
    .eq("id", reviewId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "review.hide",
    targetType: "review",
    targetId: reviewId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : {},
  });

  if (error) return { error: "Couldn't hide this review — please try again." };

  revalidateReviewViews();
  return { success: true };
}

export async function restoreReview(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reviewId = Number(formData.get("reviewId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reviewId || Number.isNaN(reviewId)) return { error: "Missing review id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: review } = await admin.from("reviews").select("id, hidden_at").eq("id", reviewId).maybeSingle();
  if (!review) return { error: "Review not found." };
  if (!review.hidden_at) return { error: "This review isn't hidden." };

  const { error } = await admin
    .from("reviews")
    .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
    .eq("id", reviewId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "review.restore",
    targetType: "review",
    targetId: reviewId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : {},
  });

  if (error) return { error: "Couldn't restore this review — please try again." };

  revalidateReviewViews();
  return { success: true };
}
