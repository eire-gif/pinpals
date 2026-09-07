import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { offerHasExpired } from "@/lib/marketplace";
import { runOfferSweeps } from "@/app/marketplace/[id]/actions";
import CheckoutForm from "@/app/checkout/checkout-form";
import { submitOfferCheckout } from "./actions";
import type { Address, Listing, Order } from "@/lib/types";

/**
 * The accepted-offer counterpart to src/app/marketplace/[id]/checkout/ — the
 * order already exists (offer_action(), 0048, created it the instant the
 * offer was accepted) so this page's only job is collecting the delivery
 * choice finalize_offer_checkout() (0050) needs before the buyer moves on to
 * the existing Pay page (../page.tsx). Reached from
 * src/app/marketplace/[id]/my-offer-status.tsx's "Complete checkout" link
 * (only shown while `checkout_completed_at` is still null) or, defensively,
 * from ../page.tsx itself if a buyer navigates straight there.
 */
export default async function OfferCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!orderId || Number.isNaN(orderId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/dashboard/orders/${orderId}/checkout`);

  // Same opportunistic sweep the order detail page itself runs — makes sure
  // a lapsed reservation shows as 'cancelled' rather than still inviting a
  // buyer to finalize checkout on a listing that's already been handed back.
  await runOfferSweeps();

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle<Order>();
  if (!order || order.buyer_id !== user.id) notFound();

  // Nothing left to finalize — send the buyer to wherever this order
  // actually is right now (paying, already paid, or no longer checkout-able).
  if (order.status !== "pending" || order.payment_status === "paid" || order.checkout_completed_at) {
    redirect(`/dashboard/orders/${orderId}`);
  }
  if (order.reservation_expires_at && offerHasExpired(order.reservation_expires_at)) {
    redirect(`/dashboard/orders/${orderId}`);
  }

  const [listingResult, addressesResult] = await Promise.all([
    order.listing_id
      ? supabase.from("listings").select("*").eq("id", order.listing_id).maybeSingle<Listing>()
      : Promise.resolve({ data: null }),
    supabase.from("addresses").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).returns<Address[]>(),
  ]);

  const listing = listingResult.data;
  const deliveryOptions = listing?.delivery_options?.length ? listing.delivery_options : (["collection"] as const);
  const addresses = addressesResult.data ?? [];

  let sellerName = "Pinpals member";
  const { data: seller } = await supabase
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", order.seller_id)
    .maybeSingle<{ first_name: string; last_name: string }>();
  if (seller) sellerName = `${seller.first_name} ${seller.last_name}`;

  const submit = submitOfferCheckout.bind(null, orderId);

  return (
    <div className="max-w-xl mx-auto px-6 py-10 md:py-14">
      <Link href={`/dashboard/orders/${orderId}`} className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← Back to order
      </Link>
      <h1 className="font-display font-bold text-2xl mb-1">Checkout</h1>
      <p className="text-sm text-ink-500 mb-6">Your offer was accepted — choose delivery to finish reserving it.</p>

      <CheckoutForm
        item={{ title: order.listing_title, imageUrl: order.listing_image_url, sellerName, priceEur: order.amount_eur }}
        deliveryOptions={[...deliveryOptions]}
        collectionNotes={listing?.collection_notes ?? null}
        addresses={addresses}
        submitLabel="Confirm delivery"
        onSubmit={submit}
      />
    </div>
  );
}
