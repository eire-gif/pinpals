import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase sends confirmation + password-recovery email links here with a
// `token_hash` + `type`. We exchange the token for a real session, then forward
// the user on:
//   - signup confirmations -> profile setup (the default when no `next` is given)
//   - password recovery     -> /reset-password (passed as `next` by the reset email)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as "email" | "signup" | "recovery" | "email_change",
      token_hash: tokenHash,
    });

    if (!error) {
      // Only allow same-site relative redirects from `next` (guards against an
      // open-redirect via a tampered link).
      const destination =
        next && next.startsWith("/") ? next : "/profile/edit?welcome=1";
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  // Send recovery failures back to the reset request page, everything else to login.
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }
  return NextResponse.redirect(`${origin}/login?confirm_error=1`);
}
