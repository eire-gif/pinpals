import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listReports } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";
import AdminAvatar from "@/components/admin/avatar";
import AdminPagination from "@/components/admin/pagination";

// Listing moderation itself (search/filter/hide/restore) already lives in
// full at /admin/listings — this tab is deliberately narrower: just the
// listings someone has actually reported, unclaimed, via the exact same
// listReports() function /admin/reports uses. Not a second moderation
// queue, a filtered view of the one that already exists.
export default async function ListingsTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // Any active staff role can view — same as /admin/listings and
  // /admin/reports themselves.
  await requireStaff();

  const page = Number(searchParams.listingsPage ?? "1") || 1;
  const { rows, total, pageSize } = await listReports("", { targetType: "listing", status: "open" }, page);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Listings with unclaimed reports</h2>
        <Link href="/admin/reports?targetType=listing" className="text-sm underline">
          View all listing reports →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Open, unclaimed reports against a listing — claim and act on one from{" "}
        <Link href="/admin/reports" className="underline">
          Reports
        </Link>
        , or manage listings directly at{" "}
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>
        .
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">
          No unclaimed listing reports right now.
        </p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Listing</th>
                <th className="px-5 py-3">Reporter</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Reported</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    {r.target.href ? (
                      <Link href={r.target.href} className="hover:underline">
                        {r.target.label}
                      </Link>
                    ) : (
                      r.target.label
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <AdminAvatar name={personName(r.reporter)} color={r.reporter?.avatar_color ?? null} />
                      <span>{personName(r.reporter)}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{r.category}</td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(r.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/reports/${r.id}`} className="text-sm underline">
                      Open →
                    </Link>
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
        hrefForPage={(p) => `/admin/marketplace?tab=listings&listingsPage=${p}`}
      />
    </div>
  );
}
