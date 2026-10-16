import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { ageFromIso, bandFromFacts, type JuniorBand } from "@/lib/junior";

/**
 * The Age panel on /admin/users/[id] (0159): what staff need to answer an
 * "may be under 18" report or an app-store signal. Read with the service
 * role — member_birthdates, guardian_links, member_age_flags and
 * member_store_age_signals are owner- or staff-only by RLS, and the admin
 * console reads everything that way (see queries.ts).
 *
 * The band is worked out here from the same facts age_band_of() uses
 * (bandFromFacts mirrors it), rather than calling a function revoked from
 * every role but the database's own.
 */

export type AgePanel = {
  dateOfBirth: string | null;
  age: number | null;
  band: JuniorBand;
  /** The live parent link (or the last one), as a junior. */
  parentLink: { id: number; status: string; email: string; guardianId: string | null; guardianName: string | null; invitedAt: string; approvedAt: string | null; cardCheckedAt: string | null } | null;
  /** Children this member is the approved/pending parent of. */
  children: { id: string; name: string; status: string }[];
  flag: { reason: string; note: string | null; createdAt: string; resolvedAt: string | null } | null;
  storeSignal: { platform: string; lower: number | null; upper: number | null; status: string | null; receivedAt: string } | null;
};

export async function loadAgePanel(userId: string): Promise<AgePanel | null> {
  const admin = createAdminClient();
  const [dob, links, kids, flag, signal] = await Promise.all([
    admin.from("member_birthdates").select("date_of_birth").eq("user_id", userId).maybeSingle<{ date_of_birth: string }>(),
    admin
      .from("guardian_links")
      .select("id, status, guardian_email, guardian_id, invited_at, approved_at, card_checked_at")
      .eq("junior_id", userId)
      .order("invited_at", { ascending: false })
      .limit(5),
    admin.from("guardian_links").select("junior_id, status").eq("guardian_id", userId).in("status", ["pending", "approved"]),
    admin.from("member_age_flags").select("reason, note, created_at, resolved_at").eq("user_id", userId).maybeSingle<{ reason: string; note: string | null; created_at: string; resolved_at: string | null }>(),
    admin
      .from("member_store_age_signals")
      .select("platform, age_lower, age_upper, status, received_at")
      .eq("user_id", userId)
      .maybeSingle<{ platform: string; age_lower: number | null; age_upper: number | null; status: string | null; received_at: string }>(),
  ]);
  // Before 0159 is applied, guardian_links doesn't exist: no panel.
  if (links.error) return null;

  type LinkRow = { id: number; status: string; guardian_email: string; guardian_id: string | null; invited_at: string; approved_at: string | null; card_checked_at: string | null };
  const rows = (links.data ?? []) as LinkRow[];
  const live = rows.find((r) => r.status === "pending" || r.status === "approved") ?? rows[0] ?? null;

  const kidRows = (kids.data ?? []) as { junior_id: string; status: string }[];
  const nameIds = [...new Set([live?.guardian_id, ...kidRows.map((k) => k.junior_id)].filter((x): x is string => !!x))];
  const { data: people } = nameIds.length
    ? await admin.from("profiles").select("id, first_name, last_name").in("id", nameIds)
    : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));

  const dateOfBirth = dob.data?.date_of_birth ?? null;
  const openFlag = !!flag.data && !flag.data.resolved_at;
  return {
    dateOfBirth,
    age: dateOfBirth ? ageFromIso(dateOfBirth) : null,
    band: bandFromFacts({ dateOfBirth, parentApproved: rows.some((r) => r.status === "approved"), openFlag }),
    parentLink: live
      ? {
          id: live.id,
          status: live.status,
          email: live.guardian_email,
          guardianId: live.guardian_id,
          guardianName: live.guardian_id ? nameOf.get(live.guardian_id) ?? null : null,
          invitedAt: live.invited_at,
          approvedAt: live.approved_at,
          cardCheckedAt: live.card_checked_at,
        }
      : null,
    children: kidRows.map((k) => ({ id: k.junior_id, name: nameOf.get(k.junior_id) ?? "Member", status: k.status })),
    flag: flag.data ? { reason: flag.data.reason, note: flag.data.note, createdAt: flag.data.created_at, resolvedAt: flag.data.resolved_at } : null,
    storeSignal: signal.data
      ? { platform: signal.data.platform, lower: signal.data.age_lower, upper: signal.data.age_upper, status: signal.data.status, receivedAt: signal.data.received_at }
      : null,
  };
}

/** Who may switch the parent card check — the roles the table's own update policy allows (0159), plus super admin. */
export const AGE_SETTINGS_ROLES = ["admin", "super_admin"] as const;

/** The age_settings switch, for /admin/age. */
export async function loadAgeSettings(): Promise<{ requireParentCardCheck: boolean; updatedAt: string | null } | null> {
  const { data, error } = await createAdminClient()
    .from("age_settings")
    .select("require_parent_card_check, updated_at")
    .eq("id", true)
    .maybeSingle<{ require_parent_card_check: boolean; updated_at: string }>();
  if (error) return null;
  return { requireParentCardCheck: data?.require_parent_card_check ?? false, updatedAt: data?.updated_at ?? null };
}
