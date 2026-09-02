import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getUserDetail } from "@/lib/admin/queries";
import {
  formatDateTime,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  INVITE_STATUS_LABELS,
  INVITE_STATUS_STYLES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_STYLES,
} from "@/lib/admin/format";
import { formatPrice } from "@/lib/format";
import { formatInviteDate } from "@/lib/tee-times";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();

  const { profile, listings, invites, offersMade } = detail;
  const name = `${profile.first_name} ${profile.last_name}`;

  return (
    <div>
      <Link href="/admin/users" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All users
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8 flex flex-wrap items-start gap-5">
        <AdminAvatar name={name} color={profile.avatar_color} size="lg" />
        <div className="flex-1 min-w-[220px]">
          <h1 className="font-display font-bold text-2xl">{name}</h1>
          <p className="text-ink-500">{profile.email ?? "No email on file"}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {profile.home_club && (
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.home_club}
              </span>
            )}
            {profile.county && (
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.county}
              </span>
            )}
            {profile.handicap != null && (
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
                {profile.handicap} hcp{profile.handicap_visible ? "" : " (hidden)"}
              </span>
            )}
            {profile.gui_membership_number && (
              <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
                GUI #{profile.gui_membership_number}
              </span>
            )}
          </div>
          {profile.bio && <p className="text-sm text-ink-500 mt-3 max-w-[60ch]">{profile.bio}</p>}
        </div>
        <div className="text-sm text-ink-500 text-right shrink-0">
          Joined
          <div className="text-ink-900 font-semibold">{formatDateTime(profile.created_at)}</div>
        </div>
      </div>

      <Section title={`Listings (${listings.length})`}>
        {listings.length === 0 ? (
          <EmptyRow>No listings.</EmptyRow>
        ) : (
          <Table headers={["Title", "Price", "Status", "Listed"]}>
            {listings.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <Link href={`/admin/listings/${l.id}`} className="font-semibold text-ink-900 hover:underline">
                    {l.title}
                  </Link>
                </td>
                <td className="px-5 py-3 text-ink-500">{formatPrice(l.price_eur)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={l.status} labels={LISTING_STATUS_LABELS} styles={LISTING_STATUS_STYLES} />
                </td>
                <td className="px-5 py-3 text-ink-500">{formatDateTime(l.created_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={`Tee-time invites hosted (${invites.length})`}>
        {invites.length === 0 ? (
          <EmptyRow>No tee-time invites.</EmptyRow>
        ) : (
          <Table headers={["Club", "Date", "Status", "Spaces"]}>
            {invites.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <Link href={`/admin/tee-times/${i.id}`} className="font-semibold text-ink-900 hover:underline">
                    {i.club_name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-ink-500">{formatInviteDate(i.play_date)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={i.status} labels={INVITE_STATUS_LABELS} styles={INVITE_STATUS_STYLES} />
                </td>
                <td className="px-5 py-3 text-ink-500">{i.spaces_available}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={`Offers made (${offersMade.length})`}>
        {offersMade.length === 0 ? (
          <EmptyRow>No offers made on other listings.</EmptyRow>
        ) : (
          <Table headers={["Listing", "Amount", "Status", "Offered"]}>
            {offersMade.map((o) => (
              <tr key={o.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  {o.listing ? (
                    <Link href={`/admin/listings/${o.listing.id}`} className="font-semibold text-ink-900 hover:underline">
                      {o.listing.title}
                    </Link>
                  ) : (
                    <span className="text-ink-500">Listing removed</span>
                  )}
                </td>
                <td className="px-5 py-3 text-ink-500">{formatPrice(o.amount_eur)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={o.status} labels={OFFER_STATUS_LABELS} styles={OFFER_STATUS_STYLES} />
                </td>
                <td className="px-5 py-3 text-ink-500">{formatDateTime(o.created_at)}</td>
              </tr>
            ))}
          </Table>
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

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
          {headers.map((h) => (
            <th key={h} className="px-5 py-3 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-10 text-ink-500 text-sm">{children}</div>;
}
