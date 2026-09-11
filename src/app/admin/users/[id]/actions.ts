"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { MODERATION_ROLES, type ModerationState } from "@/lib/admin/moderation";
import {
  MEMBER_EDIT_ROLES,
  parseMemberProfileEdit,
  summariseProfileChanges,
  type MemberProfileBefore,
} from "@/lib/admin/member-profile";
import { countryName } from "@/lib/regions";
import type { Profile } from "@/lib/types";

// Suspension is enforced via Supabase Auth's own ban mechanism
// (`auth.admin.updateUserById(..., { ban_duration })`), not a new column on
// `profiles`. That means it's real enforcement from day one — a banned user
// can't log in or refresh a session — without a migration or any RLS change,
// and it reuses the same Auth admin client this file already trusts for
// listUsers() elsewhere in src/lib/admin/queries.ts.
//
// There is no "forever" duration in the Auth admin API, so an indefinite
// suspension uses a very long one instead — the same convention widely used
// for "permanent" bans built on a duration-based API. reinstateUser() clears
// it with ban_duration: "none".
const SUSPEND_DURATION = "876000h"; // ~100 years

export async function suspendUser(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!reason) return { error: "A reason is required." };
  if (targetId === user.id) return { error: "You can't suspend your own account." };

  const admin = createAdminClient();

  // Staff accounts are out of scope for this action — moderating a colleague
  // this way would be an easy route to locking out another admin. Role/staff
  // management is a separate, not-yet-built feature.
  const { data: targetStaff } = await admin
    .from("staff_roles")
    .select("user_id")
    .eq("user_id", targetId)
    .maybeSingle();
  if (targetStaff) {
    return { error: "Staff accounts can't be suspended from here." };
  }

  const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: SUSPEND_DURATION });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.suspend",
    targetType: "user",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't suspend this user — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function reinstateUser(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MODERATION_ROLES });
  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!reason) return { error: "A reason is required." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.reinstate",
    targetType: "user",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't reinstate this user — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

const NOTE_MAX_LENGTH = 4000; // matches admin_user_notes' own check constraint

// Unlike suspend/reinstate, adding a note isn't a moderation action — it's
// the "help" half of "Support may view/help; higher roles may suspend"
// (see the project task's own role rules), so this is gated to *any* active
// staff member via a bare requireStaff() call, not MODERATION_ROLES. The
// note itself has no "reason" — the body *is* the content — but every write
// through the service-role client still gets an audit row, per this file's
// own established pattern (see the top-of-file comment in queries.ts).
export async function addUserNote(_prev: ModerationState, formData: FormData): Promise<ModerationState> {
  const { user, staff } = await requireStaff();
  const targetId = String(formData.get("userId") ?? "").trim();
  const body = String(formData.get("note") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!body) return { error: "A note can't be empty." };
  if (body.length > NOTE_MAX_LENGTH) {
    return { error: `Notes are limited to ${NOTE_MAX_LENGTH} characters.` };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("admin_user_notes").insert({
    target_user_id: targetId,
    author_id: user.id,
    author_role: staff.role,
    body,
  });

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.note_added",
    targetType: "user",
    targetId,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message } : undefined,
  });

  if (error) {
    return { error: "Couldn't save this note — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  return { success: true };
}

/**
 * A super admin editing a member's own profile.
 *
 * ============ Why this is gated tighter than moderation ============
 *
 * Everything else in this file changes a *status*: suspended or not, and one
 * click puts it back. This rewrites facts a member entered about themselves —
 * their name, their club, their handicap — and once the row is overwritten the
 * old values exist nowhere but the audit entry written below. That is the same
 * tier as force-removing a listing, so it takes the same role: super_admin
 * alone (MEMBER_EDIT_ROLES).
 *
 * ============ What it will not touch ============
 *
 * - **Email.** It is the login identity, lives in `auth.users`, and changing it
 *   is an account takeover with a friendly name. A member changes their own.
 * - **Date of birth.** Its own table, readable only by its owner by design
 *   (supabase/migrations/0059) — the whole point is that staff never see it.
 *   `handicap_visible` IS editable here, because a super admin fixing a
 *   member's details over the phone needs it; every flip of it is in the diff.
 * - **Profile photo.** Uploads need the member's own Storage folder; there is
 *   no staff path to that bucket and inventing one for this is out of scope.
 * - **Staff roles.** /admin/staff owns those, and deliberately stays separate.
 *
 * The validation is deliberately the same as the member's own form's
 * (parseMemberProfileEdit mirrors updateProfile in
 * src/app/profile/edit/actions.ts): a staff edit must not be able to save a
 * combination a member would have been refused, because the directory, the
 * club pages and the tee-time filters all read these columns assuming it held.
 */
export async function updateMemberProfile(
  _prev: ModerationState,
  formData: FormData
): Promise<ModerationState> {
  const { user, staff } = await requireStaff({ roles: MEMBER_EDIT_ROLES });
  const targetId = String(formData.get("userId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!targetId) return { error: "Missing user id." };
  if (!reason) return { error: "A reason is required." };

  const parsed = parseMemberProfileEdit({
    firstName: String(formData.get("first") ?? ""),
    lastName: String(formData.get("last") ?? ""),
    clubId: String(formData.get("club") ?? ""),
    country: String(formData.get("country") ?? ""),
    county: String(formData.get("county") ?? ""),
    handicap: String(formData.get("handicap") ?? ""),
    handicapVisible: formData.get("handicapVisible") === "on",
    bio: String(formData.get("bio") ?? ""),
    guiNumber: String(formData.get("guiNumber") ?? ""),
  });

  if (!parsed.ok) return { error: parsed.error };

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("profiles")
    .select("*")
    .eq("id", targetId)
    .maybeSingle<Profile>();

  if (!before) return { error: "That member no longer exists." };

  // ============ Home club ============
  // The form submits an id; the display name is re-read from the club row
  // rather than trusted from the request, exactly as the member's own form
  // does — `home_club` is denormalised (0061) and a staff edit that let the
  // two drift apart would be invisible until someone searched for the club.
  let homeClubName: string | null = null;
  if (parsed.values.home_club_id !== null) {
    const { data: club } = await admin
      .from("clubs")
      .select("id, name, country")
      .eq("id", parsed.values.home_club_id)
      .maybeSingle<{ id: number; name: string; country: string }>();

    if (!club) return { error: "Pick the home club from the suggestions." };
    if (club.country !== parsed.values.country) {
      return {
        error: `${club.name} isn't in ${countryName(parsed.values.country)} — pick a club there, or change the country.`,
      };
    }
    homeClubName = club.name;
  }

  // Compared on the columns this action owns, so an unrelated change to the
  // row (an avatar upload, say) can't read as an edit nobody made. Postgres
  // returns numeric as a number through PostgREST, but handicap is coerced
  // anyway so a string never silently reads as "changed".
  const previousValues: MemberProfileBefore = {
    first_name: before.first_name,
    last_name: before.last_name,
    home_club_id: before.home_club_id,
    country: before.country,
    county: before.county,
    handicap: before.handicap == null ? null : Number(before.handicap),
    handicap_visible: before.handicap_visible,
    bio: before.bio,
    gui_membership_number: before.gui_membership_number,
  };

  const changed = summariseProfileChanges(previousValues, parsed.values);
  if (Object.keys(changed).length === 0) {
    // No audit row either: an entry that records a reason for changing
    // nothing is noise in a log whose whole value is that every row means
    // something happened.
    return { error: "Nothing changed — edit a field before saving." };
  }

  const { error } = await admin
    .from("profiles")
    .update({ ...parsed.values, home_club: homeClubName })
    .eq("id", targetId);

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "user.profile_edited",
    targetType: "user",
    targetId,
    reason,
    outcome: error ? "failure" : "success",
    metadata: error ? { error: error.message, changed } : { changed },
  });

  if (error) {
    return { error: "Couldn't save those details — please try again." };
  }

  revalidatePath(`/admin/users/${targetId}`);
  revalidatePath("/admin/users");
  // The member-facing surfaces that read these columns straight off a
  // select("*") — the directory, the club pages, the tee-time list. Same set
  // the member's own edit form revalidates.
  revalidatePath("/community");
  revalidatePath("/courses");
  revalidatePath("/tee-times");
  return { success: true };
}
