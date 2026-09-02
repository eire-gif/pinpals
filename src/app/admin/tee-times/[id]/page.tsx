import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getTeeTimeInviteDetail } from "@/lib/admin/queries";
import { canAccess } from "@/lib/admin/roles";
import {
  formatDateTime,
  INVITE_STATUS_LABELS,
  INVITE_STATUS_STYLES,
  INVITE_INTEREST_STATUS_LABELS,
  INVITE_INTEREST_STATUS_STYLES,
} from "@/lib/admin/format";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import { formatClock, formatInviteDate, formatTimeRange } from "@/lib/tee-times";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import { cancelInvite, restoreInvite } from "./actions";

export default async function AdminTeeTimeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { staff } = await requireStaff();
  const { id } = await params;
  const inviteId = Number(id);
  if (!inviteId || Number.isNaN(inviteId)) notFound();

  const detail = await getTeeTimeInviteDetail(inviteId);
  if (!detail) notFound();

  const { invite, host, interests } = detail;
  const hostName = host ? `${host.first_name} ${host.last_name}` : "Unknown host";
  const canModerate = canAccess(staff, MODERATION_ROLES);
  const timeRange =
    formatTimeRange(invite.time_from, invite.time_to) ??
    (invite.exact_tee_time ? formatClock(invite.exact_tee_time) : null);

  return (
    <div>
      <Link href="/admin/tee-times" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All tee-times
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-2xl">{invite.club_name}</h1>
            <p className="text-ink-500 mt-1">
              {formatInviteDate(invite.play_date)}
              {timeRange && <> · {timeRange}</>}
            </p>
          </div>
          <StatusBadge status={invite.status} labels={INVITE_STATUS_LABELS} styles={INVITE_STATUS_STYLES} />
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {invite.county && (
            <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">{invite.county}</span>
          )}
          <span className="bg-cream-100 text-xs font-bold px-2.5 py-1 rounded-full">
            {invite.spaces_available} {invite.spaces_available === 1 ? "space" : "spaces"}
          </span>
          {invite.handicap_limit != null && (
            <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
              Handicap limit {invite.handicap_limit}
            </span>
          )}
          {invite.has_tee_time_booked && (
            <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
              Tee time booked
            </span>
          )}
        </div>

        {invite.notes && <p className="text-sm text-ink-500 mt-4 max-w-[60ch]">{invite.notes}</p>}

        <div className="text-xs text-ink-500 mt-4 flex gap-4 flex-wrap">
          <span>Created {formatDateTime(invite.created_at)}</span>
          <span>Expires {formatDateTime(invite.expires_at)}</span>
        </div>
      </div>

      {canModerate && (invite.status === "cancelled" || invite.status === "open" || invite.status === "full") && (
        <Section title="Moderation">
          <div className="p-5">
            {invite.status === "cancelled" ? (
              <ModerationForm
                action={restoreInvite}
                idField="inviteId"
                id={invite.id}
                submitLabel="Restore"
                pendingLabel="Restoring…"
                placeholder="Reason for restoring (recorded in the audit log)"
              />
            ) : (
              <ModerationForm
                action={cancelInvite}
                idField="inviteId"
                id={invite.id}
                submitLabel="Cancel"
                pendingLabel="Cancelling…"
                tone="danger"
                placeholder="Reason for cancelling (recorded in the audit log)"
              />
            )}
          </div>
        </Section>
      )}

      <Section title="Host">
        {host ? (
          <Link href={`/admin/users/${host.id}`} className="flex items-center gap-3 p-5">
            <AdminAvatar name={hostName} color={host.avatar_color} />
            <div>
              <div className="font-semibold text-ink-900">{hostName}</div>
              <div className="text-sm text-ink-500">{host.email ?? "No email on file"}</div>
            </div>
          </Link>
        ) : (
          <EmptyRow>Host account no longer exists.</EmptyRow>
        )}
      </Section>

      <Section title={`Interested members (${interests.length})`}>
        {interests.length === 0 ? (
          <EmptyRow>No one has expressed interest yet.</EmptyRow>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Member</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Requested</th>
              </tr>
            </thead>
            <tbody>
              {interests.map((interest) => {
                const memberName = interest.member
                  ? `${interest.member.first_name} ${interest.member.last_name}`
                  : "Unknown member";
                return (
                  <tr key={interest.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      {interest.member ? (
                        <Link href={`/admin/users/${interest.member.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={memberName} color={interest.member.avatar_color} />
                          <span className="text-ink-900">{memberName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{memberName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge
                        status={interest.status}
                        labels={INVITE_INTEREST_STATUS_LABELS}
                        styles={INVITE_INTEREST_STATUS_STYLES}
                      />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatDateTime(interest.created_at)}</td>
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
