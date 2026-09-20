"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createInvite } from "@/lib/tee-time-invites";

export type PostAvailabilityState = { error?: string };

/**
 * The website's post-a-tee-time form.
 *
 * Thin on purpose: every rule about what makes a valid invite — the club, the
 * county, the times, the audience, the rate limit, and the fan-out to the
 * host's connections — lives in createInvite(), which the app's
 * /api/app/tee-times/invites route calls too. This function's only job is to
 * turn FormData into that call and turn the answer into what the form expects.
 */
export async function postAvailability(
  _prev: PostAvailabilityState,
  formData: FormData
): Promise<PostAvailabilityState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const result = await createInvite(supabase, user.id, {
    clubId: formData.get("club"),
    country: formData.get("country"),
    county: formData.get("county"),
    playDate: formData.get("playDate"),
    timeFrom: formData.get("timeFrom"),
    timeTo: formData.get("timeTo"),
    exactTeeTime: formData.get("exactTeeTime"),
    spaces: formData.get("spaces"),
    // An unticked checkbox posts nothing at all; createInvite reads a missing
    // value as false.
    hasTeeTime: formData.get("hasTeeTime"),
    handicapLimit: formData.get("handicapLimit"),
    notes: formData.get("notes"),
    visibility: formData.get("visibility"),
    ladiesOnly: formData.get("ladiesOnly"),
  });

  if (!result.ok) {
    return { error: result.message };
  }

  redirect("/dashboard?posted=1");
}
