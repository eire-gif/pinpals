"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { getStripeClient } from "@/lib/stripe/client";
import { reconcilePayoutTransfers, upsertPayout } from "@/lib/stripe/payouts";
import type { Order, Payout } from "@/lib/types";

type PayoutActionState = { error?: string; success?: boolean };

function revalidatePayout(payoutId: number) {
  revalidatePath(`/admin/payouts/ledger/${payoutId}`);
  revalidatePath("/admin/payouts/ledger");
}

/**
 * An admin's manual "Sync from Stripe" click — same gap-filling reasoning as
 * refreshSellerAccountStatus() (src/app/admin/payouts/[id]/actions.ts): for
 * the window between "something changed on Stripe's side" and "the
 * payout.* webhook actually arrived", or for a payout that predates this
 * app's Connect-events webhook subscription entirely (see the Phase 12
 * summary's manual-test notes on enabling "Listen to events on Connected
 * accounts"). Re-fetches this one payout by its Stripe id, upserts it, and
 * re-runs reconciliation exactly the same way the webhook handler does
 * (src/lib/stripe/payments.ts's handlePayoutEvent()) — never a separate code
 * path, so this button can never produce a different result than the
 * webhook eventually would have.
 */
export async function syncPayoutFromStripe(
  _prev: PayoutActionState,
  formData: FormData
): Promise<PayoutActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });
  const payoutRowId = Number(formData.get("payoutId"));
  if (!payoutRowId || Number.isNaN(payoutRowId)) return { error: "Missing payout id." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("payouts")
    .select("id, user_id, stripe_account_id, stripe_payout_id, livemode")
    .eq("id", payoutRowId)
    .maybeSingle<Pick<Payout, "id" | "user_id" | "stripe_account_id" | "stripe_payout_id" | "livemode">>();

  if (!existing) return { error: "Payout not found." };

  try {
    const stripe = getStripeClient();
    const payout = await stripe.payouts.retrieve(existing.stripe_payout_id, undefined, {
      stripeAccount: existing.stripe_account_id,
    });

    await upsertPayout(admin, payout, {
      userId: existing.user_id,
      stripeAccountId: existing.stripe_account_id,
      livemode: existing.livemode,
    });
    await reconcilePayoutTransfers(admin, {
      payoutRowId: existing.id,
      stripeAccountId: existing.stripe_account_id,
      stripePayoutId: existing.stripe_payout_id,
      payoutStatus: payout.status as Payout["status"],
    });

    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "payout.synced",
      targetType: "payout",
      targetId: existing.id,
      outcome: "success",
      // Same "operational fields only, never the raw Stripe payload"
      // discipline as refreshSellerAccountStatus()'s own audit metadata.
      metadata: { status: payout.status },
    });
  } catch {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "payout.synced",
      targetType: "payout",
      targetId: existing.id,
      outcome: "failure",
    });
    return { error: "Couldn't reach Stripe just now — please try again in a moment." };
  }

  revalidatePayout(payoutRowId);
  return { success: true };
}

async function setHeldStatus(
  formData: FormData,
  input: { held: boolean; action: "payout.held" | "payout.released" }
): Promise<PayoutActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });
  const payoutRowId = Number(formData.get("payoutId"));
  if (!payoutRowId || Number.isNaN(payoutRowId)) return { error: "Missing payout id." };

  const admin = createAdminClient();

  // Held/released is a Pinpals-internal flag on the ORDERS this payout swept
  // up (payout_status = 'held') — never a Stripe mutation, and never touches
  // any bank/account detail. Releasing sets the orders back to 'paid_out'
  // (this action only ever targets orders this payout already reconciled as
  // paid) rather than trying to reverse-derive whatever state they were in
  // before the hold.
  const { data: orders, error } = await admin
    .from("orders")
    .update({ payout_status: input.held ? "held" : "paid_out" })
    .eq("payout_id", payoutRowId)
    .eq("payout_status", input.held ? "paid_out" : "held")
    .select("id")
    .returns<Pick<Order, "id">[]>();

  if (error) return { error: "Couldn't update those orders just now — please try again in a moment." };

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: input.action,
    targetType: "payout",
    targetId: payoutRowId,
    outcome: "success",
    metadata: { orderIds: (orders ?? []).map((o) => o.id) },
  });

  revalidatePayout(payoutRowId);
  return { success: true };
}

/**
 * Flags every order this payout paid out as 'held' — a manual signal for
 * "don't treat this as settled yet, a human is looking into it" (a
 * chargeback risk, a seller dispute, anything not itself a Stripe-reported
 * payout failure). apply_payout_reconciliation() (0024) is written to never
 * overwrite a 'held' row, so this is the one status an automatic
 * reconciliation pass can never clobber until explicitly released below.
 */
export async function holdPayoutOrders(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  return setHeldStatus(formData, { held: true, action: "payout.held" });
}

/** Releases a hold placed by holdPayoutOrders() above, returning those
 * orders' payout_status to 'paid_out'. */
export async function releasePayoutOrders(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  return setHeldStatus(formData, { held: false, action: "payout.released" });
}
