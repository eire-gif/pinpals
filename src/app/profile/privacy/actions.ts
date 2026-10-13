"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { friendlyPhoneError } from "@/lib/phone-auth";
import { cleanCode, normalisePhone } from "@/lib/phone";

export type MobileState = { error?: string; sentTo?: string; done?: boolean };

/** Step 1: text a code to the new number (Auth's phone change). */
export async function sendAddCode(_prev: MobileState, formData: FormData): Promise<MobileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to add a number." };

  const limit = await checkRateLimit({ action: "phone-add-code", identifier: user.id, maxHits: 5, windowSeconds: 3600 });
  if (!limit.allowed) return { error: rateLimitMessage(limit.retryAfterSeconds) };

  const parsed = normalisePhone(String(formData.get("phone") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase.auth.updateUser({ phone: parsed.e164 });
  if (error) return { error: friendlyPhoneError(error.message, "We couldn't send a code to that number.") };
  return { sentTo: parsed.e164 };
}

/** Step 2: the code back. Auth confirms the number; the database copies it. */
export async function confirmAddCode(prev: MobileState, formData: FormData): Promise<MobileState> {
  const phone = String(formData.get("sentTo") ?? "");
  const token = cleanCode(String(formData.get("code") ?? ""));
  if (!phone || !token) return { ...prev, error: "Type the six-digit code from the text." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "phone_change" });
  if (error) return { sentTo: phone, error: friendlyPhoneError(error.message, "That code didn't work. Check it, or send a new one.") };

  revalidatePath("/profile/privacy");
  return { done: true };
}

export async function removeMobile(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("remove_my_phone");
  await supabase.auth.refreshSession().catch(() => undefined);
  revalidatePath("/profile/privacy");
}
