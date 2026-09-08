import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listAuditLog } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";
import { ROLE_LABELS } from "@/lib/admin/roles";

// Same super_admin-only gate as /admin/audit-log itself — this is a summary
// (most recent entries, no filter UI, no keyset pagination) that links to
// the real thing rather than re-implementing its cursor-paginated view.
export default async function AuditTab() {
  await requireStaff({ roles: ["super_admin"] });

  const { rows } = await listAuditLog();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-bold text-lg">Recent admin activity</h2>
        <Link href="/admin/audit-log" className="text-sm underline">
          Open the full audit log →
        </Link>
      </div>
      <p className="text-sm text-ink-500 mb-4">
        Every admin mutation this app makes — here and anywhere else in the console — writes exactly one row here,
        append-only. This is the most recent page only; filter by actor, action, target, or date on the full log.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-6">No admin activity yet.</p>
      ) : (
        <div className="bg-surface border border-line rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3">Actor</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Target</th>
                <th className="px-5 py-3">Outcome</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 20).map((entry) => (
                <tr key={entry.id}>
                  <td className="px-5 py-3">
                    {personName(entry.actor)}{" "}
                    <span className="text-xs text-ink-500">({ROLE_LABELS[entry.actor_role]})</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{entry.action}</td>
                  <td className="px-5 py-3 text-ink-500">
                    {entry.target_type}
                    {entry.target_id ? ` #${entry.target_id}` : ""}
                  </td>
                  <td className="px-5 py-3">
                    <span className={entry.outcome === "success" ? "text-green-700" : "text-red-600"}>
                      {entry.outcome}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
