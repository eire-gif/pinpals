import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getClubById } from "@/lib/courses";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";
import { ageBandForDate } from "@/lib/age";
import { ImageProcessingError, uploadAvatarImage } from "@/lib/images/upload";

/**
 * One member's profile, validated and written.
 *
 * Lifted out of the /profile/edit Server Action so the app's own
 * /api/app/profile route can use the same code rather than a second opinion
 * on it. The rules here are not decoration — a home club must exist in the
 * directory and be in the country claimed, a county must belong to that
 * country, a handicap must be a real index, a date of birth must resolve to
 * an age band. An app that reimplemented those would drift, and the drift
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
  const dobRaw = String(formData.get("dob") || "").trim();
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
      handicap,
      handicap_visible: handicapVisible,
      bio: bio || null,
      gui_membership_number: guiNumber || null,
      // Omitted entirely when the member neither uploaded nor removed a
      // photo, so an ordinary save can never blank an existing one.
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", userId);

  if (error) {
    return { error: error.message };
  }

  // ============ Date of birth ============
  // Its own table, readable only by its owner — see
  // supabase/migrations/0059_member_photos_and_age_bands.sql for why it
  // isn't a column on `profiles`. Written after the profile update rather
  // than alongside it because they're two tables and this one is optional:
  // a member who never fills it in never gets a row.
  if (dobRaw) {
    // Reuses the display helper as the validator: anything it can't turn
    // into a band (unparseable, or in the future) is exactly what shouldn't
    // be stored.
    if (ageBandForDate(dobRaw) === null) {
      return { error: "That date of birth doesn't look right." };
    }

    const { error: dobError } = await supabase
      .from("member_birthdates")
      .upsert(
        { user_id: userId, date_of_birth: dobRaw, age_range_visible: ageRangeVisible },
        { onConflict: "user_id" }
      );

    if (dobError) {
      return { error: dobError.message };
    }
  } else {
    // Cleared the field — remove the row rather than keeping a date with
    // the toggle off. "I'd rather you didn't hold my date of birth" and "I
    // hold it but don't publish it" are different requests, and clearing
    // the field is the first one.
    const { error: dobError } = await supabase
      .from("member_birthdates")
      .delete()
      .eq("user_id", userId);
    if (dobError) {
      return { error: dobError.message };
    }
  }

  return {};
}
