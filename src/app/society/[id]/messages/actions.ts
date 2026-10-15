"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { loadConsole } from "@/lib/society-console/access";
import { AUDIENCES, audienceCount, isAudience } from "@/lib/society-console/data";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, positiveInt, text } from "@/lib/society-console/rules";

/**
 * A committee message (0144), as the app's message screen: count who it
 * would reach (society_audience_count) and send it (send_society_message).
 * Both decide who may — this only checks the member is on the committee
 * with the "messages" area before asking.
 */

/** How many members an audience reaches right now, or null when it can't be counted. */
export async function countRecipients(rawGroupId: number, audience: string, rawOutingId: number | null): Promise<number | null> {
  const groupId = positiveInt(rawGroupId);
  if (!groupId || !isAudience(audience)) return null;
  const ctx = await loadConsole(groupId);
  if (!ctx || !ctx.areas.includes("messages")) return null;
  const needsEvent = !!AUDIENCES.find((a) => a.audience === audience)?.needsEvent;
  const outingId = needsEvent ? positiveInt(rawOutingId) : null;
  if (needsEvent && !outingId) return null;
  return audienceCount(ctx.supabase, groupId, audience, outingId);
}

export async function sendMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "messages" }, async ({ supabase, society }) => {
    const audience = form.get("audience");
    if (!isAudience(audience)) throw new Error("Choose who it's for.");
    const needsEvent = !!AUDIENCES.find((a) => a.audience === audience)?.needsEvent;
    const outingId = needsEvent ? positiveInt(form.get("outing")) : null;
    if (needsEvent && !outingId) throw new Error("Choose the event.");
    const title = text(form, "title", 200);
    const body = text(form, "body", 2000);
    if (!title) throw new Error("Give the message a title.");
    if (title.length > 80) throw new Error("The title is 80 characters at most.");
    if (body && body.length > 1000) throw new Error("The message is 1,000 characters at most.");
    // Only a message to everyone goes on the noticeboard.
    const postNotice = audience === "everyone" && checked(form, "notice");
    const { data, error } = await supabase.rpc("send_society_message", {
      p_group_id: society.id,
      p_audience: audience,
      p_outing_id: outingId,
      p_title: title,
      p_body: body,
      p_post_notice: postNotice,
    });
    check(error, "Couldn't send it.");
    const n = Number(data);
    return Number.isFinite(n) ? `Sent to ${n} ${n === 1 ? "member" : "members"}.` : "Sent.";
  });
}
