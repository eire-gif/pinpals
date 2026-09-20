import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Redeems the single-use token minted by /api/app/web-session and turns it
 * into cookies, so the rest of the site sees the member the app already knows.
 *
 * This is the only route on the site that starts a session without a password.
 * Three things keep that honest:
 *
 *  - the token can only have come from /api/app/web-session, which required a
 *    valid bearer token for the member it names;
 *  - verifyOtp() is what checks it, so an expired, forged or already-used
 *    token fails in Supabase rather than in a check here that could drift;
 *  - `next` is a same-site path or nothing, so this cannot be used to bounce
 *    somebody to another origin with a fresh session in hand.
 *
 * A failure sends the member to the login page rather than showing an error.
 * From inside the app that reads as "you need to sign in again", which is the
 * truth, and it is recoverable without them having to understand any of this.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const nextParam = url.searchParams.get("next") ?? "/";

  // Same rule as the minting route. Repeated rather than shared because a
  // redirect target arriving from the network is the thing being guarded, and
  // it should be impossible to weaken both ends by editing one file.
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (error) {
    console.warn("[app-session] handoff rejected:", error.message);
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  // The cookies written by verifyOtp are carried on this redirect, so the
  // very next request — the page the member actually wanted — arrives signed
  // in. The token is spent; a reload of this URL lands on /login, which is
  // correct.
  return NextResponse.redirect(new URL(next, url.origin));
}
