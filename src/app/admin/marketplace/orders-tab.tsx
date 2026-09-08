import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listOrders } from "@/lib/admin/queries";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  formatDateTime,
  personName,
} from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";

// Order search/filter/refund/timeline itself already lives in full at
// /admin/orders — this is that same listOrders() function, pre-filtered to
// the sharpest "needs attention" slice (a pending order whose payment has
// actually failed), with a link out to the broader still-pending view.
export default async function OrdersTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const page = Number(searchParams.ordersPage ?? "1") || 1;
  const { rows, total, pageSize } = await listOrders({ status: "pending", paymentStatus: "failed" }, page);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Orders with failed payments</h2>
        <Link href="/admin/orders" className="text-sm underline">
          View all orders →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Still &ldquo;pending&rdquo; with a payment attempt that failed — the buyer needs to retry, or it&rsquo;ll
        lapse once its reservation window passes. Also see{" "}
        <Link href="/admin/orders?status=pending&payment=pending" className="underline">
          orders still awaiting a first payment attempt
        </Link>
        .
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">
          No orders with a failed payment right now.
        </p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Buyer</th>
                <th className="px-5 py-3">Seller</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Payment</th>
                <th className="px-5 py-3">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    <Link href={`/admin/orders/${o.id}`} className="hover:underline">
                      #{o.id} — {o.listing_title}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{personName(o.buyer)}</td>
                  <td className="px-5 py-3">{personName(o.seller)}</td>
                  <td className="px-5 py-3">{formatPrice(o.total_eur)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={o.status} labels={ORDER_STATUS_LABELS} styles={ORDER_STATUS_STYLES} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge
                      status={o.payment_status}
                      labels={PAYMENT_STATUS_LABELS}
                      styles={PAYMENT_STATUS_STYLES}
                    />
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        hrefForPage={(p) => `/admin/marketplace?tab=orders&ordersPage=${p}`}
      />
    </div>
  );
}
