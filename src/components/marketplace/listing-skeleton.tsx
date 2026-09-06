// Loading placeholders for the marketplace preview grid and detail page —
// wired up via src/app/marketplace-preview/loading.tsx and
// src/app/marketplace-preview/[slug]/loading.tsx (Next's route-level
// Suspense boundary), and reusable directly wherever a listing fetch is in
// flight once these shared components are wired to a real data source.
// `aria-hidden` on the shimmering blocks plus a single
// screen-reader-only status message avoids a screen reader announcing every
// individual placeholder block.
function ShimmerBlock({ className }: { className: string }) {
  return <div className={`animate-pulse bg-surface-tint rounded-lg ${className}`} aria-hidden="true" />;
}

export function ListingCardSkeleton() {
  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
      <ShimmerBlock className="h-48 w-full rounded-none" />
      <div className="p-4 grid gap-2.5">
        <ShimmerBlock className="h-3 w-20" />
        <ShimmerBlock className="h-5 w-4/5" />
        <ShimmerBlock className="h-3.5 w-full" />
        <div className="flex gap-2 mt-1">
          <ShimmerBlock className="h-6 w-16 rounded-full" />
          <ShimmerBlock className="h-6 w-16 rounded-full" />
        </div>
        <ShimmerBlock className="h-9 w-full rounded-full mt-2" />
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div>
      <span className="sr-only" role="status">
        Loading listings…
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5" aria-hidden="true">
        {Array.from({ length: count }).map((_, i) => (
          <ListingCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function ListingDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-14">
      <span className="sr-only" role="status">
        Loading listing…
      </span>
      <div aria-hidden="true">
        <ShimmerBlock className="h-4 w-32 mb-6" />
        <div className="grid md:grid-cols-2 gap-8">
          <ShimmerBlock className="h-80 w-full" />
          <div className="grid gap-3">
            <ShimmerBlock className="h-3 w-24" />
            <ShimmerBlock className="h-8 w-3/4" />
            <ShimmerBlock className="h-7 w-28" />
            <ShimmerBlock className="h-4 w-full mt-2" />
            <ShimmerBlock className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    </div>
  );
}
