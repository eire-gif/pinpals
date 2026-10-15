"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { isGroupOffice, text } from "@/lib/society-console/rules";

/**
 * The committee: set_group_office (0144 — the owner appoints or stands down
 * any office) and set_group_role(…, 'owner') (0122 — the owner hands the
 * society over and becomes an ordinary admin). Both refuse anyone else.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setOffice(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    if (ctx.role !== "owner") throw new Error("Only the society's owner can appoint its committee.");
    const m = text(form, "m", 64);
    if (!m || !UUID.test(m)) throw new Error("Choose a member.");
    const raw = text(form, "office", 40);
    const office = raw === "none" ? null : raw;
    if (office !== null && !isGroupOffice(office)) throw new Error("Unknown office.");
    const { error } = await ctx.supabase.rpc("set_group_office", { p_group_id: ctx.society.id, p_member_id: m, p_office: office });
    check(error, "Couldn't change that.");
    return office ? "Appointed." : "Stood down.";
  });
}

export async function handOver(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async (ctx) => {
    if (ctx.role !== "owner") throw new Error("Only the society's owner can hand it over.");
    const m = text(form, "m", 64);
    if (!m || !UUID.test(m)) throw new Error("Choose who to hand the society to.");
    if (m === ctx.user.id) throw new Error("Choose another member.");
    const { error } = await ctx.supabase.rpc("set_group_role", { p_group_id: ctx.society.id, p_member_id: m, p_role: "owner" });
    check(error, "Couldn't hand it over.");
    return "Handed over. They're the owner now; you stay on as an admin.";
  });
}
