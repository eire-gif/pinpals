import Link from "next/link";

// Same `.range()` + `count: "exact"` shape every list function in
// src/lib/admin/queries.ts already uses, and the same inline prev/next
// markup every existing /admin list page (orders, listings, reports, ...)
// hand-rolls at the bottom of its own file — pulled out here because
// /admin/marketplace's tabs need it five separate times in one page, the
// same reasoning that led to src/components/dashboard/pagination.tsx for
// the buyer/seller workspace pages. Existing single-list pages are
// unaffected; this doesn't replace their own inline version, just avoids a
// sixth near-identical copy inside this new page.
export default function AdminPagination({
  page,
  pageSize,
  total,
  hrefForPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefForPage: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
      <span>
        Page {page} of {totalPages} &middot; {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={hrefForPage(page - 1)}
            className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Previous
          </Link>
        )}
        {page < totalPages && (
          <Link
            href={hrefForPage(page + 1)}
            className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
