"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { AGE_SETTINGS_ROLES } from "@/lib/admin/age";

export type AgeSettingsState = { error?: string; success?: boolean };

/**
 * Switch the parent's €0 card check on or off (age_settings, 0159). Applies
 * to approvals from now on; links already approved stay approved.
 */
export async function setParentCardCheck(_prev: AgeSettingsState, formData: FormData): Promise<AgeSettingsState> {
  const { user, staff } = await requireStaff({ roles: AGE_SETTINGS_ROLES });
  const on = formData.get("enabled") === "on";
  const admin = createAdminClient();
  const { data: before } = await admin.from("age_settings").select("require_parent_card_check").eq("id", true).maybeSingle<{ require_parent_card_check: boolean }>();
  const { error } = await admin
    .from("age_settings")
    .upsert({ id: true, require_parent_card_check: on, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "age_settings.updated",
    targetType: "age_settings",
    targetId: null,
    outcome: error ? "failure" : "success",
    metadata: { require_parent_card_check: { before: before?.require_parent_card_check ?? null, after: on }, ...(error ? { error: error.message } : {}) },
  });
  if (error) return { error: "Couldn't save — try again." };
  revalidatePath("/admin/age");
  return { success: true };
}
