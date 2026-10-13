import Link from "next/link";

/**
 * A headline figure on an admin dashboard: label, big number, a one-line
 * hint, optionally a link. `accent` is the navy card with gold label used for
 * the one figure a page is about (total revenue); `warn` reds the number.
 * Shared by /admin/marketplace's Revenue tab and /admin/advertising.
 */
export default function StatCard({
  label,
  value,
  hint,
  href,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const body = (
    <>
      <div className={`text-xs uppercase tracking-wide font-semibold ${accent ? "text-gold-400" : "text-ink-500"}`}>{label}</div>
      <div className={`font-display font-bold text-3xl mt-1 ${accent ? "text-cream-50" : warn ? "text-red-600" : "text-ink-900"}`}>{value}</div>
      {hint && <div className={`text-xs mt-1 ${accent ? "text-cream-100" : "text-ink-500"}`}>{hint}</div>}
    </>
  );
  const cls = `block rounded-2xl p-6 shadow-sm border ${accent ? "bg-navy-900 border-navy-900" : "bg-surface border-line"}`;
  return href ? (
    <Link href={href} className={`${cls} hover:shadow-md hover:-translate-y-0.5 transition`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

