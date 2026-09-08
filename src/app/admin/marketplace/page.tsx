import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import type { StaffRole } from "@/lib/admin/roles";
import { canAccess } from "@/lib/admin/roles";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import OverviewTab from "./overview-tab";
import ListingsTab from "./listings-tab";
import SellersTab from "./sellers-tab";
import OrdersTab from "./orders-tab";
import PaymentsTab from "./payments-tab";
import OffersTab from "./offers-tab";
import DisputesTab from "./disputes-tab";
import MessagesTab from "./messages-tab";
import AuditTab from "./audit-tab";

// /admin/marketplace — a consolidated marketplace console. Deliberately a
// single route with a `?tab=` switch (same pattern as /dashboard/buying and
// /dashboard/selling — see src/components/dashboard/workspace-tabs.tsx),
// not nine separate route segments: every tab here is either a thin,
// curated "needs attention" slice of an existing list function or a
// genuinely new read (offers/auctions history, disputes queue), and none of
// them needs its own URL to be independently bookmarkable/linkable the way
// a full moderation surface like /admin/orders does — this page's whole
// job is to be the one place a marketplace-focused admin starts their day,
// then drill through to the existing dedicated pages for anything that
// needs deeper search/filter/action UI.
//
// Security note, matching every other /admin page's own comment: the tab
// dispatch below does NOT trust a shared top-level role check for the
// whole route. requireStaff() here only proves "some active staff member is
// signed in" — each tab component calls requireStaff({ roles }) again,
// itself, with the roles that specific tab's data actually needs (see
// src/lib/admin/authorization.ts's own file-header comment on why "close to
// the data operation" matters more than a single layout-level gate). A
// support/moderator-only staff member hitting ?tab=payments gets exactly
// the same 404 requireStaff() gives anywhere else in this app, not a
// silently-empty tab.

export type MarketplaceTabKey =
  | "overview"
  | "listings"
  | "sellers"
  | "orders"
  | "payments"
  | "offers"
  | "disputes"
  | "messages"
  | "audit";

const TABS: { key: MarketplaceTabKey; label: string; roles?: readonly StaffRole[] }[] = [
  { key: "overview", label: "Overview" },
  { key: "listings", label: "Listings" },
  { key: "sellers", label: "Sellers", roles: FINANCE_ROLES },
  { key: "orders", label: "Orders", roles: FINANCE_ROLES },
  { key: "payments", label: "Payments", roles: FINANCE_ROLES },
  { key: "offers", label: "Offers & auctions" },
  { key: "disputes", label: "Disputes & support", roles: FINANCE_ROLES },
  { key: "messages", label: "Reported messages", roles: MODERATION_ROLES },
  { key: "audit", label: "Audit log", roles: ["super_admin"] },
];

function isTabKey(value: string): value is MarketplaceTabKey {
  return TABS.some((t) => t.key === value);
}

export default async function AdminMarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { staff } = await requireStaff();
  const params = await searchParams;
  const tab: MarketplaceTabKey = isTabKey(params.tab ?? "") ? (params.tab as MarketplaceTabKey) : "overview";

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-2">Marketplace</h1>
      <p className="text-ink-500 mb-6">
        Listings, sellers, orders, payments, offers, auctions, disputes, and reported messages — one console for the
        marketplace, most of it linking straight into the dedicated page for that data. Every mutation here (and
        everywhere it links to) is audited in{" "}
        <Link href="/admin/audit-log" className="underline">
          the audit log
        </Link>
        .
      </p>

      <div className="flex gap-1.5 border-b border-line mb-6 overflow-x-auto">
        {TABS.filter((t) => !t.roles || canAccess(staff, t.roles)).map((t) => (
          <Link
            key={t.key}
            href={`/admin/marketplace?tab=${t.key}`}
            className={`shrink-0 px-4 py-2.5 text-sm font-bold border-b-2 transition ${
              t.key === tab ? "border-green-700 text-green-700" : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "listings" && <ListingsTab searchParams={params} />}
      {tab === "sellers" && <SellersTab searchParams={params} />}
      {tab === "orders" && <OrdersTab searchParams={params} />}
      {tab === "payments" && <PaymentsTab searchParams={params} />}
      {tab === "offers" && <OffersTab searchParams={params} />}
      {tab === "disputes" && <DisputesTab searchParams={params} />}
      {tab === "messages" && <MessagesTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}
