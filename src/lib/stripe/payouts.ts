import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripeClient } from "./client";
import type { Payout } from "@/lib/types";

// Finance/admin payout visibility and reconciliation (Phase 12) — see
// supabase/migrations/0024_payouts.sql for the schema this backs. Same
// "pure mapping + a service-role write helper" split as
// src/lib/stripe/connect.ts, plus the one piece connect.ts doesn't need:
// reconciling which of THIS app's orders a given payout actually swept up,
// since (unlike a connected account's operational flags) a Payout object
// carries no list of the orders behind it — Stripe only exposes that via
// its balance transaction history.

export type PayoutRow = {
  user_id: string;
  stripe_account_id: string;
  stripe_payout_id: string;
  amount_eur: number;
  currency: string;
  status: Payout["status"];
  failure_code: string | null;
  failure_message: string | null;
  arrival_date: string | null;
  method: string | null;
  type: string | null;
  livemode: boolean;
  stripe_created_at: string;
};

/**
 * Pure mapping from a Stripe Payout object to the row shape this app
 * stores. Framework-free and DB-free by design, same reasoning as
 * connect.ts's mapStripeAccountToRow() — trivial to unit test without a
 * real Stripe payout. See payouts.test.ts.
 */
export function mapStripePayoutToRow(
  payout: Stripe.Payout,
  input: { userId: string; stripeAccountId: string; livemode: boolean }
): PayoutRow {
  return {
    user_id: input.userId,
    stripe_account_id: input.stripeAccountId,
    stripe_payout_id: payout.id,
    amount_eur: payout.amount / 100,
    currency: payout.currency,
    status: payout.status as Payout["status"],
    failure_code: payout.failure_code ?? null,
    failure_message: payout.failure_message ?? null,
    arrival_date: payout.arrival_date ? new Date(payout.arrival_date * 1000).toISOString() : null,
    method: payout.method ?? null,
    type: payout.type ?? null,
    livemode: input.livemode,
    stripe_created_at: new Date(payout.created * 1000).toISOString(),
  };
}

/**
 * Writes one Stripe Payout's current state into `payouts`, keyed on
 * stripe_payout_id — same "upsert, no dedicated function" shape as a
 * disputes-table write (src/lib/stripe/payments.ts's handleDisputeEvent()),
 * since a payout row here is also a pure Stripe projection with no guard
 * logic to centralize (the *order-level* state transition this triggers is
 * what apply_payout_reconciliation() guards — see reconcilePayoutTransfers()
 * below). Always goes through the service-role client and always stamps
 * last_synced_at, same discipline as syncConnectedAccountFromStripe().
 * Returns the row's own Pinpals id, needed to link orders.payout_id to it.
 */
export async function upsertPayout(
  admin: SupabaseClient,
  payout: Stripe.Payout,
  input: { userId: string; stripeAccountId: string; livemode: boolean }
): Promise<number> {
  const row = mapStripePayoutToRow(payout, input);

  const { data, error } = await admin
    .from("payouts")
    .upsert({ ...row, last_synced_at: new Date().toISOString() }, { onConflict: "stripe_payout_id" })
    .select("id")
    .single<{ id: number }>();

  if (error || !data) {
    throw new Error(`Failed to upsert Stripe payout ${payout.id}: ${error?.message ?? "no row returned"}`);
  }
  return data.id;
}

/** Stripe's own payout status collapsed to the two outcomes an order's
 * payout_status ever needs to reflect — 'paid' means the money genuinely
 * landed in the seller's bank account, everything else that reconciliation
 * ever runs against ('canceled'/'failed') means it didn't and needs a human
 * to look at it. ('pending'/'in_transit' payouts don't trigger
 * reconciliation at all — see reconcilePayoutTransfers() — so they're not
 * mapped here.) */
export function orderPayoutStatusForPayout(status: Payout["status"]): "paid_out" | "failed" | null {
  if (status === "paid") return "paid_out";
  if (status === "canceled" || status === "failed") return "failed";
  return null;
}

const MAX_BALANCE_TRANSACTION_PAGES = 10; // 10 * 100 = 1,000 transfers per payout, a generous cap for this app's current scale

/**
 * The actual reconciliation: asks Stripe which transfers a given payout
 * swept up (a payout carries no such list itself — this is the only way to
 * learn it), then updates every matching order via the guarded
 * apply_payout_reconciliation() function (0024) — never overwrites an
 * admin-held order, and safely re-runs if this payout's webhook redelivers.
 * Only called for a payout in a TERMINAL state (paid/canceled/failed, see
 * orderPayoutStatusForPayout()) — a still-in-flight payout has nothing
 * final to reconcile against yet.
 *
 * Capped at MAX_BALANCE_TRANSACTION_PAGES pages as a safety bound against an
 * unbounded loop; a payout that genuinely aggregates more transfers than
 * that is beyond this app's current scale and is left for a later phase
 * (noted in the Phase 12 summary's deferred items).
 */
export async function reconcilePayoutTransfers(
  admin: SupabaseClient,
  input: { payoutRowId: number; stripeAccountId: string; stripePayoutId: string; payoutStatus: Payout["status"] }
): Promise<void> {
  const orderPayoutStatus = orderPayoutStatusForPayout(input.payoutStatus);
  if (!orderPayoutStatus) return;

  const stripe = getStripeClient();
  const transferIds: string[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_BALANCE_TRANSACTION_PAGES; page++) {
    const list = await stripe.balanceTransactions.list(
      { payout: input.stripePayoutId, type: "transfer", limit: 100, starting_after: startingAfter },
      { stripeAccount: input.stripeAccountId }
    );
    for (const bt of list.data) {
      const transferId = typeof bt.source === "string" ? bt.source : bt.source?.id;
      if (transferId) transferIds.push(transferId);
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }

  if (transferIds.length === 0) return;

  const { error } = await admin.rpc("apply_payout_reconciliation", {
    p_payout_id: input.payoutRowId,
    p_order_payout_status: orderPayoutStatus,
    p_transfer_ids: transferIds,
  });
  if (error) {
    throw new Error(`Failed to reconcile payout ${input.stripePayoutId} against its orders: ${error.message}`);
  }
}

/**
 * Direct link into Stripe's own connected-account payout view — same
 * "link out rather than replicate Stripe's own tooling" reasoning as
 * src/lib/stripe/refunds.ts's stripeDisputeDashboardUrl(), just under
 * Connect's own dashboard path since a payout belongs to the connected
 * account, not the platform account.
 */
export function stripePayoutDashboardUrl(stripeAccountId: string, payoutId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}connect/accounts/${stripeAccountId}/payouts/${payoutId}`;
}
