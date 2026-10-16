"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { recordAdminAction } from "@/lib/admin/audit";
import type { StaffRole } from "@/lib/admin/roles";
import { FEATURE_COLUMNS, SETTINGS_COLUMNS } from "@/lib/admin/memberships";
import { MEMBERSHIP_EDIT_ROLES, parseFeatureForm, parseSettingsForm } from "@/lib/memberships";
import { createAdminClient } from "@/lib/supabase/admin";

// Mutations for /admin/monetisation (0156). Super admin only, re-checked
// here. The tables take no writes from anyone but the service role, so this
// file is the only way in. Every change writes admin_audit_log with what
// changed, before and after.

export type MembershipActionState = { error?: string; success?: boolean };

const ROOT = "/admin/monetisation";

type Actor = { id: string; role: StaffRole };

async function editor(): Promise<Actor> {
  const { user, staff } = await requireStaff({ roles: MEMBERSHIP_EDIT_ROLES });
  return { id: user.id, role: staff.role };
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => before[k] !== after[k]);
}

async function writeSettings(actor: Actor, patch: Record<string, unknown>): Promise<MembershipActionState> {
  const admin = createAdminClient();
  const { data: before } = await admin
    .from("membership_settings")
    .select(SETTINGS_COLUMNS)
    .eq("id", true)
    .maybeSingle<Record<string, unknown>>();
  const keys = changed(before ?? {}, patch);
  if (before && keys.length === 0) return { success: true };
  // Upsert: 0156 creates the row, but a restore without it shouldn't strand the switch.
  const { error } = await admin
    .from("membership_settings")
    .upsert({ id: true, ...patch, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
  const beforeShown = before ? Object.fromEntries(keys.map((k) => [k, before[k]])) : null;
  const afterShown = Object.fromEntries(keys.map((k) => [k, patch[k]]));
  if (error) {
    await recordAdminAction({
      actor,
      action: "membership_settings.updated",
      targetType: "membership_settings",
      targetId: null,
      outcome: "failure",
      metadata: { error: error.message, changed: keys },
    });
    return { error: "Couldn't save — try again." };
  }
  await recordAdminAction({
    actor,
    action: "membership_settings.updated",
    targetType: "membership_settings",
    targetId: null,
    metadata: { changed: keys, before: beforeShown, after: afterShown },
  });
  revalidatePath(ROOT);
  return { success: true };
}

/** The master switch. Off = every feature free for everyone. */
export async function setPaidPlansEnabled(_prev: MembershipActionState, formData: FormData): Promise<MembershipActionState> {
  const actor = await editor();
  return writeSettings(actor, { paid_plans_enabled: formData.get("enabled") === "on" });
}

/** Prices shown in the app, trial lengths and the launch-offer date. */
export async function saveMembershipSettings(_prev: MembershipActionState, formData: FormData): Promise<MembershipActionState> {
  const actor = await editor();
  const parsed = parseSettingsForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  return writeSettings(actor, parsed.value);
}

/** One feature: its level, what Basic members see, and keep-for-existing. */
export async function saveFeature(_prev: MembershipActionState, formData: FormData): Promise<MembershipActionState> {
  const actor = await editor();
  const parsed = parseFeatureForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const { key, ...patch } = parsed.value;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("membership_features")
    .select(FEATURE_COLUMNS)
    .eq("key", key)
    .maybeSingle<Record<string, unknown>>();
  if (!before) return { error: "That feature isn't in the list any more — reload the page." };
  const keys = changed(before, patch);
  if (keys.length === 0) return { success: true };

  const { error } = await admin
    .from("membership_features")
    .update({ ...patch, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) {
    await recordAdminAction({
      actor,
      action: "membership_feature.updated",
      targetType: "membership_feature",
      targetId: key,
      outcome: "failure",
      metadata: { error: error.message, changed: keys },
    });
    return { error: "Couldn't save that feature — try again." };
  }
  await recordAdminAction({
    actor,
    action: "membership_feature.updated",
    targetType: "membership_feature",
    targetId: key,
    metadata: {
      changed: keys,
      before: Object.fromEntries(keys.map((k) => [k, before[k]])),
      after: Object.fromEntries(keys.map((k) => [k, (patch as Record<string, unknown>)[k]])),
    },
  });
  revalidatePath(ROOT);
  return { success: true };
}
