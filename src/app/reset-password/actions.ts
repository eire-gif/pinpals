"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

export type ResetPasswordState = { error?: string };

// By user id, not IP: this action only ever runs for an already-established
// recovery session, so a real user id is always available and is the more
// precise key.
const RESET_PASSWORD_MAX_ATTEMPTS = 10;
const RESET_PASSWORD_WINDOW_SECONDS = 60 * 60;

export async function updatePassword(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < 6) {
    return { error: "Your new password needs to be at least 6 characters." };
  }
  if (password !== confirm) {
    return { error: "The two passwords don't match — please retype them." };
  }

  const supabase = await createClient();

  // The recovery link (verified in /auth/confirm) leaves the user with a valid
  // session. If there isn't one, the link was never used, has expired, or was
  // opened in a different browser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error:
        "This reset link has expired or isn't valid anymore. Please request a new one from the Forgot password page.",
    };
  }

  const rateLimit = await checkRateLimit({
    action: "reset-password",
    identifier: user.id,
    maxHits: RESET_PASSWORD_MAX_ATTEMPTS,
    windowSeconds: RESET_PASSWORD_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard?password_updated=1");
}
