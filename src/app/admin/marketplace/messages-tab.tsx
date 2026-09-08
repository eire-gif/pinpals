import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import { listReports, type AdminReportListItem } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";

// Reported messages get their own tab per the task, but deliberately NOT
// their own content-viewing surface — that already exists, and is
// carefully built: ConversationAccessPanel on /admin/reports/[id] requires
// a typed reason before any message content loads, bounds how much history
// it shows, and writes a fresh conversation.access_viewed audit row on
// every single reveal (see src/app/admin/reports/[id]/conversation-access-panel.tsx
// and the ADMIN_ACTIONS comment on that entry). This tab reuses that
// mechanism by linking into it — it never shows a message body itself, and
// never adds a second way to browse a conversation, which would undermine
// the whole point of that access model. gated MODERATION_ROLES, same as
// the actions that mechanism lives behind.
export default async function MessagesTab() {
  await requireStaff({ roles: MODERATION_ROLES });

  const [messageReports, conversationReports] = await Promise.all([
    listReports("", { targetType: "message", status: "open" }),
    listReports("", { targetType: "conversation", status: "open" }),
  ]);

  const rows: AdminReportListItem[] = [...messageReports.rows, ...conversationReports.rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Reported messages</h2>
        <Link href="/admin/reports" className="text-sm underline">
          View all reports →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Open reports against a message or conversation. Content is never shown here — open a report to enter a
        reason and reveal it, exactly as on the Reports page.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">
          No open reports about messages right now.
        </p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Reported by</th>
                <th className="px-5 py-3">Target</th>
                <th className="px-5 py-3">Category</th>
                <th className="px-5 py-3">Reported</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3">{personName(r.reporter)}</td>
                  <td className="px-5 py-3 text-ink-500">{r.target.label}</td>
                  <td className="px-5 py-3 text-ink-500">{r.category}</td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(r.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/reports/${r.id}`} className="text-sm underline">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
