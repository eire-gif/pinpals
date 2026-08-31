import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase sends the confirmation email link here with a `token_hash` + `type`.
// We exchange it for a real session, then send new users straight into onboarding.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as "email" | "signup" | "recovery" | "email_change",
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(`${origin}/profile/edit?welcome=1`);
    }
  }

  return NextResponse.redirect(`${origin}/login?confirm_error=1`);
}
