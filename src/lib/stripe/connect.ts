import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// The one place in this app that interprets a Stripe Connect Account
// payload into what Pinpals stores. Every caller — the account.updated
// webhook, the onboarding-return handler, and an admin's manual "Refresh
// from Stripe" action — goes through mapStripeAccountToRow() (directly, for
// testing) or syncConnectedAccountFromStripe() (the actual DB write), never
// reimplements this mapping inline. See supabase/migrations/
// 0020_stripe_connected_accounts.sql for why only these specific fields are
// kept: Stripe's own operational flags, never a status Pinpals invents.

export type StripeConnectAccountRow = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_currently_due: string[];
  requirements_past_due: string[];
  disabled_reason: string | null;
};

/**
 * Pure mapping from a Stripe Account object to the row shape this app
 * stores. Framework-free and DB-free by design (same reasoning as
 * src/lib/admin/roles.ts's canAccess()) so it's trivial to unit test without
 * a real Stripe account or a mocked network call — see connect.test.ts.
 */
export function mapStripeAccountToRow(account: Stripe.Account): StripeConnectAccountRow {
  return {
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    details_submitted: account.details_submitted ?? false,
    requirements_currently_due: account.requirements?.currently_due ?? [],
    requirements_past_due: account.requirements?.past_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  };
}

/**
 * Writes a Stripe Account's current operational status into
 * stripe_connected_accounts, keyed on stripe_account_id. Always goes through
 * the service-role client — there is no authenticated update policy on this
 * table (see the migration) — and always stamps last_synced_at so the admin
 * UI can show "as of" rather than implying this row is live.
 *
 * Silently no-ops if no row exists for this account id yet (e.g. a stray
 * webhook for an account this app didn't create, or one that arrives before
 * the initial insert lands) rather than throwing — callers that need to know
 * whether a row existed (the admin refresh action) check its own return
 * value.
 */
export async function syncConnectedAccountFromStripe(account: Stripe.Account): Promise<boolean> {
  const admin = createAdminClient();
  const row = mapStripeAccountToRow(account);

  const { data, error } = await admin
    .from("stripe_connected_accounts")
    .update({ ...row, last_synced_at: new Date().toISOString() })
    .eq("stripe_account_id", account.id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to sync Stripe connected account ${account.id}: ${error.message}`);
  }

  return data != null;
}
