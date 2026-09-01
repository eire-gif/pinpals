"use server";

import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { error?: string; success?: boolean };

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") || "").trim();

  if (!email) {
    return { error: "Please enter the email address for your account." };
  }

  const supabase = await createClient();

  // Same site-URL resolution the signup flow uses: an explicit override first,
  // then Vercel's production domain, then its preview URL, then localhost.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  // The recovery email link lands on /auth/confirm, which verifies the token
  // and then forwards the (now signed-in) user to /reset-password to choose a
  // new password.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/confirm?next=/reset-password`,
  });

  if (error) {
    return { error: error.message };
  }

  // Always report success even if the email isn't registered — this avoids
  // revealing which addresses have accounts.
  return { success: true };
}
