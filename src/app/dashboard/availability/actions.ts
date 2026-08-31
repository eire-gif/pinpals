"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { InviteStatus } from "@/lib/types";

export async function updateInviteStatus(inviteId: number, status: InviteStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS also enforces this, but checking here keeps the error message useful
  // rather than a silent no-op update.
  const { error } = await supabase
    .from("tee_time_invites")
    .update({ status })
    .eq("id", inviteId)
    .eq("member_id", user.id);

  revalidatePath("/dashboard");
  revalidatePath("/tee-times");

  if (error) {
    return { error: error.message };
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

  const { error } = await supabase
    .from("tee_time_invites")
    .delete()
    .eq("id", inviteId)
    .eq("member_id", user.id);

  revalidatePath("/dashboard");
  revalidatePath("/tee-times");

  if (error) {
    return { error: error.message };
  }
  return {};
}

export async function respondToInterest(interestId: number, accept: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS already restricts this update to the invite's host, but we need the
  // invite_id (and whether this was already resolved) for the follow-up step.
  const { data: interest } = await supabase
    .from("tee_time_interests")
    .select("invite_id, status")
    .eq("id", interestId)
    .single();

  if (!interest) {
    return { error: "That request no longer exists." };
  }

  const { error } = await supabase
    .from("tee_time_interests")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", interestId);

  if (error) {
    return { error: error.message };
  }

  // Accepting fills one space on the invite, and closes it out once they're
  // all gone, so the host doesn't have to remember to do that manually.
  if (accept && interest.status === "pending") {
    const { data: invite } = await supabase
      .from("tee_time_invites")
      .select("spaces_available")
      .eq("id", interest.invite_id)
      .single();

    if (invite) {
      const remaining = Math.max(0, invite.spaces_available - 1);
      await supabase
        .from("tee_time_invites")
        .update({
          spaces_available: remaining,
          status: remaining === 0 ? "full" : "open",
        })
        .eq("id", interest.invite_id);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/tee-times");
  return {};
}
