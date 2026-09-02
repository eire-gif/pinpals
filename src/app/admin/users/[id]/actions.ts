"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";

// Suspension is enforced via Supabase Auth's own ban mechanism
// (`auth.admin.updateUserById(..., { ban_duration })`), not a new column on
// `profiles`. That means it's real enforcement from day one — a banned user
// can't log in or refresh a session — without a migration or any RLS change,
// and it reuses the same Auth admin client this file already trusts for
// listUsers() elsewhere in src/lib/admin/queries.ts.
//
// There is no "forever" duration in the Auth admin API, so an indefinite
// suspension uses a very long one instead — the same convention widely used
// for "permanent" bans built on a duration-based API. reinstateUser() clears
// it with ban_duration: "none".
const SUSPEND_DURATION = "876000h"; // ~100 years

export async function suspendUser(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!reason) return { error: "A reason is required." };
  if (targetId === user.id) return { error: "You can't suspend your own account." };

  const admin = createAdminClient();

  // Staff accounts are out of scope for this action — moderating a colleague
  // this way would be an easy route to locking out another admin. Role/staff
  // management is a separate, not-yet-built feature.
  const { data: targetStaff } = await admin
    .from("staff_roles")
    .select("user_id")
    .eq("user_id", targetId)
    .maybeSingle();
  if (targetStaff) {
    return { error: "Staff accounts can't be suspended from here." };
  }

  const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: SUSPEND_DURATION });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.suspend",
    targetType: "user",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't suspend this user — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function reinstateUser(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.reinstate",
    targetType: "user",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't reinstate this user — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  revalidatePath("/admin/users");
  return { success: true };
}
