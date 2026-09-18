"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InviteStatus } from "@/lib/types";
import { notifyInviteCancelled } from "@/lib/tee-times-server";
import {
  confirmPlace,
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

/** Everyone who asked to join, whatever answer they got. Read BEFORE the
 * invite changes, because cancelling is the one case where the rows we need
 * are about to be deleted or made moot. */
async function interestedMemberIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inviteId: number
): Promise<string[]> {
  const { data } = await supabase
    .from("tee_time_interests")
    .select("member_id, status")
    .eq("invite_id", inviteId)
    .in("status", ["pending", "accepted", "confirmed"])
    .returns<{ member_id: string; status: string }[]>();

  return [...new Set((data ?? []).map((row) => row.member_id))];
}

export async function updateInviteStatus(inviteId: number, status: InviteStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Read the invite and its interested members before the update, so a
  // cancellation can still tell the people it affects.
  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("club_name, play_date, member_id")
    .eq("id", inviteId)
    .eq("member_id", user.id)
    .maybeSingle<{ club_name: string; play_date: string; member_id: string }>();

  const recipientIds = status === "cancelled" && invite ? await interestedMemberIds(supabase, inviteId) : [];

  // RLS also enforces this, but checking here keeps the error message useful
  // rather than a silent no-op update.
  const { error } = await supabase
    .from("tee_time_invites")
    .update({ status })
    .eq("id", inviteId)
    .eq("member_id", user.id);

  revalidateTeeTimeViews();

  if (error) {
    return { error: error.message };
  }

  // Nobody should turn up to a round that isn't happening. This is the one
  // notification here that can reach several people at once, and the only
  // one they cannot act on — it exists purely so they aren't left waiting.
  if (status === "cancelled" && invite && recipientIds.length > 0) {
    after(async () => {
      await notifyInviteCancelled(createAdminClient(), {
        hostId: user.id,
        recipientIds,
        invite: { inviteId, clubName: invite.club_name, playDate: invite.play_date },
      });
    });
  }

  return {};
}

export async function deleteInvite(inviteId: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Deleting cascades the interests away (0007's ON DELETE CASCADE), so both
  // the invite details and the recipient list have to be captured first —
  // after the delete there is nothing left to read.
  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("club_name, play_date")
    .eq("id", inviteId)
    .eq("member_id", user.id)
    .maybeSingle<{ club_name: string; play_date: string }>();

  const recipientIds = invite ? await interestedMemberIds(supabase, inviteId) : [];

  const { error } = await supabase
    .from("tee_time_invites")
    .delete()
    .eq("id", inviteId)
    .eq("member_id", user.id);

  revalidateTeeTimeViews();

  if (error) {
    return { error: error.message };
  }

  // Deleting an invite reads to everyone else exactly like cancelling it,
  // so it sends the same notification. The alternative — a member's request
  // vanishing without explanation — is the worse of the two.
  if (invite && recipientIds.length > 0) {
    after(async () => {
      await notifyInviteCancelled(createAdminClient(), {
        hostId: user.id,
        recipientIds,
        invite: { inviteId, clubName: invite.club_name, playDate: invite.play_date },
      });
    });
  }

  return {};
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
