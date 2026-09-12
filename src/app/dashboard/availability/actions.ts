"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InviteStatus } from "@/lib/types";
import {
  notifyInterestDeclined,
  notifyInviteCancelled,
  notifyPlaceConfirmed,
  notifyPlaceOffered,
  notifyPlaceWithdrawn,
  type InviteRef,
} from "@/lib/tee-times-server";

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

type RespondRow = {
  interest_id: number;
  applicant_id: string;
  invite_id: number;
  club_name: string;
  play_date: string;
  new_status: string;
  spaces_remaining: number;
};

/**
 * The host offers a place, or declines.
 *
 * Everything that used to live here in TypeScript — the ownership check, the
 * pending check, the space decrement, closing the invite when it fills — is
 * now inside respond_to_tee_time_interest() (0077), which takes a row lock
 * on the invite first. The old version read the count, subtracted one in
 * JavaScript and wrote it back, so a double-click could offer the same seat
 * twice; and because it wrote `Math.max(0, n - 1)` against a column
 * constrained `>= 1`, filling the last space failed outright while leaving
 * the interest marked accepted.
 */
export async function respondToInterest(interestId: number, accept: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.rpc("respond_to_tee_time_interest", {
    p_interest_id: interestId,
    p_accept: accept,
  });

  if (error) {
    // The function raises with member-facing sentences ("That request has
    // already been answered."), so the message is shown as-is rather than
    // replaced with something vaguer.
    return { error: error.message };
  }

  const result = (data as RespondRow[] | null)?.[0];
  revalidateTeeTimeViews();

  if (result) {
    const invite: InviteRef = {
      inviteId: result.invite_id,
      clubName: result.club_name,
      playDate: result.play_date,
    };

    after(async () => {
      const admin = createAdminClient();
      if (accept) {
        await notifyPlaceOffered(admin, {
          applicantId: result.applicant_id,
          hostId: user.id,
          interestId: result.interest_id,
          invite,
        });
      } else {
        await notifyInterestDeclined(admin, {
          applicantId: result.applicant_id,
          hostId: user.id,
          interestId: result.interest_id,
          invite,
        });
      }
    });
  }

  return {};
}

type ConfirmRow = {
  interest_id: number;
  host_id: string;
  invite_id: number;
  club_name: string;
  play_date: string;
  new_status: string;
};

/**
 * The golfer confirms their place, or drops out.
 *
 * Same move as respondToInterest above: the status check and the
 * hand-the-space-back arithmetic are now in confirm_tee_time_place() (0077)
 * behind the same row lock, so a member dropping out while the host is
 * accepting somebody else can't lose or duplicate a space.
 */
export async function confirmTeeTimePlace(interestId: number, attending: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("confirm_tee_time_place", {
    p_interest_id: interestId,
    p_attending: attending,
  });

  if (error) {
    return { error: error.message };
  }

  const result = (data as ConfirmRow[] | null)?.[0];
  revalidateTeeTimeViews();

  if (result) {
    const invite: InviteRef = {
      inviteId: result.invite_id,
      clubName: result.club_name,
      playDate: result.play_date,
    };

    after(async () => {
      const admin = createAdminClient();
      if (attending) {
        await notifyPlaceConfirmed(admin, {
          hostId: result.host_id,
          applicantId: user.id,
          interestId: result.interest_id,
          invite,
        });
      } else {
        await notifyPlaceWithdrawn(admin, {
          hostId: result.host_id,
          applicantId: user.id,
          interestId: result.interest_id,
          invite,
        });
      }
    });
  }

  return {};
}
