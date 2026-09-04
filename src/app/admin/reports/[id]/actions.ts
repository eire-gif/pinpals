"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";
import { REPORT_PRIORITIES, type ReportActionState, type ReportPriority } from "@/lib/admin/reports";
import { getConversationAccessWindow, type ConversationAccessState } from "@/lib/admin/messaging";
import type { MessagesCursor } from "@/lib/messaging";

const NOTE_MAX_LENGTH = 4000; // matches report_notes' own check constraint
const RESOLUTION_MAX_LENGTH = 4000; // matches reports.resolution's own check constraint
const ACCESS_REASON_MAX_LENGTH = 4000; // matches admin_audit_log.reason having no length cap of its own, capped here for sanity

function revalidateReport(reportId: number) {
  revalidatePath(`/admin/reports/${reportId}`);
  revalidatePath("/admin/reports");
}

/**
 * Loads a report's target_type/target_id/created_at, and confirms it's
 * actually a message/conversation report — shared by
 * grantConversationAccess() and loadOlderConversationAccess() so the same
 * validation can't drift between the two.
 */
async function loadMessageReport(admin: ReturnType<typeof createAdminClient>, reportId: number) {
  const { data: report } = await admin
    .from("reports")
    .select("id, target_type, target_id, created_at")
    .eq("id", reportId)
    .maybeSingle<{ id: number; target_type: string; target_id: string; created_at: string }>();
  if (!report) return { error: "Report not found." } as const;
  if (report.target_type !== "message" && report.target_type !== "conversation") {
    return { error: "This report isn't a message or conversation report." } as const;
  }
  return { report: report as { id: number; target_type: "message" | "conversation"; target_id: string; created_at: string } } as const;
}

/**
 * The first (and every subsequent) reveal of a report's message content —
 * see the privacy model comment at the top of
 * supabase/migrations/0025_messaging.sql. Requires a non-empty reason EVERY
 * call, and writes a `conversation.access_viewed` audit row every call, not
 * just the first — including a failed one, so a rejected/erroring attempt
 * still leaves a trace of who tried and why.
 */
export async function grantConversationAccess(_prev: ConversationAccessState, formData: FormData): Promise<ConversationAccessState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!reason) return { error: "A reason is required to view message content." };
  if (reason.length > ACCESS_REASON_MAX_LENGTH) return { error: `Reasons are limited to ${ACCESS_REASON_MAX_LENGTH} characters.` };

  const admin = createAdminClient();
  const loaded = await loadMessageReport(admin, reportId);
  if ("error" in loaded) return { error: loaded.error };
  const { report } = loaded;

  const result = await getConversationAccessWindow({
    targetType: report.target_type,
    targetId: report.target_id,
    reportCreatedAt: report.created_at,
  });

  if ("notFound" in result) {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "conversation.access_viewed",
      targetType: "conversation",
      targetId: report.target_id,
      reason,
      outcome: "failure",
      metadata: { reportId, error: "target no longer exists" },
    });
    return { error: "That message or conversation no longer exists." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "conversation.access_viewed",
    targetType: "conversation",
    targetId: result.conversationId,
    reason,
    outcome: "success",
    metadata: { reportId, messageCount: result.messages.length, initialReveal: true },
  });

  return {
    success: true,
    conversationId: result.conversationId,
    participants: result.participants,
    messages: result.messages,
    nextCursor: result.nextCursor,
  };
}

/**
 * A "load older messages" follow-up within an already-open reveal — called
 * directly from the conversation-access panel's client component, not via a
 * form. Still requires the reason to be re-submitted (the panel re-sends
 * whatever reason the admin typed for the initial reveal) and still writes
 * its own `conversation.access_viewed` row: every additional page of
 * another member's private conversation an admin looks at is its own
 * auditable event, not covered by the first one.
 */
export async function loadOlderConversationAccess(reportId: number, reason: string, cursor: MessagesCursor): Promise<ConversationAccessState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const trimmedReason = reason.trim();
  if (!trimmedReason) return { error: "A reason is required to view message content." };

  const admin = createAdminClient();
  const loaded = await loadMessageReport(admin, reportId);
  if ("error" in loaded) return { error: loaded.error };
  const { report } = loaded;

  const result = await getConversationAccessWindow({
    targetType: report.target_type,
    targetId: report.target_id,
    reportCreatedAt: report.created_at,
    cursor,
  });

  if ("notFound" in result) return { error: "That message or conversation no longer exists." };

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "conversation.access_viewed",
    targetType: "conversation",
    targetId: result.conversationId,
    reason: trimmedReason,
    outcome: "success",
    metadata: { reportId, messageCount: result.messages.length, initialReveal: false },
  });

  return {
    success: true,
    conversationId: result.conversationId,
    participants: result.participants,
    messages: result.messages,
    nextCursor: result.nextCursor,
  };
}

/**
 * Hides one message from ordinary participants — sets hidden_at/hidden_by/
 * hidden_reason only, never touches `body` (see the privacy model comment in
 * 0025_messaging.sql — this is the DB-level guarantee this action relies on,
 * not just its own good behavior). Gated to MODERATION_ROLES, same as every
 * other content-moderation action in this file.
 */
export async function hideMessage(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const messageId = Number(formData.get("messageId"));
  const reportId = Number(formData.get("reportId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!messageId || Number.isNaN(messageId)) return { error: "Missing message id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: message } = await admin.from("messages").select("id, hidden_at").eq("id", messageId).maybeSingle();
  if (!message) return { error: "Message not found." };
  if (message.hidden_at) return { error: "This message is already hidden." };

  const { error } = await admin
    .from("messages")
    .update({ hidden_at: new Date().toISOString(), hidden_by: user.id, hidden_reason: reason })
    .eq("id", messageId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "message.hidden",
    targetType: "message",
    targetId: messageId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, reportId } : { reportId },
  });

  if (error) return { error: "Couldn't hide this message — please try again." };

  if (reportId) revalidateReport(reportId);
  return { success: true };
}

/** Restores a previously-hidden message — clears hidden_at/hidden_by/
 * hidden_reason. Never touches `body`, same as hideMessage() above. */
export async function restoreMessage(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const messageId = Number(formData.get("messageId"));
  const reportId = Number(formData.get("reportId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!messageId || Number.isNaN(messageId)) return { error: "Missing message id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: message } = await admin.from("messages").select("id, hidden_at").eq("id", messageId).maybeSingle();
  if (!message) return { error: "Message not found." };
  if (!message.hidden_at) return { error: "This message isn't hidden." };

  const { error } = await admin
    .from("messages")
    .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
    .eq("id", messageId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "message.restored",
    targetType: "message",
    targetId: messageId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, reportId } : { reportId },
  });

  if (error) return { error: "Couldn't restore this message — please try again." };

  if (reportId) revalidateReport(reportId);
  return { success: true };
}

/**
 * Claims an open, unassigned report for the current staff member. This is
 * the actual double-handling guard the task asked for: a single UPDATE
 * guarded by `status = 'open' AND assigned_admin IS NULL`, not a
 * read-then-write. Postgres holds a row lock for the duration of an UPDATE,
 * so of two concurrent claims on the same report, only one can ever match
 * that WHERE clause — the other comes back with zero rows updated and gets
 * the "already claimed" error below rather than silently overwriting the
 * first claim.
 */
export async function claimReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };

  const admin = createAdminClient();
  const { data: claimed, error } = await admin
    .from("reports")
    .update({ status: "claimed", assigned_admin: user.id, claimed_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "open")
    .is("assigned_admin", null)
    .select("id")
    .maybeSingle();

  if (error) {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "report.claimed",
      targetType: "report",
      targetId: reportId,
      outcome: "failure",
      metadata: { error: error.message },
    });
    return { error: "Couldn't claim this report — please try again." };
  }

  if (!claimed) {
    // Zero rows matched: either someone else already claimed it, or it was
    // resolved/dismissed in the meantime. Not logged as a failed audit
    // entry — no action actually happened, so there's nothing to record.
    return { error: "This report was already claimed (or is no longer open) — refresh to see its current state." };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.claimed",
    targetType: "report",
    targetId: reportId,
    outcome: "success",
  });

  revalidateReport(reportId);
  return { success: true };
}

/**
 * Releases a claim back to "open" without resolving/dismissing anything —
 * for when a report was claimed by mistake, or the assignee can't get to it.
 * Restricted to the staff member who claimed it, or a senior role (admin/
 * super_admin) who can reassign on someone else's behalf; a moderator can't
 * release a colleague's claim out from under them.
 */
export async function releaseReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("reports")
    .select("status, assigned_admin")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "Report not found." };
  if (report.status !== "claimed") {
    return { error: `Only claimed reports can be released (this one is "${report.status}").` };
  }
  const isSenior = staff.role === "admin" || staff.role === "super_admin";
  if (report.assigned_admin !== user.id && !isSenior) {
    return { error: "Only the staff member who claimed this report (or an admin) can release it." };
  }

  const { error } = await admin
    .from("reports")
    .update({ status: "open", assigned_admin: null, claimed_at: null })
    .eq("id", reportId)
    .eq("status", "claimed");

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.status_changed",
    targetType: "report",
    targetId: reportId,
    reason: "Released claim",
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: "claimed", newStatus: "open" },
  });

  if (error) return { error: "Couldn't release this report — please try again." };

  revalidateReport(reportId);
  return { success: true };
}

/** Dismisses an open or claimed report — "not actionable", "duplicate",
 * etc. Always requires a reason, same as every other terminal moderation
 * action in this app. */
export async function dismissReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: report } = await admin.from("reports").select("status").eq("id", reportId).maybeSingle();
  if (!report) return { error: "Report not found." };
  if (report.status === "resolved" || report.status === "dismissed") {
    return { error: `This report is already "${report.status}".` };
  }

  const { error } = await admin
    .from("reports")
    .update({ status: "dismissed", resolution: reason, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq("id", reportId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.dismissed",
    targetType: "report",
    targetId: reportId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: report.status },
  });

  if (error) return { error: "Couldn't dismiss this report — please try again." };

  revalidateReport(reportId);
  return { success: true };
}

/**
 * Resolves a report with a required resolution summary, optionally linked
 * to a specific existing admin_audit_log entry for this report's own
 * target — e.g. "resolved by hiding listing #42". The link is re-verified
 * here against the report's own target_type/target_id, never trusted from
 * the submitted form value alone: the resolution form only ever offers
 * entries from this target's own moderation history, but a crafted request
 * could submit an arbitrary id, so this is checked server-side regardless of
 * what the UI restricts.
 */
export async function resolveReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  const resolution = String(formData.get("resolution") ?? "").trim();
  const linkedActionIdRaw = String(formData.get("linkedActionId") ?? "").trim();

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!resolution) return { error: "A resolution summary is required." };
  if (resolution.length > RESOLUTION_MAX_LENGTH) {
    return { error: `Resolutions are limited to ${RESOLUTION_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("reports")
    .select("status, target_type, target_id")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "Report not found." };
  if (report.status === "resolved" || report.status === "dismissed") {
    return { error: `This report is already "${report.status}".` };
  }

  let linkedActionId: number | null = null;
  if (linkedActionIdRaw) {
    const candidateId = Number(linkedActionIdRaw);
    if (!candidateId || Number.isNaN(candidateId)) return { error: "Invalid moderation action reference." };
    const { data: actionRow } = await admin
      .from("admin_audit_log")
      .select("id")
      .eq("id", candidateId)
      .eq("target_type", report.target_type)
      .eq("target_id", report.target_id)
      .maybeSingle();
    if (!actionRow) return { error: "That moderation action doesn't belong to this report's target." };
    linkedActionId = candidateId;
  }

  const { error } = await admin
    .from("reports")
    .update({
      status: "resolved",
      resolution,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
      linked_action_id: linkedActionId,
    })
    .eq("id", reportId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.resolved",
    targetType: "report",
    targetId: reportId,
    reason: resolution,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: report.status, linkedActionId },
  });

  if (error) return { error: "Couldn't resolve this report — please try again." };

  revalidateReport(reportId);
  return { success: true };
}

/** Reopens a resolved/dismissed report — for correcting a mistaken
 * resolution — clearing the assignment and resolution fields back to a
 * clean "open" state so it re-enters the claimable queue. */
export async function reopenReport(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { data: report } = await admin.from("reports").select("status").eq("id", reportId).maybeSingle();
  if (!report) return { error: "Report not found." };
  if (report.status !== "resolved" && report.status !== "dismissed") {
    return { error: `Only resolved or dismissed reports can be reopened (this one is "${report.status}").` };
  }

  const { error } = await admin
    .from("reports")
    .update({
      status: "open",
      assigned_admin: null,
      claimed_at: null,
      resolution: null,
      resolved_at: null,
      resolved_by: null,
      linked_action_id: null,
    })
    .eq("id", reportId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.status_changed",
    targetType: "report",
    targetId: reportId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousStatus: report.status, newStatus: "open" },
  });

  if (error) return { error: "Couldn't reopen this report — please try again." };

  revalidateReport(reportId);
  return { success: true };
}

/** Adjusts a report's priority — not itself a status change, so it doesn't
 * touch claim/resolution state, but still gated to MODERATION_ROLES (the
 * same "support may view, not act" split every other mutation in this file
 * uses) and still audited. */
export async function setReportPriority(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const reportId = Number(formData.get("reportId"));
  const priority = String(formData.get("priority") ?? "") as ReportPriority;

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!REPORT_PRIORITIES.includes(priority)) return { error: "Invalid priority." };

  const admin = createAdminClient();
  const { data: report } = await admin.from("reports").select("priority").eq("id", reportId).maybeSingle();
  if (!report) return { error: "Report not found." };

  const { error } = await admin.from("reports").update({ priority }).eq("id", reportId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.status_changed",
    targetType: "report",
    targetId: reportId,
    reason: `Priority changed to ${priority}`,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { previousPriority: report.priority, newPriority: priority },
  });

  if (error) return { error: "Couldn't update this report's priority — please try again." };

  revalidateReport(reportId);
  return { success: true };
}

/** Adds an internal note to a report. Like addUserNote(), this is gated to
 * *any* active staff member (a bare requireStaff() call, not
 * MODERATION_ROLES) — a note isn't a moderation action, it's the "help"
 * half of "support may view/help; higher roles may act". */
export async function addReportNote(_prev: ReportActionState, formData: FormData): Promise<ReportActionState> {
  const { user, staff } = await requireStaff();
  const reportId = Number(formData.get("reportId"));
  const body = String(formData.get("note") ?? "").trim();

  if (!reportId || Number.isNaN(reportId)) return { error: "Missing report id." };
  if (!body) return { error: "A note can't be empty." };
  if (body.length > NOTE_MAX_LENGTH) {
    return { error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { data: report } = await admin.from("reports").select("id").eq("id", reportId).maybeSingle();
  if (!report) return { error: "Report not found." };

  const { error } = await admin.from("report_notes").insert({
    report_id: reportId,
    author_id: user.id,
    author_role: staff.role,
    body,
  });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "report.note_added",
    targetType: "report",
    targetId: reportId,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) return { error: "Couldn't save this note — please try again." };

  revalidatePath(`/admin/reports/${reportId}`);
  return { success: true };
}
