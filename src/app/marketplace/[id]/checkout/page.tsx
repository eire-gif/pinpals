import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { centsToEur } from "@/lib/marketplace";
import { runOfferSweeps } from "../actions";
import CheckoutForm from "@/app/checkout/checkout-form";
import { submitBuyNowCheckout } from "./actions";
import type { Address, Auction, Listing } from "@/lib/types";

function parseListingId(id: string): number | null {
  const listingId = Number(id);
  return listingId && !Number.isNaN(listingId) ? listingId : null;
}

/**
 * The Buy Now checkout page — everything this phase's spec asks a checkout
 * page to show, BEFORE any order exists: item/seller summary, the
 * delivery/collection choice this listing actually supports, an address
 * picker, a transparent total, and buyer-protection/terms acknowledgement.
 * Submitting (submitBuyNowCheckout(), ./actions.ts) is the one moment the
 * order actually gets created — see create_purchase_order()'s own header
 * comment (supabase/migrations/0050_marketplace_checkout.sql) for why the
 * order-creating "Server transaction" happens here, at submit, rather than
 * the instant a buyer clicks "Buy Now" on the listing page (which now only
 * ever links here — see buy-now-button.tsx).
 *
 * Every eligibility check here is a courtesy early exit for a good UX
 * (redirect back rather than show a checkout form for something that isn't
 * actually purchasable) — create_purchase_order() re-derives and re-checks
 * every one of these itself from a freshly locked read, so a stale render of
 * this page can only ever produce a friendly rejection on submit, never an
 * incorrect purchase.
 */
export default async function BuyNowCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listingId = parseListingId(id);
  if (!listingId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/marketplace/${listingId}/checkout`);

  await runOfferSweeps();

  const { data: listing } = await supabase.from("listings").select("*").eq("id", listingId).maybeSingle<Listing>();
  if (!listing) notFound();
  if (listing.seller_id === user.id) redirect(`/marketplace/${listingId}`);
  if (listing.status !== "active") redirect(`/marketplace/${listingId}`);

  let priceEur: number | null = listing.price_eur;
  if (listing.sale_type === "auction_with_buy_now") {
    const { data: auction } = await supabase
      .from("auctions")
      .select("*")
      .eq("listing_id", listingId)
      .maybeSingle<Auction>();
    if (!auction || auction.buy_now_price_cents === null || auction.status === "ended" || auction.status === "cancelled") {
      redirect(`/marketplace/${listingId}`);
    }
    priceEur = centsToEur(auction!.buy_now_price_cents!);
  }
  if (priceEur === null) redirect(`/marketplace/${listingId}`);

  const [sellerResult, addressesResult] = await Promise.all([
    supabase.from("profiles").select("first_name, last_name").eq("id", listing.seller_id).maybeSingle<{ first_name: string; last_name: string }>(),
    supabase.from("addresses").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).returns<Address[]>(),
  ]);

  const sellerName = sellerResult.data ? `${sellerResult.data.first_name} ${sellerResult.data.last_name}` : "Pinpals member";
  const addresses = addressesResult.data ?? [];

  const submit = submitBuyNowCheckout.bind(null, listingId);

  return (
    <div className="max-w-xl mx-auto px-6 py-10 md:py-14">
      <Link href={`/marketplace/${listingId}`} className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← Back to listing
      </Link>
      <h1 className="font-display font-bold text-2xl mb-6">Checkout</h1>

      <CheckoutForm
        item={{ title: listing.title, imageUrl: listing.image_url, sellerName, priceEur }}
        deliveryOptions={listing.delivery_options}
        collectionNotes={listing.collection_notes}
        addresses={addresses}
        onSubmit={submit}
      />
    </div>
  );
}
