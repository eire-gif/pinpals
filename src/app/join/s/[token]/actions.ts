"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PENDING_COOKIE_MAX_AGE } from "@/lib/find-pinpals";
import { EMAIL_INVITE_COOKIE, emailInvitePath, isEmailInviteToken } from "@/lib/group-invites";
import { createClient } from "@/lib/supabase/server";

export type JoinSocietyState = { error?: string };

/**
 * A society's emailed invitation (0170). Signed in: join now, with this
 * account. Signed out: keep the token, then sign up (the address filled in)
 * or log in — the first signed-in request claims it (middleware), and an
 * account confirmed with the invited address joins anyway (0170's trigger).
 */
export async function joinSociety(_prev: JoinSocietyState, formData: FormData): Promise<JoinSocietyState> {
  const token = String(formData.get("token") ?? "");
  const intent = formData.get("intent");
  const email = String(formData.get("email") ?? "");
  if (!isEmailInviteToken(token)) return { error: "That invitation link isn't valid." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    (await cookies()).set(EMAIL_INVITE_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PENDING_COOKIE_MAX_AGE,
    });
    if (intent === "login") redirect(`/login?next=${encodeURIComponent(emailInvitePath(token))}`);
    redirect(email ? `/signup?email=${encodeURIComponent(email)}` : "/signup");
  }

  const { data: groupId, error } = await supabase.rpc("claim_group_email_invite", { p_token: token });
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't join just now — please try again." };
  redirect(`/groups/${groupId}`);
}
