"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { findStaffGrantCandidates } from "@/lib/admin/queries";
import { STAFF_ROLES, type StaffRole } from "@/lib/admin/roles";
import type { ModerationState } from "@/lib/admin/moderation";
import { isSelfTargeted, wouldRemoveLastActiveSuperAdmin, type StaffMemberRow } from "@/lib/admin/staff-management";

// Every mutation in this file is restricted to super_admin — see
// admin-architecture-review.md §6 ("super_admin — ... manage other admin
// accounts/roles") — and re-checks requireStaff() itself rather than relying
// on the page's own guard, same discipline every other admin action.ts in
// this app follows (see suspendUser() in
// src/app/admin/users/[id]/actions.ts for the precedent).

export type GrantStaffState = {
  error?: string;
  success?: boolean;
  candidates?: { id: string; name: string; email: string | null }[];
};

async function loadAllStaffRows(admin: ReturnType<typeof createAdminClient>): Promise<StaffMemberRow[]> {
  const { data, error } = await admin.from("staff_roles").select("user_id, role, status").returns<StaffMemberRow[]>();
  if (error) throw new Error(`Failed to load staff roles: ${error.message}`);
  return data ?? [];
}

// No invitation-by-arbitrary-client-input: the "member" field is never
// trusted as-is — it's resolved through findStaffGrantCandidates() (the same
// email-then-name lookup /admin/support/new uses for its own requester
// field), which only ever returns real, existing profiles rows. Granting
// requires exactly one match; more than one is a disambiguation error, never
// a guess.
export async function grantStaffRole(_prev: GrantStaffState, formData: FormData): Promise<GrantStaffState> {
  const { user, staff } = await requireStaff({ roles: ["super_admin"] });

  const memberQuery = String(formData.get("member") ?? "").trim();
  const role = String(formData.get("role") ?? "") as StaffRole;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!memberQuery) return { error: "Enter the member's email or name." };
  if (!(STAFF_ROLES as readonly string[]).includes(role)) return { error: "Choose a role." };
  if (!reason) return { error: "A reason is required." };

  const candidates = await findStaffGrantCandidates(memberQuery);
  if (candidates.length === 0) {
    return { error: "No member matched that email or name." };
  }
  if (candidates.length > 1) {
    return {
      error: "More than one member matched — try their exact email instead.",
      candidates: candidates.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), email: c.email })),
    };
  }
  const target = candidates[0];

  if (isSelfTargeted(user.id, target.id)) {
    return { error: "You already have staff access — this form is for granting access to someone else." };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin.from("staff_roles").select("id").eq("user_id", target.id).maybeSingle();
  if (existing) {
    return { error: "This member already has staff access — change their role in the table above instead." };
  }

  const { error } = await admin.from("staff_roles").insert({
    user_id: target.id,
    role,
    status: "active",
    created_by: user.id,
  });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "admin.granted",
    targetType: "staff_role",
    targetId: target.id,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { role },
  });

  if (error) return { error: "Couldn't grant staff access — please try again." };

  revalidatePath("/admin/staff");
  return { success: true };
}

export async function changeStaffRole(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: ["super_admin"] });

  const targetId = String(formData.get("userId") ?? "").trim();
  const nextRole = String(formData.get("role") ?? "") as StaffRole;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing staff member id." };
  if (!(STAFF_ROLES as readonly string[]).includes(nextRole)) return { error: "Choose a role." };
  if (!reason) return { error: "A reason is required." };
  // Flat rule, not a "would this be the last super admin" check on the
  // actor specifically — see staff-management.ts's file header for why a
  // super_admin can never touch their own row through this UI at all.
  if (isSelfTargeted(user.id, targetId)) {
    return { error: "You can't change your own role — ask another super admin to make this change." };
  }

  const admin = createAdminClient();
  const allStaff = await loadAllStaffRows(admin);
  const current = allStaff.find((r) => r.user_id === targetId);
  if (!current) return { error: "That staff member no longer exists." };

  if (wouldRemoveLastActiveSuperAdmin(allStaff, targetId, { role: nextRole, status: current.status })) {
    return { error: "This would leave no active super admins — grant super admin to someone else first." };
  }

  const { error } = await admin.from("staff_roles").update({ role: nextRole }).eq("user_id", targetId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "admin.role_changed",
    targetType: "staff_role",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousRole: current.role, newRole: nextRole },
  });

  if (error) return { error: "Couldn't change this role — please try again." };

  revalidatePath("/admin/staff");
  return { success: true };
}

async function setStaffStatus(formData: FormData, nextStatus: "active" | "disabled"): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: ["super_admin"] });

  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing staff member id." };
  if (!reason) return { error: "A reason is required." };
  if (isSelfTargeted(user.id, targetId)) {
    return { error: "You can't change your own status — ask another super admin to make this change." };
  }

  const admin = createAdminClient();
  const allStaff = await loadAllStaffRows(admin);
  const current = allStaff.find((r) => r.user_id === targetId);
  if (!current) return { error: "That staff member no longer exists." };

  if (wouldRemoveLastActiveSuperAdmin(allStaff, targetId, { role: current.role, status: nextStatus })) {
    return { error: "This would leave no active super admins — grant super admin to someone else first." };
  }

  const { error } = await admin.from("staff_roles").update({ status: nextStatus }).eq("user_id", targetId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "admin.status_changed",
    targetType: "staff_role",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: current.status, newStatus: nextStatus },
  });

  if (error) return { error: "Couldn't update this staff member — please try again." };

  revalidatePath("/admin/staff");
  return { success: true };
}

export async function disableStaffMember(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  return setStaffStatus(formData, "disabled");
}

export async function reinstateStaffMember(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  return setStaffStatus(formData, "active");
}
