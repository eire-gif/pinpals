import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import { GUEST_COOKIE, INVITE_COOKIE, isGuestToken, isInviteCode } from "@/lib/find-pinpals";
import { EMAIL_INVITE_COOKIE, GROUP_INVITE_COOKIE, isEmailInviteToken } from "@/lib/group-invites";
import { isGroupInviteCode } from "@/lib/groups";

// Refreshes the Supabase auth session on every request so server components
// always see an up-to-date cookie. Wired up in proxy.ts at the project root.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touching getUser() is what actually triggers the token refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Find PinPals (0118): an invite or guest scorecard opened before signing
  // up is finished on the first signed-in request, then forgotten. Failures
  // (a blocked member, a claimed card) are dropped with the cookie — the
  // pages themselves explain those when the link is opened again.
  if (user) {
    const invite = request.cookies.get(INVITE_COOKIE)?.value;
    const guest = request.cookies.get(GUEST_COOKIE)?.value;
    // Groups (0120): a group's invite link, opened before signing in.
    const groupInvite = request.cookies.get(GROUP_INVITE_COOKIE)?.value;
    // A society's emailed invitation (0170), opened before signing in.
    const emailInvite = request.cookies.get(EMAIL_INVITE_COOKIE)?.value;
    if (invite || guest || groupInvite || emailInvite) {
      if (isInviteCode(invite)) await supabase.rpc("connect_by_invite", { p_code: invite });
      if (isGuestToken(guest)) await supabase.rpc("claim_round_guest", { p_token: guest });
      if (isGroupInviteCode(groupInvite)) await supabase.rpc("join_group_by_code", { p_code: groupInvite });
      if (isEmailInviteToken(emailInvite)) await supabase.rpc("claim_group_email_invite", { p_token: emailInvite });
      supabaseResponse.cookies.delete(INVITE_COOKIE);
      supabaseResponse.cookies.delete(GUEST_COOKIE);
      supabaseResponse.cookies.delete(GROUP_INVITE_COOKIE);
      supabaseResponse.cookies.delete(EMAIL_INVITE_COOKIE);
    }
  }

  return supabaseResponse;
}
