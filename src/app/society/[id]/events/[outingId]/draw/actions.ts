"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { positiveInt } from "@/lib/society-console/rules";
import { parseDrawGroups } from "@/lib/society-console/events-draw";

/**
 * Publish the tee times — publish_outing_draw with
 * [{ tee_time, members: [memberId | { guest: id }] }], as the app sends it.
 * The database checks everyone is entered (or a guest on this event) and
 * nobody is in two groups.
 */
export async function publishDraw(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = positiveInt(form.get("outing"));
    if (!outing) throw new Error("That event wasn't found.");
    const { data: row } = await ctx.supabase.from("society_outings").select("id, kind").eq("id", outing).eq("group_id", ctx.society.id).maybeSingle<{ id: number; kind: string }>();
    if (!row) throw new Error("That event wasn't found.");
    if (row.kind !== "day") throw new Error("A trip's groups are on each round of its itinerary.");
    const raw = form.get("groups");
    const groups = parseDrawGroups(typeof raw === "string" ? raw : "");
    if ("error" in groups) throw new Error(groups.error);
    const { error } = await ctx.supabase.rpc("publish_outing_draw", { p_outing_id: outing, p_groups: groups.groups });
    check(error, "Couldn't publish the tee times.");
    return "Tee times published. Everyone in the draw can see their tee time and who they're playing with.";
  });
}
