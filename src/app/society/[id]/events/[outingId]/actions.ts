"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import type { ConsoleContext } from "@/lib/society-console/access";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { parseIndex, positiveInt, text } from "@/lib/society-console/rules";

/**
 * One event's control room — the same functions the app's outing screen
 * calls (outings.ts), with the member's own client:
 *
 *   events area   cancel_outing, review_outing_request, promote_outing_waiting,
 *                 set_outing_entry, add/update/remove_outing_guest
 *   money area    mark_outing_paid, claim_outing_paid (clearing a claim),
 *                 mark_outing_refunded, mark_outing_guest_paid   (0144)
 *
 * Every id from the form is checked to belong to this society before the
 * call; the database then decides whether this member may.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Paid = "cash" | "transfer" | "waived";
const isPaid = (v: unknown): v is Paid => v === "cash" || v === "transfer" || v === "waived";

async function ownOuting(ctx: ConsoleContext, form: FormData): Promise<number> {
  const id = positiveInt(form.get("outing"));
  if (!id) throw new Error("That event wasn't found.");
  const { data } = await ctx.supabase.from("society_outings").select("id").eq("id", id).eq("group_id", ctx.society.id).maybeSingle();
  if (!data) throw new Error("That event wasn't found.");
  return id;
}

function member(form: FormData): string {
  const m = text(form, "member", 40);
  if (!m || !UUID.test(m)) throw new Error("That member wasn't found.");
  return m;
}

async function ownGuest(ctx: ConsoleContext, form: FormData): Promise<number> {
  const outing = await ownOuting(ctx, form);
  const id = positiveInt(form.get("guest"));
  if (!id) throw new Error("That guest wasn't found.");
  const { data } = await ctx.supabase.from("society_outing_guests").select("id").eq("id", id).eq("outing_id", outing).maybeSingle();
  if (!data) throw new Error("That guest wasn't found.");
  return id;
}

// ---------------------------------------------------------------------------
// Events area
// ---------------------------------------------------------------------------

export async function cancelEvent(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const { error } = await ctx.supabase.rpc("cancel_outing", { p_outing_id: outing });
    check(error, "Couldn't cancel the event.");
    return "Cancelled. It stays in the list marked as cancelled, and nobody can join it.";
  });
}

const DECISIONS = ["approve", "member_only", "waiting", "decline"] as const;
type Decision = (typeof DECISIONS)[number];

export async function reviewRequest(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const who = member(form);
    const decision = text(form, "decision", 20) as Decision | null;
    if (!decision || !DECISIONS.includes(decision)) throw new Error("Approve, decline or put them on the waiting list.");
    const { data, error } = await ctx.supabase.rpc("review_outing_request", { p_outing_id: outing, p_member: who, p_decision: decision });
    check(error, "Couldn't answer that.");
    const r = String(data);
    return r === "confirmed" ? "They have a place — they'll get a notification." : r === "waiting" ? "On the waiting list." : r === "declined" ? "Declined — they'll get a notification." : "Done.";
  });
}

export async function promoteWaiting(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const { error } = await ctx.supabase.rpc("promote_outing_waiting", { p_outing_id: outing, p_member: member(form) });
    check(error, "Couldn't give them a place.");
    return "They have a place.";
  });
}

/** Put a member in (true) or take them out (false). */
export async function setEntry(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const inIt = text(form, "in", 5) === "1";
    const { error } = await ctx.supabase.rpc("set_outing_entry", { p_outing_id: outing, p_in: inIt, p_member: member(form) });
    check(error, inIt ? "Couldn't put them in." : "Couldn't take them out.");
    return inIt ? "Added to the event." : "Taken off the event.";
  });
}

function guestFields(form: FormData): { name: string; index: number | null } {
  const name = text(form, "name", 80);
  if (!name) throw new Error("Give the guest a name.");
  if (name.length > 60) throw new Error("That name is too long — 60 characters at most.");
  const index = parseIndex(text(form, "index", 8));
  if (index === undefined) throw new Error("A handicap index looks like 14.2, or +1.5 for a plus handicap.");
  return { name, index };
}

export async function addGuest(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const { name, index } = guestFields(form);
    const { error } = await ctx.supabase.rpc("add_outing_guest", { p_outing_id: outing, p_name: name, p_index: index });
    check(error, "Couldn't add the guest.");
    return `${name} added.`;
  });
}

export async function updateGuest(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const guest = await ownGuest(ctx, form);
    const { name, index } = guestFields(form);
    const { error } = await ctx.supabase.rpc("update_outing_guest", { p_guest_id: guest, p_name: name, p_index: index });
    check(error, "Couldn't change the guest.");
    return "Guest saved.";
  });
}

export async function removeGuest(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "events" }, async (ctx) => {
    const guest = await ownGuest(ctx, form);
    const { error } = await ctx.supabase.rpc("remove_outing_guest", { p_guest_id: guest });
    check(error, "Couldn't take the guest off.");
    return "Guest taken off.";
  });
}

// ---------------------------------------------------------------------------
// Money area (0144: payments are the treasurer's, captain's and secretary's)
// ---------------------------------------------------------------------------

/** Mark paid (cash / transfer / waived), or clear it ("none"). Confirming a claim is marking it. */
export async function markPaid(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money", alerts: false }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const raw = text(form, "status", 10);
    const status = raw === "none" ? null : isPaid(raw) ? raw : undefined;
    if (status === undefined) throw new Error("Choose how they paid.");
    const { error } = await ctx.supabase.rpc("mark_outing_paid", { p_outing_id: outing, p_member: member(form), p_status: status });
    check(error, "Couldn't mark that.");
    return status ? "Marked." : "Marked not paid.";
  });
}

/** "Not received": clears a member's "I've paid". */
export async function clearClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money", alerts: false }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const { error } = await ctx.supabase.rpc("claim_outing_paid", { p_outing_id: outing, p_method: null, p_member: member(form) });
    check(error, "Couldn't save that.");
    return "Claim cleared.";
  });
}

export async function markRefunded(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money", alerts: false }, async (ctx) => {
    const outing = await ownOuting(ctx, form);
    const refunded = text(form, "refunded", 5) === "1";
    const { error } = await ctx.supabase.rpc("mark_outing_refunded", { p_outing_id: outing, p_member: member(form), p_refunded: refunded });
    check(error, "Couldn't mark that.");
    return refunded ? "Marked refunded." : "Refund undone.";
  });
}

export async function markGuestPaid(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money", alerts: false }, async (ctx) => {
    const guest = await ownGuest(ctx, form);
    const raw = text(form, "status", 10);
    const status = raw === "none" ? null : isPaid(raw) ? raw : undefined;
    if (status === undefined) throw new Error("Choose how they paid.");
    const { error } = await ctx.supabase.rpc("mark_outing_guest_paid", { p_guest_id: guest, p_status: status });
    check(error, "Couldn't mark that.");
    return status ? "Marked." : "Marked not paid.";
  });
}
