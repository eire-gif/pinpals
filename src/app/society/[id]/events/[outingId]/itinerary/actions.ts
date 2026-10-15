"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/society-console/action-state";
import type { ConsoleContext } from "@/lib/society-console/access";
import { loadClub } from "@/lib/society-console/events-data";
import { buildItemP, parseItemPeople } from "@/lib/society-console/events-itinerary";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { consoleHref, positiveInt, text } from "@/lib/society-console/rules";

/**
 * A trip's itinerary (0126): save_outing_item, delete_outing_item and
 * set_outing_item_people, exactly as the app's itinerary.ts calls them.
 */

async function ownTrip(ctx: ConsoleContext, form: FormData): Promise<{ id: number; playsOn: string; endsOn: string | null; kind: string }> {
  const id = positiveInt(form.get("outing"));
  if (!id) throw new Error("That trip wasn't found.");
  const { data } = await ctx.supabase
    .from("society_outings")
    .select("id, plays_on, ends_on, kind")
    .eq("id", id)
    .eq("group_id", ctx.society.id)
    .maybeSingle<{ id: number; plays_on: string; ends_on: string | null; kind: string }>();
  if (!data) throw new Error("That trip wasn't found.");
  return { id: data.id, playsOn: data.plays_on, endsOn: data.ends_on, kind: data.kind };
}

async function ownItem(ctx: ConsoleContext, outingId: number, raw: FormDataEntryValue | null): Promise<number | null> {
  const id = positiveInt(raw);
  if (!id) return null;
  const { data } = await ctx.supabase.from("society_outing_items").select("id").eq("id", id).eq("outing_id", outingId).maybeSingle();
  if (!data) throw new Error("That part of the itinerary has gone.");
  return id;
}

export async function saveItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  let done: { g: number; outing: number; day: string } | null = null;
  const state = await consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const trip = await ownTrip(ctx, form);
    const itemId = await ownItem(ctx, trip.id, form.get("item"));
    const clubId = positiveInt(form.get("club"));
    const club = clubId ? await loadClub(ctx.supabase, clubId) : null;
    if (clubId && !club) throw new Error("That course wasn't found — search for it again.");
    const built = buildItemP(
      {
        kind: text(form, "kind", 20),
        onDate: text(form, "on_date", 10),
        title: text(form, "title", 200),
        clubId: club?.id ?? null,
        clubName: club?.name ?? null,
        startsAt: text(form, "starts_at", 5),
        endsAt: text(form, "ends_at", 5),
        fromPlace: text(form, "from_place", 100),
        toPlace: text(form, "to_place", 100),
        carrier: text(form, "carrier", 100),
        nights: text(form, "nights", 3),
        gap: text(form, "gap", 3),
        format: text(form, "format", 20),
        details: text(form, "details", 2000),
      },
      { playsOn: trip.playsOn, endsOn: trip.endsOn ?? trip.playsOn }
    );
    if ("error" in built) throw new Error(built.error);
    const people = parseItemPeople(text(form, "people", 40000), built.p.kind);
    if ("error" in people) throw new Error(people.error);

    const { data, error } = await ctx.supabase.rpc("save_outing_item", { p_outing_id: trip.id, p_id: itemId, p: built.p });
    check(error, "Couldn't save that.");
    const savedId = Number(data);
    if (people.people) {
      const { error: pe } = await ctx.supabase.rpc("set_outing_item_people", { p_item_id: savedId, p_people: people.people });
      check(pe, "Saved, but couldn't save who's on it.");
    }
    done = { g: ctx.society.id, outing: trip.id, day: built.p.on_date };
    return "Saved — everyone on the trip sees it.";
  });
  if (state.ok && done) {
    const d = done as { g: number; outing: number; day: string };
    redirect(`${consoleHref(d.g, `events/${d.outing}/itinerary`)}?day=${d.day}`);
  }
  return state;
}

export async function deleteItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  let done: { g: number; outing: number } | null = null;
  const state = await consoleAction(form.get("g"), { area: "events", alerts: false }, async (ctx) => {
    const trip = await ownTrip(ctx, form);
    const itemId = await ownItem(ctx, trip.id, form.get("item"));
    if (!itemId) throw new Error("That part of the itinerary has gone.");
    const { error } = await ctx.supabase.rpc("delete_outing_item", { p_item_id: itemId });
    check(error, "Couldn't remove that.");
    done = { g: ctx.society.id, outing: trip.id };
    return "Removed.";
  });
  if (state.ok && done && form.get("back") === "1") {
    const d = done as { g: number; outing: number };
    redirect(consoleHref(d.g, `events/${d.outing}/itinerary`));
  }
  return state;
}
