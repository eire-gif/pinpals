import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listPayouts } from "@/lib/admin/queries";
import { PAYOUT_ROW_STATUS_LABELS, PAYOUT_ROW_STATUS_STYLES, formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import type { Payout } from "@/lib/types";

export default async function AdminPayoutLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string; status?: string; blocked?: string; page?: string }>;
}) {
  // Same finance gate as every other money-adjacent admin section — see
  // src/lib/admin/finance.ts.
  await requireStaff({ roles: FINANCE_ROLES });

  const { seller = "", status = "", blocked = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const blockedOnly = blocked === "1";

  const { rows: payouts, total, pageSize } = await listPayouts(
    {
      seller: seller || undefined,
      status: blockedOnly ? undefined : ((status || undefined) as Payout["status"] | undefined),
      blockedOnly: blockedOnly || undefined,
    },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(seller || status || blockedOnly);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (seller) params.set("seller", seller);
    if (status) params.set("status", status);
    if (blockedOnly) params.set("blocked", "1");
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/payouts/ledger?${qs}` : "/admin/payouts/ledger";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Payout ledger</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "payout" : "payouts"} — Stripe is the source of truth for every figure here;
        this is Pinpals&apos; own timestamped record of it, traced through to the orders each payout swept
        up. For seller Connect onboarding status, see{" "}
        <Link href="/admin/payouts" className="text-ink-900 hover:underline">
          Seller accounts
        </Link>
        .
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="seller"
          defaultValue={seller}
          placeholder="Seller name or id"
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          disabled={blockedOnly}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm disabled:opacity-50"
        >
          <option value="">Any status</option>
          {Object.entries(PAYOUT_ROW_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <input type="checkbox" name="blocked" value="1" defaultChecked={blockedOnly} />
          Failed &amp; blocked only
        </label>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/payouts/ledger"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {payouts.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No payouts match that filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Seller</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Arrival</th>
                <th className="px-5 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => {
                const sellerName = payout.seller
                  ? `${payout.seller.first_name} ${payout.seller.last_name}`.trim()
                  : "Unknown member";
                return (
                  <tr key={payout.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/payouts/ledger/${payout.id}`} className="flex items-center gap-2.5">
                        <AdminAvatar name={sellerName} color={payout.seller?.avatar_color ?? null} />
                        <span className="text-ink-900 font-semibold">{sellerName}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-900 font-semibold">{formatPrice(payout.amount_eur)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge
                        status={payout.status}
                        labels={PAYOUT_ROW_STATUS_LABELS}
                        styles={PAYOUT_ROW_STATUS_STYLES}
                      />
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {payout.arrival_date ? formatDateTime(payout.arrival_date) : "—"}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(payout.stripe_created_at)}</td>
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
