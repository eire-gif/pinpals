"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { reissueParentLink } from "@/lib/age-access";
import { checkDateOfBirth, dateFromParts, parseAgeAccess } from "@/lib/junior";

/**
 * Junior members (0159): the two things a member does about their own age on
 * the website — enter a date of birth (once), and send a parent the approval
 * email again or to a different address. The app does the same through
 * `set_my_date_of_birth` and POST /api/app/age/parent.
 */

export type DobState = { error?: string; done?: boolean; needsParent?: boolean };

/**
 * A member from before date of birth was asked for enters it, once. The
 * database refuses a second time, a date that makes them under 13, and any
 * change after — those messages are written to be shown.
 */
export async function saveDateOfBirth(_prev: DobState, formData: FormData): Promise<DobState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const checked = checkDateOfBirth(dateFromParts(formData.get("dobDay"), formData.get("dobMonth"), formData.get("dobYear")));
  if (!checked.ok) return { error: checked.error };

  const { data, error } = await supabase.rpc("set_my_date_of_birth", { p_date: checked.date });
  if (error) {
    // 22023 / 42501 are the function's and its trigger's own messages.
    return { error: error.code === "22023" || error.code === "42501" ? error.message : "Couldn't save that just now — please try again." };
  }
  const access = parseAgeAccess(data);
  revalidatePath("/", "layout");
  return { done: true, needsParent: access?.band === "junior_pending" };
}

export type ParentEmailState = { error?: string; sent?: boolean };

/** Same as POST /api/app/age/parent, for the website's waiting panel. */
export async function sendParentRequest(_prev: ParentEmailState, formData: FormData): Promise<ParentEmailState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in again." };

  const limit = await checkRateLimit({ action: "age-parent-email", identifier: user.id, maxHits: 5, windowSeconds: 3600 });
  if (!limit.allowed) return { error: rateLimitMessage(limit.retryAfterSeconds) };

  const result = await reissueParentLink(supabase, user, formData.get("email"));
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return { sent: true };
}
