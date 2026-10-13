import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "./types";

/**
 * A member's handicap and Golf Ireland membership number, from
 * member_private (0133) — readable by that member alone. The copies on
 * `profiles` are what everyone else sees: the handicap only while the member
 * shows it, the membership number never.
 *
 * withPrivateDetails() lays the real values over a profile row: for a member's
 * own pages (their client can read only their own row), and for the admin
 * tools (the service role reads anyone's).
 */
export async function loadPrivateDetails(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ handicap: number | null; gui_membership_number: string | null }> {
  const { data } = await supabase
    .from("member_private")
    .select("handicap, gui_membership_number")
    .eq("member_id", memberId)
    .maybeSingle<{ handicap: number | string | null; gui_membership_number: string | null }>();
  return {
    handicap: data?.handicap == null ? null : Number(data.handicap),
    gui_membership_number: data?.gui_membership_number ?? null,
  };
}

export async function withPrivateDetails<P extends Pick<Profile, "handicap" | "gui_membership_number">>(
  supabase: SupabaseClient,
  memberId: string,
  profile: P | null
): Promise<P | null> {
  if (!profile) return profile;
  const mine = await loadPrivateDetails(supabase, memberId);
  return { ...profile, ...mine };
}
