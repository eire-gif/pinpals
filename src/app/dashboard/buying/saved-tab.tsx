import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, SELLER_LISTING_STATUS_LABELS, SELLER_LISTING_STATUS_STYLES } from "@/lib/format";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import FavouriteButton from "@/app/marketplace/favourite-button";
import type { Listing } from "@/lib/types";

const PAGE_SIZE = 12;

type FavouriteRow = { listing_id: number; listings: Listing | null };

// The task spec's "saved items". listing_favourites (0037) was purely
// additive when it shipped — favourite-button.tsx (the toggle) and the
// browse grid are its only readers so far — this is the first page that
// actually lists them back to their owner. Reuses FavouriteButton as-is for
// the "remove" affordance rather than a new one-off unsave control, so
// there's exactly one place that ever writes to this table from the client.
export default async function SavedTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const { data, count } = await supabase
    .from("listing_favourites")
    .select("listing_id, listings(*)", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo)
    .returns<FavouriteRow[]>();

  const rows = (data ?? []).filter((r): r is FavouriteRow & { listings: Listing } => r.listings !== null);

  if (rows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="No saved items yet"
        description="Tap the heart on any listing to save it here for later."
        actionHref="/marketplace"
        actionLabel="Browse the marketplace"
      />
    );
  }

  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(({ listings: listing }) => (
          <div key={listing.id} className="relative bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
            <FavouriteButton listingId={listing.id} initialFavourited signedIn />
            <Link href={`/marketplace/${listing.id}`} className="block">
              <div className="relative w-full aspect-square bg-surface-tint">
                {listing.image_url ? (
                  <Image src={listing.image_url} alt="" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-500">
                    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-bold text-ink-900 truncate">{listing.title}</h3>
                  {listing.status !== "active" && (
                    <span
                      className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${SELLER_LISTING_STATUS_STYLES[listing.status]}`}
                    >
                      {SELLER_LISTING_STATUS_LABELS[listing.status]}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-500">
                  {listing.price_eur !== null ? formatPrice(listing.price_eur) : "Auction"}
                </p>
              </div>
            </Link>
          </div>
        ))}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/buying?tab=saved&page=${p}`}
      />
    </div>
  );
}
