import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyPlaceConfirmed, notifyTeeTimeGroupInvited } from "@/lib/tee-times-server";

/**
 * Inviting your group to a tee time, and taking a place in one tap (0186).
 *
 * The host picks one or more of their groups while posting. Everyone in them
 * gets an invitation the host has already said yes to, so taking a place is
 * a single tap that confirms it — first come, first served, under the same
 * row lock as the host's own accept, so two buddies tapping at once can never
 * both get the last space.
 *
 * Same rule as tee-times-operations.ts: the notification is scheduled in
 * here, never left to the caller.
 */

export type GroupInviteResult = {
  /** Members newly invited, across every group, each counted once, with the
   *  name of the group they were invited with. */
  invitees: Map<string, string>;
  /** Groups that couldn't be used (not a member any more, round full…). */
  skipped: number;
};

/** Never more than this many groups on one round — a fat-fingered "select all" guard. */
export const MAX_GROUPS_PER_ROUND = 5;

export function parseGroupIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((v) => Number.isInteger(v) && v > 0);
  return [...new Set(ids)].slice(0, MAX_GROUPS_PER_ROUND);
}

/**
 * Invites every member of each group and tells them. Never throws: the round
 * is already posted by the time this runs, and a group that can't be invited
 * must not cost the host their post.
 */
export async function inviteGroupsToTeeTime(
  supabase: SupabaseClient,
  hostId: string,
  invite: { inviteId: number; clubName: string; playDate: string; spaces: number },
  groupIds: number[],
  options: { notify?: boolean } = {}
): Promise<GroupInviteResult> {
  const told = new Map<string, string>(); // member → group name they were invited with
  let skipped = 0;

  for (const groupId of groupIds) {
    const { data, error } = await supabase.rpc("invite_group_to_tee_time", {
      p_invite_id: invite.inviteId,
      p_group_id: groupId,
    });
    if (error) {
      skipped += 1;
      continue;
    }
    const members = ((data as (string | { invite_group_to_tee_time: string })[] | null) ?? []).map((r) =>
      typeof r === "string" ? r : r.invite_group_to_tee_time
    );
    if (members.length === 0) continue;

    const { data: group } = await supabase.from("groups").select("name").eq("id", groupId).maybeSingle<{ name: string }>();
    for (const m of members) if (!told.has(m)) told.set(m, group?.name ?? "your group");
  }

  if (options.notify !== false) notifyGroupInvitees(hostId, invite, told);

  return { invitees: told, skipped };
}

/** Schedules the group alerts. Separate so createInvite can invite first and
 *  leave these members out of its general "posted a tee time" fan-out. */
export function notifyGroupInvitees(
  hostId: string,
  invite: { inviteId: number; clubName: string; playDate: string; spaces: number },
  invitees: Map<string, string>
): void {
  if (invitees.size === 0) return;
  after(async () => {
    const admin = createAdminClient();
    for (const [memberId, groupName] of invitees) {
      await notifyTeeTimeGroupInvited(admin, {
        memberId,
        hostId,
        groupName,
        spaces: invite.spaces,
        invite: { inviteId: invite.inviteId, clubName: invite.clubName, playDate: invite.playDate },
      });
    }
  });
}

export type TakeFailure = "forbidden" | "conflict" | "failed";
export type TakeResult =
  | { ok: true; value: { interestId: number; spacesRemaining: number } }
  | { ok: false; reason: TakeFailure; message: string };

type TakeRow = {
  interest_id: number;
  host_id: string;
  invite_id: number;
  club_name: string;
  play_date: string;
  spaces_remaining: number;
};

/** One tap, place confirmed, host told. */
export async function takeTeeTimePlace(
  supabase: SupabaseClient,
  userId: string,
  inviteId: number
): Promise<TakeResult> {
  const { data, error } = await supabase.rpc("take_tee_time_place", { p_invite_id: inviteId });
  if (error) {
    return { ok: false, reason: error.code === "42501" ? "forbidden" : "conflict", message: error.message };
  }
  const row = (data as TakeRow[] | null)?.[0];
  if (!row) return { ok: false, reason: "failed", message: "Couldn't take that place — please try again." };

  after(async () => {
    await notifyPlaceConfirmed(createAdminClient(), {
      hostId: row.host_id,
      applicantId: userId,
      interestId: row.interest_id,
      invite: { inviteId: row.invite_id, clubName: row.club_name, playDate: row.play_date },
    });
  });

  return { ok: true, value: { interestId: row.interest_id, spacesRemaining: row.spaces_remaining } };
}

/** "Can't make it" — nothing moves, nobody is told; the invitation stops asking. */
export async function passTeeTimePlace(supabase: SupabaseClient, inviteId: number): Promise<boolean> {
  const { error } = await supabase.rpc("pass_tee_time_place", { p_invite_id: inviteId });
  return !error;
}

/** True when the member holds a group invitation the host has already said yes to. */
export async function hasReadyInvitation(supabase: SupabaseClient, userId: string, inviteId: number): Promise<boolean> {
  const { data } = await supabase
    .from("tee_time_invitations")
    .select("ready")
    .eq("invite_id", inviteId)
    .eq("member_id", userId)
    .maybeSingle<{ ready: boolean }>();
  return data?.ready === true;
}
