import "server-only";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

/**
 * Creating an account — the one implementation behind both the website's
 * sign-up form (src/app/signup/actions.ts) and the app's own sign-up screen
 * (POST /api/app/signup). Two copies would drift, and the drift that matters
 * here is a rule one of them forgets: a rate limit, a validation, a gate.
 *
 * Email confirmation is on, so this never returns a session. The member
 * confirms from the email (supabase/templates/confirm-signup.html), whose
 * link is /auth/confirm on the website — and, on an iPhone with the app,
 * opens the app instead (the apple-app-site-association claims it).
 */

export type SignUpInput = { firstName: string; lastName: string; email: string; password: string };
export type SignUpResult = { ok: true } | { ok: false; error: string };

// By IP: signup itself is the abuse surface here (mass account creation),
// not any single email address.
const SIGNUP_MAX_ATTEMPTS = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;

export const MIN_SIGNUP_PASSWORD = 6;

/** Where the site is, for the confirmation link Supabase builds. */
function siteUrl(): string {
  // Prefer an explicit override, then Vercel's own production-domain env var
  // (always set on Vercel, no manual config needed), then the deployment's
  // own URL, then localhost for local dev.
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000")
  );
}

export async function signUpMember(raw: Partial<Record<keyof SignUpInput, unknown>>): Promise<SignUpResult> {
  const rateLimit = await checkRateLimit({
    action: "signup",
    maxHits: SIGNUP_MAX_ATTEMPTS,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { ok: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const firstName = String(raw.firstName ?? "").trim();
  const lastName = String(raw.lastName ?? "").trim();
  const email = String(raw.email ?? "").trim();
  const password = String(raw.password ?? "");

  if (!firstName || !lastName || !email || password.length < MIN_SIGNUP_PASSWORD) {
    return { ok: false, error: "Please fill in every field — passwords need at least 6 characters." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { first_name: firstName, last_name: lastName },
      emailRedirectTo: `${siteUrl()}/auth/confirm`,
    },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
