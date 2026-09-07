/** Next.js route-segment loading state — shown automatically while
 * page.tsx's server-side data fetch (the seller's own listings) is in
 * flight. A simple skeleton echoing that page's own layout (tab row + list
 * of rows) rather than a bare spinner, so the transition into the real
 * content doesn't visually jump. */
export default function LoadingMyListings() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-14 animate-pulse">
      <div className="mb-8 flex items-center justify-between">
        <div className="h-9 w-48 bg-cream-100 rounded-lg" />
        <div className="h-11 w-32 bg-cream-100 rounded-full" />
      </div>

      <div className="flex gap-3 border-b border-line mb-6 pb-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-5 w-16 bg-cream-100 rounded" />
        ))}
      </div>

      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 bg-surface border border-line rounded-xl p-4">
            <div className="w-16 h-16 shrink-0 rounded-lg bg-cream-100" />
            <div className="flex-1 grid gap-2">
              <div className="h-4 w-1/2 bg-cream-100 rounded" />
              <div className="h-3 w-1/3 bg-cream-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
