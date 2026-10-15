"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { positiveInt, text } from "@/lib/society-console/rules";

/**
 * The treasurer's "Say they've paid" list (0144), as the app's Money screen
 * does it: Confirm marks the payment with how they said they paid (Revolut
 * counts as a transfer); Not received takes their "I've paid" away.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = ["revolut", "transfer", "cash"] as const;

function readClaim(form: FormData) {
  const kind = form.get("kind");
  const member = text(form, "member", 64);
  const method = text(form, "method", 20);
  if ((kind !== "event" && kind !== "membership") || !member || !UUID.test(member)) return null;
  const outingId = positiveInt(form.get("outing"));
  const season = positiveInt(form.get("season"));
  if (kind === "event" && !outingId) return null;
  return { kind, member, method: (METHODS as readonly string[]).includes(method ?? "") ? (method as (typeof METHODS)[number]) : null, outingId, season } as const;
}

export async function confirmClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money" }, async ({ supabase, society }) => {
    const c = readClaim(form);
    if (!c || !c.method) throw new Error("That payment wasn't found.");
    const how = c.method === "cash" ? "cash" : "transfer";
    if (c.kind === "event") {
      // The outing must be this society's; the database checks the rest.
      const { data: o } = await supabase.from("society_outings").select("id").eq("id", c.outingId!).eq("group_id", society.id).maybeSingle();
      if (!o) throw new Error("That event isn't in this society.");
      const { error } = await supabase.rpc("mark_outing_paid", { p_outing_id: c.outingId, p_member: c.member, p_status: how });
      check(error, "Couldn't mark that.");
    } else {
      if (!c.season || c.season < 2000 || c.season > 2100) throw new Error("Choose the season.");
      const { error } = await supabase.rpc("mark_membership", { p_group_id: society.id, p_member: c.member, p_season: c.season, p_status: "paid", p_method: how });
      check(error, "Couldn't mark that.");
    }
    return "Payment confirmed.";
  });
}

export async function rejectClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money" }, async ({ supabase, society }) => {
    const c = readClaim(form);
    if (!c) throw new Error("That payment wasn't found.");
    if (c.kind === "event") {
      const { data: o } = await supabase.from("society_outings").select("id").eq("id", c.outingId!).eq("group_id", society.id).maybeSingle();
      if (!o) throw new Error("That event isn't in this society.");
      const { error } = await supabase.rpc("claim_outing_paid", { p_outing_id: c.outingId, p_method: null, p_member: c.member });
      check(error, "Couldn't save that.");
    } else {
      const { error } = await supabase.rpc("claim_membership_paid", { p_group_id: society.id, p_method: null, p_member: c.member });
      check(error, "Couldn't save that.");
    }
    return "Marked as not received.";
  });
}
