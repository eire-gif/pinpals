"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

/**
 * Hide and restore for course reviews (0093) — the same "flag, never delete"
 * shape as the marketplace reviews and the feed. A hidden review drops out of
 * the club's average (the roll-up trigger excludes it) and out of every view
 * but its author's, who is told it was hidden.
 *
 * Service role throughout: members have no grant on hidden_at at all.
 */
async function setHidden(hide: boolean, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const id = Number(formData.get("reviewId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) return { error: "Missing review id." };
  if (!reason) return { error: "A reason is required." };
  if (reason.length > 500) return { error: "Please keep the reason under 500 characters." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("course_reviews")
    .select("id, hidden_at")
    .eq("id", id)
    .maybeSingle<{ id: number; hidden_at: string | null }>();
  if (!row) return { error: "That review no longer exists." };
  if (hide && row.hidden_at) return { error: "This review is already hidden." };
  if (!hide && !row.hidden_at) return { error: "This review isn't hidden." };

  const { error } = await admin
    .from("course_reviews")
    .update(
      hide
        ? { hidden_at: new Date().toISOString(), hidden_by: user.id, hidden_reason: reason }
        : { hidden_at: null, hidden_by: null, hidden_reason: null }
    )
    .eq("id", id);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: hide ? "course_review.hide" : "course_review.restore",
    targetType: "course_review",
    targetId: id,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : {},
  });

  if (error) return { error: `Couldn't ${hide ? "hide" : "restore"} that review — please try again.` };
  revalidatePath("/admin/course-reviews");
  return { success: true };
}

export async function hideCourseReview(_prev: ModerationState, formData: FormData) {
  return setHidden(true, formData);
}

export async function restoreCourseReview(_prev: ModerationState, formData: FormData) {
  return setHidden(false, formData);
}
