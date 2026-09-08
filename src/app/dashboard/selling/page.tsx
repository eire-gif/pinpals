import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceTabs, { type WorkspaceTab } from "@/components/dashboard/workspace-tabs";
import { runOfferSweeps } from "@/app/marketplace/[id]/actions";
import ListingsPerformanceTab from "./listings-performance-tab";
import OffersAuctionsTab from "./offers-auctions-tab";
import OrdersActionTab from "./orders-action-tab";
import SalesHistoryTab from "./sales-history-tab";
import BalancePayoutsTab from "./balance-payouts-tab";

const TABS: WorkspaceTab[] = [
  { key: "listings", label: "Listings & performance" },
  { key: "offers", label: "Offers & auctions" },
  { key: "orders", label: "Orders needing action" },
  { key: "sales", label: "Sales history" },
  { key: "payouts", label: "Balance & payouts" },
];

/**
 * "My selling" — the seller half of the marketplace-workspaces checkpoint.
 * Same shape as ../buying/page.tsx: one page on the existing dashboard
 * shell, tab bar over `?tab=`, each tab its own scoped Server Component.
 * Deliberately links out to (rather than re-implements) two pages that
 * already do this job well: /dashboard/listings for actually managing a
 * listing (draft/edit/tabs by status) and /dashboard/payouts for the full
 * Stripe onboarding flow (Start/Resume setup, requirements) — this
 * workspace's own "Listings & performance" and "Balance & payouts" tabs add
 * the genuinely new data (performance counts, live balance) and cross-link
 * into those existing pages for anything actionable, rather than
 * duplicating their logic.
 */
export default async function SellingWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { tab: tabParam, page: pageParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/selling");

  // Same opportunistic sweep as the buyer workspace — a seller's own offers
  // tab should never show a 'pending' offer whose deadline has already
  // silently lapsed.
  await runOfferSweeps();

  const activeTab = TABS.find((t) => t.key === tabParam) ?? TABS[0];
  const page = Math.max(1, Number(pageParam) || 1);

  return (
    <div className="max-w-4xl mx-auto px-6 py-14">
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
          </span>
          <h1 className="font-display font-bold text-3xl mt-2.5">My selling</h1>
          <p className="text-ink-500 mt-1">Everything you&apos;re selling, negotiating or getting paid for.</p>
        </div>
      </div>

      <WorkspaceTabs tabs={TABS} activeKey={activeTab.key} basePath="/dashboard/selling" />

      {activeTab.key === "listings" && <ListingsPerformanceTab userId={user.id} page={page} />}
      {activeTab.key === "offers" && <OffersAuctionsTab userId={user.id} />}
      {activeTab.key === "orders" && <OrdersActionTab userId={user.id} page={page} />}
      {activeTab.key === "sales" && <SalesHistoryTab userId={user.id} page={page} />}
      {activeTab.key === "payouts" && <BalancePayoutsTab userId={user.id} page={page} />}
    </div>
  );
}
