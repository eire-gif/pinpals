import Link from "next/link";

import { GOLD_BUTTON, NAVY_OUTLINE_BUTTON } from "@/components/marketplace/buy-styles";

/**
 * One link, both Buy Now paths (fixed-price/offers-allowed, and the Buy It
 * Now price on an auction_with_buy_now listing) — both now lead to the same
 * checkout page (./checkout/page.tsx), which re-derives which price/flow
 * applies from the listing itself, so this component only ever needs the
 * listing id. No client-side pending/error state of its own any more: a
 * plain navigation has nothing to fail the way the old direct buyNow()
 * Server Action call could — every eligibility/price check now happens once
 * the buyer is actually on the checkout page (and, authoritatively, when
 * they submit it — see create_purchase_order()'s own header comment,
 * supabase/migrations/0050_marketplace_checkout.sql).
 */
export default function BuyNowButton({
  listingId,
  label = "Buy Now",
  variant = "primary",
}: {
  listingId: number;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  // Gold on a darker gold lip — the one "this spends money" button, the
  // same on the website and in the app (Oct 2026 redesign, mock-up 3).
  // Navy text on gold-400 is well over WCAG AA.
  const styles = variant === "primary" ? GOLD_BUTTON : NAVY_OUTLINE_BUTTON;

  return (
    <Link href={`/marketplace/${listingId}/checkout`} className={`w-full ${styles}`}>
      {label}
    </Link>
  );
}
