import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getSellerAccountDetail, getUserDetail, isUserSuspended, listReports } from "@/lib/admin/queries";
import { canAccess } from "@/lib/admin/roles";
import { FINANCE_ROLES } from "@/lib/admin/finance";
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
import { MEMBER_EDIT_ROLES } from "@/lib/admin/member-profile";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { formatPrice, sellerAccountStatusLabel } from "@/lib/format";
import { formatInviteDate } from "@/lib/tee-times";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import UnavailableCard from "@/components/admin/unavailable-card";
import { REPORT_CATEGORY_LABELS, REPORT_STATUS_LABELS, REPORT_STATUS_STYLES } from "@/lib/admin/reports";
import { listFraudFlagsForTarget } from "@/lib/admin/queries";
import RiskFlagsPanel from "@/components/admin/risk-flags-panel";
import MemberProfileForm from "@/components/admin/member-profile-form";
import FieldsActionForm from "@/components/admin/fields-action-form";
import { loadAgePanel, type AgePanel } from "@/lib/admin/age";
import { BAND_LABELS, isMinorBand } from "@/lib/junior";
import type { StaffRecord } from "@/lib/admin/roles";
import { addUserNote, clearAgeRestriction, correctDateOfBirth, restrictAsUnder18, updateMemberProfile } from "./actions";
import { cancelMemberDeletion } from "../../controls/actions";
import { pendingDeletionFor } from "@/lib/account-deletion";
import RecordPanel from "@/components/admin/controls/record-panel";

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
  const fraudFlags = await listFraudFlagsForTarget("user", id);
  const pendingDeletion = await pendingDeletionFor(id);
  const agePanel = await loadAgePanel(id);

  const { profile, listings, invites, offersMade, notes } = detail;
  const name = `${profile.first_name} ${profile.last_name}`;
  const suspended = isUserSuspended(profile);
  const sellerStatus = sellerStatusLabel(listings);
  // Same reasoning: /admin/payouts itself is gated to FINANCE_ROLES (see
  // src/lib/admin/finance.ts), so a moderator/support staff member shouldn't
  // see a live-looking link into a page requireStaff() would 404 them out of.
  const canViewPayouts = canAccess(staff, FINANCE_ROLES);
  // Same UX-only check: updateMemberProfile() calls requireStaff({ roles:
  // MEMBER_EDIT_ROLES }) itself, so hiding the form here only keeps a
  // moderator from being shown a form that would refuse them.
  const canEditProfile = canAccess(staff, MEMBER_EDIT_ROLES);
  // Deliberately a separate lookup from sellerStatus above — that's about
  // listings (has this member ever sold anything on Pinpals), this is about
  // Stripe Connect payout readiness (can they actually be paid out). See
  // sellerAccountStatusLabel() in src/lib/format.ts for why these stay two
  // distinct concepts rather than merged into one "seller status".
  const payoutAccount = canViewPayouts ? (await getSellerAccountDetail(profile.id))?.account ?? null : null;

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
          {canViewPayouts && (
            <div>
              Payout readiness
              <div className="text-ink-900 font-semibold">
                {payoutAccount ? (
                  // /admin/payouts/[id] 404s when no connected-account row
                  // exists yet (getSellerAccountDetail returns null) — only
                  // link when there's actually something to open.
                  <Link href={`/admin/payouts/${profile.id}`} className="hover:underline">
                    {sellerAccountStatusLabel(payoutAccount)} →
                  </Link>
                ) : (
                  sellerAccountStatusLabel(payoutAccount)
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mb-8">
        <RecordPanel
          staff={staff}
          entity="user"
          id={profile.id}
          state={{ hidden: suspended }}
          title={name}
          stateNote={
            pendingDeletion
              ? `Account deletion requested ${formatDateTime(pendingDeletion.requestedAt)}; the scrub runs from ${formatDateTime(pendingDeletion.scheduledFor)}.`
              : suspended
                ? "Suspended — this member can't sign in."
                : null
          }
        />
        {pendingDeletion && canAccess(staff, ["super_admin"]) && (
          <div className="bg-surface border border-line rounded-2xl p-5 mt-4">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-3">Cancel the deletion</h2>
            <ModerationForm
              action={cancelMemberDeletion}
              idField="id"
              id={profile.id}
              submitLabel="Cancel deletion"
              pendingLabel="Cancelling…"
              placeholder="Why the deletion is being cancelled (recorded in the audit log)"
            />
          </div>
        )}
      </div>

      {agePanel && (
        <Section title="Age" id="age">
          <AgeSection panel={agePanel} userId={profile.id} staff={staff} />
        </Section>
      )}

      {canEditProfile && (
        <Section title="Member details" id="edit">
          <MemberProfileForm
            action={updateMemberProfile}
            userId={profile.id}
            defaultValues={{
              first: profile.first_name,
              last: profile.last_name,
              club: profile.home_club ?? "",
              clubId: profile.home_club_id,
              country: profile.country ?? "",
              county: profile.county ?? "",
              // A string because the input is uncontrolled and "" is the only
              // way to render "not set" — 0 is a real handicap.
              handicap: profile.handicap == null ? "" : String(profile.handicap),
              handicapVisible: profile.handicap_visible,
              bio: profile.bio ?? "",
              guiNumber: profile.gui_membership_number ?? "",
            }}
          />
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
                <td className="px-5 py-3 text-ink-500">{l.price_eur !== null ? formatPrice(l.price_eur) : "Auction"}</td>
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

      <RiskFlagsPanel targetType="user" targetId={id} flags={fraudFlags} staff={staff} />

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

function Section({ title, children, id }: { title: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div className="mb-8 scroll-mt-6" id={id}>
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

/**
 * Junior members (0159): the facts behind this member's age band, and the
 * three things staff can do about it. Restrict / clear go to any staff role
 * admin_set_age_flag() allows; a date correction to admins only (it decides
 * what the member may do). All three are audited (./actions.ts).
 */
function AgeSection({ panel, userId, staff }: { panel: AgePanel; userId: string; staff: StaffRecord }) {
  const flagOpen = !!panel.flag && !panel.flag.resolvedAt;
  const canFlag = canAccess(staff, ["support", "moderator", "admin", "super_admin"]);
  const canCorrect = canAccess(staff, ["admin", "super_admin"]);
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs font-bold text-ink-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-ink-900 mt-0.5">{value}</dd>
    </div>
  );

  return (
    <div className="p-5 grid gap-5">
      <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {fact("Date of birth", panel.dateOfBirth ?? "Not given")}
        {fact("Age", panel.age ?? "—")}
        {fact(
          "Band",
          <span className={isMinorBand(panel.band) ? "font-bold text-red-600" : ""}>{BAND_LABELS[panel.band]}</span>
        )}
        {fact(
          "Parent link",
          panel.parentLink ? (
            <>
              {panel.parentLink.status}
              {panel.parentLink.guardianId ? (
                <>
                  {" · "}
                  <Link href={`/admin/users/${panel.parentLink.guardianId}`} className="font-semibold hover:underline">
                    {panel.parentLink.guardianName ?? "Parent"}
                  </Link>
                </>
              ) : null}
              <div className="text-xs text-ink-500">
                Asked {panel.parentLink.email} · {formatDateTime(panel.parentLink.invitedAt)}
                {panel.parentLink.approvedAt ? ` · approved ${formatDateTime(panel.parentLink.approvedAt)}` : ""}
                {panel.parentLink.cardCheckedAt ? " · card checked" : ""}
              </div>
            </>
          ) : (
            "None"
          )
        )}
      </dl>

      {panel.children.length > 0 && (
        <p className="text-sm text-ink-500">
          Parent of{" "}
          {panel.children.map((c, i) => (
            <span key={c.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/admin/users/${c.id}`} className="font-semibold text-ink-900 hover:underline">
                {c.name}
              </Link>{" "}
              ({c.status})
            </span>
          ))}
        </p>
      )}

      {panel.flag && (
        <div className={`rounded-xl px-4 py-3 text-sm ${flagOpen ? "bg-red-100 text-red-700" : "bg-cream-100 text-ink-700"}`}>
          <strong>{flagOpen ? "Restricted as under 18, pending review" : "Restriction cleared"}</strong>
          {" · "}
          {panel.flag.reason === "store_signal" ? "app store signal" : panel.flag.reason}
          {" · "}
          {formatDateTime(panel.flag.createdAt)}
          {panel.flag.resolvedAt ? ` · cleared ${formatDateTime(panel.flag.resolvedAt)}` : ""}
          {panel.flag.note && <p className="mt-1 whitespace-pre-wrap">{panel.flag.note}</p>}
        </div>
      )}

      {panel.storeSignal && (
        <p className="text-sm text-ink-500">
          App store ({panel.storeSignal.platform}) says {panel.storeSignal.lower ?? "?"}–{panel.storeSignal.upper ?? "?"}
          {panel.storeSignal.status ? ` (${panel.storeSignal.status})` : ""} · {formatDateTime(panel.storeSignal.receivedAt)}
        </p>
      )}

      {canFlag && (
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-2">
              {flagOpen ? "Clear the restriction" : "Restrict as under 18 pending review"}
            </h3>
            <ModerationForm
              action={flagOpen ? clearAgeRestriction : restrictAsUnder18}
              idField="userId"
              id={userId}
              submitLabel={flagOpen ? "Clear" : "Restrict as under 18"}
              pendingLabel="Saving…"
              tone={flagOpen ? "default" : "danger"}
              placeholder={flagOpen ? "How their age was checked (recorded in the audit log)" : "Why (recorded in the audit log, shown to staff)"}
            />
          </div>
          {canCorrect && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-2">Correct date of birth</h3>
              <FieldsActionForm action={correctDateOfBirth} submitLabel="Save date" pendingLabel="Saving…" className="grid gap-2">
                <input type="hidden" name="userId" value={userId} />
                <input type="date" name="dob" required defaultValue={panel.dateOfBirth ?? ""} className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface" />
                <textarea name="reason" required rows={2} placeholder="Why, and how it was checked (recorded in the audit log)" className="w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface" />
              </FieldsActionForm>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
