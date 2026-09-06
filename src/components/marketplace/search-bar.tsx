// Plain GET form — works without client-side JavaScript, matching the rest
// of the app's filter forms (courses directory, tee-time browse). `role="search"`
// gives assistive tech a landmark to jump straight to; the visible label is
// a placeholder only, so a screen-reader label is added separately for each
// field rather than relying on placeholder text alone.
export default function MarketplaceSearchBar({
  defaultQuery,
  defaultCounty,
  defaultSort,
  counties,
}: {
  defaultQuery: string;
  defaultCounty: string;
  defaultSort: string;
  counties: readonly string[];
}) {
  return (
    <div role="search" className="bg-surface border border-line rounded-2xl px-5 py-4 shadow-sm">
      <form className="flex flex-wrap gap-3.5 items-center justify-between">
        <div className="relative flex-1 min-w-[220px]">
          <label htmlFor="marketplace-search" className="sr-only">
            Search listings
          </label>
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            id="marketplace-search"
            type="text"
            name="q"
            defaultValue={defaultQuery}
            placeholder="Search clubs, bags, gear…"
            className="w-full pl-10 pr-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
          />
        </div>

        <div>
          <label htmlFor="marketplace-county" className="sr-only">
            County
          </label>
          <select
            id="marketplace-county"
            name="county"
            defaultValue={defaultCounty}
            className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
          >
            <option value="">All counties</option>
            {counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="marketplace-sort" className="sr-only">
            Sort by
          </label>
          <select
            id="marketplace-sort"
            name="sort"
            defaultValue={defaultSort}
            className="px-3.5 py-2.5 rounded-full border-[1.5px] border-line bg-surface-tint text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
          >
            <option value="recent">Newest first</option>
            <option value="price_low">Price: low to high</option>
            <option value="price_high">Price: high to low</option>
          </select>
        </div>

        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold bg-green-700 text-cream-50 text-sm hover:bg-green-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
        >
          Search
        </button>
      </form>
    </div>
  );
}
