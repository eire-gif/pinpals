"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PENDING_COOKIE_MAX_AGE } from "@/lib/find-pinpals";
import { GROUP_INVITE_COOKIE } from "@/lib/group-invites";
import { groupInvitePath, isGroupInviteCode } from "@/lib/groups";
import { createClient } from "@/lib/supabase/server";

export type JoinGroupState = { error?: string };

/** Signed in: join now. Signed out: remember the code, then sign up or log in. */
export async function joinGroup(_prev: JoinGroupState, formData: FormData): Promise<JoinGroupState> {
  const code = String(formData.get("code") ?? "").toLowerCase();
  const intent = formData.get("intent");
  if (!isGroupInviteCode(code)) return { error: "That invite link isn't valid." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    (await cookies()).set(GROUP_INVITE_COOKIE, code, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: PENDING_COOKIE_MAX_AGE,
    });
    redirect(intent === "login" ? `/login?next=${encodeURIComponent(groupInvitePath(code))}` : "/signup");
  }

  const { data: groupId, error } = await supabase.rpc("join_group_by_code", { p_code: code });
  // The function's own messages are written for members ("This group is
  // full", "That invite link isn't valid any more").
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't join just now — please try again." };
  redirect(`/groups/${groupId}`);
}
