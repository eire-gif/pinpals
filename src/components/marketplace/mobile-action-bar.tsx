import Link from "next/link";

// A sticky bottom bar for the primary action on small viewports, matching
// the pattern common to marketplace apps without copying any one of them
// pixel-for-pixel — plain surface, one bordered edge, safe-area padding so
// it clears a phone's home indicator. Hidden from md and up, where the
// equivalent action already lives inline in the page (a header CTA on
// /marketplace-preview, the seller panel on /marketplace-preview/[slug]).
//
// The calling page is responsible for reserving space for this bar (e.g. a
// bottom padding on the page's outer container on small viewports) so it
// never overlaps the last piece of real content.
export default function MobileActionBar({
  label,
  href,
  disabled = false,
  disabledNote,
}: {
  label: string;
  href: string;
  disabled?: boolean;
  disabledNote?: string;
}) {
  return (
    <div
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-line px-4 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {disabled ? (
        <div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="w-full py-3.5 rounded-full font-bold text-center bg-cream-100 text-ink-500 cursor-not-allowed"
          >
            {label}
          </button>
          {disabledNote && <p className="text-[11px] text-ink-500 text-center mt-1.5">{disabledNote}</p>}
        </div>
      ) : (
        <Link
          href={href}
          className="block w-full py-3.5 rounded-full font-bold text-center bg-green-700 text-cream-50 hover:bg-green-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
        >
          {label}
        </Link>
      )}
    </div>
  );
}
