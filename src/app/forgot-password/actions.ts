"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

export type ForgotPasswordState = { error?: string; success?: boolean };

// By IP: this endpoint sends real email, so an unlimited caller can be used
// to spam/harass arbitrary inboxes even without ever learning which emails
// have accounts (the response is deliberately the same either way — see
// the comment at the bottom of this function).
const FORGOT_PASSWORD_MAX_ATTEMPTS = 5;
const FORGOT_PASSWORD_WINDOW_SECONDS = 60 * 60;

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const rateLimit = await checkRateLimit({
    action: "forgot-password",
    maxHits: FORGOT_PASSWORD_MAX_ATTEMPTS,
    windowSeconds: FORGOT_PASSWORD_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

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
