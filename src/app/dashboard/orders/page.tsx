import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_STYLES } from "@/lib/admin/format";
import StatusBadge from "@/components/admin/status-badge";
import type { Order } from "@/lib/types";

// A member's own purchases and sales — the buyer/seller-facing counterpart
// to /admin/orders. Reads through the regular RLS-scoped client: the
// `.or()` filter below just narrows an already-RLS-scoped query to "rows
// where I'm buyer or seller" for clarity — 0019_orders.sql's own policies
// already prevent this query from ever returning anyone else's order, even
// without it (a staff member's broader "can view every order" policy is
// deliberately not narrowed by this filter working around it — this page
// isn't gated to non-staff, but a staff member visiting their own
// /dashboard/orders should see their own orders, same as anyone else).
export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/orders");

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50)
    .returns<Order[]>();

  const rows = orders ?? [];

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display font-bold text-3xl mb-1">Your orders</h1>
      <p className="text-ink-500 mb-8">Everything you&apos;ve bought or sold on the marketplace.</p>

      {rows.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl shadow-sm text-center py-16 text-ink-500">
          Nothing here yet — accepted offers turn into orders automatically.
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          <ul>
            {rows.map((order) => {
              const isBuyer = order.buyer_id === user.id;
              return (
                <li key={order.id} className="border-b border-line last:border-0">
                  <Link
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-surface-tint transition"
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
                      <div className="text-xs text-ink-500">{isBuyer ? "Bought" : "Sold"} · {formatPrice(order.total_eur)}</div>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
