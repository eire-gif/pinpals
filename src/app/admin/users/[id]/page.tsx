import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getUserDetail, isUserSuspended, listReports } from "@/lib/admin/queries";
import { canAccess } from "@/lib/admin/roles";
import {
  formatDateTime,
  LISTING_STATUS_LABELS,
  LISTING_STATUS_STYLES,
  INVITE_STATUS_LABELS,
  INVITE_STATUS_STYLES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_STYLES,
  sellerStatusLabel,
} from "@/lib/admin/format";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { formatPrice } from "@/lib/format";
import { formatInviteDate } from "@/lib/tee-times";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import UnavailableCard from "@/components/admin/unavailable-card";
import { REPORT_CATEGORY_LABELS, REPORT_STATUS_LABELS, REPORT_STATUS_STYLES } from "@/lib/admin/reports";
import { suspendUser, reinstateUser, addUserNote } from "./actions";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { staff } = await requireStaff();
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) notFound();

  // Separate from getUserDetail() the same way listListings(seller: ...) is
  // a separate query from getUserDetail() elsewhere — one page's worth of
  // reports against this member, not a full-table fetch. First page only:
  // this section is a summary, not the queue itself — see the "Open in
  // Reports →" link for the full filtered view.
  const { rows: reportsAboutThem, total: reportsAboutThemTotal } = await listReports(
    "",
    { targetType: "user", targetId: id },
    1
  );

  const { profile, listings, invites, offersMade, notes } = detail;
  const name = `${profile.first_name} ${profile.last_name}`;
  const suspended = isUserSuspended(profile);
  const sellerStatus = sellerStatusLabel(listings);
  // A UX nicety only — canAccess() re-checks this server-side inside
  // suspendUser()/reinstateUser() themselves, which is the real boundary.
  const canModerate = canAccess(staff, MODERATION_ROLES);

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
            {suspended && (
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
                Suspended
              </span>
            )}
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
        <div className="text-sm text-ink-500 text-right shrink-0 space-y-2">
          <div>
            Account status
            <div className={`font-semibold ${suspended ? "text-red-600" : "text-green-700"}`}>
              {suspended ? "Suspended" : "Active"}
            </div>
          </div>
          <div>
            Joined
            <div className="text-ink-900 font-semibold">{formatDateTime(profile.created_at)}</div>
          </div>
          <div>
            Seller status
            <div className="text-ink-900 font-semibold">{sellerStatus}</div>
          </div>
        </div>
      </div>

      {canModerate && (
        <Section title="Moderation">
          <div className="p-5">
            {suspended ? (
              <ModerationForm
                action={reinstateUser}
                idField="userId"
                id={profile.id}
                submitLabel="Reinstate"
                pendingLabel="Reinstating…"
                placeholder="Reason for reinstating (recorded in the audit log)"
              />
            ) : (
              <ModerationForm
                action={suspendUser}
                idField="userId"
                id={profile.id}
                submitLabel="Suspend"
                pendingLabel="Suspending…"
                tone="danger"
                placeholder="Reason for suspending (recorded in the audit log)"
              />
            )}
          </div>
        </Section>
      )}

      <Section
        title={
          <div className="flex items-center justify-between gap-3">
            <span>Listings ({listings.length})</span>
            {listings.length > 0 && (
              <Link
                href={`/admin/listings?seller=${profile.id}`}
                className="text-xs font-semibold text-ink-500 hover:text-ink-900 normal-case tracking-normal"
              >
                Open in Listings →
              </Link>
            )}
          </div>
        }
      >
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

      <Section title="Orders">
        <div className="p-5">
          <UnavailableCard
            label="Orders"
            reason="No orders table exists yet — the marketplace is offer-negotiation only, with no payment step."
          />
        </div>
      </Section>

      <Section
        title={
          <div className="flex items-center justify-between gap-3">
            <span>Reports involving this member ({reportsAboutThemTotal})</span>
            {reportsAboutThemTotal > 0 && (
              <Link
                href={`/admin/reports?target=user&targetId=${profile.id}`}
                className="text-xs font-semibold text-ink-500 hover:text-ink-900 normal-case tracking-normal"
              >
                Open in Reports →
              </Link>
            )}
          </div>
        }
      >
        {reportsAboutThem.length === 0 ? (
          <EmptyRow>No reports filed against this member.</EmptyRow>
        ) : (
          <Table headers={["Category", "Reporter", "Priority", "Status", "Filed"]}>
            {reportsAboutThem.map((r) => {
              const rowReporterName = r.reporter
                ? `${r.reporter.first_name} ${r.reporter.last_name}`.trim()
                : "Unknown member";
              return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/admin/reports/${r.id}`} className="font-semibold text-ink-900 hover:underline">
                      {REPORT_CATEGORY_LABELS[r.category]}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{rowReporterName}</td>
                  <td className="px-5 py-3 text-ink-500">{r.priority}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={r.status} labels={REPORT_STATUS_LABELS} styles={REPORT_STATUS_STYLES} />
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(r.created_at)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Section>

      <Section title={`Internal notes (${notes.length})`}>
        <div className="p-5 border-b border-line">
          {/* Any active staff member can add a note — see the comment on
              addUserNote() in ./actions.ts for why this isn't gated to
              MODERATION_ROLES the way suspend/reinstate above is. */}
          <ModerationForm
            action={addUserNote}
            idField="userId"
            id={profile.id}
            fieldName="note"
            submitLabel="Add note"
            pendingLabel="Saving…"
            placeholder="Add an internal note about this member — visible to all staff"
          />
        </div>
        {notes.length === 0 ? (
          <EmptyRow>No notes yet.</EmptyRow>
        ) : (
          <ul>
            {notes.map((n) => {
              const authorName = n.author
                ? `${n.author.first_name} ${n.author.last_name}`.trim()
                : "Unknown staff member";
              return (
                <li key={n.id} className="px-5 py-4 border-b border-line last:border-0">
                  <div className="flex items-center gap-2.5 mb-2">
                    <AdminAvatar name={authorName} color={n.author?.avatar_color ?? null} size="sm" />
                    <div className="text-sm">
                      <span className="font-semibold text-ink-900">{authorName}</span>
                      <span className="text-ink-500"> · {ROLE_LABELS[n.author_role]}</span>
                      <span className="text-ink-500"> · {formatDateTime(n.created_at)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-ink-900 whitespace-pre-wrap">{n.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
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
