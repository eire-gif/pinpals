import Link from "next/link";
import { formatPrice } from "@/lib/format";
import { listingUnavailableReason } from "@/lib/marketplace";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES } from "@/lib/admin/format";
import type { OrderStatus } from "@/lib/types";

/**
 * "Show listing context, current status and permitted actions in the
 * thread" (this phase's spec) — a compact card above the message list, not
 * a second purchase panel. The listing page itself (PurchasePanel) is still
 * the one place Buy Now/Place Bid/Make an Offer actually happen; this only
 * ever links there or to the order, it never re-implements those actions.
 * No card at all for a non-marketplace conversation (listing is null).
 */
export default function ListingContextCard({
  listing,
  order,
}: {
  listing: { id: number; title: string; status: string; price_eur: number | null; image_url: string | null } | null;
  order: { id: number; status: string } | null;
}) {
  if (!listing) return null;

  const unavailableReason = listingUnavailableReason(listing.status);

  return (
    <div className="bg-surface border border-line rounded-2xl shadow-sm p-4 mb-4 flex items-center gap-3.5">
      {listing.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={listing.image_url} alt="" className="w-14 h-14 rounded-lg object-cover border border-line shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <Link href={`/marketplace/${listing.id}`} className="font-display font-bold text-sm hover:text-green-700 transition truncate block">
          {listing.title}
        </Link>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {listing.price_eur !== null && <span className="text-xs text-ink-500">{formatPrice(listing.price_eur)}</span>}
          {order ? (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ORDER_STATUS_STYLES[order.status as OrderStatus] ?? "bg-cream-100 text-ink-700"}`}>
              {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
            </span>
          ) : (
            unavailableReason && <span className="text-[11px] text-ink-500">{unavailableReason}</span>
          )}
        </div>
      </div>
      <Link
        href={order ? `/dashboard/orders/${order.id}` : `/marketplace/${listing.id}`}
        className="shrink-0 text-xs font-bold text-green-700 hover:text-green-800 transition"
      >
        {order ? "View order" : "View listing"}
      </Link>
    </div>
  );
}
