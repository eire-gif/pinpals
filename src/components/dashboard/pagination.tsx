import Link from "next/link";

// Reusable offset pagination for a Server Component list — same `.range()` +
// `count: "exact"` shape as src/lib/admin/queries.ts's listPayouts(), just
// with a member-facing footer instead of an admin table's page-number rail.
// Deliberately plain <Link>s (no client JS): every list this backs is a
// Server Component reading `page` from searchParams, so a normal navigation
// is the whole mechanism — no useState/useTransition needed here at all.
export default function Pagination({
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

  const prevPage = page - 1;
  const nextPage = page + 1;

  return (
    <div className="flex items-center justify-between gap-3 mt-5 text-sm">
      <span className="text-ink-500">
        Page {page} of {totalPages} &middot; {total} total
      </span>
      <div className="flex gap-2">
        <PageLink disabled={page <= 1} href={hrefForPage(prevPage)} label="Previous" />
        <PageLink disabled={page >= totalPages} href={hrefForPage(nextPage)} label="Next" />
      </div>
    </div>
  );
}

function PageLink({ disabled, href, label }: { disabled: boolean; href: string; label: string }) {
  if (disabled) {
    return (
      <span className="px-3.5 py-2 rounded-full border-[1.5px] border-line text-ink-300 cursor-not-allowed">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="px-3.5 py-2 rounded-full border-[1.5px] border-line text-ink-900 hover:bg-cream-100 transition"
    >
      {label}
    </Link>
  );
}
