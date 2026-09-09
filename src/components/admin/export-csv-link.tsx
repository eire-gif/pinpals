/**
 * "Export CSV" control for an admin list page.
 *
 * A plain <a>, deliberately not next/link: the target is a Route Handler
 * that responds with Content-Disposition: attachment, and the client router
 * would try to treat that response as a page navigation. A full-page request
 * lets the browser do what it already knows how to do with an attachment —
 * download it and leave the current page untouched.
 *
 * `href` is built by the caller from that page's own current filters, so the
 * file matches what the admin is looking at rather than the whole table.
 */
export default function ExportCsvLink({
  href,
  title,
}: {
  href: string;
  /** Tooltip — a short note on scope, e.g. "Downloads all 412 matching rows". */
  title?: string;
}) {
  return (
    <a
      href={href}
      title={title}
      className="inline-flex items-center gap-2 shrink-0 text-sm font-semibold px-3.5 py-2 rounded-full border border-line text-ink-900 hover:bg-cream-100 transition whitespace-nowrap"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1.8v8.4M4.6 6.8 8 10.2l3.4-3.4M2.4 13.4h11.2" />
      </svg>
      Export CSV
    </a>
  );
}
