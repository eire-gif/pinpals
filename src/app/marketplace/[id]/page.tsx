import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Listing, ListingImage, Auction, Offer, Order, Profile, StripeConnectedAccount } from "@/lib/types";
import { formatPrice, formatPriceCents, SELLER_LISTING_STATUS_LABELS } from "@/lib/format";
import { isAuctionSaleType, summarizeRatings } from "@/lib/marketplace";
import { sellerOnboardingStatus, isSellerPaymentReady } from "@/lib/stripe/connect";
import { getSiteUrl } from "@/lib/site-url";
import { fetchMarketplaceListings, EMPTY_MARKETPLACE_FILTERS } from "@/lib/marketplace-discovery";
import { computeListingPurchaseState } from "./action-state";
import { runOfferSweeps } from "./actions";
import PublishListingButton from "./publish-listing-button";
import OffersList from "./offers-list";
import ListingGallery from "./listing-gallery";
import PurchasePanel from "./purchase-panel";
import MobileActionBar from "./mobile-action-bar";
import SellerCard from "./seller-card";
import RelatedListings from "./related-listings";
import SafetyGuidance from "./safety-guidance";

type SellerProfile = Pick<Profile, "id" | "first_name" | "last_name" | "home_club" | "county" | "avatar_color" | "created_at">;
type SellerAccountFields = Pick<
  StripeConnectedAccount,
  "charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements_currently_due" | "requirements_past_due" | "disabled_reason"
>;

function parseListingId(id: string): number | null {
  const listingId = Number(id);
  return listingId && !Number.isNaN(listingId) ? listingId : null;
}

/**
 * "Add metadata for sharing, but never expose private seller information"
 * (this phase's spec) — everything below is drawn only from the listing
 * row itself; the seller never enters this function at all, which is what
 * actually guarantees the second half of that sentence (a stricter
 * guarantee than filtering fields after the fact would be).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const listingId = parseListingId(id);
  if (!listingId) notFound();

  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, description, image_url, status, price_eur, category")
    .eq("id", listingId)
    .maybeSingle<Pick<Listing, "id" | "title" | "description" | "image_url" | "status" | "price_eur" | "category">>();

  if (!listing) notFound();

  const description = listing.description?.trim()
    ? listing.description.trim().slice(0, 200)
    : `${listing.category} for sale on Pinpals${listing.price_eur !== null ? ` — ${formatPrice(listing.price_eur)}` : ""}.`;

  const url = `${getSiteUrl()}/marketplace/${listing.id}`;

  return {
    title: `${listing.title} | Pinpals Marketplace`,
    description,
    alternates: { canonical: url },
    // A listing that isn't currently live to the public (draft, reserved,
    // sold, expired, removed, pending review) shouldn't show up in search
    // results — the only thing metadata ever varies on here is the
    // listing's own public status, never anything about who's selling it.
    robots:
      listing.status === "active" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: listing.title,
      description,
      url,
      type: "website",
      images: listing.image_url ? [{ url: listing.image_url }] : undefined,
    },
    twitter: {
      card: listing.image_url ? "summary_large_image" : "summary",
      title: listing.title,
      description,
      images: listing.image_url ? [listing.image_url] : undefined,
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listingId = parseListingId(id);
  if (!listingId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: listing } = await supabase.from("listings").select("*").eq("id", listingId).maybeSingle<Listing>();
  if (!listing) notFound();

  // Opportunistic sweep (see runOfferSweeps()' own comment,
  // src/app/marketplace/[id]/actions.ts) — keeps what this page is about to
  // render from lagging behind an offer/reservation that's actually already
  // past its deadline. Never load-bearing for correctness, only for
  // freshness of what's displayed.
  await runOfferSweeps();

  const isSeller = user?.id === listing.seller_id;
  const isDraft = listing.status === "draft";
  const editHref = `/marketplace/${listing.id}/edit`;

  let paymentReady = false;
  if (isSeller && isDraft) {
    const { data: account } = await supabase
      .from("stripe_connected_accounts")
      .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
      .eq("user_id", user!.id)
      .maybeSingle<SellerAccountFields>();
    paymentReady = isSellerPaymentReady(sellerOnboardingStatus(account));
  }

  // Batched: images, the seller's public profile fields, the seller's
  // payment-verification flags (a buyer has no RLS read path to another
  // member's stripe_connected_accounts row — same narrow, service-role
  // cross-user lookup src/app/dashboard/orders/[id]/actions.ts's
  // createOrderPaymentIntent() already uses, collapsed to one `verified`
  // boolean before it ever reaches a component), and the seller's public
  // review ratings — four independent reads, never one per related item.
  const [imagesResult, sellerProfileResult, sellerAccountResult, reviewRowsResult] = await Promise.all([
    supabase.from("listing_images").select("*").eq("listing_id", listingId).order("position", { ascending: true }).returns<ListingImage[]>(),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, home_club, county, avatar_color, created_at")
      .eq("id", listing.seller_id)
      .maybeSingle<SellerProfile>(),
    createAdminClient()
      .from("stripe_connected_accounts")
      .select("charges_enabled, payouts_enabled, details_submitted, requirements_currently_due, requirements_past_due, disabled_reason")
      .eq("user_id", listing.seller_id)
      .maybeSingle<SellerAccountFields>(),
    supabase.from("reviews").select("rating").eq("reviewee_id", listing.seller_id).returns<{ rating: number }[]>(),
  ]);

  const images = imagesResult.data;
  const galleryUrls = images && images.length > 0 ? images.map((img) => img.image_url) : listing.image_url ? [listing.image_url] : [];

  let auction: Auction | null = null;
  let currentBidCents: number | null = null;
  if (isAuctionSaleType(listing.sale_type)) {
    const { data } = await supabase.from("auctions").select("*").eq("listing_id", listingId).maybeSingle<Auction>();
    auction = data ?? null;
    if (auction) {
      // Public read surface, not `bids` directly — see the comment on
      // fetchMarketplaceListings() in src/lib/marketplace-discovery.ts for
      // why: `bids` itself has no SELECT policy broad enough for a
      // third-party viewer (only the bidder's own bids, or the auction's
      // own seller).
      const { data: topBid } = await supabase
        .from("auction_bid_history")
        .select("amount_cents")
        .eq("auction_id", auction.id)
        .order("amount_cents", { ascending: false })
        .limit(1)
        .returns<{ amount_cents: number }[]>();
      currentBidCents = topBid?.[0]?.amount_cents ?? null;
    }
  }

  let sellerOffers: Offer[] = [];
  let myOffers: Offer[] = [];
  let myOrder: Pick<Order, "id" | "reservation_expires_at" | "status"> | null = null;

  if (isSeller) {
    // Most-recently-active first — offer history + seller action controls
    // (OffersList) reads top-to-bottom as "what needs my attention now",
    // not a price ranking.
    const { data } = await supabase
      .from("offers")
      .select("*")
      .eq("listing_id", listingId)
      .order("updated_at", { ascending: false })
      .returns<Offer[]>();
    sellerOffers = data ?? [];
  } else if (user) {
    // Every offer chain this buyer has ever made on this listing (not just
    // the latest) — MyOfferStatus needs the full set to show both
    // whichever chain is currently actionable/accepted AND the "N earlier
    // offers" history underneath it. The one-active-chain unique index
    // (0048) guarantees at most one row here is ever pending/countered.
    const { data } = await supabase
      .from("offers")
      .select("*")
      .eq("listing_id", listingId)
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .returns<Offer[]>();
    myOffers = data ?? [];

    const acceptedOffer = myOffers.find((o) => o.status === "accepted");
    if (acceptedOffer) {
      // The order offer_action() (0048) snapshotted at accept time — RLS-
      // scoped to this buyer's own orders (0019), so this can only ever
      // resolve to the one order that actually belongs to them.
      const { data: orderRow } = await supabase
        .from("orders")
        .select("id, reservation_expires_at, status")
        .eq("offer_id", acceptedOffer.id)
        .maybeSingle<Pick<Order, "id" | "reservation_expires_at" | "status">>();
      myOrder = orderRow ?? null;
    }
  }

  const sellerProfile = sellerProfileResult.data;
  const sellerName = sellerProfile ? `${sellerProfile.first_name} ${sellerProfile.last_name}` : "Pinpals member";
  const sellerVerified = isSellerPaymentReady(sellerOnboardingStatus(sellerAccountResult.data ?? null));
  const ratingSummary = summarizeRatings((reviewRowsResult.data ?? []).map((r) => r.rating));

  // Related listings: the exact same batched fetch layer /marketplace
  // itself uses (see fetchMarketplaceListings' own header comment), scoped
  // to this listing's category — never a bespoke per-card query.
  const related = await fetchMarketplaceListings(
    supabase,
    { ...EMPTY_MARKETPLACE_FILTERS, category: listing.category },
    null,
    user?.id ?? null,
    5
  );
  const relatedListings = related.listings.filter((l) => l.id !== listing.id).slice(0, 4);

  const purchaseState = computeListingPurchaseState({
    listing,
    auction,
    currentBidCents,
    isSeller,
    isSignedIn: !!user,
  });

  return (
    <div className="max-w-6xl mx-auto px-6 py-14 pb-28 lg:pb-14">
      <Link href="/marketplace" className="text-sm text-green-700 font-bold">
        &larr; Back to marketplace
      </Link>

      <div className="grid lg:grid-cols-3 gap-10 mt-6">
        <div className="lg:col-span-2">
          <ListingGallery images={galleryUrls} title={listing.title} />

          <div className="mt-6">
            <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
              {listing.category}
              {listing.subcategory && <span className="text-ink-500 normal-case font-semibold"> · {listing.subcategory}</span>}
            </span>
            <h1 className="font-display font-bold text-3xl mt-1">{listing.title}</h1>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{listing.condition}</span>
              {listing.county && (
                <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{listing.county}</span>
              )}
              {listing.status !== "active" && (
                <span className="bg-navy-900 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  {listing.status === "draft" ? "Draft — not visible to buyers" : SELLER_LISTING_STATUS_LABELS[listing.status]}
                </span>
              )}
            </div>

            {auction && (
              <div className="mt-3 text-xs text-ink-500 grid gap-1">
                <p>
                  {new Date(auction.starts_at) > new Date() ? "Starts" : "Started"}{" "}
                  {new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(auction.starts_at))}
                  {" · "}
                  Ends {new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(auction.ends_at))}
                </p>
                {isSeller && auction.reserve_price_cents !== null && (
                  <p>
                    Reserve {formatPriceCents(auction.reserve_price_cents)}{" "}
                    <span className="italic">(hidden from buyers)</span>
                  </p>
                )}
              </div>
            )}

            {listing.description && <p className="text-ink-700 mt-4">{listing.description}</p>}

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

          {/* Full purchase panel + seller card, inline — the sticky column
           * to the right is `hidden` below the lg breakpoint (see below),
           * so this is where a phone/tablet visitor actually buys/bids/
           * offers/messages, not a stripped-down substitute for it. The
           * fixed MobileActionBar further down just scrolls here. */}
          <div className="lg:hidden mt-8 grid gap-5" id="purchase-panel-mobile">
            <PurchasePanel
              listingId={listing.id}
              editHref={editHref}
              state={purchaseState}
              priceEur={listing.price_eur}
              myOffers={myOffers}
              myOrder={myOrder}
            />
            <SellerCard
              sellerId={listing.seller_id}
              name={sellerName}
              homeClub={sellerProfile?.home_club ?? null}
              county={sellerProfile?.county ?? null}
              avatarColor={sellerProfile?.avatar_color ?? null}
              joinedAtIso={sellerProfile?.created_at ?? listing.created_at}
              verified={sellerVerified}
              rating={ratingSummary}
              viewerIsSignedIn={!!user}
              viewerIsSeller={isSeller}
            />
          </div>

          <div className="mt-8">
            <SafetyGuidanceOrManage
              isSeller={isSeller}
              isDraft={isDraft}
              listingId={listing.id}
              editHref={editHref}
              paymentReady={paymentReady}
              sellerOffers={sellerOffers}
            />
          </div>

          <RelatedListings listings={relatedListings} signedIn={!!user} />
        </div>

        {/* Desktop: sticky sidebar. Same two components as the mobile block
         * above, not a second implementation — see PurchasePanel/SellerCard's
         * own header comments. */}
        <div className="hidden lg:block">
          <div className="sticky top-24 grid gap-5">
            <PurchasePanel
              listingId={listing.id}
              editHref={editHref}
              state={purchaseState}
              priceEur={listing.price_eur}
              myOffers={myOffers}
              myOrder={myOrder}
            />
            <SellerCard
              sellerId={listing.seller_id}
              name={sellerName}
              homeClub={sellerProfile?.home_club ?? null}
              county={sellerProfile?.county ?? null}
              avatarColor={sellerProfile?.avatar_color ?? null}
              joinedAtIso={sellerProfile?.created_at ?? listing.created_at}
              verified={sellerVerified}
              rating={ratingSummary}
              viewerIsSignedIn={!!user}
              viewerIsSeller={isSeller}
            />
          </div>
        </div>
      </div>

      <MobileActionBar listingId={listing.id} state={purchaseState} />
    </div>
  );
}

/**
 * Seller-facing draft/offers management (unchanged behaviour from the
 * listing-creation phase) for a seller viewing their own listing, or
 * SafetyGuidance (this phase) for everyone else — kept as one small local
 * component only so page.tsx's own JSX isn't a third level of nested
 * ternary at the call site.
 */
function SafetyGuidanceOrManage({
  isSeller,
  isDraft,
  listingId,
  editHref,
  paymentReady,
  sellerOffers,
}: {
  isSeller: boolean;
  isDraft: boolean;
  listingId: number;
  editHref: string;
  paymentReady: boolean;
  sellerOffers: Offer[];
}) {
  if (!isSeller) {
    return (
      <div className="max-w-md">
        <SafetyGuidance listingId={listingId} />
      </div>
    );
  }

  return (
    <div>
      {isDraft && (
        <div className="bg-cream-100 rounded-xl p-5 mb-8 max-w-md">
          <h2 className="font-display font-bold text-lg mb-2">This listing isn&apos;t live yet.</h2>
          <p className="text-sm text-ink-500 mb-4">
            Everything above is exactly what buyers will see — check the photos, price and details before
            publishing. You can still{" "}
            <Link href={editHref} className="font-bold text-green-700">
              edit it
            </Link>{" "}
            first if anything needs changing.
          </p>
          {paymentReady ? (
            <PublishListingButton listingId={listingId} />
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
      <OffersList offers={sellerOffers} listingId={listingId} />
    </div>
  );
}
