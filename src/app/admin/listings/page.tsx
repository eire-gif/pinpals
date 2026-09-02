import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listListings } from "@/lib/admin/queries";
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES, formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireStaff();
  const { q = "", status = "" } = await searchParams;
  const listings = await listListings(q, status);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Listings</h1>
      <p className="text-ink-500 mb-6">
        {listings.length} {listings.length === 1 ? "listing" : "listings"}
        {status && <> · {LISTING_STATUS_LABELS[status] ?? status}</>}.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search title, description, category, county, seller…"
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="reserved">Sale agreed</option>
          <option value="sold">Sold</option>
          <option value="removed">Removed by admin</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {listings.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No listings match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Listing</th>
                <th className="px-5 py-3 font-semibold">Seller</th>
                <th className="px-5 py-3 font-semibold">Price</th>
                <th className="px-5 py-3 font-semibold">County</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Listed</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const sellerName = l.seller ? `${l.seller.first_name} ${l.seller.last_name}` : "Unknown seller";
                return (
                  <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/listings/${l.id}`} className="font-semibold text-ink-900 hover:underline">
                        {l.title}
                      </Link>
                      <div className="text-xs text-ink-500">{l.category}</div>
                    </td>
                    <td className="px-5 py-3">
                      {l.seller ? (
                        <Link href={`/admin/users/${l.seller.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={sellerName} color={l.seller.avatar_color} />
                          <span className="text-ink-900">{sellerName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{sellerName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-900 font-semibold">{formatPrice(l.price_eur)}</td>
                    <td className="px-5 py-3 text-ink-500">{l.county ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={l.status} labels={LISTING_STATUS_LABELS} styles={LISTING_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(l.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
