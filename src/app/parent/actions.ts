"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkDateOfBirth, dateFromParts } from "@/lib/junior";
import { notifyGroupInvites } from "@/lib/group-notifications";

/**
 * The parent dashboard's changes (/parent, 0159). Each runs as the signed-in
 * parent through a database function that checks the parent link itself —
 * nothing here decides who is whose parent.
 */

export type ParentActionState = { error?: string; done?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function member() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Approve, or stop approving, one of the parent's PinPals to play with their child. */
export async function setContact(_prev: ParentActionState, formData: FormData): Promise<ParentActionState> {
  const { supabase, user } = await member();
  if (!user) return { error: "Please log in again." };
  const child = String(formData.get("child") ?? "");
  const contact = String(formData.get("contact") ?? "");
  const on = formData.get("on") === "1";
  if (!UUID.test(child) || !UUID.test(contact)) return { error: "Something went wrong — please reload." };

  const { error } = await supabase.rpc("junior_contact_set", { p_junior: child, p_contact: contact, p_on: on });
  if (error) return { error: error.code === "42501" || error.code === "22023" ? error.message : "Couldn't save that — please try again." };
  revalidatePath("/parent");
  return { done: on ? "Approved." : "Removed." };
}

/** Withdraw consent. The child's account goes back to waiting for a parent. */
export async function stopApproving(_prev: ParentActionState, formData: FormData): Promise<ParentActionState> {
  const { supabase, user } = await member();
  if (!user) return { error: "Please log in again." };
  const linkId = Number(formData.get("link"));
  if (!Number.isInteger(linkId) || linkId < 1) return { error: "Something went wrong — please reload." };
  if (formData.get("confirm") !== "on") return { error: "Tick the box to confirm." };

  const { error } = await supabase.rpc("guardian_link_revoke", { p_link_id: linkId });
  if (error) return { error: "Couldn't do that — please try again." };
  revalidatePath("/parent");
  return { done: "Done. Their account is paused until a parent approves it again." };
}

/**
 * Invite the child to one of the parent's groups. invite_to_group applies
 * the group's own rules (who may invite); the child accepts in the app, and
 * the age guard checks they're joining a group their parent is in.
 */
export async function addToGroup(_prev: ParentActionState, formData: FormData): Promise<ParentActionState> {
  const { supabase, user } = await member();
  if (!user) return { error: "Please log in again." };
  const child = String(formData.get("child") ?? "");
  const groupId = Number(formData.get("group"));
  if (!UUID.test(child) || !Number.isInteger(groupId) || groupId < 1) return { error: "Pick a group." };

  const { data: kids } = await supabase.rpc("my_children");
  if (!((kids ?? []) as { junior_id: string; status: string }[]).some((k) => k.junior_id === child && k.status === "approved")) {
    return { error: "Only for your own approved children." };
  }

  const { data, error } = await supabase.rpc("invite_to_group", { p_group_id: groupId, p_member_ids: [child] });
  if (error) return { error: error.message || "Couldn't send the invitation." };
  const sent = Number(data ?? 0);
  if (sent > 0) {
    try {
      await notifyGroupInvites(createAdminClient(), groupId, user.id);
    } catch (e) {
      console.error("[parent] group invite notification failed:", e);
    }
  }
  revalidatePath("/parent");
  return { done: sent > 0 ? "Invitation sent — they accept it in the app." : "They've already been invited, or are already in it." };
}

/** A parent whose own account has no date of birth adds it (needed to approve: 18+ only). */
export async function saveParentDateOfBirth(_prev: ParentActionState, formData: FormData): Promise<ParentActionState> {
  const { supabase, user } = await member();
  if (!user) return { error: "Please log in again." };
  const checked = checkDateOfBirth(dateFromParts(formData.get("dobDay"), formData.get("dobMonth"), formData.get("dobYear")));
  if (!checked.ok) return { error: checked.error };
  const { error } = await supabase.rpc("set_my_date_of_birth", { p_date: checked.date });
  if (error) return { error: error.code === "22023" || error.code === "42501" ? error.message : "Couldn't save that — please try again." };
  return { done: "saved" };
}
