import Link from "next/link";

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
  const styles =
    variant === "primary"
      ? "bg-green-700 text-cream-50 hover:bg-green-600"
      : "border-[1.5px] border-green-700 text-green-700 hover:bg-green-100";

  return (
    <Link
      href={`/marketplace/${listingId}/checkout`}
      className={`block w-full text-center py-3.5 rounded-full font-bold transition ${styles}`}
    >
      {label}
    </Link>
  );
}
