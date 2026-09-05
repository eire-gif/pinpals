"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { findSupportCaseRequesterCandidates } from "@/lib/admin/queries";
import {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_LINKED_TARGET_TYPES,
  SUPPORT_CASE_PRIORITIES,
  type SupportCaseCategory,
  type SupportCaseLinkedTargetType,
  type SupportCasePriority,
} from "@/lib/admin/support-cases";

export type CreateCaseState = { error?: string; candidates?: { id: string; name: string; email: string | null }[] };

const SUBJECT_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 4000;

// No member-facing "open a case" flow exists yet (see the migration's
// file-header comment) — every case starts here, a staff member logging a
// help request on a member's behalf. Open to ANY active staff member, same
// as every other support-case mutation.
export async function createCase(_prev: CreateCaseState, formData: FormData): Promise<CreateCaseState> {
  const { user, staff } = await requireStaff();

  const memberQuery = String(formData.get("member") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "") as SupportCaseCategory;
  const priority = (String(formData.get("priority") ?? "") || "normal") as SupportCasePriority;
  const linkedTargetTypeRaw = String(formData.get("linkedTargetType") ?? "").trim();
  const linkedTargetIdRaw = String(formData.get("linkedTargetId") ?? "").trim();

  if (!memberQuery) return { error: "Enter the member's email or name." };
  if (!subject) return { error: "A subject is required." };
  if (subject.length > SUBJECT_MAX_LENGTH) return { error: `Subjects are limited to ${SUBJECT_MAX_LENGTH} characters.` };
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return { error: `Descriptions are limited to ${DESCRIPTION_MAX_LENGTH} characters.` };
  }
  if (!SUPPORT_CASE_CATEGORIES.includes(category)) return { error: "Choose a category." };
  if (!SUPPORT_CASE_PRIORITIES.includes(priority)) return { error: "Invalid priority." };

  let linkedTargetType: SupportCaseLinkedTargetType | null = null;
  let linkedTargetId: string | null = null;
  if (linkedTargetTypeRaw || linkedTargetIdRaw) {
    if (!linkedTargetTypeRaw || !linkedTargetIdRaw) {
      return { error: "A linked record needs both a type and an id." };
    }
    if (!(SUPPORT_CASE_LINKED_TARGET_TYPES as readonly string[]).includes(linkedTargetTypeRaw)) {
      return { error: "Invalid linked record type." };
    }
    linkedTargetType = linkedTargetTypeRaw as SupportCaseLinkedTargetType;
    linkedTargetId = linkedTargetIdRaw;
  }

  const admin = createAdminClient();

  // Re-verify a linked record actually exists — never trust the submitted
  // id blindly, same discipline as every other cross-reference in this app
  // (e.g. resolveReport()'s linkedActionId check). 'conversation' is
  // deliberately accepted as-is rather than looked up (see
  // support-cases.ts's comment on SUPPORT_CASE_LINKED_TARGET_TYPES) — this
  // phase never queries the conversations/messages tables directly.
  if (linkedTargetType && linkedTargetType !== "conversation") {
    const numericId = Number(linkedTargetId);
    if (!Number.isFinite(numericId)) return { error: "Invalid linked record id." };
    const table =
      linkedTargetType === "order"
        ? "orders"
        : linkedTargetType === "listing"
          ? "listings"
          : linkedTargetType === "tee_time_invite"
            ? "tee_time_invites"
            : "reports";
    const { data: targetRow } = await admin.from(table).select("id").eq("id", numericId).maybeSingle();
    if (!targetRow) return { error: "That linked record doesn't exist." };
  }

  const candidates = await findSupportCaseRequesterCandidates(memberQuery);
  if (candidates.length === 0) {
    return { error: "No member matched that email or name." };
  }
  if (candidates.length > 1) {
    return {
      error: "More than one member matched — try their exact email instead.",
      candidates: candidates.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), email: c.email })),
    };
  }
  const requester = candidates[0];

  const { data: created, error } = await admin
    .from("support_cases")
    .insert({
      requester_id: requester.id,
      subject,
      description: description || null,
      category,
      priority,
      status: "open",
      linked_target_type: linkedTargetType,
      linked_target_id: linkedTargetId,
    })
    .select("id")
    .single();

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "support_case.created",
    targetType: "support_case",
    targetId: created?.id ?? null,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : { requesterId: requester.id },
  });

  if (error || !created) return { error: "Couldn't create this case — please try again." };

  redirect(`/admin/support/${created.id}`);
}
