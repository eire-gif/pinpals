import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listSellerAccounts } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import { sellerAccountStatusLabel, SELLER_ACCOUNT_STATUS_STYLES } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ seller?: string; attention?: string; page?: string }>;
}) {
  // Payout readiness is a finance concern, same gate as /admin/orders — see
  // src/lib/admin/finance.ts. The nav link itself is gated the same way in
  // src/app/admin/layout.tsx.
  await requireStaff({ roles: FINANCE_ROLES });

  const { seller = "", attention = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const needsAttention = attention === "1";

  const { rows: accounts, total, pageSize } = await listSellerAccounts(
    { seller: seller || undefined, needsAttention: needsAttention || undefined },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(seller || needsAttention);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (seller) params.set("seller", seller);
    if (needsAttention) params.set("attention", "1");
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/payouts?${qs}` : "/admin/payouts";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Payouts</h1>
      <p className="text-ink-500 mb-6">
        {total} seller {total === 1 ? "account" : "accounts"} — Stripe Connect onboarding and payout
        readiness. Every status here is a cached copy of what Stripe last reported, not a live balance
        or ledger.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="seller"
          defaultValue={seller}
          placeholder="Seller name or id"
          className="flex-1 min-w-[200px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <label className="flex items-center gap-2 px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <input type="checkbox" name="attention" value="1" defaultChecked={needsAttention} />
          Needs attention only
        </label>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/payouts"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {accounts.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No seller accounts match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Seller</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Charges</th>
                <th className="px-5 py-3 font-semibold">Payouts</th>
                <th className="px-5 py-3 font-semibold">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const sellerName = a.seller ? `${a.seller.first_name} ${a.seller.last_name}` : "Unknown member";
                const label = sellerAccountStatusLabel(a);
                const style = SELLER_ACCOUNT_STATUS_STYLES[label] ?? "bg-cream-100 text-ink-900";
                return (
                  <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/payouts/${a.user_id}`} className="flex items-center gap-2.5">
                        <AdminAvatar name={sellerName} color={a.seller?.avatar_color ?? null} />
                        <span className="text-ink-900 font-semibold">{sellerName}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${style}`}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{a.charges_enabled ? "Yes" : "No"}</td>
                    <td className="px-5 py-3 text-ink-500">{a.payouts_enabled ? "Yes" : "No"}</td>
                    <td className="px-5 py-3 text-ink-500">
                      {a.last_synced_at ? formatDateTime(a.last_synced_at) : "Never"}
                    </td>
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
