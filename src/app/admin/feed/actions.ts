"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

/**
 * Hide and restore for the member feed (0088) — the same "flag, never
 * delete" shape as hideReview()/restoreReview(), and for the same reason:
 * a report that led to removal has to leave something behind to review.
 *
 * A hidden post stays visible to its author with a line saying PinPals hid
 * it, so a member is never left wondering whether it failed to post. A
 * hidden comment leaves the post's comment count (the trigger in 0088
 * handles that), and stays visible to the person who wrote it.
 *
 * Service-role writes throughout: members have no grant on hidden_at at all.
 */

type Kind = "post" | "post_comment";

const TABLE: Record<Kind, "posts" | "post_comments"> = { post: "posts", post_comment: "post_comments" };
const NOUN: Record<Kind, string> = { post: "post", post_comment: "comment" };

async function setHidden(kind: Kind, hide: boolean, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const id = Number(formData.get("targetId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) return { error: `Missing ${NOUN[kind]} id.` };
  if (!reason) return { error: "A reason is required." };
  if (reason.length > 500) return { error: "Please keep the reason under 500 characters." };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from(TABLE[kind])
    .select("id, hidden_at")
    .eq("id", id)
    .maybeSingle<{ id: number; hidden_at: string | null }>();
  if (!row) return { error: `That ${NOUN[kind]} no longer exists.` };
  if (hide && row.hidden_at) return { error: `This ${NOUN[kind]} is already hidden.` };
  if (!hide && !row.hidden_at) return { error: `This ${NOUN[kind]} isn't hidden.` };

  const { error } = await admin
    .from(TABLE[kind])
    .update(
      hide
        ? { hidden_at: new Date().toISOString(), hidden_by: user.id, hidden_reason: reason }
        : { hidden_at: null, hidden_by: null, hidden_reason: null }
    )
    .eq("id", id);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: `${kind}.${hide ? "hide" : "restore"}`,
    targetType: kind,
    targetId: id,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : {},
  });

  if (error) return { error: `Couldn't ${hide ? "hide" : "restore"} that ${NOUN[kind]} — please try again.` };

  revalidatePath("/admin/feed");
  revalidatePath("/feed");
  return { success: true };
}

export async function hidePost(_prev: ModerationState, formData: FormData) {
  return setHidden("post", true, formData);
}

export async function restorePost(_prev: ModerationState, formData: FormData) {
  return setHidden("post", false, formData);
}

export async function hideComment(_prev: ModerationState, formData: FormData) {
  return setHidden("post_comment", true, formData);
}

export async function restoreComment(_prev: ModerationState, formData: FormData) {
  return setHidden("post_comment", false, formData);
}
