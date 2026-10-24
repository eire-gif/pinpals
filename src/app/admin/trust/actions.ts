"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideByStaff, revokeVerification } from "@/lib/verification/server";

/**
 * /admin/trust (0188): the few things the automatic checks hand to a person.
 *   - a Verified golfer card the AI couldn't confirm: approve or reject
 *   - a disputed tee-time no-show: uphold (it counts) or overturn (it never did)
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function decideCard(formData: FormData, approve: boolean): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const memberId = String(formData.get("member_id") ?? "");
  if (!UUID.test(memberId)) return { error: "Unknown member." };
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const result = await decideByStaff({ admin: createAdminClient(), memberId, staffUserId: user.id, approve, reason });
  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: approve ? "verification.approved" : "verification.rejected",
    targetType: "user",
    targetId: memberId,
    outcome: result.ok ? "success" : "failure",
    metadata: reason ? { reason } : {},
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/trust");
  return { success: true };
}

export async function approveCard(_prev: ModerationState, formData: FormData) {
  return decideCard(formData, true);
}

export async function rejectCard(_prev: ModerationState, formData: FormData) {
  return decideCard(formData, false);
}

export async function revokeBadge(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const memberId = String(formData.get("member_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(memberId)) return { error: "Unknown member." };
  if (!reason) return { error: "Say why — it's recorded and shown to the member." };
  await revokeVerification(createAdminClient(), memberId, user.id, reason);
  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "verification.revoked",
    targetType: "user",
    targetId: memberId,
    outcome: "success",
    metadata: { reason },
  });
  revalidatePath("/admin/trust");
  return { success: true };
}

async function decideDispute(formData: FormData, uphold: boolean): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const id = Number(formData.get("attendance_id"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Unknown record." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tee_time_attendance")
    .update({ resolution: uphold ? "upheld" : "overturned", resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .is("resolution", null)
    .select("member_id, invite_id")
    .maybeSingle<{ member_id: string; invite_id: number }>();

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: uphold ? "attendance.upheld" : "attendance.overturned",
    targetType: "tee_time_attendance",
    targetId: String(id),
    outcome: error || !data ? "failure" : "success",
    metadata: {},
  });
  if (error || !data) return { error: "That has already been decided." };

  await admin.rpc("notify_user", {
    p_user_id: data.member_id,
    p_type: "tee_time_no_show_decided",
    p_title: uphold ? "Your dispute wasn't upheld" : "Your no-show has been removed",
    p_body: uphold
      ? "We looked at the round and the no-show stands on your record."
      : "We looked at the round and took the no-show off your record.",
    p_data: { href: `/tee-times/mine?invite=${data.invite_id}` },
    p_dedupe_key: `no_show_decided:${id}`,
  });

  revalidatePath("/admin/trust");
  return { success: true };
}

export async function upholdNoShow(_prev: ModerationState, formData: FormData) {
  return decideDispute(formData, true);
}

export async function overturnNoShow(_prev: ModerationState, formData: FormData) {
  return decideDispute(formData, false);
}
