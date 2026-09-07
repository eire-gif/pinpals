/** Route-segment loading state (Next's own convention) — shown automatically
 * while page.tsx's search query is in flight, on first load and on every
 * subsequent filter/search/sort navigation alike (marketplace-controls.tsx
 * pushes a real navigation on every change). Echoes the real layout (slim
 * header + controls row + card grid) rather than a bare spinner, so the
 * transition doesn't visually jump. */
export default function LoadingMarketplace() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8 animate-pulse">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="grid gap-2">
          <div className="h-3 w-24 bg-cream-100 rounded" />
          <div className="h-7 w-64 bg-cream-100 rounded-lg" />
        </div>
        <div className="h-10 w-36 bg-cream-100 rounded-full" />
      </div>

      <div className="flex gap-3 mb-3">
        <div className="h-11 flex-1 min-w-[220px] bg-cream-100 rounded-full" />
        <div className="h-11 w-24 bg-cream-100 rounded-full" />
        <div className="h-11 w-40 bg-cream-100 rounded-full" />
      </div>
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 shrink-0 bg-cream-100 rounded-full" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="aspect-[4/3] bg-cream-100" />
            <div className="p-4 grid gap-2">
              <div className="h-3 w-16 bg-cream-100 rounded" />
              <div className="h-4 w-3/4 bg-cream-100 rounded" />
              <div className="h-5 w-1/2 bg-cream-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
