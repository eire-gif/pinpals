"use server";

import { after } from "next/server";

import { notifyGroupApproved, notifyGroupInvites } from "@/lib/group-notifications";
import type { ActionState } from "@/lib/society-console/action-state";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { text } from "@/lib/society-console/rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Members & requests. Every change is 0120/0122's own function, called as
 * the member: review_group_request, remove_group_member, invite_to_group,
 * reset_group_invite_code. Afterwards the same notifications the app asks
 * /api/app/groups/<id>/notify for are sent, once the reply has gone; who
 * hears comes from the invitation rows the database wrote, never the form.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memberId = (form: FormData): string | null => {
  const v = text(form, "m", 64);
  return v && UUID.test(v) ? v : null;
};

function notifyLater(fn: () => Promise<unknown>) {
  after(async () => {
    try {
      await fn();
    } catch (err) {
      console.error("[society-console] group notification failed", err);
    }
  });
}

export async function reviewRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people" }, async (ctx) => {
    const m = memberId(form);
    if (!m) throw new Error("That request wasn't found.");
    const approve = form.get("approve") === "1";
    const { error } = await ctx.supabase.rpc("review_group_request", { p_group_id: ctx.society.id, p_member_id: m, p_approve: approve });
    check(error, "Couldn't answer that request.");
    if (approve) notifyLater(() => notifyGroupApproved(createAdminClient(), ctx.society.id, m));
    return approve ? "Approved — they're in." : "Request declined.";
  });
}

export async function removeMember(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people" }, async (ctx) => {
    const m = memberId(form);
    if (!m) throw new Error("That member wasn't found.");
    if (m === ctx.user.id) throw new Error("To leave the society, use Leave in the app.");
    const { error } = await ctx.supabase.rpc("remove_group_member", { p_group_id: ctx.society.id, p_member_id: m });
    check(error, "Couldn't remove them.");
    return "Removed from the society.";
  });
}

export async function inviteGolfers(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people" }, async (ctx) => {
    const ids = [...new Set(form.getAll("m").filter((v): v is string => typeof v === "string" && UUID.test(v)))];
    if (ids.length === 0) throw new Error("Tick at least one golfer to invite.");
    if (ids.length > 50) throw new Error("Invite up to 50 people at a time.");
    const { data, error } = await ctx.supabase.rpc("invite_to_group", { p_group_id: ctx.society.id, p_member_ids: ids });
    check(error, "Couldn't send the invitations.");
    const sent = Number(data ?? 0);
    if (sent > 0) notifyLater(() => notifyGroupInvites(createAdminClient(), ctx.society.id, ctx.user.id));
    if (sent === 0) return "They've already been invited, or can't be added.";
    return `${sent === 1 ? "Invitation sent" : `${sent} invitations sent`} — they'll get a notification to join.`;
  });
}

export async function resetInviteLink(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    const { error } = await ctx.supabase.rpc("reset_group_invite_code", { p_group_id: ctx.society.id });
    check(error, "Couldn't reset the link.");
    return "Link reset. The old link no longer works.";
  });
}
