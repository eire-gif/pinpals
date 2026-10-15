"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/society-console/action-state";
import { loadClub } from "@/lib/society-console/events-data";
import { buildOutingP } from "@/lib/society-console/events-form";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, consoleHref, positiveInt, text } from "@/lib/society-console/rules";

/**
 * New event / save changes — save_outing with `p` exactly as the app's
 * saveOuting sends it (outings.ts). Payment details are only read from the
 * form for someone with the money area; for anyone else the database keeps
 * what's there (or, new, the society's last details) — 0142/0144.
 */
export async function saveEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const editId = positiveInt(form.get("outing"));
  let savedId: number | null = null;
  let trip = false;
  const state = await consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const money = ctx.areas.includes("money");
    if (editId) {
      // Only this society's events.
      const { data } = await ctx.supabase.from("society_outings").select("id").eq("id", editId).eq("group_id", ctx.society.id).maybeSingle();
      if (!data) throw new Error("That event can't be changed.");
    }
    const clubId = positiveInt(form.get("club"));
    // The club's name comes from the club itself, never from the form.
    const club = clubId ? await loadClub(ctx.supabase, clubId) : null;
    if (clubId && !club) throw new Error("That course wasn't found — search for it again.");
    const built = buildOutingP(
      {
        kind: text(form, "kind", 20),
        title: text(form, "title", 200),
        clubId: club?.id ?? null,
        clubName: club?.name ?? null,
        course: text(form, "course", 200),
        playsOn: text(form, "plays_on", 10),
        endsOn: text(form, "ends_on", 10),
        location: text(form, "location", 300),
        firstTee: text(form, "first_tee", 5),
        fee: text(form, "fee", 12),
        max: text(form, "max", 6),
        details: text(form, "details", 2000),
        entryMode: text(form, "entry_mode", 10),
        waitingList: checked(form, "waiting_list"),
        autoOffer: checked(form, "auto_offer"),
        guestsAllowed: checked(form, "guests_allowed"),
        guestFee: text(form, "guest_fee", 12),
        closeDays: text(form, "close_days", 3),
        arriveBy: text(form, "arrive_by", 5),
        formatLabel: text(form, "format_label", 100),
        dressCode: text(form, "dress_code", 300),
        meals: text(form, "meals", 400),
        revtag: text(form, "revtag", 60),
        iban: text(form, "iban", 60),
        accountName: text(form, "account_name", 100),
        payCash: checked(form, "pay_cash"),
        payNote: text(form, "pay_note", 300),
      },
      { money, editing: editId != null }
    );
    if ("error" in built) throw new Error(built.error.endsWith(".") ? built.error : `${built.error}.`);
    const { data, error } = await ctx.supabase.rpc("save_outing", { p_group_id: ctx.society.id, p_id: editId, p: built.p });
    check(error, "Couldn't save the event.");
    savedId = Number(data);
    trip = built.p.kind !== "day";
    return editId ? "Changes saved." : "Event created.";
  });
  if (state.ok && savedId) {
    const g = positiveInt(form.get("g"));
    // A new trip goes straight to building its itinerary, as in the app.
    redirect(consoleHref(g!, `events/${savedId}${trip && !editId ? "/itinerary" : ""}`));
  }
  return state;
}
