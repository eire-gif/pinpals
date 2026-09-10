"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";

export type OnboardingState = { error?: string };

/**
 * Step 1 — where you play.
 *
 * Validated exactly the way updateProfile() validates the same two fields
 * (src/app/profile/edit/actions.ts): a county that doesn't belong to the
 * chosen country is refused rather than silently dropped, because saving
 * "Scotland / Kerry" puts a member in the directory at a location nobody
 * can search for.
 */
export async function saveLocation(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const country = String(formData.get("country") || "").trim();
  const county = String(formData.get("county") || "").trim();

  if (!isCountryCode(country)) {
    return { error: "Please choose where you play." };
  }
  if (county && !isRegionInCountry(country, county)) {
    return { error: `That county isn't in ${countryName(country)}.` };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ country, county: county || null })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/onboarding");
  redirect("/onboarding?step=2");
}

/** Step 2 — handicap, and whether to show it. Both optional. */
export async function saveGame(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const handicapRaw = String(formData.get("handicap") || "").trim();
  const handicapVisible = formData.get("handicapVisible") === "on";

  const handicap = handicapRaw ? Number(handicapRaw) : null;
  if (handicap !== null && (Number.isNaN(handicap) || handicap < -10 || handicap > 54)) {
    return { error: "That handicap index doesn't look right." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ handicap, handicap_visible: handicapVisible })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/onboarding");
  redirect("/onboarding?step=3");
}
