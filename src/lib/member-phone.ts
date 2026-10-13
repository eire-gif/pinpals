import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The member's own mobile (member_phones, 0134 — readable by them alone). */
export async function myMobile(supabase: SupabaseClient, memberId: string): Promise<{ phone: string } | null> {
  const { data } = await supabase.from("member_phones").select("phone").eq("member_id", memberId).maybeSingle<{ phone: string }>();
  return data ?? null;
}
