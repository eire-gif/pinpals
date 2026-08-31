"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CLUBS } from "@/lib/clubs";

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
    })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/profile");
  revalidatePath("/community");
  revalidatePath("/tee-times");
  revalidatePath("/dashboard");
  redirect("/profile?saved=1");
}
