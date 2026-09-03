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
  statusLabel,
} from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    buyer?: string;
    seller?: string;
    status?: string;
    payment?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  // Orders are a finance concern, not general moderation — see
  // src/lib/admin/finance.ts. support/moderator get the same 404 a
  // non-staff request would (requireStaff()'s standard behavior), which is
  // why the nav link itself is gated the same way in src/app/admin/layout.tsx.
  await requireStaff({ roles: FINANCE_ROLES });

  const {
    id: idParam = "",
    buyer = "",
    seller = "",
    status = "",
    payment = "",
    from = "",
    to = "",
    page: pageParam,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const orderId = idParam.trim() ? Number.parseInt(idParam, 10) : undefined;

  const { rows: orders, total, pageSize } = await listOrders(
    {
      orderId: orderId && Number.isFinite(orderId) ? orderId : undefined,
      buyer: buyer || undefined,
      seller: seller || undefined,
      status: status || undefined,
      paymentStatus: payment || undefined,
      from: from || undefined,
      // Inclusive whole day — same convention as /admin/audit-log and
      // /admin/listings.
      to: to ? `${to}T23:59:59.999Z` : undefined,
    },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(idParam || buyer || seller || status || payment || from || to);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (idParam) params.set("id", idParam);
    if (buyer) params.set("buyer", buyer);
    if (seller) params.set("seller", seller);
    if (status) params.set("status", status);
    if (payment) params.set("payment", payment);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Orders</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "order" : "orders"}
        {status && <> · {statusLabel(ORDER_STATUS_LABELS, status)}</>}
        {payment && <> · {statusLabel(PAYMENT_STATUS_LABELS, payment)} payment</>}.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="id"
          defaultValue={idParam}
          placeholder="Order #"
          className="w-28 px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <input
          type="text"
          name="buyer"
          defaultValue={buyer}
          placeholder="Buyer name"
          className="flex-1 min-w-[160px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <input
          type="text"
          name="seller"
          defaultValue={seller}
          placeholder="Seller name"
          className="flex-1 min-w-[160px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="payment"
          defaultValue={payment}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All payment statuses</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={from}
          aria-label="Placed from"
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          aria-label="Placed to"
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/orders"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {orders.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No orders match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Order</th>
                <th className="px-5 py-3 font-semibold">Buyer</th>
                <th className="px-5 py-3 font-semibold">Seller</th>
                <th className="px-5 py-3 font-semibold">Total</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Payment</th>
                <th className="px-5 py-3 font-semibold">Placed</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const buyerName = o.buyer ? `${o.buyer.first_name} ${o.buyer.last_name}` : "Unknown buyer";
                const sellerName = o.seller ? `${o.seller.first_name} ${o.seller.last_name}` : "Unknown seller";
                return (
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-semibold text-ink-900 hover:underline">
                        #{o.id}
                      </Link>
                      <div className="text-xs text-ink-500 truncate max-w-[220px]">{o.listing_title}</div>
                    </td>
                    <td className="px-5 py-3">
                      {o.buyer ? (
                        <Link href={`/admin/users/${o.buyer.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={buyerName} color={o.buyer.avatar_color} />
                          <span className="text-ink-900">{buyerName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{buyerName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {o.seller ? (
                        <Link href={`/admin/users/${o.seller.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={sellerName} color={o.seller.avatar_color} />
                          <span className="text-ink-900">{sellerName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{sellerName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-900 font-semibold">{formatPrice(o.total_eur)}</td>
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
