import Link from "next/link";
import StatusBadge from "@/components/admin/status-badge";
import UnavailableCard from "@/components/admin/unavailable-card";
import { CAMPAIGN_VIEW_LABELS, type CampaignView } from "@/lib/advertising";
import { formatPrice } from "@/lib/format";

// Small server-rendered pieces shared by the /admin/advertising pages.

export const VIEW_STYLES: Record<CampaignView, string> = {
  live: "bg-green-100 text-green-800",
  scheduled: "bg-gold-400/30 text-ink-900",
  pending: "bg-gold-500 text-navy-900",
  paused: "bg-cream-100 text-ink-500",
  ended: "bg-cream-100 text-ink-500",
  draft: "bg-surface-tint text-ink-500 border border-line",
  rejected: "bg-red-100 text-red-600",
};

export function CampaignBadge({ view }: { view: CampaignView }) {
  return <StatusBadge status={view} labels={CAMPAIGN_VIEW_LABELS} styles={VIEW_STYLES} />;
}

/** Euro with cents always shown — these are invoices, not price tags. */
export function eur(value: number): string {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(value);
}

export { formatPrice };

export function dateOnly(iso: string | null): string {
  if (!iso) return "open";
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const TABS = [
  { href: "/admin/advertising", label: "Campaigns" },
  { href: "/admin/advertising/advertisers", label: "Advertisers" },
] as const;

/** The section's heading and its two tabs, in the admin's own type and colours. */
export function AdvertisingHeader({
  current,
  title,
  subtitle,
  actions,
}: {
  current: "/admin/advertising" | "/admin/advertising/advertisers" | null;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-gold-600">PinPals advertising</p>
          <h1 className="font-display font-bold text-3xl text-ink-900 mt-1">{title}</h1>
          {subtitle && <p className="text-sm text-ink-500 mt-1 max-w-2xl">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      <nav className="flex gap-1.5 mt-5">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3.5 py-1.5 rounded-full text-sm font-bold border transition ${
              current === t.href ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line text-ink-500 hover:text-ink-900 bg-surface"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function NotInstalled() {
  return (
    <UnavailableCard
      label="Advertising"
      reason="The advertising tables aren't in the database yet. Apply supabase/migrations/0139_advertising.sql, then reload this page."
    />
  );
}

export function Panel({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="font-display font-bold text-lg text-ink-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function NewCampaignLink() {
  return (
    <Link
      href="/admin/advertising/new"
      className="inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm bg-gold-500 text-navy-900 hover:bg-gold-400 transition"
    >
      + New campaign
    </Link>
  );
}
