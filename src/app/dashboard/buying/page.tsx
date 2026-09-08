import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceTabs, { type WorkspaceTab } from "@/components/dashboard/workspace-tabs";
import { runOfferSweeps } from "@/app/marketplace/[id]/actions";
import PurchasesTab from "./purchases-tab";
import OffersBidsTab from "./offers-bids-tab";
import SavedTab from "./saved-tab";
import MessagesTab from "./messages-tab";
import DeliveryReviewsTab from "./delivery-reviews-tab";

const TABS: WorkspaceTab[] = [
  { key: "purchases", label: "Purchases" },
  { key: "offers", label: "Offers & bids" },
  { key: "saved", label: "Saved items" },
  { key: "messages", label: "Messages" },
  { key: "delivery", label: "Delivery & reviews" },
];

/**
 * "My buying" — the buyer half of the marketplace-workspaces checkpoint,
 * built on the existing dashboard shell (there is no dashboard layout.tsx to
 * extend, see the other pages under src/app/dashboard/ — every page here is
 * its own freestanding Server Component with its own auth guard, same as
 * this one). One page, five tabs (`?tab=`), same pattern as
 * src/app/dashboard/listings/page.tsx's own tab bar, generalized into
 * WorkspaceTabs. Each tab is its own Server Component doing its own scoped,
 * paginated query — nothing here recomputes a price, a fee, or an order/
 * offer/listing status; every figure and status shown anywhere in this tree
 * is read straight off the row the DB already computed (apply_order_payment_*(),
 * offer_action(), etc.) or via the same pure display helpers the rest of the
 * app already uses (formatPrice, formatTimeRemaining, isOfferActionable,
 * buyerOrderNextAction — never a new parallel calculation).
 */
export default async function BuyingWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; status?: string; offersPage?: string; bidsPage?: string }>;
}) {
  const { tab: tabParam, page: pageParam, status: statusParam, offersPage: offersPageParam, bidsPage: bidsPageParam } =
    await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/buying");

  // Same opportunistic sweep the order detail page runs (see its own
  // comment) — this is the buyer's own hub, so it's exactly the right place
  // to make sure a lapsed reservation shows as 'cancelled' rather than a
  // stale 'pending' that still looks actionable in the Purchases tab.
  await runOfferSweeps();

  const activeTab = TABS.find((t) => t.key === tabParam) ?? TABS[0];
  const page = Math.max(1, Number(pageParam) || 1);

  return (
    <div className="max-w-4xl mx-auto px-6 py-14">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
        </span>
        <h1 className="font-display font-bold text-3xl mt-2.5">My buying</h1>
        <p className="text-ink-500 mt-1">Everything you&apos;re buying, watching or waiting on.</p>
      </div>

      <WorkspaceTabs tabs={TABS} activeKey={activeTab.key} basePath="/dashboard/buying" />

      {activeTab.key === "purchases" && (
        <PurchasesTab userId={user.id} page={page} status={statusParam} />
      )}
      {activeTab.key === "offers" && (
        <OffersBidsTab
          userId={user.id}
          offersPage={Math.max(1, Number(offersPageParam) || 1)}
          bidsPage={Math.max(1, Number(bidsPageParam) || 1)}
        />
      )}
      {activeTab.key === "saved" && <SavedTab userId={user.id} page={page} />}
      {activeTab.key === "messages" && <MessagesTab userId={user.id} page={page} />}
      {activeTab.key === "delivery" && <DeliveryReviewsTab userId={user.id} page={page} />}
    </div>
  );
}
