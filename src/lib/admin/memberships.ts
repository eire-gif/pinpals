import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "./roles";
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  MEMBERSHIP_EDIT_ROLES,
  type MembershipFeature,
  type MembershipSettings,
} from "@/lib/memberships";

// /admin/monetisation (0156) — loaders only. The rules are in
// src/lib/memberships.ts; these fetch rows with the service role. Every
// caller sits behind requireStaff().

export const canEditMemberships = (role: StaffRole): boolean => (MEMBERSHIP_EDIT_ROLES as readonly StaffRole[]).includes(role);

/** Thrown when 0156 hasn't been applied yet, so the page can say so instead of crashing. */
export class MembershipsNotInstalledError extends Error {
  constructor() {
    super("Memberships aren't set up in the database yet — apply migration 0156_memberships.sql.");
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|Could not find the table/i.test(error.message ?? "");
}

function fail(label: string, error: { code?: string; message: string }): never {
  if (isMissingTable(error)) throw new MembershipsNotInstalledError();
  throw new Error(`Failed to load ${label}: ${error.message}`);
}

export const SETTINGS_COLUMNS =
  "paid_plans_enabled, paid_plans_since, free_until, premium_monthly_price, premium_annual_price, pro_monthly_price, pro_annual_price, premium_trial_days, pro_trial_days, updated_at";

export const FEATURE_COLUMNS = "key, group_key, name, description, sort, access, when_locked, keep_for_existing, paywalled_at";

export type MembershipOverview = {
  settings: MembershipSettings;
  features: MembershipFeature[];
  counts: { premium: number; pro: number; trials: number; staffGrants: number };
};

export async function getMembershipOverview(): Promise<MembershipOverview> {
  const admin = createAdminClient();
  const [s, f, e] = await Promise.all([
    admin.from("membership_settings").select(SETTINGS_COLUMNS).eq("id", true).maybeSingle<MembershipSettings>(),
    admin.from("membership_features").select(FEATURE_COLUMNS).order("group_key").order("sort").order("key"),
    admin
      .from("member_entitlements")
      .select("tier, source, in_trial, expires_at")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
  ]);
  if (s.error) fail("membership settings", s.error);
  if (f.error) fail("membership features", f.error);
  if (e.error) fail("member entitlements", e.error);

  const rows = (e.data ?? []) as { tier: string; source: string; in_trial: boolean }[];
  return {
    settings: s.data ?? DEFAULT_MEMBERSHIP_SETTINGS,
    features: (f.data ?? []) as MembershipFeature[],
    counts: {
      premium: rows.filter((r) => r.tier === "premium").length,
      pro: rows.filter((r) => r.tier === "pro").length,
      trials: rows.filter((r) => r.in_trial).length,
      staffGrants: rows.filter((r) => r.source === "staff_grant").length,
    },
  };
}
