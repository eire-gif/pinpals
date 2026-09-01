import "server-only";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { canAccess, type StaffRecord, type StaffRole } from "./roles";

export type StaffSession = { user: User; staff: StaffRecord | null };

async function resolveSession(): Promise<{
  supabase: SupabaseClient;
  session: StaffSession | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, session: null };
  }

  // RLS on staff_roles only lets a user read their own row (or, if they're a
  // super_admin, every row) — this query can never see another user's staff
  // status. No service-role client needed for this read.
  const { data: staffRow } = await supabase
    .from("staff_roles")
    .select("user_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle<StaffRecord>();

  return { supabase, session: { user, staff: staffRow ?? null } };
}

/**
 * Read-only lookup of the current user's staff record, if any. Does not
 * redirect or throw. Prefer `requireStaff()` for anything that needs to
 * actually ENFORCE access — this is only for the rare case where a page
 * wants to know staff status without gating on it.
 */
export async function getCurrentStaffMember(): Promise<StaffSession | null> {
  const { session } = await resolveSession();
  return session;
}

type RequireStaffOptions = {
  /** Restrict to specific roles. Omitted/empty = any active staff role. */
  roles?: readonly StaffRole[];
  /**
   * Seam for future step-up MFA on high-risk actions (e.g. issuing a payout,
   * deleting an account). No caller sets this yet, and no MFA enrollment UI
   * exists in the app yet, but the check itself is real — it reads Supabase
   * Auth's actual authenticator assurance level — so a later phase can
   * require "aal2" on a specific mutation without restructuring this
   * function or its callers.
   */
  requiredAal?: "aal1" | "aal2";
};

/**
 * The single authorization choke point for the admin surface. Every /admin
 * page, layout, and server mutation that touches admin data should call this
 * directly — don't rely on the /admin layout alone as the security boundary
 * (the App Router doesn't guarantee a parent layout re-runs on every request
 * in every navigation path), and don't reimplement this check inline.
 *
 * - No session -> redirect to /login.
 * - Session but not an active staff member, wrong role, or (when required)
 *   insufficient auth assurance level -> 404. A 404 rather than a "not
 *   authorized" page avoids confirming to a logged-in non-staff user that
 *   /admin, or a specific admin sub-route, exists at all.
 */
export async function requireStaff(
  options: RequireStaffOptions = {}
): Promise<{ user: User; staff: StaffRecord }> {
  const { supabase, session } = await resolveSession();

  if (!session) {
    redirect("/login?next=/admin");
  }

  const { user, staff } = session;

  if (!canAccess(staff, options.roles)) {
    notFound();
  }

  if (options.requiredAal === "aal2" && !(await hasAal2(supabase))) {
    // No step-up/re-auth UI exists yet, so the only safe response today is
    // the same denial as any other failed check. Swap this for a redirect to
    // a step-up flow once MFA enrollment ships — the call site above never
    // has to change.
    notFound();
  }

  // canAccess(staff, ...) only returns true when staff is non-null (see
  // roles.ts / roles.test.ts), so this is a safe narrowing, not an assumption.
  return { user, staff: staff! };
}

async function hasAal2(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.currentLevel === "aal2";
}
