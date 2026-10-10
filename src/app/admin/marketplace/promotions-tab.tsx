import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import {
  PROMOTION_KIND_LABELS,
  PROMOTION_STATUSES,
  listPromotionsForAdmin,
  type PromotionStatus,
} from "@/lib/admin/marketplace-revenue";
import { formatDateTime, personName } from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import ModerationForm from "@/components/admin/moderation-form";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";
import { cancelPromotion } from "./growth-actions";

const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  pending: "Awaiting payment",
  active: "Active",
  expired: "Expired",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const PROMOTION_STATUS_STYLES: Record<PromotionStatus, string> = {
  pending: "bg-cream-100 text-ink-500",
  active: "bg-green-100 text-green-800",
  expired: "bg-cream-100 text-ink-900",
  cancelled: "bg-red-100 text-red-600",
  refunded: "bg-gold-500/20 text-gold-700",
};

function isPromotionStatus(value: string | undefined): value is PromotionStatus {
  return (PROMOTION_STATUSES as readonly string[]).includes(value ?? "");
}

// Paid bumps and featured placements (0115), most recent first.
export default async function PromotionsTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireStaff({ roles: FINANCE_ROLES });

  const status = isPromotionStatus(searchParams.promoStatus) ? searchParams.promoStatus : undefined;
  const page = Number(searchParams.promosPage ?? "1") || 1;
  const { rows, total, pageSize } = await listPromotionsForAdmin({ status }, page);

  const filterHref = (s?: PromotionStatus) => `/admin/marketplace?tab=promotions${s ? `&promoStatus=${s}` : ""}`;

  return (
    <div>
      <h2 className="font-display font-bold text-lg mb-2">Promotions</h2>
      <p className="text-sm text-ink-500 mb-4">
        Featured (€4.99, 7 days) and Bump (€1.99, 3 days) placements bought by sellers. Cancelling stops an active
        placement and removes the Featured badge; it doesn&rsquo;t refund — issue any refund in the Stripe dashboard.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <FilterChip href={filterHref()} active={!status} label="All" />
        {PROMOTION_STATUSES.map((s) => (
          <FilterChip key={s} href={filterHref(s)} active={status === s} label={PROMOTION_STATUS_LABELS[s]} />
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No promotions{status ? " with this status" : " yet"}.</p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Listing</th>
                <th className="px-5 py-3">Seller</th>
                <th className="px-5 py-3">Kind</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Runs</th>
                <th className="px-5 py-3 min-w-64" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-5 py-3 font-semibold text-ink-900">
                    <Link href={`/admin/listings/${p.listing_id}`} className="hover:underline">
                      {p.listingTitle ?? `Listing #${p.listing_id}`}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/admin/users/${p.seller_id}`} className="hover:underline">
                      {personName(p.seller)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className={p.kind === "featured" ? "font-bold text-gold-600" : ""}>{PROMOTION_KIND_LABELS[p.kind] ?? p.kind}</span>
                  </td>
                  <td className="px-5 py-3">{formatPrice(p.amount_eur)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={p.status} labels={PROMOTION_STATUS_LABELS} styles={PROMOTION_STATUS_STYLES} />
                  </td>
                  <td className="px-5 py-3 text-ink-500 whitespace-nowrap">
                    {p.starts_at ? (
                      <>
                        {formatDateTime(p.starts_at)}
                        <br />→ {p.ends_at ? formatDateTime(p.ends_at) : "—"}
                      </>
                    ) : (
                      <>Created {formatDateTime(p.created_at)}</>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {p.status === "active" && (
                      <details>
                        <summary className="text-sm text-ink-500 cursor-pointer">Cancel…</summary>
                        <div className="mt-2">
                          <ModerationForm
                            action={cancelPromotion}
                            idField="promotionId"
                            id={p.id}
                            submitLabel="Cancel promotion"
                            pendingLabel="Cancelling…"
                            tone="danger"
                            placeholder="Reason (required — recorded in the audit log)"
                          />
                        </div>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminPagination
        page={page}
        pageSize={pageSize}
        total={total}
        hrefForPage={(n) => `${filterHref(status)}&promosPage=${n}`}
      />
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
        active ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line text-ink-500 hover:text-ink-900 bg-surface"
      }`}
    >
      {label}
    </Link>
  );
}
