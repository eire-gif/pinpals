import "server-only";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { ageFromIso, checkDateOfBirth, checkParentEmail, signupAgeOutcome, UNDER_13_MESSAGE } from "@/lib/junior";
import { newParentToken } from "@/lib/parent-link-token";
import { sendParentEmail } from "@/lib/age-access";

/**
 * Creating an account — the one implementation behind both the website's
 * sign-up form (src/app/signup/actions.ts) and the app's own sign-up screen
 * (POST /api/app/signup). Two copies would drift, and the drift that matters
 * here is a rule one of them forgets: a rate limit, a validation, a gate.
 *
 * Email confirmation is on, so this never returns a session. The member
 * confirms from the email (supabase/templates/confirm-signup.html), whose
 * link is /auth/confirm on the website — and, on an iPhone with the app,
 * opens the app instead (the apple-app-site-association claims it). The same
 * email carries a code, which the app's sign-up screen asks for — the route
 * that never depends on how a mail app treats links.
 *
 * DATE OF BIRTH (0159, claude/junior-members.md). Required. Under 13 is
 * turned away here, before an account exists. 13–15 also needs a parent's
 * email: a secret is made here, its SHA-256 goes to the database in the
 * sign-up metadata with the date of birth and the parent's email, and the
 * secret itself goes only into the email to the parent. The database's
 * sign-up trigger (member_age_from_signup) stores all three in the same
 * transaction that creates the account and strips them from auth.users, so
 * no account exists without the date it was made with.
 */

export type SignUpInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  /** Required for 13–15 year olds. */
  parentEmail?: string;
};
export type SignUpResult = { ok: true; needsParent: boolean } | { ok: false; error: string; code?: "under_13" };

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
  const firstName = String(raw.firstName ?? "").trim();
  const lastName = String(raw.lastName ?? "").trim();
  const email = String(raw.email ?? "").trim();
  const password = String(raw.password ?? "");

  if (!firstName || !lastName || !email || password.length < MIN_SIGNUP_PASSWORD) {
    return { ok: false, error: "Please fill in every field — passwords need at least 6 characters." };
  }

  // Checked before the rate limit: a mistyped date shouldn't use up one of
  // five attempts an hour, and nothing here touches the database.
  const dob = checkDateOfBirth(raw.dateOfBirth);
  if (!dob.ok) return { ok: false, error: dob.error };
  const outcome = signupAgeOutcome(ageFromIso(dob.date));
  if (outcome === "under_13") return { ok: false, error: UNDER_13_MESSAGE, code: "under_13" };

  let parent: { email: string; token: string; hash: string } | null = null;
  if (outcome === "needs_parent") {
    const checked = checkParentEmail(raw.parentEmail, email);
    if (!checked.ok) return { ok: false, error: checked.error };
    parent = { email: checked.email, ...newParentToken() };
  }

  const rateLimit = await checkRateLimit({
    action: "signup",
    failClosed: true,
    maxHits: SIGNUP_MAX_ATTEMPTS,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { ok: false, error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        // Read and removed by the database's sign-up trigger (0159) — never
        // kept in auth.users.
        date_of_birth: dob.date,
        ...(parent ? { guardian_email: parent.email, guardian_token_hash: parent.hash } : {}),
      },
      emailRedirectTo: `${siteUrl()}/auth/confirm`,
    },
  });

  if (error) return { ok: false, error: error.message };

  // An email that already has an account gets Supabase's look-alike success
  // (no identities, nothing created) so sign-up can't be used to test who's
  // a member. Nothing was stored, so no parent is emailed either.
  const created = (data.user?.identities?.length ?? 0) > 0;
  if (parent && created) {
    await sendParentEmail({ to: parent.email, childFirstName: firstName, token: parent.token });
  }
  return { ok: true, needsParent: !!parent };
}
