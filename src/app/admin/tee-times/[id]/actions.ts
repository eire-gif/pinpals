"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

export async function cancelInvite(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const inviteId = Number(formData.get("inviteId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!inviteId || Number.isNaN(inviteId)) return { error: "Missing invite id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("tee_time_invites")
    .select("status")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite) return { error: "Invite not found." };
  if (invite.status === "cancelled" || invite.status === "completed") {
    return { error: `This invite is already "${invite.status}".` };
  }

  const { error } = await admin.from("tee_time_invites").update({ status: "cancelled" }).eq("id", inviteId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "invite.cancel",
    targetType: "tee_time_invite",
    targetId: inviteId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't cancel this invite — please try again." };
  }

  revalidatePath(`/admin/tee-times/${inviteId}`);
  revalidatePath("/admin/tee-times");
  return { success: true };
}

export async function restoreInvite(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const inviteId = Number(formData.get("inviteId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!inviteId || Number.isNaN(inviteId)) return { error: "Missing invite id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("tee_time_invites")
    .select("status, expires_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (!invite) return { error: "Invite not found." };
  if (invite.status !== "cancelled") {
    return { error: `Only cancelled invites can be restored (this one is "${invite.status}").` };
  }

  // Restoring a since-expired invite as "open" would resurrect something a
  // member could no longer act on in the normal browse flow — land it on
  // "completed" instead when its expiry has already passed, "open" otherwise.
  const restoredStatus = invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()
    ? "completed"
    : "open";

  const { error } = await admin
    .from("tee_time_invites")
    .update({ status: restoredStatus })
    .eq("id", inviteId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "invite.restore",
    targetType: "tee_time_invite",
    targetId: inviteId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { restoredStatus },
  });

  if (error) {
    return { error: "Couldn't restore this invite — please try again." };
  }

  revalidatePath(`/admin/tee-times/${inviteId}`);
  revalidatePath("/admin/tee-times");
  return { success: true };
}
