"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error?: string };

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

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard?password_updated=1");
}
