"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAdminAction } from "@/lib/admin/audit";
import { getStripeClient } from "@/lib/stripe/client";
import { syncConnectedAccountFromStripe } from "@/lib/stripe/connect";
import type { StripeConnectedAccount } from "@/lib/types";

type RefreshActionState = { error?: string; success?: boolean };

/**
 * An admin's manual "Refresh from Stripe" click — the one admin *interaction*
 * this phase's Stripe Connect work audits (see the comment on
 * "seller_account.synced" in src/lib/admin/audit.ts). Exists for the gap
 * between "something changed on Stripe's side" and "the account.updated
 * webhook actually arrived" — same safe server-side stripe.accounts.retrieve()
 * pattern as the member's own onboarding-return handler
 * (src/app/dashboard/payouts/return/route.ts), just admin-triggered instead
 * of automatic.
 *
 * Deliberately logs only the resulting operational flags in the audit
 * metadata (charges_enabled/payouts_enabled/details_submitted) — never the
 * raw Stripe Account payload itself, per the task's "do not log sensitive
 * Stripe payload content" requirement. recordAdminAction()'s own
 * sanitizeMetadata() is a backstop, not the reason this is safe; the reason
 * is that nothing sensitive is ever put into metadata in the first place.
 */
export async function refreshSellerAccountStatus(
  _prev: RefreshActionState,
  formData: FormData
): Promise<RefreshActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return { error: "Missing seller id." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("stripe_connected_accounts")
    .select("id, stripe_account_id")
    .eq("user_id", userId)
    .maybeSingle<Pick<StripeConnectedAccount, "id" | "stripe_account_id">>();

  if (!existing) return { error: "No Stripe connected account found for this member." };

  try {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(existing.stripe_account_id);
    await syncConnectedAccountFromStripe(account);

    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "seller_account.synced",
      targetType: "seller_account",
      targetId: existing.id,
      outcome: "success",
      metadata: {
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        detailsSubmitted: account.details_submitted ?? false,
      },
    });
  } catch {
    // Never include the caught error's message here — a Stripe API error can
    // echo back request details that don't belong in the audit log, and this
    // action doesn't need more than "it failed" to be useful to staff.
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "seller_account.synced",
      targetType: "seller_account",
      targetId: existing.id,
      outcome: "failure",
    });
    return { error: "Couldn't reach Stripe just now — please try again in a moment." };
  }

  revalidatePath(`/admin/payouts/${userId}`);
  revalidatePath("/admin/payouts");
  return { success: true };
}
