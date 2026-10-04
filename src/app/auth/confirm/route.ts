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
  const code = searchParams.get("code");
  // Only allow same-site relative redirects from `next` (guards against an
  // open-redirect via a tampered link).
  const destination = next && next.startsWith("/") ? next : "/profile/edit?welcome=1";

  // Supabase's DEFAULT confirmation email links through Supabase's own
  // verify endpoint, which confirms the address and then lands here with a
  // PKCE `code` rather than a token_hash. Without this branch those members
  // were confirmed but sent to /login with an error. The branded templates
  // (supabase/templates/) use token_hash below; this keeps any default-
  // template email already in someone's inbox working too.
  if (code && !tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${destination}`);
    // The code is tied to the browser that signed up. Opened elsewhere, the
    // address is still confirmed: say so, rather than "something went wrong".
    return NextResponse.redirect(`${origin}/login?confirmed=1`);
  }

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as "email" | "signup" | "recovery" | "email_change",
      token_hash: tokenHash,
    });

    if (!error) return NextResponse.redirect(`${origin}${destination}`);
  }

  // Send recovery failures back to the reset request page, everything else to login.
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }
  return NextResponse.redirect(`${origin}/login?confirm_error=1`);
}
