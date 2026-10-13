"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { postLoginPath } from "@/lib/safe-redirect";
import { cleanCode, normalisePhone } from "@/lib/phone";

/**
 * Signing in with a text code (0134), for a member who has verified a mobile.
 * Never creates an account. The answer to "send a code" is the same whether
 * or not the number is on an account, so it can't be used to look members up.
 */

export type CodeLoginState = { error?: string; sentTo?: string };

export async function sendLoginCode(_prev: CodeLoginState, formData: FormData): Promise<CodeLoginState> {
  const limit = await checkRateLimit({ action: "login-code", maxHits: 5, windowSeconds: 15 * 60 });
  if (!limit.allowed) return { error: rateLimitMessage(limit.retryAfterSeconds) };

  const parsed = normalisePhone(String(formData.get("phone") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.e164, options: { shouldCreateUser: false } });
  if (error && /rate|too many|seconds/i.test(error.message)) return { error: "Too many codes asked for. Wait a minute and try again." };
  return { sentTo: parsed.e164 };
}

export async function verifyLoginCode(prev: CodeLoginState, formData: FormData): Promise<CodeLoginState> {
  const limit = await checkRateLimit({ action: "login", maxHits: 10, windowSeconds: 5 * 60 });
  if (!limit.allowed) return { ...prev, error: rateLimitMessage(limit.retryAfterSeconds) };

  const phone = String(formData.get("sentTo") ?? "");
  const token = cleanCode(String(formData.get("code") ?? ""));
  if (!phone || !token) return { ...prev, error: "Type the six-digit code from the text." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) return { sentTo: phone, error: "That code didn't work. Check it, or send a new one." };

  redirect(postLoginPath(formData.get("next")));
}
