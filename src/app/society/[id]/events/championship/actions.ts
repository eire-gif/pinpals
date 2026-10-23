"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/society-console/action-state";
import { buildChampionshipP, type ChampionshipDayInput } from "@/lib/society-console/championships";
import { loadClub } from "@/lib/society-console/events-data";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { consoleHref, positiveInt, text } from "@/lib/society-console/rules";

/**
 * New / changed multi-day championship — save_championship with `p` exactly
 * as the app's set-up screen sends it. Each day's course name comes from the
 * club itself, never from the form.
 */
export async function saveChampionship(_prev: ActionState, form: FormData): Promise<ActionState> {
  const editId = positiveInt(form.get("championship"));
  let savedId: number | null = null;
  const state = await consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    if (editId) {
      const { data } = await ctx.supabase.from("group_championships").select("id").eq("id", editId).eq("group_id", ctx.society.id).maybeSingle();
      if (!data) throw new Error("That championship can't be changed.");
    }
    const n = Math.min(4, Math.max(2, positiveInt(form.get("days")) ?? 2));
    const days: ChampionshipDayInput[] = [];
    for (let i = 0; i < n; i++) {
      const clubId = positiveInt(form.get(`club_${i}`));
      const club = clubId ? await loadClub(ctx.supabase, clubId) : null;
      if (clubId && !club) throw new Error(`The course for day ${i + 1} wasn't found — search for it again.`);
      days.push({
        playsOn: text(form, `plays_on_${i}`, 10) ?? "",
        clubId: club?.id ?? null,
        courseName: club?.name ?? text(form, `course_${i}`, 200) ?? "",
        firstTee: text(form, `first_tee_${i}`, 5) ?? "",
        format: text(form, `format_${i}`, 20) ?? "",
      });
    }
    const built = buildChampionshipP({
      title: text(form, "title", 200) ?? "",
      rule: text(form, "rule", 10) ?? "auto",
      fee: text(form, "fee", 12) ?? "",
      max: text(form, "max", 6) ?? "",
      details: text(form, "details", 2000) ?? "",
      days,
    });
    if ("error" in built) throw new Error(`${built.error}.`);
    const { data, error } = await ctx.supabase.rpc("save_championship", { p_group_id: ctx.society.id, p_id: editId, p: built.p });
    check(error, "Couldn't save the championship.");
    savedId = Number(data);
    return editId ? "Changes saved." : "Championship created.";
  });
  if (state.ok && savedId) {
    const g = positiveInt(form.get("g"));
    redirect(consoleHref(g!, `events/championship/${savedId}`));
  }
  return state;
}

export async function cancelChampionship(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = positiveInt(form.get("championship"));
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    if (!id) throw new Error("That championship wasn't found.");
    const { data } = await ctx.supabase.from("group_championships").select("id").eq("id", id).eq("group_id", ctx.society.id).maybeSingle();
    if (!data) throw new Error("That championship wasn't found.");
    const { error } = await ctx.supabase.rpc("cancel_championship", { p_id: id });
    check(error, "Couldn't cancel the championship.");
    return "Championship cancelled. The days not yet played are cancelled too.";
  });
}
