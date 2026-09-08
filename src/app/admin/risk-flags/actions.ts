"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { ESCALATION_ROLES } from "@/lib/admin/reports";
import { FRAUD_FLAG_SEVERITIES, FRAUD_FLAG_TARGET_TYPES, FRAUD_FLAG_TYPES } from "@/lib/admin/risk";
import type { FraudFlagSeverity, FraudFlagTargetType, FraudFlagType } from "@/lib/admin/risk";

export type FraudFlagActionState = { error?: string; success?: boolean };

const NOTE_MAX_LENGTH = 4000; // matches fraud_flags.note's own check constraint
const CLEAR_REASON_MAX_LENGTH = 4000; // matches fraud_flags.clear_reason's own check constraint

// Roles that may CLEAR a flag — a real judgment call that closes out a
// concern, so it's held to the same bar as report escalation (not support,
// which is read/help-only everywhere else in this app). RAISING a flag, by
// contrast, is open to any active staff member below — see raiseFraudFlag()'s
// own comment for why that asymmetry is deliberate.
const CLEAR_FRAUD_FLAG_ROLES = ESCALATION_ROLES;

function revalidateFraudFlagViews(targetType: FraudFlagTargetType, targetId: string) {
  revalidatePath("/admin/risk-flags");
  if (targetType === "user") revalidatePath(`/admin/users/${targetId}`);
  if (targetType === "listing") revalidatePath(`/admin/listings/${targetId}`);
  if (targetType === "order") revalidatePath(`/admin/orders/${targetId}`);
}

/**
 * Raises a new fraud/risk flag — an internal-only SIGNAL for a human to
 * review, never an automatic consequence (see src/lib/admin/risk.ts's own
 * header comment; nothing reads this table except the admin UI itself).
 * Deliberately gated to a bare requireStaff() rather than MODERATION_ROLES/
 * FINANCE_ROLES: raising a flag is closer to "adding a structured note" than
 * "taking a moderation action" — support noticing something suspicious
 * while helping a member should be able to surface it just as easily as
 * moderator/finance can, same reasoning addReportNote() already documents
 * for report notes. Always requires a note (equivalent to every other
 * "reason for a manual write" rule in this app).
 */
export async function raiseFraudFlag(_prev: FraudFlagActionState, formData: FormData): Promise<FraudFlagActionState> {
  const { user, staff } = await requireStaff();

  const targetType = String(formData.get("targetType") ?? "") as FraudFlagTargetType;
  const targetId = String(formData.get("targetId") ?? "").trim();
  const flagType = String(formData.get("flagType") ?? "") as FraudFlagType;
  const severity = String(formData.get("severity") ?? "medium") as FraudFlagSeverity;
  const note = String(formData.get("note") ?? "").trim();

  if (!FRAUD_FLAG_TARGET_TYPES.includes(targetType)) return { error: "Invalid target type." };
  if (!targetId) return { error: "Missing target id." };
  if (!FRAUD_FLAG_TYPES.includes(flagType)) return { error: "Choose a flag type." };
  if (!FRAUD_FLAG_SEVERITIES.includes(severity)) return { error: "Invalid severity." };
  if (!note) return { error: "A note is required." };
  if (note.length > NOTE_MAX_LENGTH) return { error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };

  const admin = createAdminClient();

  // Confirm the target actually exists before recording a flag against it —
  // same "don't let a typo'd id silently create an orphaned signal" care as
  // every other admin write that takes a client-supplied target id.
  const targetExists = await (async () => {
    if (targetType === "user") {
      const { data } = await admin.from("profiles").select("id").eq("id", targetId).maybeSingle();
      return !!data;
    }
    if (targetType === "listing") {
      const { data } = await admin.from("listings").select("id").eq("id", targetId).maybeSingle();
      return !!data;
    }
    const { data } = await admin.from("orders").select("id").eq("id", targetId).maybeSingle();
    return !!data;
  })();
  if (!targetExists) return { error: "That target no longer exists." };

  const { data: flag, error } = await admin
    .from("fraud_flags")
    .insert({ target_type: targetType, target_id: targetId, flag_type: flagType, severity, note, raised_by: user.id })
    .select("id")
    .maybeSingle();

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "fraud_flag.raised",
    targetType: "fraud_flag",
    targetId: flag?.id ?? null,
    reason: note,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, targetType, targetId } : { targetType, targetId, flagType, severity },
  });

  if (error) return { error: "Couldn't raise this flag — please try again." };

  revalidateFraudFlagViews(targetType, targetId);
  return { success: true };
}

/**
 * Clears an open flag — a determination that it's no longer a concern (or
 * was a false positive). Requires a reason, same as every other terminal
 * state-repair action in this app, and is gated to CLEAR_FRAUD_FLAG_ROLES
 * (not support) — see that constant's own comment above.
 */
export async function clearFraudFlag(_prev: FraudFlagActionState, formData: FormData): Promise<FraudFlagActionState> {
  const { user, staff } = await requireStaff({ roles: CLEAR_FRAUD_FLAG_ROLES });

  const flagId = Number(formData.get("flagId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!flagId || Number.isNaN(flagId)) return { error: "Missing flag id." };
  if (!reason) return { error: "A reason is required." };
  if (reason.length > CLEAR_REASON_MAX_LENGTH) {
    return { error: `Reasons are limited to ${CLEAR_REASON_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: flag } = await admin
    .from("fraud_flags")
    .select("status, target_type, target_id")
    .eq("id", flagId)
    .maybeSingle();
  if (!flag) return { error: "Flag not found." };
  if (flag.status === "cleared") return { error: "This flag is already cleared." };

  const { error } = await admin
    .from("fraud_flags")
    .update({ status: "cleared", cleared_by: user.id, cleared_at: new Date().toISOString(), clear_reason: reason })
    .eq("id", flagId)
    .eq("status", "open");

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "fraud_flag.cleared",
    targetType: "fraud_flag",
    targetId: flagId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { targetType: flag.target_type, targetId: flag.target_id },
  });

  if (error) return { error: "Couldn't clear this flag — please try again." };

  revalidateFraudFlagViews(flag.target_type as FraudFlagTargetType, flag.target_id);
  return { success: true };
}
