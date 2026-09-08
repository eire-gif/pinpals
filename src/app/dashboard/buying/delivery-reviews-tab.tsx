import { createClient } from "@/lib/supabase/server";
import { formatPrice, DELIVERY_OPTION_LABELS } from "@/lib/format";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import LeaveReviewForm from "./leave-review-form";
import type { Order, Profile, Review } from "@/lib/types";

const PAGE_SIZE = 10;

type ReviewRow = Pick<Review, "id" | "order_id" | "rating" | "body">;

// The task spec's "delivery/collection details and review actions" —
// completed orders only (an in-flight order's delivery choice is already
// shown on its own detail page while checkout is happening; this tab is
// specifically the post-purchase "where's it going / how did it go" view).
// delivery_method/delivery_fee_cents/delivery_detail are the buyer's own
// snapshotted checkout choice (create_purchase_order()/finalize_offer_checkout(),
// 0050) — read directly, never re-derived.
export default async function DeliveryReviewsTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const { data: orders, count } = await supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("buyer_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .range(rangeFrom, rangeTo)
    .returns<Order[]>();

  const rows = orders ?? [];
  const orderIds = rows.map((o) => o.id);
  const sellerIds = [...new Set(rows.map((o) => o.seller_id))];

  const [{ data: reviews }, { data: sellerProfiles }] = await Promise.all([
    orderIds.length
      ? supabase.from("reviews").select("id, order_id, rating, body").eq("reviewer_id", userId).in("order_id", orderIds).returns<ReviewRow[]>()
      : Promise.resolve({ data: [] as ReviewRow[] }),
    sellerIds.length
      ? supabase.from("profiles").select("*").in("id", sellerIds).returns<Profile[]>()
      : Promise.resolve({ data: [] as Profile[] }),
  ]);

  const reviewByOrder = new Map((reviews ?? []).map((r) => [r.order_id, r]));
  const sellerById = new Map((sellerProfiles ?? []).map((p) => [p.id, p]));

  if (rows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="Nothing delivered yet"
        description="Once a purchase completes, its delivery or collection details — and your review action — show up here."
      />
    );
  }

  return (
    <div>
      <div className="grid gap-4">
        {rows.map((order) => {
          const seller = sellerById.get(order.seller_id);
          const sellerName = seller ? `${seller.first_name} ${seller.last_name}`.trim() : "the seller";
          const review = reviewByOrder.get(order.id);

          return (
            <div key={order.id} className="bg-surface border border-line rounded-2xl shadow-sm p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <div className="min-w-0">
                  <div className="font-bold text-ink-900 truncate">{order.listing_title}</div>
                  <div className="text-xs text-ink-500">
                    {formatPrice(order.total_eur)} &middot; from {sellerName}
                  </div>
                </div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-cream-100 text-ink-900 shrink-0">
                  {DELIVERY_OPTION_LABELS[order.delivery_method]}
                </span>
              </div>

              {order.delivery_detail && (
                <p className="text-sm text-ink-700 bg-cream-100 rounded-lg px-3.5 py-2.5 mb-3 whitespace-pre-wrap">
                  {order.delivery_detail}
                </p>
              )}

              {review ? (
                <div className="text-sm text-ink-700">
                  <span className="text-gold-500 font-bold">{"★".repeat(review.rating)}</span>
                  <span className="text-ink-300 font-bold">{"★".repeat(5 - review.rating)}</span>
                  {review.body && <p className="text-ink-500 mt-1">{review.body}</p>}
                </div>
              ) : (
                <LeaveReviewForm orderId={order.id} revieweeId={order.seller_id} />
              )}
            </div>
          );
        })}
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/buying?tab=delivery&page=${p}`}
      />
    </div>
  );
}
