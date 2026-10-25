import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { postedParams, sameOrigin, switchPageUrl } from "@/lib/auth/account-switch";

/**
 * Redeems the single-use token minted by /api/app/web-session and turns it
 * into cookies, so the rest of the site sees the member the app already knows.
 *
 * This is the only route on the site that starts a session without a password.
 * Four things keep that honest:
 *
 *  - the token can only have come from /api/app/web-session, which required a
 *    valid bearer token for the member it names;
 *  - verifyOtp() is what checks it, so an expired, forged or already-used
 *    token fails in Supabase rather than in a check here that could drift;
 *  - `next` is a same-site path or nothing, so this cannot be used to bounce
 *    somebody to another origin with a fresh session in hand;
 *  - a browser already signed in as somebody else is asked first
 *    (/auth/switch), so a link can't silently swap the account.
 *
 * A failure sends the member to the login page rather than showing an error.
 * From inside the app that reads as "you need to sign in again", which is the
 * truth, and it is recoverable without them having to understand any of this.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("token_hash")) {
    const supabase = await createClient();
    const { data: current } = await supabase.auth.getUser();
    // Already signed in here as the same member? Keep that session. Swapping it
    // for a fresh magic-link session throws away a staff member's two-step
    // sign-in (aal2), so every Admin row the app opened asked for a code again.
    // Safe: this only skips the swap for a browser that already holds that
    // member's own session — the uid in the URL grants nothing by itself.
    if (current.user && current.user.id === url.searchParams.get("uid")) {
      return NextResponse.redirect(new URL(nextPath(url.searchParams), url.origin), 303);
    }
    // Signed in as somebody else: ask first (src/lib/auth/account-switch.ts).
    if (current.user) return NextResponse.redirect(switchPageUrl(url), 303);
  }
  return redeem(url.searchParams, url.origin);
}

/** "Continue" on /auth/switch — only from our own page. */
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  if (!sameOrigin(request)) return NextResponse.redirect(new URL("/login", origin), 303);
  return redeem(await postedParams(request), origin);
}

// The site's strict same-site check. A "starts with / but not //" test let
// "/\evil.com" through, which browsers read as https://evil.com (security
// review, Oct 2026).
function nextPath(params: URLSearchParams): string {
  return safeRedirectPath(params.get("next") ?? "/") ?? "/";
}

async function redeem(params: URLSearchParams, origin: string) {
  const tokenHash = params.get("token_hash");
  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login", origin), 303);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (error) {
    console.warn("[app-session] handoff rejected:", error.message);
    return NextResponse.redirect(new URL("/login", origin), 303);
  }

  // The cookies written by verifyOtp are carried on this redirect, so the
  // very next request — the page the member actually wanted — arrives signed
  // in. The token is spent; a reload of this URL lands on /login, which is
  // correct. 303 so a POST from /auth/switch isn't re-sent to that page.
  return NextResponse.redirect(new URL(nextPath(params), origin), 303);
}
