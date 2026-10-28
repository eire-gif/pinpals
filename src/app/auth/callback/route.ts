import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_POST_LOGIN_PATH, safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Where Google (and Apple, once switched on for the web) send a member back
 * to after "Continue with…" (src/app/auth/social/actions.ts).
 *
 * The `code` is only redeemable by the browser that started the sign-in —
 * its PKCE half is a cookie here — so, unlike an emailed link
 * (/auth/confirm), nobody can send a member a link that signs them in to
 * someone else's account, and there is no "you're already signed in" step.
 *
 * A brand-new account goes to the profile builder, which asks for the date
 * of birth first (0193 holds the account until it's saved); anyone else goes
 * where they were headed, or the dashboard.
 */
const NEW_ACCOUNT_MS = 10 * 60 * 1000;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { origin, searchParams } = url;
  const code = searchParams.get("code");

  // ?error=access_denied is Cancel on the provider's page — back to log in,
  // quietly. Anything else gets the message.
  if (!code) {
    const cancelled = searchParams.get("error") === "access_denied";
    // Connecting Google to an account (Privacy & security) comes back here
    // too; a failure — usually "already has its own PinPals account" —
    // goes back to that page, not to log in.
    if (safeRedirectPath(searchParams.get("next"))?.startsWith("/profile/privacy")) {
      return NextResponse.redirect(`${origin}/profile/privacy${cancelled ? "" : "?link_error=1"}`, 303);
    }
    return NextResponse.redirect(`${origin}/login${cancelled ? "" : "?oauth_error=1"}`, 303);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?oauth_error=1`, 303);
  }

  const isNew = Date.now() - new Date(data.user.created_at).getTime() < NEW_ACCOUNT_MS;
  const destination =
    safeRedirectPath(searchParams.get("next")) ?? (isNew ? "/profile/edit?welcome=1" : DEFAULT_POST_LOGIN_PATH);
  return NextResponse.redirect(`${origin}${destination}`, 303);
}
