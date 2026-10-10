import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import {
  REVENUE_PERIODS,
  REVENUE_PERIOD_LABELS,
  getMarketplaceRevenue,
  heldForSellersEur,
  parseRevenuePeriod,
  type HeldOrderRow,
} from "@/lib/admin/marketplace-revenue";
import { formatDateTime } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";

// The marketplace money dashboard (0114 Buyer Protection, 0115 shops,
// promotions, banners, affiliates). Read-only: every figure links to where
// it can be acted on. Revenue figures are for the chosen period; the "Right
// now" section is the live position regardless of period.
export default async function RevenueTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const period = parseRevenuePeriod(searchParams.period);
  const r = await getMarketplaceRevenue(period);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h2 className="font-display font-bold text-lg">PinPals revenue — {REVENUE_PERIOD_LABELS[period].toLowerCase()}</h2>
        <div className="flex gap-1.5">
          {REVENUE_PERIODS.map((p) => (
            <Link
              key={p}
              href={`/admin/marketplace?tab=revenue&period=${p}`}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                p === period
                  ? "bg-navy-900 text-cream-50 border-navy-900"
                  : "border-line text-ink-500 hover:text-ink-900 bg-surface"
              }`}
            >
              {p === "all" ? "All" : p}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        <StatCard label="Total PinPals revenue" value={formatPrice(r.totalRevenueEur)} accent hint="Buyer Protection + shop commission + promotions + banner fees" />
        <StatCard label="Buyer Protection fees" value={formatPrice(r.orders.buyerProtectionEur)} hint={`${r.orders.paidOrders - r.orders.shopOrders} member sales`} />
        <StatCard label="Shop commission" value={formatPrice(r.orders.shopCommissionEur)} hint={`${r.orders.shopOrders} pro shop sales`} href="/admin/marketplace?tab=shops" />
        <StatCard
          label="Promotions"
          value={formatPrice(r.promotions.totalEur)}
          hint={`${r.promotions.byKind.featured.count} featured · ${r.promotions.byKind.bump.count} bumps`}
          href="/admin/marketplace?tab=promotions"
        />
        <StatCard label="Banner fees" value={formatPrice(r.banners.totalEur)} hint={`${r.banners.count} banners started`} href="/admin/marketplace?tab=retail" />
        <StatCard label="GMV (paid orders)" value={formatPrice(r.orders.gmvEur)} hint={`${r.orders.paidOrders} paid orders`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-10">
        <Panel title="Promotions by kind">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Kind</th>
                <th className="px-5 py-3 text-right">Sold</th>
                <th className="px-5 py-3 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-5 py-3 font-semibold text-ink-900">Featured (7 days)</td>
                <td className="px-5 py-3 text-right">{r.promotions.byKind.featured.count}</td>
                <td className="px-5 py-3 text-right">{formatPrice(r.promotions.byKind.featured.totalEur)}</td>
              </tr>
              <tr>
                <td className="px-5 py-3 font-semibold text-ink-900">Bump (3 days)</td>
                <td className="px-5 py-3 text-right">{r.promotions.byKind.bump.count}</td>
                <td className="px-5 py-3 text-right">{formatPrice(r.promotions.byKind.bump.totalEur)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <Panel title={`Affiliate clicks — ${r.affiliate.clicks}`}>
          {r.affiliate.top.length === 0 ? (
            <p className="text-sm text-ink-500 p-5">No affiliate clicks in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Top products</th>
                  <th className="px-5 py-3">Retailer</th>
                  <th className="px-5 py-3 text-right">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.affiliate.top.map((p) => (
                  <tr key={p.productId}>
                    <td className="px-5 py-3 font-semibold text-ink-900">{p.title}</td>
                    <td className="px-5 py-3 text-ink-500">{p.retailer}</td>
                    <td className="px-5 py-3 text-right">{p.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <h2 className="font-display font-bold text-lg mb-3">Right now</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        <StatCard label="Held for sellers" value={formatPrice(r.live.heldEur)} hint={`${r.live.heldCount} paid sales awaiting handover or delivery`} />
        <StatCard label="Releases due in 3 days" value={String(r.live.releasesDue.length)} hint="Automatic release unless a problem is reported" />
        <StatCard label="Sales with a problem" value={String(r.live.problems.length)} hint="Release frozen until staff decide" warn={r.live.problems.length > 0} />
      </div>

      <div id="problems" className="mb-8 scroll-mt-6">
        <h3 className="font-display font-bold text-base mb-3">Problems reported (not released)</h3>
        <HeldTable rows={r.live.problems} empty="No open problems." dateLabel="Reported" dateOf={(o) => o.problem_at} />
      </div>

      <div className="mb-8">
        <h3 className="font-display font-bold text-base mb-3">Releases due in the next 3 days</h3>
        <HeldTable rows={r.live.releasesDue} empty="Nothing due to release in the next 3 days." dateLabel="Release due" dateOf={(o) => o.release_due_at} />
      </div>

      <p className="text-xs text-ink-500">
        Order revenue is booked on the order&rsquo;s creation date (paid orders only); promotions on their start; banner fees
        on the banner&rsquo;s start date. Refunds of promotions made in Stripe aren&rsquo;t reflected unless the promotion is
        marked refunded. Affiliate commission is paid by retailers outside PinPals and isn&rsquo;t counted.
      </p>
    </div>
  );
}

function StatCard({
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden">
      <h3 className="font-display font-bold text-base px-5 pt-4 pb-3">{title}</h3>
      {children}
    </div>
  );
}

function HeldTable({
  rows,
  empty,
  dateLabel,
  dateOf,
}: {
  rows: HeldOrderRow[];
  empty: string;
  dateLabel: string;
  dateOf: (o: HeldOrderRow) => string | null;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">{empty}</p>;
  }
  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-3">Order</th>
            <th className="px-5 py-3">Held</th>
            <th className="px-5 py-3">Stage</th>
            <th className="px-5 py-3">{dateLabel}</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((o) => {
            const when = dateOf(o);
            return (
              <tr key={o.id}>
                <td className="px-5 py-3 font-semibold text-ink-900">
                  #{o.id} — {o.listing_title}
                  {o.store_id != null && <span className="ml-2 text-xs font-bold text-gold-600">Shop</span>}
                </td>
                <td className="px-5 py-3">{formatPrice(heldForSellersEur([o]))}</td>
                <td className="px-5 py-3 text-ink-500">{o.fulfilment_status?.replace(/_/g, " ") ?? "—"}</td>
                <td className="px-5 py-3 text-ink-500">{when ? formatDateTime(when) : "—"}</td>
                <td className="px-5 py-3 text-right">
                  <Link href={`/admin/orders/${o.id}`} className="text-sm underline">
                    Open →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
