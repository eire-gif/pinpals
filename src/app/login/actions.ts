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
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email or password didn't match — check for typos and try again." };
  }

  redirect("/dashboard");
}
