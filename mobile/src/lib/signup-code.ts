import { supabase } from "@/lib/supabase";

/**
 * Confirming a new account with the code in the sign-up email (Oct 2026).
 *
 * The email carries both a link and a code. The link opens the app only when
 * everything lines up — an iPhone with the app, a mail app that hands links
 * to iOS (Gmail often doesn't), the phone holding a fresh copy of the
 * website's apple-app-site-association. The code works whatever the member
 * reads their email in, so the app asks for it straight after sign-up and the
 * member never leaves the app.
 *
 * Supabase's email codes are 6 digits by default and the project setting
 * allows up to 10, so anything 6–10 digits long is accepted.
 */

export const CODE_MIN = 6;
export const CODE_MAX = 10;

/** Digits only, capped at the longest code Supabase sends. Spaces and dashes
 *  from a pasted or autofilled code are dropped. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, CODE_MAX);
}

export function isCompleteCode(code: string): boolean {
  return code.length >= CODE_MIN && code.length <= CODE_MAX;
}

/** Turns Supabase's verify errors into something a golfer can act on. */
export function codeErrorMessage(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("expired") || m.includes("invalid") || m.includes("otp")) {
    return "That code isn't right or has expired. Check the latest email, or send a new code.";
  }
  if (m.includes("rate") || m.includes("too many")) {
    return "Too many tries. Wait a minute, then try again.";
  }
  return "Couldn't confirm your account. Please try again.";
}

/** Where a newly signed-in member goes: the profile builder until they've
 *  finished it, Home after that. Used by the code screen and auth-confirm. */
export async function routeAfterSignIn(userId: string): Promise<"/onboarding" | "/(tabs)"> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", userId)
    .maybeSingle<{ onboarded_at: string | null }>();
  return profile?.onboarded_at ? "/(tabs)" : "/onboarding";
}

export type ConfirmResult = { ok: true; next: "/onboarding" | "/(tabs)" } | { ok: false; error: string };

/** Checks the emailed code and signs the member in. */
export async function confirmWithCode(email: string, code: string): Promise<ConfirmResult> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  const userId = data.user?.id ?? data.session?.user?.id;
  if (error || !userId) return { ok: false, error: codeErrorMessage(error?.message) };
  return { ok: true, next: await routeAfterSignIn(userId) };
}

/** Sends the sign-up email again: a new code and a new link. */
export async function resendSignupCode(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (!error) return { ok: true };
  const m = error.message.toLowerCase();
  if (m.includes("seconds") || m.includes("rate")) {
    return { ok: false, error: "A code was sent a moment ago. Give it a minute, then try again." };
  }
  return { ok: false, error: "Couldn't send a new code. Please try again." };
}
