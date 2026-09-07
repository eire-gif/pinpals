import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Listing, ListingImage, Auction, Offer, StripeConnectedAccount } from "@/lib/types";
import { formatPrice, formatPriceCents } from "@/lib/format";
import { isAuctionSaleType } from "@/lib/marketplace";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import PriceSummary from "@/components/price-summary";
import OfferForm from "./offer-form";
import OffersList from "./offers-list";
import PublishListingButton from "./publish-listing-button";
import ListingGallery from "./listing-gallery";

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listingId = Number(id);
  if (!listingId || Number.isNaN(listingId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .single<Listing>();

  if (!listing) notFound();

  const isSeller = user?.id === listing.seller_id;
  const isDraft = listing.status === "draft";

  let paymentReady = false;
  if (isSeller && isDraft) {
    const { data: account } = await supabase
      .from("stripe_connected_accounts")
      .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
      .eq("user_id", user!.id)
      .maybeSingle<
        Pick<
          StripeConnectedAccount,
          | "charges_enabled"
          | "payouts_enabled"
          | "details_submitted"
          | "requirements_currently_due"
          | "requirements_past_due"
          | "disabled_reason"
        >
      >();
    paymentReady = isSellerPaymentReady(sellerOnboardingStatus(account));
  }

  const { data: images } = await supabase
    .from("listing_images")
    .select("*")
    .eq("listing_id", listingId)
    .order("position", { ascending: true })
    .returns<ListingImage[]>();

  const galleryUrls = images && images.length > 0 ? images.map((img) => img.image_url) : listing.image_url ? [listing.image_url] : [];

  let auction: Auction | null = null;
  if (isAuctionSaleType(listing.sale_type)) {
    const { data } = await supabase
      .from("auctions")
      .select("*")
      .eq("listing_id", listingId)
      .maybeSingle<Auction>();
    auction = data ?? null;
  }

  let sellerOffers: Offer[] = [];
  let myOffer: Offer | null = null;

  if (isSeller) {
    const { data } = await supabase
      .from("offers")
      .select("*")
      .eq("listing_id", listingId)
      .order("amount_eur", { ascending: false })
      .returns<Offer[]>();
    sellerOffers = data ?? [];
  } else if (user) {
    const { data } = await supabase
      .from("offers")
      .select("*")
      .eq("listing_id", listingId)
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Offer[]>();
    myOffer = data?.[0] ?? null;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-14">
      <Link href="/marketplace" className="text-sm text-green-700 font-bold">
        &larr; Back to marketplace
      </Link>

      <div className="grid md:grid-cols-2 gap-8 mt-6">
        <ListingGallery images={galleryUrls} title={listing.title} />

        <div>
          <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
            {listing.category}
            {listing.subcategory && <span className="text-ink-500 normal-case font-semibold"> · {listing.subcategory}</span>}
          </span>
          <h1 className="font-display font-bold text-3xl mt-1">{listing.title}</h1>

          {auction ? (
            <div className="mt-2 grid gap-1.5">
              <p className="font-display font-bold text-2xl text-gold-600">
                {formatPriceCents(auction.starting_price_cents)}
                <span className="text-sm font-semibold text-ink-500"> starting bid</span>
              </p>
              <p className="text-xs text-ink-500">
                Min. bid increment {formatPriceCents(auction.min_increment_cents)}
                {auction.buy_now_price_cents !== null && (
                  <> · Buy It Now {formatPriceCents(auction.buy_now_price_cents)}</>
                )}
              </p>
              {isSeller && auction.reserve_price_cents !== null && (
                <p className="text-xs text-ink-500">
                  Reserve {formatPriceCents(auction.reserve_price_cents)} <span className="italic">(hidden from buyers)</span>
                </p>
              )}
              <p className="text-xs text-ink-500">
                {new Date(auction.starts_at) > new Date() ? "Starts" : "Started"}{" "}
                {new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(auction.starts_at))}
                {" · "}
                Ends {new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(auction.ends_at))}
              </p>
            </div>
          ) : (
            <p className="font-display font-bold text-2xl text-gold-600 mt-2">
              {listing.price_eur !== null ? formatPrice(listing.price_eur) : "Auction listing"}
            </p>
          )}

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
              {listing.condition}
            </span>
            {listing.county && (
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {listing.county}
              </span>
            )}
            {listing.status !== "active" && (
              <span className="bg-navy-900 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {listing.status === "reserved"
                  ? "Sale agreed"
                  : listing.status === "draft"
                    ? "Draft — not visible to buyers"
                    : listing.status}
              </span>
            )}
          </div>

          {listing.description && (
            <p className="text-ink-700 mt-4">{listing.description}</p>
          )}

          {(listing.delivery_options.length > 0 || listing.collection_notes) && (
            <div className="mt-4 text-sm text-ink-500">
              {listing.delivery_options.length > 0 && (
                <p>
                  Delivery:{" "}
                  {listing.delivery_options
                    .map((opt) => (opt === "post" ? "Postage" : "Local collection"))
                    .join(", ")}
                </p>
              )}
              {listing.collection_notes && <p className="mt-1">{listing.collection_notes}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 pt-8 border-t border-line">
        {isSeller ? (
          <>
            <Link
              href={`/marketplace/${listing.id}/edit`}
              className="inline-block mb-6 px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition"
            >
              Edit listing
            </Link>
            {isDraft && (
              <div className="bg-cream-100 rounded-xl p-5 mb-8 max-w-md">
                <h2 className="font-display font-bold text-lg mb-2">This listing isn&apos;t live yet.</h2>
                <p className="text-sm text-ink-500 mb-4">
                  Everything above is exactly what buyers will see — check the photos, price and details before
                  publishing. You can still{" "}
                  <Link href={`/marketplace/${listing.id}/edit`} className="font-bold text-green-700">
                    edit it
                  </Link>{" "}
                  first if anything needs changing.
                </p>
                {paymentReady ? (
                  <PublishListingButton listingId={listing.id} />
                ) : (
                  <p className="text-sm text-ink-500">
                    Finish{" "}
                    <Link href="/dashboard/payouts" className="font-bold text-green-700">
                      seller setup
                    </Link>{" "}
                    with Stripe to publish it — buyers won&apos;t see this listing until then.
                  </p>
                )}
              </div>
            )}
            <h2 className="font-display font-bold text-xl mb-4">Offers on your listing</h2>
            <OffersList offers={sellerOffers} listingId={listing.id} />
          </>
        ) : !user ? (
          <div className="bg-surface rounded-2xl shadow-lg p-8 text-center max-w-md">
            <h2 className="font-display font-bold text-xl mb-2">Join to make an offer.</h2>
            <p className="text-ink-500 mb-6">
              Create a free profile to bid on gear from other Pinpals members.
            </p>
            <Link href="/signup" className="inline-block px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
              Join Pinpals
            </Link>
          </div>
        ) : listing.status !== "active" ? (
          <p className="text-sm text-ink-500">This listing is no longer available.</p>
        ) : myOffer ? (
          <div className="max-w-sm">
            <h2 className="font-display font-bold text-xl mb-4">Your offer</h2>
            <div className="bg-surface border border-line rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold">{formatPrice(myOffer.amount_eur)}</span>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    myOffer.status === "accepted"
                      ? "bg-green-100 text-green-800"
                      : myOffer.status === "declined"
                        ? "bg-red-100 text-red-600"
                        : "bg-cream-100 text-ink-900"
                  }`}
                >
                  {myOffer.status === "pending" ? "Waiting on seller" : myOffer.status === "accepted" ? "Accepted" : "Declined"}
                </span>
              </div>
              {myOffer.status !== "declined" && <PriceSummary amountEur={myOffer.amount_eur} />}
            </div>
          </div>
        ) : isAuctionSaleType(listing.sale_type) ? (
          // Offers (the `offers` table/OfferForm) are a fixed-price
          // negotiation mechanism — they don't apply to an auction listing,
          // which is sold via `bids` instead. A full bidding UI here is
          // later work (this phase only covers listing create/edit + My
          // Listings); this is the honest placeholder in the meantime,
          // rather than showing a "make an offer" form that would try to
          // insert an `offers` row against an auction-type listing.
          <p className="text-sm text-ink-500">
            Bidding on auctions is coming soon — check back shortly.
          </p>
        ) : (
          <div className="max-w-sm">
            <h2 className="font-display font-bold text-xl mb-4">Make an offer</h2>
            {/* Non-null in practice: listings_price_required_for_non_auction_check
             * (0046) guarantees price_eur is set for every non-auction sale_type,
             * and the branch above already excluded auction listings — the ?? 0
             * is only here to satisfy the type checker, never expected to fire. */}
            <OfferForm listingId={listing.id} askingPrice={listing.price_eur ?? 0} />
          </div>
        )}
      </div>
    </div>
  );
}
