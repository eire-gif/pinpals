import type { NextRequest } from "next/server";
import { requireStaff } from "@/lib/admin/authorization";
import { listReports } from "@/lib/admin/queries";
import { recordAdminAction } from "@/lib/admin/audit";
import { toCsv, type CsvValue } from "@/lib/admin/csv";
import { EXPORT_MAX_ROWS, csvFilename, csvResponse, exportTruncated } from "@/lib/admin/export";
import { personName } from "@/lib/admin/format";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_PRIORITY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
  type EscalationRole,
  type ReportCategory,
  type ReportPriority,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/admin/reports";
import { ROLE_LABELS } from "@/lib/admin/roles";

/**
 * CSV export of /admin/reports — the moderation queue, one row per report.
 * Open to any active staff member, the same gate as the page itself, and it
 * carries no email addresses (see the gating rule in
 * src/lib/admin/export.ts).
 *
 * ============ What this file leaves out, and why ============
 *
 * `description` — the reporter's own free-text account of what another
 * member did — and `evidence_refs` are deliberately NOT exported. They are
 * not on the queue page either; they live on the detail page, one report at
 * a time, which is the right way to read an allegation. A spreadsheet of
 * every accusation ever made on Pinpals, sitting in a Downloads folder, is a
 * different object entirely, and it is not what an export of this queue is
 * for — which is volume, ageing, category mix and who is carrying the load.
 *
 * "Has description" and "Redacted at" are exported instead, so an empty
 * description is never silently mistaken for "nothing was said": one says
 * there is text to go and read, the other says a super admin removed it
 * (redactReport(), 0055).
 *
 * `resolution` IS exported. It is written by staff, about a decision staff
 * made, and "what did we actually do about these" is most of the value in
 * looking at closed reports in bulk.
 */
export const dynamic = "force-dynamic";

const HEADERS = [
  "Report ID",
  "Status",
  "Priority",
  "Category",
  "Target type",
  "Target ID",
  "Target",
  "Reporter ID",
  "Reporter name",
  "Assigned to ID",
  "Assigned to",
  "Claimed at",
  "Escalated to role",
  "Escalated at",
  "Wants refund",
  "Has description",
  "Redacted at",
  "Resolution",
  "Resolved at",
  "Linked action ID",
  "Filed at",
  "Updated at",
] as const;

export async function GET(request: NextRequest) {
  const { user, staff } = await requireStaff();

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";
  const priority = sp.get("priority") ?? "";
  const category = sp.get("category") ?? "";
  const target = sp.get("target") ?? "";
  const targetId = sp.get("targetId") ?? "";
  const assigned = sp.get("assigned") ?? "";
  const escalated = sp.get("escalated") ?? "";

  // "mine" resolves against the signed-in staff member here, exactly as the
  // page does — the link never has to carry a staff user id.
  const assignedFilter = assigned === "mine" ? user.id : assigned || undefined;

  const { rows, total } = await listReports(
    q,
    {
      status: (status as ReportStatus) || undefined,
      priority: (priority as ReportPriority) || undefined,
      category: (category as ReportCategory) || undefined,
      targetType: (target as ReportTargetType) || undefined,
      targetId: targetId || undefined,
      assignedAdmin: assignedFilter,
      escalatedToRole: (escalated as EscalationRole) || undefined,
    },
    1,
    EXPORT_MAX_ROWS
  );

  const body: CsvValue[][] = rows.map((r) => [
    r.id,
    REPORT_STATUS_LABELS[r.status] ?? r.status,
    REPORT_PRIORITY_LABELS[r.priority] ?? r.priority,
    REPORT_CATEGORY_LABELS[r.category] ?? r.category,
    REPORT_TARGET_TYPE_LABELS[r.target_type] ?? r.target_type,
    r.target_id,
    // The same resolved one-liner the page shows ("Listing #12 — Ping G430
    // driver"), including its "no longer exists" form, rather than leaving a
    // bare id to be looked up by hand.
    r.target.label,
    r.reporter_id,
    r.reporter ? personName(r.reporter) : null,
    r.assigned_admin,
    r.assignedStaff ? personName(r.assignedStaff) : null,
    r.claimed_at,
    r.escalated_to_role ? ROLE_LABELS[r.escalated_to_role] : null,
    r.escalated_at,
    r.wants_refund,
    r.description != null && r.description.trim().length > 0,
    r.redacted_at,
    r.resolution,
    r.resolved_at,
    r.linked_action_id,
    r.created_at,
    r.updated_at,
  ]);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "export.reports",
    targetType: "report",
    metadata: {
      rowCount: body.length,
      matchedTotal: total,
      truncated: exportTruncated(total),
      includesEmail: false,
      includesDescription: false,
      filters: { q, status, priority, category, target, targetId, assigned, escalated },
    },
  });

  return csvResponse(csvFilename("reports"), toCsv(HEADERS, body));
}
