import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listTeeTimeInvites } from "@/lib/admin/queries";
import { INVITE_STATUS_LABELS, INVITE_STATUS_STYLES, statusLabel } from "@/lib/admin/format";
import { formatClock, formatInviteDate, formatTimeRange } from "@/lib/tee-times";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminTeeTimesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireStaff();
  const { q = "", status = "" } = await searchParams;
  const invites = await listTeeTimeInvites(q, status);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Tee-times</h1>
      <p className="text-ink-500 mb-6">
        {invites.length} {invites.length === 1 ? "invite" : "invites"}
        {status && <> · {statusLabel(INVITE_STATUS_LABELS, status)}</>}.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search club, county, notes, host…"
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="full">Full</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {invites.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No tee-time invites match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Club</th>
                <th className="px-5 py-3 font-semibold">Host</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Interest</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => {
                const hostName = i.host ? `${i.host.first_name} ${i.host.last_name}` : "Unknown host";
                const timeRange =
                  formatTimeRange(i.time_from, i.time_to) ??
                  (i.exact_tee_time ? formatClock(i.exact_tee_time) : null);
                return (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/tee-times/${i.id}`} className="font-semibold text-ink-900 hover:underline">
                        {i.club_name}
                      </Link>
                      {i.county && <div className="text-xs text-ink-500">{i.county}</div>}
                    </td>
                    <td className="px-5 py-3">
                      {i.host ? (
                        <Link href={`/admin/users/${i.host.id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={hostName} color={i.host.avatar_color} />
                          <span className="text-ink-900">{hostName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{hostName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{formatInviteDate(i.play_date)}</td>
                    <td className="px-5 py-3 text-ink-500">{timeRange ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={i.status} labels={INVITE_STATUS_LABELS} styles={INVITE_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-right text-ink-900">{i.interest_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
