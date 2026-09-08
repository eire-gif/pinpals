import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { canSeeFinanceMetrics } from "@/lib/admin/overview";
import { getMarketplaceOverviewMetrics } from "@/lib/admin/queries";
import { buildMarketplaceAlerts } from "@/lib/admin/marketplace";

// Any active staff role may view — same as /admin's own root overview.
// Finance-flavored figures (orders/payments/sellers/webhooks) are hidden
// for a support/moderator-only viewer, same split canSeeFinanceMetrics()
// already draws on the root overview page.
export default async function OverviewTab() {
  const { staff } = await requireStaff();
  const metrics = await getMarketplaceOverviewMetrics();
  const showFinance = canSeeFinanceMetrics(staff);

  const allAlerts = buildMarketplaceAlerts(metrics);
  const FINANCE_ALERT_KEYS = new Set([
    "openDisputes",
    "sellersNeedingAttention",
    "webhookEventFailures",
    "ordersAwaitingPayment",
    "staleAuctions",
  ]);
  const alerts = allAlerts.filter((a) => showFinance || !FINANCE_ALERT_KEYS.has(a.key));

  return (
    <div>
      <Section title="Needs attention">
        {alerts.length === 0 ? (
          <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">
            Nothing needs attention right now.
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {alerts.map((a) => (
              <Link
                key={a.key}
                href={a.href}
                className="block bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
              >
                <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{a.label}</div>
                <div className="font-display font-bold text-3xl mt-1 text-ink-900">{a.count}</div>
              </Link>
            ))}
          </div>
        )}
        {!showFinance && (
          <p className="text-xs text-ink-500 mt-4">
            Finance-only alerts (payments, sellers, webhooks, auctions) aren&rsquo;t shown for your role.
          </p>
        )}
      </Section>

      <div className="bg-surface border border-line rounded-2xl p-6">
        <h2 className="font-display font-bold text-lg mb-2">About this console</h2>
        <p className="text-sm text-ink-500">
          Most of what&rsquo;s below reuses the same read functions and role gates as the dedicated admin pages this
          links into — Listings, Orders, Seller accounts, Payout ledger, Reports, Support cases. Nothing here
          duplicates a moderation or finance action: use this page to spot what needs attention, then act on the
          linked page. The two exceptions are the Offers &amp; auctions and Disputes tabs, which had no admin view
          anywhere before this phase.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
      {children}
    </div>
  );
}
