import { ListingGridSkeleton } from "@/components/marketplace/listing-skeleton";

export default function MarketplaceLoading() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-14">
      <ListingGridSkeleton />
    </div>
  );
}
