import "server-only";
import type Stripe from "stripe";
import { getStripeClient } from "./client";

// A seller's own Stripe Connect available/pending balance — the "available/
// pending balance" the marketplace-workspaces task asks the seller workspace
// to show. Deliberately the ONE piece of Stripe data in this whole feature
// read live rather than from a DB mirror: unlike stripe_connected_accounts
// (0020) or payouts (0024), a balance is a snapshot of money currently in
// flux — caching it would mean showing a seller a number that's already
// wrong. Every other read in this app's dashboard pages goes through a
// service-role/RLS-scoped DB query for exactly this reason (see
// src/app/dashboard/payouts/page.tsx's own comment) — this is the deliberate
// exception, not a new pattern to generalize from.

export type ConnectAccountBalance = { availableEur: number; pendingEur: number };

/**
 * Sums a Stripe Balance object's available/pending arrays into single EUR
 * totals. Pure and Stripe-client-free on purpose — the actual network call
 * lives only in getConnectAccountBalance() below, so this half is directly
 * unit-testable (see balance.test.ts) without mocking the Stripe SDK.
 * Every connected account this app creates is EUR-only (stripe_connected_accounts
 * has no currency column at all, 0020) so in practice there is exactly one
 * entry in each array — this sums every entry regardless of its own currency
 * code rather than filtering to "eur" specifically, so a stray non-EUR
 * balance entry (which should never happen) is still reflected rather than
 * silently dropped.
 */
export function summarizeBalance(balance: Pick<Stripe.Balance, "available" | "pending">): ConnectAccountBalance {
  const sumCents = (entries: Stripe.Balance["available"]) =>
    entries.reduce((total, entry) => total + entry.amount, 0);
  return {
    availableEur: sumCents(balance.available) / 100,
    pendingEur: sumCents(balance.pending) / 100,
  };
}

/**
 * A seller's own Stripe Connect balance, read live. Best-effort: returns
 * `null` on ANY Stripe error (a restricted or not-yet-chargeable account, a
 * transient API failure, a bad account id) rather than throwing, so a
 * live-data hiccup never takes down the whole seller workspace page around
 * it — callers show a "balance unavailable right now" fallback instead. This
 * is the one place in this app that's allowed to fail open like that,
 * precisely because it never writes anything and never gates an action —
 * it's a display-only read.
 */
export async function getConnectAccountBalance(stripeAccountId: string): Promise<ConnectAccountBalance | null> {
  try {
    const stripe = getStripeClient();
    const balance = await stripe.balance.retrieve({}, { stripeAccount: stripeAccountId });
    return summarizeBalance(balance);
  } catch {
    return null;
  }
}
