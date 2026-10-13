import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verified mobiles on the website (0134) — the server half of what the app's
 * lib/mobile-number.ts does. Supabase Auth sends and checks the codes; the
 * database copies a confirmed number to member_phones.
 *
 * Auth's own error messages name provider internals, so every failure is
 * said again in the member's terms.
 */

export function friendlyPhoneError(message: string | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate") || m.includes("too many") || m.includes("seconds")) return "Too many codes asked for. Wait a minute and try again.";
  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) return "That code didn't work. Check it, or send a new one.";
  if (m.includes("already") || m.includes("registered") || m.includes("exists")) return "That number is already on another PinPals account.";
  if (m.includes("provider") || m.includes("sms") || m.includes("unsupported")) return "We can't send text messages just now. Try again later.";
  return fallback;
}

export async function myMobile(supabase: SupabaseClient, memberId: string): Promise<{ phone: string; verified_at: string } | null> {
  const { data } = await supabase
    .from("member_phones")
    .select("phone, verified_at")
    .eq("member_id", memberId)
    .maybeSingle<{ phone: string; verified_at: string }>();
  return data ?? null;
}
