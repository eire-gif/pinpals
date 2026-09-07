import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Listing, ListingImage, Auction } from "@/lib/types";
import { isAuctionSaleType } from "@/lib/marketplace";
import EditListingForm from "./edit-listing-form";

export default async function EditListingPage({
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

  if (!user) redirect("/login");

  const { data: listing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .single<Listing>();

  if (!listing) notFound();
  // listing_is_visible() (0045) would let a non-owner read this row too
  // (e.g. staff, or anyone once it's active) — editing is narrower than
  // viewing, so this is its own explicit check rather than inferred from
  // the page having loaded at all.
  if (listing.seller_id !== user.id) notFound();

  const { data: images } = await supabase
    .from("listing_images")
    .select("*")
    .eq("listing_id", listingId)
    .order("position", { ascending: true })
    .returns<ListingImage[]>();

  let auction: Auction | null = null;
  if (isAuctionSaleType(listing.sale_type)) {
    const { data } = await supabase
      .from("auctions")
      .select("*")
      .eq("listing_id", listingId)
      .maybeSingle<Auction>();
    auction = data ?? null;
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <Link href={`/marketplace/${listingId}`} className="text-sm text-green-700 font-bold">
        &larr; Back to listing
      </Link>

      <div className="mb-8 mt-4">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">Edit listing</h1>
        <p className="text-ink-500 mt-2">Changes save immediately — buyers only see them once this listing is live.</p>
      </div>

      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <EditListingForm listing={listing} images={images ?? []} auction={auction} />
      </div>
    </div>
  );
}
