import Link from "next/link";

// Plain server-rendered links (no client JS needed) — each pill's href is
// built by the caller so this component doesn't need to know which other
// filters (search term, county, sort) are currently active in order to
// preserve them across a category change.
export default function CategoryNav({
  categories,
  activeCategory,
  buildHref,
}: {
  categories: readonly string[];
  activeCategory?: string;
  buildHref: (category?: string) => string;
}) {
  return (
    <nav aria-label="Marketplace categories" className="relative">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:thin]">
        <CategoryPill href={buildHref(undefined)} active={!activeCategory}>
          All categories
        </CategoryPill>
        {categories.map((category) => (
          <CategoryPill key={category} href={buildHref(category)} active={activeCategory === category}>
            {category}
          </CategoryPill>
        ))}
      </div>
    </nav>
  );
}

function CategoryPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-[1.5px] transition whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 ${
        active
          ? "bg-green-700 border-green-700 text-cream-50"
          : "bg-surface border-line text-ink-900 hover:border-green-700 hover:text-green-700"
      }`}
    >
      {children}
    </Link>
  );
}
