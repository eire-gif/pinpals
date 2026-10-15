"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { indexLabel, parseIndex, text } from "@/lib/society-console/rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The society's handicap for one member (0144's set_society_handicap — the
 * owner, captain, secretary and handicap secretary). `clear` puts them back
 * on their own index.
 */
export async function setHandicap(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "handicaps", alerts: false }, async (ctx) => {
    const m = text(form, "m", 64);
    if (!m || !UUID.test(m)) throw new Error("That member wasn't found.");
    const clear = form.get("clear") === "1";
    let index: number | null = null;
    if (!clear) {
      const parsed = parseIndex(text(form, "index", 10));
      if (parsed === undefined) throw new Error("A handicap index is between +10 and 54 — e.g. 14.2 or +1.5.");
      if (parsed === null) throw new Error("Type an index, or clear it to use their own.");
      index = parsed;
    }
    const { error } = await ctx.supabase.rpc("set_society_handicap", { p_group_id: ctx.society.id, p_member_id: m, p_index: index });
    check(error, "Couldn't save that handicap.");
    return index === null ? "Cleared — they play off their own." : `Saved: plays off ${indexLabel(index)}.`;
  });
}
