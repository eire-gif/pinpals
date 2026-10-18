import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { GROUP_KIND_INFO, isGroupKind } from "./groups";
import { notifyUser } from "./notifications-server";

/**
 * Group notifications (0120), sent with the admin client after the app has
 * made the change itself through a group function.
 *
 *   someone invites you                 → group_invited
 *   someone asks to join a group you run → group_join_request (owner + admins)
 *   your request is approved             → group_request_approved
 *
 * All three are in the feed category ("Your posts and groups"). Each has a
 * dedupe key tied to the invitation row and the moment it was made, so a
 * retried request never buzzes anyone twice, but a fresh invitation after a
 * decline still does.
 *
 * Recipients are read from the invitation rows the database wrote, never
 * from the request, and the routes in src/app/api/app/groups/ check with the
 * member's own client that they're entitled to trigger each one. Titles carry
 * only first names and the group's name.
 */

type GroupRow = { id: number; name: string; kind: string };
type InvitationRow = { id: number; member_id: string; invited_by: string | null; created_at: string };

// "Golf Buddies" reads oddly mid-sentence ("Join the golf buddies"), so that kind is just "group".
const kindWord = (kind: string) => (isGroupKind(kind) && kind !== "crew" ? GROUP_KIND_INFO[kind].label.toLowerCase() : "group");

async function firstName(admin: SupabaseClient, memberId: string | null): Promise<string> {
  if (!memberId) return "A PinPal";
  const { data } = await admin.from("profiles").select("first_name").eq("id", memberId).maybeSingle<{ first_name: string | null }>();
  return data?.first_name?.trim() || "A PinPal";
}

async function loadGroup(admin: SupabaseClient, groupId: number): Promise<GroupRow | null> {
  const { data } = await admin.from("groups").select("id, name, kind").eq("id", groupId).is("hidden_at", null).maybeSingle<GroupRow>();
  return data ?? null;
}

const stamp = (iso: string) => new Date(iso).getTime();

/** Everyone `inviterId` has a pending invitation out to in this group. */
export async function notifyGroupInvites(admin: SupabaseClient, groupId: number, inviterId: string): Promise<number> {
  const group = await loadGroup(admin, groupId);
  if (!group) return 0;
  const { data: rows } = await admin
    .from("group_invitations")
    .select("id, member_id, invited_by, created_at")
    .eq("group_id", groupId)
    .eq("invited_by", inviterId)
    .eq("direction", "invite")
    .eq("status", "pending")
    .overrideTypes<InvitationRow[]>();
  if (!rows?.length) return 0;
  const by = await firstName(admin, inviterId);
  for (const r of rows) {
    await notifyUser(admin, {
      userId: r.member_id,
      type: "group_invited",
      title: `${by} invited you to ${group.name}`,
      body: `Join the ${kindWord(group.kind)} on PinPals. Tap to accept or decline.`,
      href: `/groups/${group.id}`,
      dedupeKey: `group_invited:${r.id}:${stamp(r.created_at)}`,
    });
  }
  return rows.length;
}

/** `requesterId` asked to join: tell the owner and admins (unless they've muted the group). */
export async function notifyGroupRequest(admin: SupabaseClient, groupId: number, requesterId: string): Promise<number> {
  const group = await loadGroup(admin, groupId);
  if (!group) return 0;
  const { data: request } = await admin
    .from("group_invitations")
    .select("id, member_id, invited_by, created_at")
    .eq("group_id", groupId)
    .eq("member_id", requesterId)
    .eq("direction", "request")
    .eq("status", "pending")
    .maybeSingle<InvitationRow>();
  if (!request) return 0;
  const { data: admins } = await admin
    .from("group_members")
    .select("member_id")
    .eq("group_id", groupId)
    .in("role", ["owner", "admin"])
    .eq("muted", false)
    .overrideTypes<{ member_id: string }[]>();
  const who = await firstName(admin, requesterId);
  let sent = 0;
  for (const a of admins ?? []) {
    await notifyUser(admin, {
      userId: a.member_id,
      type: "group_join_request",
      title: `${who} asked to join ${group.name}`,
      body: "Tap to approve or decline.",
      href: `/groups/${group.id}`,
      dedupeKey: `group_join_request:${request.id}:${stamp(request.created_at)}:${a.member_id}`,
    });
    sent += 1;
  }
  return sent;
}

/** `memberId`'s request was approved and they're in. */
export async function notifyGroupApproved(admin: SupabaseClient, groupId: number, memberId: string): Promise<number> {
  const group = await loadGroup(admin, groupId);
  if (!group) return 0;
  const [{ data: member }, { data: request }] = await Promise.all([
    admin.from("group_members").select("member_id").eq("group_id", groupId).eq("member_id", memberId).maybeSingle(),
    admin
      .from("group_invitations")
      .select("id, member_id, invited_by, created_at")
      .eq("group_id", groupId)
      .eq("member_id", memberId)
      .eq("direction", "request")
      .eq("status", "accepted")
      .maybeSingle<InvitationRow>(),
  ]);
  if (!member || !request) return 0;
  await notifyUser(admin, {
    userId: memberId,
    type: "group_request_approved",
    title: `You're in ${group.name}`,
    body: `Your request to join the ${kindWord(group.kind)} was approved.`,
    href: `/groups/${group.id}`,
    dedupeKey: `group_request_approved:${request.id}:${stamp(request.created_at)}`,
  });
  return 1;
}
