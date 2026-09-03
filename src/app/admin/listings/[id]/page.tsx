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
import { ROLE_LABELS } from "@/lib/admin/roles";
import { formatPrice } from "@/lib/format";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import UnavailableCard from "@/components/admin/unavailable-card";
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

  const { listing, seller, offers, moderationHistory } = detail;
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

      {/* Sensitive seller data stays minimized here — name, club/county, and
          a link to the full profile, not email/handicap/GUI number. Staff
          who need those for this member specifically are one click away on
          /admin/users/[id], which is the right place for them (its own
          moderation actions, notes, and full activity live there), rather
          than duplicated on every listing they've ever posted. */}
      <Section title="Seller">
        {seller ? (
          <div className="flex items-center justify-between gap-3 p-5 flex-wrap">
            <Link href={`/admin/users/${seller.id}`} className="flex items-center gap-3">
              <AdminAvatar name={sellerName} color={seller.avatar_color} />
              <div>
                <div className="font-semibold text-ink-900">{sellerName}</div>
                <div className="text-sm text-ink-500">
                  {[seller.home_club, seller.county].filter(Boolean).join(" · ") || "No club/county on file"}
                </div>
              </div>
            </Link>
            <Link
              href={`/admin/listings?seller=${seller.id}`}
              className="text-xs font-semibold text-ink-500 hover:text-ink-900 whitespace-nowrap"
            >
              All listings by this seller →
            </Link>
          </div>
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

      <Section title="Reports">
        <div className="p-5">
          <UnavailableCard
            label="Reports on this listing"
            reason="No reporting/flagging mechanism exists yet — nothing for members to report with."
          />
        </div>
      </Section>

      <Section title={`Moderation history (${moderationHistory.length})`}>
        {moderationHistory.length === 0 ? (
          <EmptyRow>No moderation actions have been taken on this listing.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold">Staff member</th>
                <th className="px-5 py-3 font-semibold">Action</th>
                <th className="px-5 py-3 font-semibold">Reason</th>
                <th className="px-5 py-3 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {moderationHistory.map((entry) => {
                const actorName = entry.actor
                  ? `${entry.actor.first_name} ${entry.actor.last_name}`.trim()
                  : "Unknown staff member";
                return (
                  <tr key={entry.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 text-ink-500 whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <AdminAvatar name={actorName} color={entry.actor?.avatar_color ?? null} />
                        <div>
                          <div className="font-semibold text-ink-900">{actorName}</div>
                          <div className="text-xs text-ink-500">{ROLE_LABELS[entry.actor_role]}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-900">{entry.action}</td>
                    <td className="px-5 py-3 text-ink-500 max-w-[28ch] truncate" title={entry.reason ?? undefined}>
                      {entry.reason ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          entry.outcome === "success"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-600"
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
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
