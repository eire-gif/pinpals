import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPrice, SELLER_ONBOARDING_STATUS_LABELS, SELLER_ONBOARDING_STATUS_STYLES } from "@/lib/format";
import { formatDateTime, PAYOUT_ROW_STATUS_LABELS, PAYOUT_ROW_STATUS_STYLES } from "@/lib/admin/format";
import { sellerOnboardingStatus } from "@/lib/stripe/connect";
import { getConnectAccountBalance } from "@/lib/stripe/balance";
import Pagination from "@/components/dashboard/pagination";
import MarketplaceEmptyState from "@/components/marketplace/empty-state";
import type { Payout, StripeConnectedAccount } from "@/lib/types";

const PAGE_SIZE = 10;

// The task spec's "available/pending balance and payout history through
// safe Stripe data/components" + "account/payout readiness and
// requirements". The readiness/requirements half already has a whole page
// (src/app/dashboard/payouts/page.tsx, unchanged) — this tab shows a
// compact status summary and links there for the full detail and the
// Start/Resume-onboarding actions, rather than rebuilding that flow. The
// balance/payout-history half is genuinely new: balance is read live from
// Stripe (getConnectAccountBalance() — src/lib/stripe/balance.ts, "safe"
// because it's a read-only display of Stripe's own numbers, never a value
// this app computes), and payout history reads `payouts` (0024) through the
// member-facing SELECT policy this checkpoint adds
// (0054_payouts_member_select_policy.sql) — every figure below is either
// Stripe's own live balance or a row Stripe's own payout.* webhooks already
// wrote; nothing here recomputes an amount or a fee.
export default async function BalancePayoutsTab({ userId, page }: { userId: string; page: number }) {
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("stripe_connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<StripeConnectedAccount>();

  if (!account) {
    return (
      <MarketplaceEmptyState
        title="Set up payouts to get started"
        description="You'll see your balance and payout history here once you've set up payouts with Stripe."
        actionHref="/dashboard/payouts"
        actionLabel="Set up payouts"
      />
    );
  }

  const status = sellerOnboardingStatus(account);
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const [balance, { data: payouts, count }] = await Promise.all([
    getConnectAccountBalance(account.stripe_account_id),
    supabase
      .from("payouts")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("stripe_created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rangeFrom, rangeTo)
      .returns<Payout[]>(),
  ]);

  const rows = payouts ?? [];

  return (
    <div>
      <div className="bg-surface border border-line rounded-2xl shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <span className="text-xs uppercase tracking-wide text-ink-500 font-semibold">Payout readiness</span>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${SELLER_ONBOARDING_STATUS_STYLES[status]}`}
            >
              {SELLER_ONBOARDING_STATUS_LABELS[status]}
            </span>
            <Link href="/dashboard/payouts" className="text-sm font-bold text-green-700 hover:text-green-600">
              Details &rarr;
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-ink-500">Available</div>
            <div className="font-display font-bold text-xl">
              {balance ? formatPrice(balance.availableEur) : "Unavailable right now"}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-500">Pending</div>
            <div className="font-display font-bold text-xl">
              {balance ? formatPrice(balance.pendingEur) : "Unavailable right now"}
            </div>
          </div>
        </div>
        {!balance && (
          <p className="text-xs text-ink-500 mt-3">
            Couldn&apos;t reach Stripe just now for a live balance — this doesn&apos;t affect your actual payouts,
            only this page.
          </p>
        )}
      </div>

      <h2 className="font-display font-bold text-lg mb-4">Payout history</h2>

      {rows.length === 0 ? (
        <MarketplaceEmptyState
          title="No payouts yet"
          description="Once Stripe sends your first payout, it'll show up here."
        />
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
          <ul>
            {rows.map((payout) => (
              <li key={payout.id} className="border-b border-line last:border-0">
                <div className="flex items-center justify-between gap-4 px-5 py-4 flex-wrap">
                  <div>
                    <div className="font-semibold text-ink-900">{formatPrice(payout.amount_eur)}</div>
                    <div className="text-xs text-ink-500">{formatDateTime(payout.stripe_created_at)}</div>
                  </div>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full ${PAYOUT_ROW_STATUS_STYLES[payout.status]}`}
                  >
                    {PAYOUT_ROW_STATUS_LABELS[payout.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        hrefForPage={(p) => `/dashboard/selling?tab=payouts&page=${p}`}
      />
    </div>
  );
}
