import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Listing, Offer } from "@/lib/types";
import { formatPrice } from "@/lib/format";
import PriceSummary from "@/components/price-summary";
import OfferForm from "./offer-form";
import OffersList from "./offers-list";

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
        <div className="relative h-80 rounded-2xl overflow-hidden bg-surface-tint border border-line">
          {listing.image_url ? (
            <Image src={listing.image_url} alt={listing.title} fill className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-500">
              <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8M12 8v8" />
              </svg>
            </div>
          )}
        </div>

        <div>
          <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
            {listing.category}
          </span>
          <h1 className="font-display font-bold text-3xl mt-1">{listing.title}</h1>
          <p className="font-display font-bold text-2xl text-gold-600 mt-2">
            {formatPrice(listing.price_eur)}
          </p>

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
                {listing.status === "reserved" ? "Sale agreed" : listing.status}
              </span>
            )}
          </div>

          {listing.description && (
            <p className="text-ink-700 mt-4">{listing.description}</p>
          )}
        </div>
      </div>

      <div className="mt-10 pt-8 border-t border-line">
        {isSeller ? (
          <>
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
        ) : (
          <div className="max-w-sm">
            <h2 className="font-display font-bold text-xl mb-4">Make an offer</h2>
            <OfferForm listingId={listing.id} askingPrice={listing.price_eur} />
          </div>
        )}
      </div>
    </div>
  );
}
