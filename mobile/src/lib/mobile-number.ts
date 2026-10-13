import { supabase } from "@/lib/supabase";

/**
 * Your mobile (0134) — readable and changeable by you alone, in
 * member_phones. No text-message check and no sign-in by text: those cost
 * money per message, so PinPals sends none. Share it, group by group, with
 * the people who run each one (member_phone_shares) — see group_contacts()
 * for who sees what.
 */

export type MyMobile = { phone: string } | null;

export async function loadMyMobile(userId: string): Promise<MyMobile> {
  const { data, error } = await supabase.from("member_phones").select("phone").eq("member_id", userId).maybeSingle<{ phone: string }>();
  if (error || !data) return null;
  return { phone: data.phone };
}

/** Add or change your number (already in +353… form — see lib/phone.ts). */
export async function saveMyMobile(userId: string, e164: string): Promise<void> {
  const { error } = await supabase
    .from("member_phones")
    .upsert({ member_id: userId, phone: e164, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) throw new Error("Couldn't save your number. Try again.");
}

/** Off your account, and out of every group you shared it with. */
export async function removeMyMobile(): Promise<void> {
  const { error } = await supabase.rpc("remove_my_phone");
  if (error) throw new Error("Couldn't remove your number. Try again.");
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
