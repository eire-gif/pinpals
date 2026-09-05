"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import {
  SUPPORT_CASE_PRIORITIES,
  isSupportCaseOpen,
  type SupportCaseActionState,
  type SupportCasePriority,
} from "@/lib/admin/support-cases";

const NOTE_MAX_LENGTH = 4000; // matches support_case_notes' own check constraint
const RESOLUTION_MAX_LENGTH = 4000; // matches support_cases.resolution's own check constraint
const LINK_NOTE_MAX_LENGTH = 1000; // matches support_case_linked_actions.note's own check constraint

function revalidateCase(caseId: number) {
  revalidatePath(`/admin/support/${caseId}`);
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}

/**
 * Claims an open, unassigned case for the current staff member. Same real
 * double-handling guard as reports' claimReport(): a single UPDATE guarded
 * by `status = 'open' AND assigned_admin IS NULL`, not a read-then-write —
 * of two concurrent claims, only one can ever match. Open to ANY active
 * staff role (a bare requireStaff() call) — see support-cases.ts's
 * file-header comment for why cases aren't gated to MODERATION_ROLES the
 * way reports are.
 */
export async function claimCase(_prev: SupportCaseActionState, formData: FormData): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };

  const admin = createAdminClient();
  const { data: claimed, error } = await admin
    .from("support_cases")
    .update({ status: "claimed", assigned_admin: user.id, claimed_at: new Date().toISOString() })
    .eq("id", caseId)
    .eq("status", "open")
    .is("assigned_admin", null)
    .select("id")
    .maybeSingle();

  if (error) {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "support_case.claimed",
      targetType: "support_case",
      targetId: caseId,
      outcome: "failure",
      metadata: { error: error.message },
    });
    return { error: "Couldn't claim this case — please try again." };
  }

  if (!claimed) {
    // Zero rows matched: either someone else already claimed it, or its
    // status changed in the meantime. Not logged as a failed audit entry —
    // no action actually happened, so there's nothing to record.
    return { error: "This case was already claimed (or is no longer open) — refresh to see its current state." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.claimed",
    targetType: "support_case",
    targetId: caseId,
  });

  revalidateCase(caseId);
  return { success: true };
}

/**
 * Releases a claim back to "open" — for when a case was claimed by mistake,
 * or the assignee can't get to it. Restricted to the staff member who
 * claimed it, or a senior role (admin/super_admin) who can reassign on
 * someone else's behalf — same restriction as reports' releaseReport(),
 * kept even though claiming itself isn't role-gated, so one staff member
 * can't casually pull a case out from under a colleague who's already
 * working it.
 */
export async function releaseCase(_prev: SupportCaseActionState, formData: FormData): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("support_cases")
    .select("status, assigned_admin")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return { error: "Case not found." };
  if (caseRow.status !== "claimed" && caseRow.status !== "waiting_on_member") {
    return { error: `Only claimed cases can be released (this one is "${caseRow.status}").` };
  }
  const isSenior = staff.role === "admin" || staff.role === "super_admin";
  if (caseRow.assigned_admin !== user.id && !isSenior) {
    return { error: "Only the staff member who claimed this case (or an admin) can release it." };
  }

  const { error } = await admin
    .from("support_cases")
    .update({ status: "open", assigned_admin: null, claimed_at: null })
    .eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.status_changed",
    targetType: "support_case",
    targetId: caseId,
    reason: "Released claim",
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: caseRow.status, newStatus: "open" },
  });

  if (error) return { error: "Couldn't release this case — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/**
 * Toggles a still-open case between "claimed" (actively being worked) and
 * "waiting_on_member" (staff are blocked on the member's own reply) — the
 * one non-terminal status change a case can go through beyond claim/
 * release. Deliberately can't be used to reach open/resolved/closed —
 * those have their own actions with their own required-reason rules.
 */
export async function setCaseWaitingOnMember(
  _prev: SupportCaseActionState,
  formData: FormData
): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const waiting = String(formData.get("waiting") ?? "") === "true";
  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("status").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };
  const current = caseRow.status;
  if (current !== "claimed" && current !== "waiting_on_member") {
    return { error: `Only a claimed case can be marked waiting-on-member (this one is "${current}").` };
  }

  const nextStatus = waiting ? "waiting_on_member" : "claimed";
  if (current === nextStatus) return { success: true };

  const { error } = await admin.from("support_cases").update({ status: nextStatus }).eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.status_changed",
    targetType: "support_case",
    targetId: caseId,
    reason: waiting ? "Marked waiting on member" : "Marked back in progress",
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: current, newStatus: nextStatus },
  });

  if (error) return { error: "Couldn't update this case's status — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/** Adjusts a case's priority — not itself a status change, mirrors reports'
 * setReportPriority() exactly. Open to any active staff member, same as
 * every other mutation in this file. */
export async function setCasePriority(
  _prev: SupportCaseActionState,
  formData: FormData
): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const priority = String(formData.get("priority") ?? "") as SupportCasePriority;

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!SUPPORT_CASE_PRIORITIES.includes(priority)) return { error: "Invalid priority." };

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("priority").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };

  const { error } = await admin.from("support_cases").update({ priority }).eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.status_changed",
    targetType: "support_case",
    targetId: caseId,
    reason: `Priority changed to ${priority}`,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousPriority: caseRow.priority, newPriority: priority },
  });

  if (error) return { error: "Couldn't update this case's priority — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/** Resolves a case with a required resolution summary — the "fixed it"
 * terminal state, mirrors reports' resolveReport() minus the linked-action
 * picker (support cases link actions independently, any time, via
 * linkCaseAction() below — not only at resolution time). */
export async function resolveCase(
  _prev: SupportCaseActionState,
  formData: FormData
): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const resolution = String(formData.get("resolution") ?? "").trim();

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!resolution) return { error: "A resolution summary is required." };
  if (resolution.length > RESOLUTION_MAX_LENGTH) {
    return { error: `Resolutions are limited to ${RESOLUTION_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("status").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };
  if (!isSupportCaseOpen(caseRow.status)) {
    return { error: `This case is already "${caseRow.status}".` };
  }

  const { error } = await admin
    .from("support_cases")
    .update({ status: "resolved", resolution, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.resolved",
    targetType: "support_case",
    targetId: caseId,
    reason: resolution,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: caseRow.status },
  });

  if (error) return { error: "Couldn't resolve this case — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/** Closes a case without a resolution — "no longer needed", "duplicate of
 * case #X", etc. — the equivalent of reports' dismissReport(). Always
 * requires a reason, same as every other terminal moderation-shaped action
 * in this app. */
export async function closeCase(_prev: SupportCaseActionState, formData: FormData): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("status").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };
  if (!isSupportCaseOpen(caseRow.status)) {
    return { error: `This case is already "${caseRow.status}".` };
  }

  const { error } = await admin
    .from("support_cases")
    .update({ status: "closed", resolution: reason, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.closed",
    targetType: "support_case",
    targetId: caseId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: caseRow.status },
  });

  if (error) return { error: "Couldn't close this case — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/** Reopens a resolved/closed case — for correcting a mistaken resolution —
 * clearing the assignment and resolution fields back to a clean "open"
 * state, mirrors reports' reopenReport() exactly. */
export async function reopenCase(_prev: SupportCaseActionState, formData: FormData): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("status").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };
  if (isSupportCaseOpen(caseRow.status)) {
    return { error: `Only a resolved or closed case can be reopened (this one is "${caseRow.status}").` };
  }

  const { error } = await admin
    .from("support_cases")
    .update({
      status: "open",
      assigned_admin: null,
      claimed_at: null,
      resolution: null,
      resolved_at: null,
      resolved_by: null,
    })
    .eq("id", caseId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.reopened",
    targetType: "support_case",
    targetId: caseId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: caseRow.status, newStatus: "open" },
  });

  if (error) return { error: "Couldn't reopen this case — please try again." };

  revalidateCase(caseId);
  return { success: true };
}

/** Adds an internal note to a case. Like addReportNote(), open to ANY active
 * staff member — a note isn't a moderation action. */
export async function addCaseNote(_prev: SupportCaseActionState, formData: FormData): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const body = String(formData.get("note") ?? "").trim();

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!body) return { error: "A note can't be empty." };
  if (body.length > NOTE_MAX_LENGTH) {
    return { error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin.from("support_cases").select("id").eq("id", caseId).maybeSingle();
  if (!caseRow) return { error: "Case not found." };

  const { error } = await admin.from("support_case_notes").insert({
    case_id: caseId,
    author_id: user.id,
    author_role: staff.role,
    body,
  });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.note_added",
    targetType: "support_case",
    targetId: caseId,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) return { error: "Couldn't save this note — please try again." };

  revalidatePath(`/admin/support/${caseId}`);
  return { success: true };
}

/**
 * Points this case at an existing, already-authorized admin_audit_log row —
 * "this case resulted in suspending the user", "this case resulted in
 * refunding order #42" — WITHOUT re-performing or duplicating that action's
 * own data. The submitted audit-log id is re-verified here to actually
 * belong to either the requester's own account history or this case's
 * linked-target history (see getSupportCaseDetail()'s
 * requesterAccountHistory/linkedTargetHistory) — the picker UI only ever
 * offers entries from those two lists, but a crafted request could submit
 * an arbitrary id, so this is checked server-side regardless of what the UI
 * restricts, same discipline as reports' resolveReport().
 */
export async function linkCaseAction(
  _prev: SupportCaseActionState,
  formData: FormData
): Promise<SupportCaseActionState> {
  const { user, staff } = await requireStaff();
  const caseId = Number(formData.get("caseId"));
  const auditLogId = Number(formData.get("auditLogId"));
  const note = String(formData.get("note") ?? "").trim();

  if (!caseId || Number.isNaN(caseId)) return { error: "Missing case id." };
  if (!auditLogId || Number.isNaN(auditLogId)) return { error: "Choose an action to link." };
  if (note.length > LINK_NOTE_MAX_LENGTH) {
    return { error: `Notes are limited to ${LINK_NOTE_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: caseRow } = await admin
    .from("support_cases")
    .select("requester_id, linked_target_type, linked_target_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return { error: "Case not found." };

  const { data: auditRow } = await admin
    .from("admin_audit_log")
    .select("id, target_type, target_id")
    .eq("id", auditLogId)
    .maybeSingle();
  if (!auditRow) return { error: "That action no longer exists." };

  const belongsToRequester = auditRow.target_type === "user" && auditRow.target_id === caseRow.requester_id;
  const belongsToLinkedTarget =
    caseRow.linked_target_type != null &&
    auditRow.target_type === caseRow.linked_target_type &&
    auditRow.target_id === caseRow.linked_target_id;
  if (!belongsToRequester && !belongsToLinkedTarget) {
    return { error: "That action doesn't belong to this case's member or linked record." };
  }

  const { error } = await admin.from("support_case_linked_actions").insert({
    case_id: caseId,
    audit_log_id: auditLogId,
    linked_by: user.id,
    note: note || null,
  });

  // A duplicate link attempt (support_case_linked_actions_unique) isn't a
  // real failure — the action is already linked — so it's shown as a
  // friendly message rather than an audited failure.
  if (error?.code === "23505") {
    return { error: "That action is already linked to this case." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.action_linked",
    targetType: "support_case",
    targetId: caseId,
    reason: note || null,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { auditLogId },
  });

  if (error) return { error: "Couldn't link this action — please try again." };

  revalidateCase(caseId);
  return { success: true };
}
