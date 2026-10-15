import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The society console's look: the site's cream and navy, Playfair titles,
 * gold accents, rounded white cards. Presentational only — safe in Server
 * Components.
 */

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="inline-block text-sm text-ink-500 hover:text-ink-900 mb-2">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-2xl sm:text-3xl text-ink-900">{title}</h1>
          {description && <p className="text-sm text-ink-500 mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = "" }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-surface rounded-2xl border border-line shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="font-display font-bold text-lg text-ink-900">{title}</h2>}
            {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const PILL = {
  green: "bg-green-100 text-green-800",
  gold: "bg-gold-500/20 text-gold-600",
  navy: "bg-navy-900 text-cream-50",
  red: "bg-red-100 text-red-600",
  grey: "bg-cream-100 text-ink-500",
} as const;
export type PillTone = keyof typeof PILL;

export function Pill({ tone = "grey", children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${PILL[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint, href, alert }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; alert?: boolean }) {
  const body = (
    <div className={`rounded-2xl border p-4 h-full transition ${alert ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line text-ink-900"} ${href ? "hover:shadow-md" : ""}`}>
      <div className={`text-[11px] font-bold uppercase tracking-[0.08em] ${alert ? "text-gold-400" : "text-ink-500"}`}>{label}</div>
      <div className="font-display font-bold text-3xl mt-1">{value}</div>
      {hint && <div className={`text-xs mt-1 ${alert ? "text-cream-50/80" : "text-ink-500"}`}>{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-500 text-center py-6">{children}</p>;
}

/** A table that scrolls sideways on a phone rather than squashing. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-500 border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="font-bold px-5 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-5 py-3 align-top ${className}`}>{children}</td>;
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={size} height={size} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span className="rounded-full bg-green-700 text-cream-50 font-bold inline-flex items-center justify-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials || "?"}
    </span>
  );
}

/** Small tabs along the top of a page. */
export function Tabs({ tabs, current }: { tabs: { href: string; label: string; count?: number }[]; current: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${t.href === current ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
        >
          {t.label}
          {t.count != null && t.count > 0 && <span className="ml-1.5 rounded-full bg-gold-500 text-navy-900 px-1.5 text-[11px]">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
