import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Listing, ListingStatus } from "@/lib/types";
import { formatPrice, SELLER_LISTING_STATUS_LABELS, SELLER_LISTING_STATUS_STYLES } from "@/lib/format";

/** The five tabs the task spec asks for. `pending_review` and `expired`
 * exist in the DB enum (0035) but nothing in this codebase currently ever
 * sets a listing to either one (there's no moderation-review queue or
 * auto-expiry job yet) — rather than give them their own tabs for a state no
 * listing can actually be in today, they fold into the tab they're closest
 * to in meaning (pending_review -> Draft, both "not live yet"; expired ->
 * Removed, both "no longer available") so a listing is never simply
 * invisible here if one of those job/queue features lands later. The card
 * itself always shows its real status via SELLER_LISTING_STATUS_LABELS, so
 * a folded-in listing is never mislabeled even though it shares a tab.
 */
const TABS: { key: string; label: string; statuses: ListingStatus[] }[] = [
  { key: "draft", label: "Draft", statuses: ["draft", "pending_review"] },
  { key: "active", label: "Active", statuses: ["active"] },
  { key: "reserved", label: "Reserved", statuses: ["reserved"] },
  { key: "sold", label: "Sold", statuses: ["sold"] },
  { key: "removed", label: "Removed", statuses: ["removed", "expired"] },
];

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // listing_is_visible() (0045) already lets a seller read every one of
  // their own listings regardless of status — this is the one query on
  // the same predicate every other marketplace page relies on, just scoped
  // to seller_id = the viewer themselves rather than "is this publicly
  // visible or mine".
  const { data } = await supabase
    .from("listings")
    .select("*")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .returns<Listing[]>();

  const listings = data ?? [];
  const activeTab = TABS.find((t) => t.key === tabParam) ?? TABS[0];
  const tabListings = listings.filter((l) => activeTab.statuses.includes(l.status));

  return (
    <div className="max-w-4xl mx-auto px-6 py-14">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Marketplace
          </span>
          <h1 className="font-display font-bold text-3xl mt-2.5">My listings</h1>
        </div>
        <Link
          href="/marketplace/new"
          className="px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
        >
          List an item
        </Link>
      </div>

      <div className="flex gap-1.5 border-b border-line mb-6 overflow-x-auto">
        {TABS.map((t) => {
          const count = listings.filter((l) => t.statuses.includes(l.status)).length;
          const isActive = t.key === activeTab.key;
          return (
            <Link
              key={t.key}
              href={`/dashboard/listings?tab=${t.key}`}
              className={`shrink-0 px-4 py-2.5 text-sm font-bold border-b-2 transition ${
                isActive
                  ? "border-green-700 text-green-700"
                  : "border-transparent text-ink-500 hover:text-ink-900"
              }`}
            >
              {t.label} <span className="text-xs font-semibold text-ink-500">({count})</span>
            </Link>
          );
        })}
      </div>

      {tabListings.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl p-10 text-center">
          <p className="text-ink-500">
            {activeTab.key === "draft"
              ? "No drafts yet — start a listing and save it here whenever you're ready."
              : `You don't have any ${activeTab.label.toLowerCase()} listings.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {tabListings.map((listing) => (
            <div
              key={listing.id}
              className="flex items-center gap-4 bg-surface border border-line rounded-xl p-4"
            >
              <div className="relative w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-tint">
                {listing.image_url ? (
                  <Image src={listing.image_url} alt="" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-ink-500">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/marketplace/${listing.id}`} className="font-bold text-ink-900 hover:underline truncate">
                    {listing.title}
                  </Link>
                  <span
                    className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0 ${SELLER_LISTING_STATUS_STYLES[listing.status]}`}
                  >
                    {SELLER_LISTING_STATUS_LABELS[listing.status]}
                  </span>
                </div>
                <p className="text-sm text-ink-500 mt-0.5">
                  {listing.price_eur !== null ? formatPrice(listing.price_eur) : "Auction"} · {listing.category}
                </p>
              </div>

              <div className="flex gap-2 shrink-0">
                <Link
                  href={`/marketplace/${listing.id}`}
                  className="px-3.5 py-2 rounded-full text-xs font-bold border-[1.5px] border-line text-ink-900 hover:bg-cream-100 transition"
                >
                  {listing.status === "draft" || listing.status === "pending_review" ? "Preview" : "View"}
                </Link>
                {listing.status !== "removed" && (
                  <Link
                    href={`/marketplace/${listing.id}/edit`}
                    className="px-3.5 py-2 rounded-full text-xs font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-100 transition"
                  >
                    Edit
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
