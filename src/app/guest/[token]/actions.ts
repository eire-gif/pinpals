"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { GUEST_COOKIE, PENDING_COOKIE_MAX_AGE, isGuestToken } from "@/lib/find-pinpals";
import { createClient } from "@/lib/supabase/server";

export type ClaimState = { error?: string };

/** Signed in: put the round on your profile now. Signed out: remember it, sign up. */
export async function claimGuestCard(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const token = String(formData.get("token") ?? "").toLowerCase();
  const intent = formData.get("intent");
  if (!isGuestToken(token)) return { error: "That scorecard link isn't valid." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    (await cookies()).set(GUEST_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PENDING_COOKIE_MAX_AGE,
    });
    redirect(intent === "login" ? `/login?next=${encodeURIComponent(`/guest/${token}`)}` : "/signup");
  }

  const { data: roundId, error } = await supabase.rpc("claim_round_guest", { p_token: token });
  if (error) return { error: error.code === "P0001" || error.code === "P0002" ? error.message : "Couldn't save it just now — please try again." };
  redirect(`/live/rounds/${roundId}`);
}
