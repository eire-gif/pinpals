"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { parseMeritDraft } from "@/lib/society-console/merit-form";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, text } from "@/lib/society-console/rules";

/** The order of merit's rules (0145): the owner, captain or secretary — save_order_of_merit decides. */
export async function saveMeritRules(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async ({ supabase, society }) => {
    const r = parseMeritDraft({
      points: text(form, "points", 400) ?? "",
      attendance: text(form, "attendance", 10) ?? "",
      bestOf: text(form, "bestOf", 10) ?? "",
      includeTeam: checked(form, "includeTeam"),
      startMonth: text(form, "startMonth", 4) ?? "",
    });
    if (typeof r === "string") throw new Error(r);
    const { error } = await supabase.rpc("save_order_of_merit", {
      p_group_id: society.id,
      p: { points: r.points, attendance_points: r.attendancePoints, best_of: r.bestOf, include_team: r.includeTeam, season_start_month: r.seasonStartMonth },
    });
    check(error, "Couldn't save the rules.");
    return "Rules saved. The table below uses them.";
  });
}
