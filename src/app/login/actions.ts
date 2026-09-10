"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";

export type LoginState = { error?: string };

// By IP, not by email: a limit keyed on email alone would let an attacker
// credential-stuff an unbounded number of email addresses from one source
// without ever tripping it. 10 attempts / 5 minutes is generous enough for
// a person mistyping their password a few times, tight enough to blunt a
// scripted brute force.
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_SECONDS = 5 * 60;

export async function logIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rateLimit = await checkRateLimit({
    action: "login",
    maxHits: LOGIN_MAX_ATTEMPTS,
    windowSeconds: LOGIN_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return { error: rateLimitMessage(rateLimit.retryAfterSeconds) };
  }

  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  const supabase = await createClient();

  // ============ Existing members must keep getting in ============
  //
  // There is deliberately NO password-length check here, and there must
  // never be one. The minimum in src/lib/passwords.ts governs CHOOSING a
  // password — sign-up and reset — not proving you already know one. It was
  // raised from 6 to 10, and every member whose password predates that
  // still has to be able to log in with it.
  //
  // Supabase Auth agrees: strengthened requirements apply at sign-up and
  // password change, not at sign-in. When a member signs in successfully
  // with a password that no longer meets the current rules, supabase-js
  // returns `data.weakPassword` with `error` still null — the session is
  // already issued and saved by that point. So the only thing this code
  // checks is `error`, and a weak-password signal is not an error.
  //
  // If someone later wants to nudge those members, the place to do it is a
  // banner after they land on the dashboard, never a refusal here.
  // src/lib/passwords.test.ts asserts both of these against this file.
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email or password didn't match — check for typos and try again." };
  }

  redirect("/dashboard");
}
