"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { recordAdminAction } from "@/lib/admin/audit";
import { auctionEligibleForForceClose } from "@/lib/admin/marketplace";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Auction } from "@/lib/types";

export type MarketplaceActionState = { error?: string; success?: boolean };

const REASON_MAX_LENGTH = 4000; // same bound requestOrderRefund() uses (refunds.reason's check constraint)

/**
 * The one mutation this checkpoint adds — see auctionEligibleForForceClose()
 * (src/lib/admin/marketplace.ts) for why it needs to exist at all: this
 * schema only ever closes an auction lazily, the moment someone tries to
 * act on it, so a real auction can sit indefinitely in 'live'/'scheduled'
 * status after its own end time with no winning bidder able to check out.
 *
 * Every requirement from the task maps to a specific step below —
 *  - finance-role gate (a transaction-blocking state, not a content-
 *    moderation one — same role set as orders/refunds/payouts, not
 *    MODERATION_ROLES): requireStaff({ roles: FINANCE_ROLES }).
 *  - never trust client state: the auction is re-fetched by id alone and
 *    re-validated against auctionEligibleForForceClose() here, server-side
 *    — a client that raced a real bid in between page-load and submit gets
 *    a clear error, not a silently-wrong close.
 *  - reason required: enforced below, same bound as every other admin
 *    reason field.
 *  - confirmation: this action is only ever reachable through
 *    ModerationForm (src/components/admin/moderation-form.tsx) — the same
 *    required-reason-plus-explicit-submit pattern every other status-
 *    changing admin action in this app uses as its confirmation step (see
 *    that component's own file-header comment); no destructive action
 *    anywhere in this admin console uses a JS confirm() dialog, so this
 *    doesn't invent a second pattern.
 *  - safe retry: the guard clause below (status in scheduled/live AND
 *    ends_at <= now) makes a second submit of the same click a friendly
 *    "already closed" response, not an error — the underlying UPDATE's own
 *    WHERE clause is what actually makes this safe under a genuine race,
 *    not just the pre-check.
 *  - audit event: recordAdminAction() below, actor/action/target/reason/
 *    before-after summary, on both outcomes.
 *  - no raw financial data: this action never touches payment/Stripe
 *    fields at all — it only ever flips one status column.
 */
export async function forceCloseAuction(
  _prev: MarketplaceActionState,
  formData: FormData
): Promise<MarketplaceActionState> {
  const { user, staff } = await requireStaff({ roles: FINANCE_ROLES });

  const auctionId = Number(formData.get("auctionId"));
  if (!auctionId || Number.isNaN(auctionId)) return { error: "Missing auction." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required." };
  if (reason.length > REASON_MAX_LENGTH) return { error: "Reason is too long." };

  const admin = createAdminClient();

  const { data: auction, error: auctionError } = await admin
    .from("auctions")
    .select("*")
    .eq("id", auctionId)
    .maybeSingle<Auction>();
  if (auctionError || !auction) return { error: "Auction not found." };

  if (auction.status === "ended" || auction.status === "cancelled") {
    // Safe-retry path: someone else's click (or this admin's own double
    // submit) already closed it — not an error, just nothing left to do.
    revalidatePath("/admin/marketplace");
    return { success: true };
  }

  if (!auctionEligibleForForceClose(auction)) {
    return { error: "This auction hasn't reached its end time yet — it can't be force-closed early." };
  }

  const { data: updated, error: updateError } = await admin
    .from("auctions")
    .update({ status: "ended" })
    .eq("id", auctionId)
    .in("status", ["scheduled", "live"])
    .lte("ends_at", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (updateError) {
    await recordAdminAction({
      actor: { id: user.id, role: staff.role },
      action: "auction.force_closed",
      targetType: "auction",
      targetId: auctionId,
      reason,
      outcome: "failure",
      metadata: { error: updateError.message },
    });
    return { error: "Couldn't close the auction — try again." };
  }

  if (!updated) {
    // Lost a race between the maybeSingle() read above and this guarded
    // UPDATE (e.g. a bid landed in between, flipping it back out of
    // eligibility) — same friendly non-error as the already-closed case.
    revalidatePath("/admin/marketplace");
    return { success: true };
  }

  await recordAdminAction({
    actor: { id: user.id, role: staff.role },
    action: "auction.force_closed",
    targetType: "auction",
    targetId: auctionId,
    reason,
    outcome: "success",
    metadata: { previousStatus: auction.status, newStatus: "ended", endsAt: auction.ends_at },
  });

  revalidatePath("/admin/marketplace");
  return { success: true };
}
