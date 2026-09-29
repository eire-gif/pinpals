"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { InviteStatus } from "@/lib/types";
import {
  changeInviteStatus,
  confirmPlace,
  removeInvite,
  respondToInterest as respondToInterestFor,
} from "@/lib/tee-times-operations";

/** Every page that shows an interest or a space count. Revalidating all of
 * them from one place keeps the three tee-time tabs and the dashboard from
 * disagreeing about whose turn it is. */
function revalidateTeeTimeViews() {
  revalidatePath("/dashboard");
  revalidatePath("/tee-times");
  revalidatePath("/tee-times/interested");
  revalidatePath("/tee-times/requests");
}

export async function updateInviteStatus(inviteId: number, status: InviteStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // The work, and crucially the cancellation notice, live in
  // src/lib/tee-times-operations.ts so the app's own route performs the
  // identical sequence. See that module's header for why the notification is
  // scheduled inside it rather than by whoever calls it.
  const result = await changeInviteStatus(supabase, user.id, inviteId, status);

  revalidateTeeTimeViews();

  return result.ok ? {} : { error: result.message };
}

export async function deleteInvite(inviteId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const result = await removeInvite(supabase, user.id, inviteId);

  revalidateTeeTimeViews();

  return result.ok ? {} : { error: result.message };
}

/**
 * The host offers a place, or declines.
 *
 * The work — respond_to_tee_time_interest() (0077) behind its row lock, then
 * telling the applicant — moved to src/lib/tee-times-operations.ts so the iOS
 * app can perform the identical sequence through an API route. Crucially the
 * notification is scheduled inside that function, not here: a caller that had
 * to remember to notify would eventually forget, and a fourball that fills
 * without telling anyone is the failure this is guarding against.
 */
export async function respondToInterest(interestId: number, accept: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const result = await respondToInterestFor(supabase, user.id, interestId, accept);

  if (!result.ok) {
    // The RPC raises member-facing sentences, passed through unchanged.
    return { error: result.message };
  }

  revalidateTeeTimeViews();
  return {};
}

/**
 * The golfer confirms their place, or drops out.
 *
 * Same move as respondToInterest above.
 */
export async function confirmTeeTimePlace(interestId: number, attending: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const result = await confirmPlace(supabase, user.id, interestId, attending);

  if (!result.ok) {
    return { error: result.message };
  }

  revalidateTeeTimeViews();
  return {};
}
