import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import { formatDateTime } from "@/lib/admin/format";
import { sellerFulfilmentLabel } from "@/lib/orders";
import NextActionBadge from "@/components/dashboard/next-action-badge";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import type { Order } from "@/lib/types";

const PAGE_SIZE = 10;

// The task spec's "orders requiring action". This schema has no fulfilment/
// shipment tracking column at all (see src/lib/orders.ts's own comment on
// isSellerOrderAwaitingFulfilment()/sellerFulfilmentLabel()) — every paid,
// completed order the seller owns is "requiring action" until this app
// grows a real "mark as shipped" step, so this is an honest queue of every
// current sale needing physical handover, not a shrinking to-do list. The
// heading/description below say so plainly rather than implying otherwise.
export default async function OrdersActionTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const { data: orders, count } = await supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("seller_id", userId)
    .eq("status", "completed")
    .eq("payment_status", "paid")
    .order("completed_at", { ascending: true })
    .range(rangeFrom, rangeTo)
    .returns<Order[]>();

  const rows = orders ?? [];

  if (rows.length === 0) {
    return (
      <MarketplaceEmptyState
        title="Nothing needs fulfilling"
        description="Every paid sale you haven't yet posted or handed over shows up here, oldest first."
      />
    );
  }

  return (
    <div>
      <p className="text-xs text-ink-500 mb-4">
        Pinpals doesn&apos;t track shipping confirmations yet — this list shows every paid order so you can keep on
        top of what still needs to go out, oldest first.
      </p>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        <ul>
          {rows.map((order) => (
            <li key={order.id} className="border-b border-line last:border-0">
              <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
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
                  <div className="text-xs text-ink-500">
                    {formatPrice(order.total_eur)} &middot; paid {order.completed_at ? formatDateTime(order.completed_at) : ""}
                  </div>
                  {order.delivery_detail && (
                    <div className="text-xs text-ink-500 mt-0.5">{order.delivery_detail}</div>
                  )}
                </div>
                <div className="shrink-0">
                  <NextActionBadge label={sellerFulfilmentLabel(order)} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/selling?tab=orders&page=${p}`}
      />
    </div>
  );
}
