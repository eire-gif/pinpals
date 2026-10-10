import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";
import { GUEST_COOKIE, INVITE_COOKIE, isGuestToken, isInviteCode } from "@/lib/find-pinpals";

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
    if (invite || guest) {
      if (isInviteCode(invite)) await supabase.rpc("connect_by_invite", { p_code: invite });
      if (isGuestToken(guest)) await supabase.rpc("claim_round_guest", { p_token: guest });
      supabaseResponse.cookies.delete(INVITE_COOKIE);
      supabaseResponse.cookies.delete(GUEST_COOKIE);
    }
  }

  return supabaseResponse;
}
