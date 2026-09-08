import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { canAccess } from "@/lib/admin/roles";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import { listOffers, listAuctions } from "@/lib/admin/queries";
import { auctionEligibleForForceClose } from "@/lib/admin/marketplace";
import {
  OFFER_STATUS_LABELS,
  OFFER_STATUS_STYLES,
  AUCTION_STATUS_LABELS,
  AUCTION_STATUS_STYLES,
  formatDateTime,
  personName,
} from "@/lib/admin/format";
import { formatPrice, formatPriceCents } from "@/lib/format";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";
import ModerationForm from "@/components/admin/moderation-form";
import { forceCloseAuction } from "./actions";

// The other genuine gap this phase closes — see the "Offers & auctions
// history" section comment in src/lib/admin/queries.ts. Offers stay
// read-only (offer_action() already owns that state machine end to end);
// auctions get the one narrow, audited exception this checkpoint adds —
// force-closing an auction stuck past its own end time — rendered inline
// on any eligible row, visible to everyone but only submittable by finance
// roles (the server action re-checks this itself regardless — see
// forceCloseAuction()'s own comment on why this isn't the only check).
export default async function OffersTab({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { staff } = await requireStaff();
  const canForceClose = canAccess(staff, FINANCE_ROLES);

  const offersPage = Number(searchParams.offersPage ?? "1") || 1;
  const auctionsPage = Number(searchParams.auctionsPage ?? "1") || 1;

  const [offers, auctions] = await Promise.all([listOffers({}, offersPage), listAuctions({}, auctionsPage)]);

  return (
    <div>
      <section className="mb-10">
        <h2 className="font-display font-bold text-lg mb-2">Auctions</h2>
        <p className="text-sm text-ink-500 mb-4">
          Most recent first. A row past its own end time and still &ldquo;Live&rdquo;/&ldquo;Scheduled&rdquo; has no
          automatic sweep that closes it — see the force-close action below on any such row.
        </p>
        {auctions.rows.length === 0 ? (
          <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No auctions yet.</p>
        ) : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Listing</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Bids</th>
                  <th className="px-5 py-3">Current high</th>
                  <th className="px-5 py-3">Ends</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {auctions.rows.map((a) => {
                  const stale = auctionEligibleForForceClose(a);
                  return (
                    <tr key={a.id}>
                      <td className="px-5 py-3 font-semibold text-ink-900">
                        {a.listing ? (
                          <Link href={`/admin/listings/${a.listing.id}`} className="hover:underline">
                            {a.listing.title}
                          </Link>
                        ) : (
                          `Listing #${a.listing_id}`
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={a.status} labels={AUCTION_STATUS_LABELS} styles={AUCTION_STATUS_STYLES} />
                        {stale && (
                          <span className="ml-2 text-xs font-bold text-red-600 uppercase tracking-wide">
                            Past end time
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-ink-500">{a.bidCount}</td>
                      <td className="px-5 py-3 text-ink-500">
                        {a.winningBid ? formatPriceCents(a.winningBid.amount_cents) : "—"}
                      </td>
                      <td className="px-5 py-3 text-ink-500">{formatDateTime(a.ends_at)}</td>
                      <td className="px-5 py-3 text-right">
                        {stale && canForceClose ? (
                          <ModerationForm
                            action={forceCloseAuction}
                            idField="auctionId"
                            id={a.id}
                            submitLabel="Force close"
                            pendingLabel="Closing…"
                            tone="danger"
                            placeholder="Reason (recorded in the audit log)"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <AdminPagination
          page={auctionsPage}
          pageSize={auctions.pageSize}
          total={auctions.total}
          hrefForPage={(p) => `/admin/marketplace?tab=offers&auctionsPage=${p}&offersPage=${offersPage}`}
        />
      </section>

      <section>
        <h2 className="font-display font-bold text-lg mb-2">Offers</h2>
        <p className="text-sm text-ink-500 mb-4">
          Read-only — negotiation state is fully enforced server-side and always current on the listing itself.
        </p>
        {offers.rows.length === 0 ? (
          <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No offers yet.</p>
        ) : (
          <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Listing</th>
                  <th className="px-5 py-3">Buyer</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {offers.rows.map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-3 font-semibold text-ink-900">
                      {o.listing ? (
                        <Link href={`/admin/listings/${o.listing.id}`} className="hover:underline">
                          {o.listing.title}
                        </Link>
                      ) : (
                        `Listing #${o.listing_id}`
                      )}
                    </td>
                    <td className="px-5 py-3">{personName(o.buyer)}</td>
                    <td className="px-5 py-3">{formatPrice(o.amount_eur)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={o.status} labels={OFFER_STATUS_LABELS} styles={OFFER_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(o.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <AdminPagination
          page={offersPage}
          pageSize={offers.pageSize}
          total={offers.total}
          hrefForPage={(p) => `/admin/marketplace?tab=offers&offersPage=${p}&auctionsPage=${auctionsPage}`}
        />
      </section>
    </div>
  );
}
