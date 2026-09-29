"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { applyProfileUpdate } from "@/lib/profile-update";

export type ProfileFormState = { error?: string };

/**
 * The website's half of saving a profile: authenticate, hand the form to the
 * shared writer, then do the two things only a Next.js page needs — clear
 * the caches that show a member's name, club and photo, and send them to
 * their profile.
 *
 * Every rule that decides whether the form is acceptable lives in
 * src/lib/profile-update.ts, because the app posts the same fields to
 * /api/app/profile and the two must not drift.
 */
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

  const result = await applyProfileUpdate(supabase, user.id, formData);
  if (result.error) {
    return { error: result.error };
  }

  revalidatePath("/profile");
  revalidatePath("/community");
  revalidatePath("/courses");
  revalidatePath("/tee-times");
  revalidatePath("/dashboard");
  redirect("/profile?saved=1");
}
