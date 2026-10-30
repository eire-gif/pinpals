/**
 * The trip kitty (0202, claude/trip-kitty.md): loading and saving. The sums
 * are in kitty-rules.ts.
 */
import { loadGroupRoster, type RosterPlayer } from "@/lib/groups-data";
import { kittyBalances, settleKitty, type KittyCategory, type KittyExpense, type KittyPayment, type KittyTransfer } from "@/lib/kitty-rules";
import { supabase } from "@/lib/supabase";

export type KittyItem = KittyExpense & {
  title: string;
  category: KittyCategory;
  spentOn: string;
  createdBy: string | null;
};

export type KittyPaymentRow = KittyPayment & { markedBy: string | null; paidAt: string };

export type KittyPage = {
  outingId: number;
  groupId: number;
  tripTitle: string;
  /** Everyone who can be in the kitty: those entered on the trip, or the whole group when nobody is. */
  people: RosterPlayer[];
  expenses: KittyItem[];
  payments: KittyPaymentRow[];
  balances: Map<string, number>;
  /** The fewest payments that square everyone now. */
  toSettle: KittyTransfer[];
};

/** The database hasn't had 0202 yet. */
const missing = (e: { code?: string; message: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message));

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function loadKitty(outingId: number, groupId: number): Promise<KittyPage | null> {
  const [roster, trip, entries, ex, pays] = await Promise.all([
    loadGroupRoster(groupId),
    supabase.from("society_outings").select("title").eq("id", outingId).maybeSingle<{ title: string }>(),
    supabase.from("society_outing_entries").select("member_id").eq("outing_id", outingId).overrideTypes<{ member_id: string }[]>(),
    supabase
      .from("trip_kitty_expenses")
      .select("id, title, category, amount_cents, paid_by, spent_on, created_by, trip_kitty_shares (member_id)")
      .eq("outing_id", outingId)
      .order("spent_on", { ascending: false })
      .order("id", { ascending: false })
      .overrideTypes<{ id: number; title: string; category: KittyCategory; amount_cents: number; paid_by: string; spent_on: string; created_by: string | null; trip_kitty_shares: { member_id: string }[] }[]>(),
    supabase
      .from("trip_kitty_payments")
      .select("id, from_member, to_member, amount_cents, marked_by, paid_at")
      .eq("outing_id", outingId)
      .order("paid_at", { ascending: false })
      .overrideTypes<{ id: number; from_member: string; to_member: string; amount_cents: number; marked_by: string | null; paid_at: string }[]>(),
  ]);
  if (missing(ex.error)) return null;
  if (ex.error) fail(ex.error, "Couldn't load the kitty.");
  if (pays.error) fail(pays.error, "Couldn't load the payments.");

  const expenses: KittyItem[] = (ex.data ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    amountCents: e.amount_cents,
    paidBy: e.paid_by,
    spentOn: e.spent_on,
    createdBy: e.created_by,
    shares: (e.trip_kitty_shares ?? []).map((s) => s.member_id),
  }));
  const payments: KittyPaymentRow[] = (pays.data ?? []).map((p) => ({ id: p.id, from: p.from_member, to: p.to_member, amountCents: p.amount_cents, markedBy: p.marked_by, paidAt: p.paid_at }));
  const entered = new Set((entries.data ?? []).map((e) => e.member_id));
  const inKitty = new Set([...expenses.flatMap((e) => [e.paidBy, ...e.shares]), ...payments.flatMap((p) => [p.from, p.to])]);
  const people = entered.size > 0 ? roster.filter((r) => entered.has(r.id) || inKitty.has(r.id)) : roster;
  const balances = kittyBalances(expenses, payments);
  return { outingId, groupId, tripTitle: trip.data?.title ?? "The trip", people, expenses, payments, balances, toSettle: settleKitty(balances) };
}

export async function saveKittyExpense(
  outingId: number,
  id: number | null,
  e: { title: string; category: KittyCategory; amountCents: number; paidBy: string; spentOn: string; shares: string[] }
): Promise<number> {
  const { data, error } = await supabase.rpc("trip_kitty_save", {
    p_outing_id: outingId,
    p_id: id,
    p: { title: e.title.trim(), category: e.category, amount_cents: e.amountCents, paid_by: e.paidBy, spent_on: e.spentOn, shares: e.shares },
  });
  if (error) fail(error, "Couldn't save that.");
  return Number(data);
}

export async function deleteKittyExpense(id: number): Promise<void> {
  const { error } = await supabase.rpc("trip_kitty_delete", { p_id: id });
  if (error) fail(error, "Couldn't take that off.");
}

export async function markKittyPaid(outingId: number, from: string, to: string, cents: number): Promise<void> {
  const { error } = await supabase.rpc("trip_kitty_pay", { p_outing_id: outingId, p_from: from, p_to: to, p_amount_cents: cents });
  if (error) fail(error, "Couldn't tick that off.");
}

export async function undoKittyPayment(id: number): Promise<void> {
  const { error } = await supabase.rpc("trip_kitty_unpay", { p_payment_id: id });
  if (error) fail(error, "Couldn't undo that.");
}

/** For the itinerary's card: what's been spent, without loading everyone. */
export async function kittySpent(outingId: number): Promise<number | null> {
  const { data, error } = await supabase.from("trip_kitty_expenses").select("amount_cents").eq("outing_id", outingId).overrideTypes<{ amount_cents: number }[]>();
  if (error) return null;
  return (data ?? []).reduce((n, r) => n + r.amount_cents, 0);
}
