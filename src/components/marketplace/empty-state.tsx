import Link from "next/link";

export default function MarketplaceEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div
      role="status"
      className="text-center py-16 px-6 bg-surface border border-line rounded-2xl"
    >
      <div
        className="w-12 h-12 mx-auto mb-4 rounded-full bg-surface-tint flex items-center justify-center text-ink-500"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <h2 className="font-display font-bold text-lg text-ink-900">{title}</h2>
      <p className="text-sm text-ink-500 mt-1.5 max-w-[42ch] mx-auto">{description}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="inline-block mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
