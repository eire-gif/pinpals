"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CLUBS } from "@/lib/clubs";
import { ageBandForDate } from "@/lib/age";
import { ALLOWED_AVATAR_TYPES, MAX_AVATAR_BYTES, avatarExtensionFor } from "@/lib/avatar";

export type ProfileFormState = { error?: string };

export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const firstName = String(formData.get("first") || "").trim();
  const lastName = String(formData.get("last") || "").trim();
  const homeClub = String(formData.get("club") || "").trim();
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
  if (homeClub && !CLUBS.includes(homeClub)) {
    return { error: "Please choose a home club from the suggested list." };
  }

  const handicap = handicapRaw ? Number(handicapRaw) : null;
  if (handicap !== null && (Number.isNaN(handicap) || handicap < -10 || handicap > 54)) {
    return { error: "That handicap index doesn't look right." };
  }

  // ============ Profile photo ============
  // Uploaded through the Server Action rather than a client-side Storage
  // call: the file is already crossing the wire with the rest of the form,
  // and doing it here means one round trip, one place that validates, and
  // no client component holding a Storage session. The bucket's own
  // policies still scope the write to this member's own folder.
  let avatarUrl: string | null | undefined;

  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    if (!(ALLOWED_AVATAR_TYPES as readonly string[]).includes(avatar.type)) {
      return { error: "Profile photos need to be a JPEG, PNG or WebP image." };
    }
    if (avatar.size > MAX_AVATAR_BYTES) {
      return { error: "That photo is larger than 2MB — please pick a smaller one." };
    }

    // Timestamped rather than a fixed "avatar.jpg": a stable path would be
    // served stale from the CDN and from every <Image> cache for as long as
    // they held it, so a member who changed their photo would keep seeing
    // the old one. A new path each time makes the change immediate. The
    // previous object is left in place — see the deferred cleanup note in
    // this feature's summary; orphaned 2MB objects are cheap next to the
    // risk of deleting a photo a page is mid-render on.
    const path = `${user.id}/avatar-${Date.now()}.${avatarExtensionFor(avatar.type)}`;

    const { error: uploadError } = await supabase.storage
      .from("member-avatars")
      .upload(path, avatar, { contentType: avatar.type, upsert: false });

    if (uploadError) {
      return { error: `Couldn't upload that photo: ${uploadError.message}` };
    }

    avatarUrl = supabase.storage.from("member-avatars").getPublicUrl(path).data.publicUrl;
  } else if (removeAvatar) {
    avatarUrl = null;
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      home_club: homeClub || null,
      county: county || null,
      handicap,
      handicap_visible: handicapVisible,
      bio: bio || null,
      gui_membership_number: guiNumber || null,
      // Omitted entirely when the member neither uploaded nor removed a
      // photo, so an ordinary save can never blank an existing one.
      ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
    })
    .eq("id", user.id);

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
        { user_id: user.id, date_of_birth: dobRaw, age_range_visible: ageRangeVisible },
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
    const { error: dobError } = await supabase.from("member_birthdates").delete().eq("user_id", user.id);
    if (dobError) {
      return { error: dobError.message };
    }
  }

  revalidatePath("/profile");
  revalidatePath("/community");
  revalidatePath("/tee-times");
  revalidatePath("/dashboard");
  redirect("/profile?saved=1");
}
