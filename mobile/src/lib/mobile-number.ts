import { supabase } from "@/lib/supabase";

/**
 * Your verified mobile (0134). Adding one is Supabase Auth's phone change: we
 * send a text code, you type it back, Auth marks the number confirmed and the
 * database copies it to member_phones — only you can read that. Then:
 *
 *   - sign in with a text code instead of your password (login.tsx)
 *   - share it, group by group, with the people who run each one
 *     (member_phone_shares) — see group_contacts() for who sees what.
 *
 * Error messages from Auth are not shown as they come: they name provider
 * internals. Each call says what went wrong in the member's terms.
 */

export type MyMobile = { phone: string; verifiedAt: string } | null;

export async function loadMyMobile(userId: string): Promise<MyMobile> {
  const { data, error } = await supabase
    .from("member_phones")
    .select("phone, verified_at")
    .eq("member_id", userId)
    .maybeSingle<{ phone: string; verified_at: string }>();
  if (error || !data) return null;
  return { phone: data.phone, verifiedAt: data.verified_at };
}

const friendly = (message: string | undefined, fallback: string): string => {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate") || m.includes("too many") || m.includes("seconds")) return "Too many codes asked for. Wait a minute and try again.";
  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) return "That code didn't work. Check it, or send a new one.";
  if (m.includes("already") || m.includes("registered") || m.includes("exists")) return "That number is already on another PinPals account.";
  if (m.includes("provider") || m.includes("sms") || m.includes("unsupported")) return "We can't send text messages just now. Try again later.";
  return fallback;
};

/** Step 1 of adding (or changing) your number: text a code to it. */
export async function sendAddCode(e164: string): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ phone: e164 });
  return error ? friendly(error.message, "We couldn't send a code to that number.") : null;
}

/** Step 2: the code back. On success the number is verified and yours. */
export async function confirmAddCode(e164: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: "phone_change" });
  return error ? friendly(error.message, "That code didn't work. Check it, or send a new one.") : null;
}

/** Off your account entirely — sign-in, and every group you shared it with. */
export async function removeMyMobile(): Promise<void> {
  const { error } = await supabase.rpc("remove_my_phone");
  if (error) throw new Error("Couldn't remove your number. Try again.");
  // The session still carries the old number until it refreshes.
  await supabase.auth.refreshSession().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Signing in with a text code
// ---------------------------------------------------------------------------

/** Only for a number already verified on an account — never makes one. */
export async function sendSignInCode(e164: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: false } });
  // Same answer whether or not the number is on an account, so this can't be
  // used to find out who is a member.
  if (error && /rate|too many|seconds/i.test(error.message)) return "Too many codes asked for. Wait a minute and try again.";
  return null;
}

export async function verifySignInCode(e164: string, code: string): Promise<string | null> {
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: "sms" });
  return error ? "That code didn't work. Check it, or send a new one." : null;
}

// ---------------------------------------------------------------------------
// Sharing with your groups
// ---------------------------------------------------------------------------

export async function loadMyShares(userId: string): Promise<Set<number>> {
  const { data } = await supabase.from("member_phone_shares").select("group_id").eq("member_id", userId);
  return new Set((data ?? []).map((r: { group_id: number | string }) => Number(r.group_id)));
}

export async function setShare(userId: string, groupId: number, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from("member_phone_shares").upsert({ member_id: userId, group_id: groupId }, { onConflict: "member_id,group_id", ignoreDuplicates: true })
    : await supabase.from("member_phone_shares").delete().eq("member_id", userId).eq("group_id", groupId);
  if (error) throw new Error(on ? "Couldn't share your number." : "Couldn't stop sharing your number.");
}

export type GroupContact = {
  memberId: string;
  name: string;
  role: "owner" | "admin" | "member";
  office: "captain" | "secretary" | null;
  phone: string;
};

/** The numbers you can see in a group: everyone's if you run it, else the people who do. */
export async function loadGroupContacts(groupId: number): Promise<GroupContact[]> {
  const { data, error } = await supabase.rpc("group_contacts", { p_group_id: groupId });
  if (error) throw new Error("Couldn't load the group's numbers.");
  return ((data ?? []) as { member_id: string; first_name: string | null; last_name: string | null; role: GroupContact["role"]; office: GroupContact["office"]; phone: string }[]).map((r) => ({
    memberId: r.member_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "A member",
    role: r.role,
    office: r.office,
    phone: r.phone,
  }));
}
