import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listListings } from "@/lib/admin/queries";
import { LISTING_STATUS_LABELS, LISTING_STATUS_STYLES, formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import { CATEGORIES } from "@/lib/marketplace";
import { COUNTIES } from "@/lib/clubs";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    county?: string;
    seller?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requireStaff();
  const {
    q = "",
    status = "",
    category = "",
    county = "",
    seller = "",
    from = "",
    to = "",
    page: pageParam,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const { rows: listings, total, pageSize } = await listListings(
    q,
    {
      status: status || undefined,
      category: category || undefined,
      county: county || undefined,
      sellerId: seller || undefined,
      from: from || undefined,
      // Inclusive whole day — see the identical comment on /admin/audit-log.
      to: to ? `${to}T23:59:59.999Z` : undefined,
    },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(q || status || category || county || seller || from || to);

  // The seller filter arrives as an id (from a link on /admin/users/[id]),
  // not a name — best-effort recover a name for the "filtered by" chip from
  // whichever row on this page happens to have it, rather than a separate
  // query just to label a filter chip. Falls back to a bare "this seller"
  // when the filter matches zero rows on this page (e.g. combined with a
  // status/category filter that excludes all of that seller's listings).
  const sellerMatch = seller ? listings.find((l) => l.seller?.id === seller)?.seller ?? null : null;
  const sellerName = sellerMatch ? `${sellerMatch.first_name} ${sellerMatch.last_name}` : null;

  function pageHref(targetPage: number, opts: { dropSeller?: boolean } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (county) params.set("county", county);
    if (seller && !opts.dropSeller) params.set("seller", seller);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/listings?${qs}` : "/admin/listings";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Listings</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "listing" : "listings"}
        {status && <> · {LISTING_STATUS_LABELS[status] ?? status}</>}
        {category && <> · {category}</>}
        {county && <> · {county}</>}
        {q && (
          <>
            {" "}
            matching &ldquo;{q}&rdquo;
          </>
        )}
        .
      </p>

      {seller && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="bg-navy-900 text-cream-50 font-semibold px-3 py-1.5 rounded-full">
            Seller: {sellerName ?? "this seller"}
          </span>
          <Link href={pageHref(1, { dropSeller: true })} className="text-ink-500 hover:text-ink-900">
            Clear
          </Link>
        </div>
      )}

      <form className="flex flex-wrap gap-3 mb-6">
        {seller && <input type="hidden" name="seller" value={seller} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search title, description, seller…"
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
        <select
          name="category"
          defaultValue={category}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          name="county"
          defaultValue={county}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All counties</option>
          {COUNTIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={from}
          aria-label="Listed from"
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          aria-label="Listed to"
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
            href="/admin/listings"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
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
                const rowSellerName = l.seller ? `${l.seller.first_name} ${l.seller.last_name}` : "Unknown seller";
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
                          <AdminAvatar name={rowSellerName} color={l.seller.avatar_color} />
                          <span className="text-ink-900">{rowSellerName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{rowSellerName}</span>
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
