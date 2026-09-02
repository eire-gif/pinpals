import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getListingDetail } from "@/lib/admin/queries";
import { canAccess } from "@/lib/admin/roles";
import {
  formatDateTime,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_STYLES,
} from "@/lib/admin/format";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import { formatPrice } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import { hideListing, restoreListing } from "./actions";

export default async function AdminListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { staff } = await requireStaff();
  const { id } = await params;
  const listingId = Number(id);
  if (!listingId || Number.isNaN(listingId)) notFound();

  const detail = await getListingDetail(listingId);
  if (!detail) notFound();

  const { listing, seller, offers } = detail;
  const sellerName = seller ? `${seller.first_name} ${seller.last_name}` : "Unknown seller";
  const canModerate = canAccess(staff, MODERATION_ROLES);

  return (
    <div>
      <Link href="/admin/listings" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All listings
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8 grid md:grid-cols-[220px_1fr] gap-6">
        <div className="relative h-40 rounded-xl overflow-hidden bg-surface-tint border border-line">
          {listing.image_url ? (
            <Image src={listing.image_url} alt={listing.title} fill className="object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-500 text-xs">
              No image
            </div>
          )}
        </div>

        <div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <span className="text-[11.5px] uppercase tracking-wider text-green-700 font-bold">
                {listing.category}
              </span>
              <h1 className="font-display font-bold text-2xl mt-1">{listing.title}</h1>
            </div>
            <StatusBadge status={listing.status} labels={LISTING_STATUS_LABELS} styles={LISTING_STATUS_STYLES} />
          </div>

          <p className="font-display font-bold text-xl text-gold-600 mt-2">
            {formatPrice(listing.price_eur)}
          </p>

          <div className="flex flex-wrap gap-2 mt-3">
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
              {listing.condition}
            </span>
            {listing.county && (
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {listing.county}
              </span>
            )}
          </div>

          {listing.description && (
            <p className="text-sm text-ink-500 mt-4 max-w-[60ch]">{listing.description}</p>
          )}

          <p className="text-xs text-ink-500 mt-4">Listed {formatDateTime(listing.created_at)}</p>
        </div>
      </div>

      {canModerate && (listing.status === "active" || listing.status === "removed") && (
        <Section title="Moderation">
          <div className="p-5">
            {listing.status === "removed" ? (
              <ModerationForm
                action={restoreListing}
                idField="listingId"
                id={listing.id}
                submitLabel="Restore"
                pendingLabel="Restoring…"
                placeholder="Reason for restoring (recorded in the audit log)"
              />
            ) : (
              <ModerationForm
                action={hideListing}
                idField="listingId"
                id={listing.id}
                submitLabel="Hide"
                pendingLabel="Hiding…"
                tone="danger"
                placeholder="Reason for hiding (recorded in the audit log)"
              />
            )}
          </div>
        </Section>
      )}

      <Section title="Seller">
        {seller ? (
          <Link href={`/admin/users/${seller.id}`} className="flex items-center gap-3 p-5">
            <AdminAvatar name={sellerName} color={seller.avatar_color} />
            <div>
              <div className="font-semibold text-ink-900">{sellerName}</div>
              <div className="text-sm text-ink-500">{seller.email ?? "No email on file"}</div>
            </div>
          </Link>
        ) : (
          <EmptyRow>Seller account no longer exists.</EmptyRow>
        )}
      </Section>

      <Section title={`Offers (${offers.length})`}>
        {offers.length === 0 ? (
          <EmptyRow>No offers on this listing yet.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Buyer</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Offered</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const buyerName = o.buyer ? `${o.buyer.first_name} ${o.buyer.last_name}` : "Unknown buyer";
                return (
                  <tr key={o.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      {o.buyer ? (
                        <Link href={`/admin/users/${o.buyer.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={buyerName} color={o.buyer.avatar_color} />
                          <span className="text-ink-900">{buyerName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{buyerName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-semibold text-ink-900">{formatPrice(o.amount_eur)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={o.status} labels={OFFER_STATUS_LABELS} styles={OFFER_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(o.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-10 text-ink-500 text-sm">{children}</div>;
}
