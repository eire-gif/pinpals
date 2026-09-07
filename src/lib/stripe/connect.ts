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

// ============ Seller onboarding status (derived, never stored) ============
// The seller-readiness flow (src/app/dashboard/payouts/page.tsx, the
// marketplace publish gate in src/app/marketplace/new/actions.ts and
// src/app/marketplace/[id]/actions.ts) needs one clear five-value status
// rather than reading the raw Stripe flags inline in every caller. This is
// deliberately a PURE function of the same cached flags
// stripe_connected_accounts already stores — never a new column, same rule
// as sellerAccountStatusLabel() in src/lib/format.ts ("never a status
// Pinpals invents itself"). The two are independent, not layered on each
// other: this one exists for the narrower enum a gate/badge needs to switch
// on; that one exists for the free-text summary /dashboard/payouts and
// /admin/payouts have shown since phase 9. Keeping them separate means nothing
// about the existing, already-tested label logic has to change for this to
// exist.
export type SellerOnboardingStatus =
  | "not_started"
  | "requirements_due"
  | "pending"
  | "enabled"
  | "restricted";

export function sellerOnboardingStatus(
  account: Pick<
    StripeConnectAccountRow,
    | "charges_enabled"
    | "payouts_enabled"
    | "details_submitted"
    | "requirements_currently_due"
    | "requirements_past_due"
    | "disabled_reason"
  > | null
): SellerOnboardingStatus {
  if (!account) return "not_started";

  // Checked first and unconditionally: an account Stripe has disabled, or
  // that has requirements now PAST due, needs the seller's attention even if
  // charges/payouts still happen to read true from before the restriction —
  // Stripe can flip those independently of this flag.
  if (account.disabled_reason || account.requirements_past_due.length > 0) {
    return "restricted";
  }

  // Anything CURRENTLY due (not yet past due) blocks "enabled" even if
  // charges/payouts already read true — e.g. Stripe periodically re-asks for
  // updated verification on an already-active account.
  if (account.requirements_currently_due.length > 0) {
    return "requirements_due";
  }

  if (account.charges_enabled && account.payouts_enabled) {
    return "enabled";
  }

  // Submitted, nothing currently outstanding, but Stripe hasn't flipped
  // charges/payouts on yet — under review.
  if (account.details_submitted) {
    return "pending";
  }

  // Row exists (onboarding started) but Stripe hasn't reported any
  // requirements yet — rare in practice (Express accounts get requirements
  // immediately on creation), but falls out here rather than being treated
  // as "enabled" or "not started".
  return "requirements_due";
}

/** The one place the publish gate (and anything else that cares) asks "is
 * this seller actually ready to take a sale" — kept as a named predicate
 * rather than an inline `=== "enabled"` at every call site so a future
 * change to what "ready" means only has to happen here. */
export function isSellerPaymentReady(status: SellerOnboardingStatus): boolean {
  return status === "enabled";
}

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
