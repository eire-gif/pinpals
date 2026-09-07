import Link from "next/link";
import { formatPrice, formatPriceCents } from "@/lib/format";
import BuyNowButton from "./buy-now-button";
import type { ListingPurchaseState } from "./action-state";

/**
 * "mobile bottom action bar" (this phase's spec) — a condensed, always-
 * visible price + primary-action strip for narrow viewports, `md:hidden`
 * (the full interactive PurchasePanel already renders inline further up
 * the page on mobile — see ../page.tsx — so nothing here is a second,
 * divergent implementation: a bid needs its own amount field and can't
 * usefully live in a fixed one-line bar, so that case just anchors up to
 * the real form rather than duplicating it).
 */
export default function MobileActionBar({ listingId, state }: { listingId: number; state: ListingPurchaseState }) {
  if (state.kind === "seller" || state.kind === "signed_out") return null;

  return (
    <div className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-line px-4 py-3 flex items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      {state.kind === "unavailable" && (
        <p className="text-sm text-ink-500 flex-1">{state.reason}</p>
      )}

      {state.kind === "fixed_price" && (
        <>
          <span className="font-display font-bold text-lg text-gold-600 shrink-0">{formatPrice(state.priceEur)}</span>
          <div className="flex-1">
            <BuyNowButton listingId={listingId} />
          </div>
        </>
      )}

      {state.kind === "auction" && (
        <>
          <div className="shrink-0">
            <div className="text-[11px] text-ink-500 leading-none">{state.ended ? "Closed" : "Current bid"}</div>
            <div className="font-display font-bold text-lg text-gold-600 leading-tight">
              {formatPriceCents(state.currentBidCents)}
            </div>
          </div>
          <Link
            href="#purchase-panel-mobile"
            className="flex-1 text-center py-3 rounded-full font-bold text-sm bg-gold-600 text-navy-900 hover:bg-gold-500 transition"
          >
            {state.ended ? "View auction" : "Place a bid"}
          </Link>
        </>
      )}
    </div>
  );
}
