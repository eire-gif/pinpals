"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyInterestReceived } from "@/lib/tee-times-server";

export type InterestState = { error?: string; success?: boolean };

export async function expressInterest(
  inviteId: number,
  _prev: InterestState,
  _formData: FormData
): Promise<InterestState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // club_name and play_date are read here rather than in the notification
  // helper: this query already exists, the row is already being fetched to
  // validate against, and the alternative is a second read on a path that
  // runs after the response.
  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("member_id, status, club_name, play_date")
    .eq("id", inviteId)
    .single<{ member_id: string; status: string; club_name: string; play_date: string }>();

  if (!invite) {
    return { error: "This invite is no longer available." };
  }
  if (invite.member_id === user.id) {
    return { error: "You can't express interest in your own invite." };
  }
  if (invite.status !== "open") {
    return { error: "This invite is no longer open." };
  }

  const { data: interest, error } = await supabase
    .from("tee_time_interests")
    .insert({
      invite_id: inviteId,
      member_id: user.id,
    })
    // The id is the notification's dedupe key. Read back the same way the
    // invite insert does in dashboard/availability/new/actions.ts — safe
    // here because the interests read policy tests this row's own columns.
    .select("id")
    .single<{ id: number }>();

  if (error) {
    // Unique violation — they've already expressed interest in this invite.
    if (error.code === "23505") {
      return { error: "You've already expressed interest in this invite." };
    }
    return { error: "Couldn't record your interest — please try again." };
  }

  // Tell the host. Before 0077 this was the gap that made the whole feature
  // feel broken: a member asked to join a round and the host had no way of
  // knowing unless they happened to open their dashboard.
  //
  // Not rate-limited, unlike posting availability: the unique constraint on
  // (invite_id, member_id) caps this at one notification per member per
  // invite, so there is no loop to run.
  if (interest) {
    after(async () => {
      await notifyInterestReceived(createAdminClient(), {
        hostId: invite.member_id,
        applicantId: user.id,
        interestId: interest.id,
        invite: { inviteId, clubName: invite.club_name, playDate: invite.play_date },
      });
    });
  }

  revalidatePath("/tee-times");
  revalidatePath("/tee-times/interested");
  revalidatePath("/tee-times/requests");
  revalidatePath("/dashboard");
  return { success: true };
}
