import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listRefunds } from "@/lib/admin/queries";
import { REFUND_STATUS_LABELS, REFUND_STATUS_STYLES, formatDateTime, personName } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";

// Fees are shown on every order detail page (platform_fee_eur) and issuing
// a refund stays exclusively an /admin/orders/[id] action (requestOrderRefund)
// — this tab is the one thing that didn't exist anywhere before: every
// refund ATTEMPT across every order, most recent first, so a finance admin
// can scan for processing trouble without opening orders one at a time.
export default async function PaymentsTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const page = Number(searchParams.paymentsPage ?? "1") || 1;
  const { rows, total, pageSize } = await listRefunds({}, page);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Recent refunds</h2>
        <Link href="/admin/payouts/ledger" className="text-sm underline">
          View payout ledger →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Every refund attempt, across every order, most recent first. Issue a new refund from the order&rsquo;s own
        page — fees, payout references, and reconciliation stay there too.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No refunds yet.</p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Buyer</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    <Link href={`/admin/orders/${r.order_id}`} className="hover:underline">
                      #{r.order_id} {r.order?.listing_title ? `— ${r.order.listing_title}` : ""}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{personName(r.buyer)}</td>
                  <td className="px-5 py-3">{formatPrice(r.amount_eur)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} labels={REFUND_STATUS_LABELS} styles={REFUND_STATUS_STYLES} />
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(r.created_at)}</td>
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
        hrefForPage={(p) => `/admin/marketplace?tab=payments&paymentsPage=${p}`}
      />
    </div>
  );
}
