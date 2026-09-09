import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES } from "@/lib/admin/format";
import StatusBadge from "@/components/admin/status-badge";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
// Reused as-is from the buyer workspace — submitReview()/LeaveReviewForm are
// generic over (orderId, revieweeId), not buyer-specific despite living
// under dashboard/buying: validate_review() (0041) has always allowed
// either direction (buyer reviews seller OR seller reviews buyer), but no
// seller-facing UI ever called it until now. Reusing the exact same
// write path/component rather than a parallel one.
import LeaveReviewForm from "../buying/leave-review-form";
import type { Order, Review } from "@/lib/types";

const PAGE_SIZE = 10;

// The task spec's "sales history" — every order this seller has ever had,
// any status, most recent first. Deliberately the full archive rather than
// filtered to "active" the way ../orders-action-tab.tsx is: a seller
// checking history wants to see a cancelled or refunded sale too, not just
// what's currently paid.
export default async function SalesHistoryTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const { data: orders, count } = await supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("seller_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo)
    .returns<Order[]>();

  const rows = orders ?? [];
  const completedOrderIds = rows.filter((o) => o.status === "completed").map((o) => o.id);
  const { data: reviews } = completedOrderIds.length
    ? await supabase
        .from("reviews")
        .select("order_id")
        .eq("reviewer_id", userId)
        .in("order_id", completedOrderIds)
        .returns<Pick<Review, "order_id">[]>()
    : { data: [] as Pick<Review, "order_id">[] };
  const reviewedOrderIds = new Set((reviews ?? []).map((r) => r.order_id));

  if (rows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="No sales yet"
        description="Every order on one of your listings — however it turns out — shows up here."
      />
    );
  }

  return (
    <div>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        <ul>
          {rows.map((order) => (
            <li key={order.id} className="border-b border-line last:border-0">
              <Link
                href={`/dashboard/orders/${order.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-surface-tint transition flex-wrap"
              >
                {order.listing_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={order.listing_image_url}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover border border-line shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink-900 truncate">{order.listing_title}</div>
                  <div className="text-xs text-ink-500">{formatPrice(order.total_eur)}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <StatusBadge status={order.status} labels={ORDER_STATUS_LABELS} styles={ORDER_STATUS_STYLES} />
                  <StatusBadge
                    status={order.payment_status}
                    labels={PAYMENT_STATUS_LABELS}
                    styles={PAYMENT_STATUS_STYLES}
                  />
                </div>
              </Link>
              {order.status === "completed" && !reviewedOrderIds.has(order.id) && (
                <div className="px-5 pb-4">
                  <LeaveReviewForm orderId={order.id} revieweeId={order.buyer_id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/selling?tab=sales&page=${p}`}
      />
    </div>
  );
}
