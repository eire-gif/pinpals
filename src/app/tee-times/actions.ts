"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  const { data: invite } = await supabase
    .from("tee_time_invites")
    .select("member_id, status")
    .eq("id", inviteId)
    .single();

  if (!invite) {
    return { error: "This invite is no longer available." };
  }
  if (invite.member_id === user.id) {
    return { error: "You can't express interest in your own invite." };
  }
  if (invite.status !== "open") {
    return { error: "This invite is no longer open." };
  }

  const { error } = await supabase.from("tee_time_interests").insert({
    invite_id: inviteId,
    member_id: user.id,
  });

  if (error) {
    // Unique violation — they've already expressed interest in this invite.
    if (error.code === "23505") {
      return { error: "You've already expressed interest in this invite." };
    }
    return { error: "Couldn't record your interest — please try again." };
  }

  revalidatePath("/tee-times");
  revalidatePath("/dashboard");
  return { success: true };
}
