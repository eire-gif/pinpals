"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalisePhone } from "@/lib/phone";

export type MobileState = { error?: string; done?: boolean };

/** Add or change your mobile (member_phones, 0134 — yours alone to read). */
export async function saveMobile(_prev: MobileState, formData: FormData): Promise<MobileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to add a number." };

  const parsed = normalisePhone(String(formData.get("phone") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const { error } = await supabase
    .from("member_phones")
    .upsert({ member_id: user.id, phone: parsed.e164, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) return { error: "Couldn't save your number. Try again." };

  revalidatePath("/profile/privacy");
  return { done: true };
}

/** Off your account, and out of every group you shared it with. */
export async function removeMobile(): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("remove_my_phone");
  revalidatePath("/profile/privacy");
}
