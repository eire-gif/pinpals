"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { INVITE_COOKIE, PENDING_COOKIE_MAX_AGE, isInviteCode } from "@/lib/find-pinpals";
import { createClient } from "@/lib/supabase/server";

export type JoinState = { error?: string };

/** Signed in: connect now. Signed out: remember the code, then sign up. */
export async function acceptInvite(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const code = String(formData.get("code") ?? "").toLowerCase();
  const intent = formData.get("intent");
  if (!isInviteCode(code)) return { error: "That invite link isn't valid." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    (await cookies()).set(INVITE_COOKIE, code, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PENDING_COOKIE_MAX_AGE,
    });
    redirect(intent === "login" ? `/login?next=${encodeURIComponent(`/join/${code}`)}` : "/signup");
  }

  const { data: owner, error } = await supabase.rpc("connect_by_invite", { p_code: code });
  if (error) return { error: error.code === "P0002" || error.code === "42501" ? error.message : "Couldn't connect just now — please try again." };
  redirect(`/members/${owner}?connected=1`);
}
