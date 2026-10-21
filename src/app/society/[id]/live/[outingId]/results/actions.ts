"use server";

import { after } from "next/server";

import { notifyResults } from "@/lib/competition-results-server";
import type { ResultsSettings } from "@/lib/competition-results";
import type { ActionState } from "@/lib/society-console/action-state";
import type { ConsoleContext } from "@/lib/society-console/access";
import { loadEvent } from "@/lib/society-console/data";
import { loadCertified, loadLiveDay } from "@/lib/society-console/live-day-data";
import { hasResults, settingsFrom, workOut } from "@/lib/society-console/live-results";
import { positiveInt } from "@/lib/society-console/rules";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Results from the console (Oct 2026), through the app's own functions
 * (0137/0138) with the member's own client — only whoever started the day
 * can save, publish or take results down, as in the app:
 *
 *   saveResults      competition_results_save (the draft settings)
 *   publishResults   worked out HERE from the cards in the database with
 *                    those settings, then competition_results_set_group (the
 *                    society) and competition_results_publish; everyone in
 *                    the day is told, as /api/app/live/match-days/[id]/results
 *   withdrawResults  competition_results_withdraw
 */

async function dayOf(ctx: ConsoleContext, raw: FormDataEntryValue | null) {
  const outing = positiveInt(raw);
  if (!outing) throw new Error("That event wasn't found.");
  const page = await loadEvent(ctx.supabase, ctx.society.id, outing).catch(() => {
    throw new Error("Couldn't load the event. Please try again.");
  });
  if (!page?.outing.matchDayId) throw new Error("This event's round hasn't started.");
  const day = await loadLiveDay(ctx.supabase, page.outing.matchDayId, ctx.user.id);
  if (!day) throw new Error("The round for this event has been removed.");
  if (!day.mine) throw new Error(`Only ${day.creatorName ?? "whoever started the round"} can work out and publish the results.`);
  if (!hasResults(day.kind)) throw new Error("A match day's result is its team score.");
  return day;
}

/** The posted settings, made safe — a malformed score is refused, never read as "picked up". */
function postedSettings(raw: FormDataEntryValue | null): ResultsSettings {
  if (typeof raw !== "string" || raw.length > 60000) throw new Error("Those settings don't look right.");
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error("Those settings don't look right.");
  }
  const amendments = (v as { amendments?: unknown })?.amendments;
  if (Array.isArray(amendments)) {
    for (const a of amendments) {
      const s = (a as { strokes?: unknown })?.strokes;
      const dq = !!(a as { dq?: unknown })?.dq;
      if (!dq && s !== null && !(Number.isInteger(s) && (s as number) >= 1 && (s as number) <= 20)) throw new Error("An amended score should be 1 to 20, or picked up.");
      if (!String((a as { reason?: unknown })?.reason ?? "").trim()) throw new Error("Every amendment needs a reason — members see it.");
    }
  }
  return settingsFrom(v);
}

export async function saveResults(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const settings = postedSettings(form.get("settings"));
    const { error } = await ctx.supabase.rpc("competition_results_save", { p_day_id: day.id, p_settings: settings });
    check(error, "Couldn't save the results settings.");
    return day.results?.status === "published" ? "Saved. Publish the update when you're ready — members still see the published results." : "Saved.";
  });
}

export async function publishResults(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const settings = postedSettings(form.get("settings"));
    const save = await ctx.supabase.rpc("competition_results_save", { p_day_id: day.id, p_settings: settings });
    check(save.error, "Couldn't save the results settings.");

    const certified = await loadCertified(ctx.supabase, day.id);
    if (!certified) throw new Error("Couldn't check which cards are certified. Please try again.");
    // Never publish from a short read: every card must have the day's holes.
    if (day.games.length === 0 || day.games.some((x) => x.card.length !== day.holes)) throw new Error("Couldn't load every card in full. Please try again.");
    const results = workOut(day.id, day.kind, day.games, certified, settings);
    if (results.counts.entrants === 0) throw new Error("There are no cards in this round.");
    const update = day.results?.status === "published";

    // On the society's page, as the app suggests for an event's day — unless a page was already chosen. Best effort.
    if (day.results?.groupId == null) await ctx.supabase.rpc("competition_results_set_group", { p_day_id: day.id, p_group_id: ctx.society.id });
    const { error } = await ctx.supabase.rpc("competition_results_publish", {
      p_day_id: day.id,
      p_results: { ...results, event: { title: day.title, courseName: day.courseName, playedOn: day.playedOn } },
    });
    check(error, "Couldn't publish the results.");

    after(async () => {
      try {
        await notifyResults(createAdminClient(), day.id);
      } catch (err) {
        console.error("[society-live] results notify failed", err);
      }
    });
    return update
      ? "The update is published. Everyone in the day is told the results have changed."
      : `Published. Every card is closed and all ${results.counts.entrants} ${results.team ? "pairs and teams" : "players"} are being told the results.`;
  });
}

export async function withdrawResults(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const day = await dayOf(ctx, form.get("outing"));
    const { error } = await ctx.supabase.rpc("competition_results_withdraw", { p_day_id: day.id });
    check(error, "Couldn't take the results down.");
    return "Taken down. Members no longer see them and the share link has stopped working. You can publish again.";
  });
}
