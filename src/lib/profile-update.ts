import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getClubById } from "@/lib/courses";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";
import { ImageProcessingError, uploadAvatarImage } from "@/lib/images/upload";

/**
 * One member's profile, validated and written.
 *
 * Lifted out of the /profile/edit Server Action so the app's own
 * /api/app/profile route can use the same code rather than a second opinion
 * on it. The rules here are not decoration — a home club must exist in the
 * directory and be in the country claimed, a county must belong to that
 * country, a handicap must be a real index. (The date of birth is set once,
 * elsewhere — see the age-range section below.) An app that reimplemented those would drift, and the drift
 * would show up as a member whose profile the website rejects and the app
 * accepts.
 *
 * Takes FormData because both callers already have one: the website from a
 * <form action>, the app from the multipart body it posts. Everything after
 * parsing is shared.
 *
 * What stays with the callers is what is genuinely theirs — the website's
 * revalidatePath/redirect, and the app's JSON response.
 */

export type ProfileUpdateResult = { error?: string };

export async function applyProfileUpdate(
  supabase: SupabaseClient,
  userId: string,
  formData: FormData
): Promise<ProfileUpdateResult> {
  const firstName = String(formData.get("first") || "").trim();
  const lastName = String(formData.get("last") || "").trim();
  const clubIdRaw = String(formData.get("club") || "").trim();
  const country = String(formData.get("country") || "").trim();
  const county = String(formData.get("county") || "").trim();
  const handicapRaw = String(formData.get("handicap") || "").trim();
  const handicapVisible = formData.get("handicapVisible") === "on";
  const bio = String(formData.get("bio") || "").trim();
  const guiNumber = String(formData.get("guiNumber") || "").trim();
  const ageRangeVisible = formData.get("ageRangeVisible") === "on";
  const removeAvatar = formData.get("removeAvatar") === "on";

  if (!firstName || !lastName) {
    return { error: "First and last name can't be empty." };
  }
  if (!isCountryCode(country)) {
    return { error: "Please choose the country you play in." };
  }

  // ============ Home club ============
  // The form submits the club's id, and the name and country are re-read
  // from the club row here rather than trusted from the request. The picker
  // leaves the id empty when the member typed a name that matched nothing,
  // which is exactly the case that has to be refused — `home_club_id` is a
  // foreign key, and a member cannot be a member of a club that isn't in the
  // directory. Clearing the field entirely is still allowed.
  let homeClub: string | null = null;
  let homeClubId: number | null = null;

  if (clubIdRaw) {
    const clubId = Number.parseInt(clubIdRaw, 10);
    if (!Number.isFinite(clubId)) {
      return { error: "Please pick your home club from the suggestions." };
    }

    const club = await getClubById(clubId);
    if (!club) {
      return { error: "Please pick your home club from the suggestions." };
    }
    if (club.country !== country) {
      return {
        error: `${club.name} isn't in ${countryName(country)} — pick a club in the country you selected, or change the country.`,
      };
    }

    homeClub = club.name;
    homeClubId = club.id;
  }

  // A county that doesn't belong to the chosen country is rejected rather
  // than silently dropped: the two arrive as independent fields, and saving
  // "Scotland / Kerry" would then show up in the directory as a real
  // location nobody could search for.
  if (county && !isRegionInCountry(country, county)) {
    return { error: `That county isn't in ${countryName(country)}.` };
  }

  const handicap = handicapRaw ? Number(handicapRaw) : null;
  if (handicap !== null && (Number.isNaN(handicap) || handicap < -10 || handicap > 54)) {
    return { error: "That handicap index doesn't look right." };
  }

  // ============ Profile photo ============
  // Through uploadAvatarImage() — which re-encodes with sharp — rather than
  // a raw Storage upload of the original file. member-avatars is a PUBLIC
  // bucket, and a photo straight off a phone carries EXIF, and EXIF carries
  // GPS: this used to upload the file as-is, which published the
  // coordinates of wherever the photo was taken to anyone who opened its
  // URL. Listing photos have gone through sharp for that exact reason since
  // the pipeline was written. See src/lib/images/upload.ts.
  let avatarUrl: string | null | undefined;

  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    try {
      avatarUrl = await uploadAvatarImage(supabase, userId, avatar);
    } catch (err) {
      // ImageProcessingError messages are written to be shown; anything else
      // is not, so it does not get shown.
      return {
        error:
          err instanceof ImageProcessingError
            ? err.message
            : "Couldn't upload that photo — please try a different file.",
      };
    }
  } else if (removeAvatar) {
    avatarUrl = null;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      home_club: homeClub,
      home_club_id: homeClubId,
      country,
      county: county || null,
      handicap_visible: handicapVisible,
      bio: bio || null,
      // Omitted entirely when the member neither uploaded nor removed a
      // photo, so an ordinary save can never blank an existing one.
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  // ============ Handicap and membership number ============
  // Owner-only, in member_private (0133). Written after the profile so the
  // shared copy others see follows the "show my handicap" choice just made.
  const { error: privateError } = await supabase
    .from("member_private")
    .upsert(
      { member_id: userId, handicap, gui_membership_number: guiNumber || null, updated_at: new Date().toISOString() },
      { onConflict: "member_id" }
    );
  if (privateError) {
    return { error: privateError.message };
  }

  // ============ Age range on the profile ============
  // The date of birth itself is no longer written here (0159): it's entered
  // once — at sign-up, or once by an existing member through
  // set_my_date_of_birth — and then only staff can change it, because what a
  // member may do on PinPals now depends on it. This form keeps only the
  // "show my age range" switch, on the row that already exists. A member
  // with no date yet has no row, and nothing to show.
  const { error: ageRangeError } = await supabase
    .from("member_birthdates")
    .update({ age_range_visible: ageRangeVisible })
    .eq("user_id", userId);
  if (ageRangeError) {
    return { error: ageRangeError.message };
  }

  return {};
}
