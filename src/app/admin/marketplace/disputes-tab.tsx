import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listDisputes } from "@/lib/admin/queries";
import { DISPUTE_STATUS_LABELS, DISPUTE_STATUS_STYLES, formatDateTime, personName } from "@/lib/admin/format";
import { stripeDisputeDashboardUrl } from "@/lib/stripe/refunds";
import { formatPrice } from "@/lib/format";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";

// The disputes queue Phase 11 explicitly deferred ("No admin-wide disputes
// list page — only per-order dispute visibility", per
// claude/phase-11-refunds-disputes-summary.md). Still read-only + a direct
// Stripe dashboard link — responding to a dispute happens in Stripe, never
// here, per the task's "links to Stripe's dashboard/embedded tools for
// sensitive financial operations rather than recreating them". Reports and
// support cases already have their own full admin sections; this tab only
// links to them rather than re-listing their contents.
export default async function DisputesTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const page = Number(searchParams.disputesPage ?? "1") || 1;
  const { rows, total, pageSize } = await listDisputes({}, page);

  return (
    <div>
      <section className="mb-8 grid sm:grid-cols-2 gap-4">
        <Link
          href="/admin/reports"
          className="block bg-surface border border-line rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
        >
          <div className="font-display font-bold text-lg">Reports</div>
          <p className="text-sm text-ink-500 mt-1">The full moderation queue — every reported user, listing, and message.</p>
        </Link>
        <Link
          href="/admin/support"
          className="block bg-surface border border-line rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
        >
          <div className="font-display font-bold text-lg">Support cases</div>
          <p className="text-sm text-ink-500 mt-1">Help requests logged outside the app — calls, emails, and their linked context.</p>
        </Link>
      </section>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Disputes</h2>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Every Stripe dispute/chargeback, across every order, most recent first. Evidence and responses are handled
        in Stripe&rsquo;s own dashboard, not here — each row links straight there.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No disputes on file.</p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Buyer</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Evidence due</th>
                <th className="px-5 py-3">Opened</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    {d.order_id ? (
                      <Link href={`/admin/orders/${d.order_id}`} className="hover:underline">
                        #{d.order_id} {d.order?.listing_title ? `— ${d.order.listing_title}` : ""}
                      </Link>
                    ) : (
                      "No linked order"
                    )}
                  </td>
                  <td className="px-5 py-3">{personName(d.buyer)}</td>
                  <td className="px-5 py-3">{formatPrice(d.amount_eur)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={d.status} labels={DISPUTE_STATUS_LABELS} styles={DISPUTE_STATUS_STYLES} />
                  </td>
                  <td className="px-5 py-3 text-ink-500">
                    {d.evidence_due_by ? formatDateTime(d.evidence_due_by) : "—"}
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(d.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <a
                      href={stripeDisputeDashboardUrl(d.stripe_dispute_id, d.livemode)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline"
                    >
                      Open in Stripe →
                    </a>
                  </td>
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
        hrefForPage={(p) => `/admin/marketplace?tab=disputes&disputesPage=${p}`}
      />
    </div>
  );
}
