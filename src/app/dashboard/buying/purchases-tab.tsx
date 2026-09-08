import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES } from "@/lib/admin/format";
import StatusBadge from "@/components/admin/status-badge";
import NextActionBadge from "@/components/dashboard/next-action-badge";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import { buyerOrderNextAction } from "@/lib/orders";
import type { Order } from "@/lib/types";

const PAGE_SIZE = 10;

// The task spec's "purchases by status" — server-side filtered (not a
// client-side re-filter of an already-fetched page, which would make the
// pagination below lie about how many pages exist) using the real
// orders.status/payment_status columns, never a status this app invents.
// "Action needed" mirrors buyerOrderNextAction()'s own non-null condition
// exactly (src/lib/orders.ts) so this filter and the badge shown on each row
// never disagree with each other.
const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "action", label: "Action needed" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Cancelled / refunded" },
] as const;

type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

export default async function PurchasesTab({
  userId,
  page,
  status,
}: {
  userId: string;
  page: number;
  status?: string;
}) {
  const activeStatus: StatusFilterKey = STATUS_FILTERS.some((f) => f.key === status)
    ? (status as StatusFilterKey)
    : "all";

  const supabase = await createClient();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("buyer_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (activeStatus === "action") {
    query = query.eq("status", "pending").neq("payment_status", "paid");
  } else if (activeStatus === "completed") {
    query = query.eq("status", "completed");
  } else if (activeStatus === "closed") {
    query = query.in("status", ["cancelled", "refunded"]);
  }

  const { data: orders, count } = await query.returns<Order[]>();
  const rows = orders ?? [];

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-5">
        {STATUS_FILTERS.map((f) => {
          const isActive = f.key === activeStatus;
          const href = f.key === "all" ? "/dashboard/buying?tab=purchases" : `/dashboard/buying?tab=purchases&status=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`px-3.5 py-2 rounded-full text-xs font-bold border-[1.5px] transition ${
                isActive
                  ? "bg-green-700 border-green-700 text-cream-50"
                  : "border-line text-ink-900 hover:bg-cream-100"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <MarketplaceEmptyState
          title="Nothing here yet"
          description={
            activeStatus === "all"
              ? "Buy something on the marketplace and it'll show up here — from Buy Now purchases to accepted offers."
              : "No purchases match this filter right now."
          }
          actionHref={activeStatus === "all" ? "/marketplace" : undefined}
          actionLabel={activeStatus === "all" ? "Browse the marketplace" : undefined}
        />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          <ul>
            {rows.map((order) => {
              const action = buyerOrderNextAction(order);
              return (
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
                    <div className="flex gap-2 items-center flex-wrap shrink-0">
                      {action ? (
                        <NextActionBadge label={action.label} deadlineIso={action.deadlineIso} />
                      ) : (
                        <>
                          <StatusBadge status={order.status} labels={ORDER_STATUS_LABELS} styles={ORDER_STATUS_STYLES} />
                          <StatusBadge
                            status={order.payment_status}
                            labels={PAYMENT_STATUS_LABELS}
                            styles={PAYMENT_STATUS_STYLES}
                          />
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) =>
          `/dashboard/buying?tab=purchases${activeStatus !== "all" ? `&status=${activeStatus}` : ""}&page=${p}`
        }
      />
    </div>
  );
}
