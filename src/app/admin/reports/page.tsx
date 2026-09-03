import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listReports } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  REPORT_PRIORITIES,
  REPORT_PRIORITY_LABELS,
  REPORT_PRIORITY_STYLES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  REPORT_TARGET_TYPES,
  REPORT_TARGET_TYPE_LABELS,
  type ReportCategory,
  type ReportPriority,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/admin/reports";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    priority?: string;
    category?: string;
    target?: string;
    targetId?: string; // paired with `target` — links from a listing/user detail page's "Reports" section
    assigned?: string; // a staff user id, "unassigned", or "mine"
    page?: string;
  }>;
}) {
  const { user } = await requireStaff();
  const {
    q = "",
    status = "",
    priority = "",
    category = "",
    target = "",
    targetId = "",
    assigned = "",
    page: pageParam,
  } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  // "mine" resolves against the signed-in staff member's own id here, on the
  // server, rather than the client ever having to know or submit it.
  const assignedFilter = assigned === "mine" ? user.id : assigned || undefined;

  const { rows: reports, total, pageSize } = await listReports(
    q,
    {
      status: (status as ReportStatus) || undefined,
      priority: (priority as ReportPriority) || undefined,
      category: (category as ReportCategory) || undefined,
      targetType: (target as ReportTargetType) || undefined,
      targetId: targetId || undefined,
      assignedAdmin: assignedFilter,
    },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(q || status || priority || category || target || targetId || assigned);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    if (target) params.set("target", target);
    if (targetId) params.set("targetId", targetId);
    if (assigned) params.set("assigned", assigned);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/reports?${qs}` : "/admin/reports";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Reports</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "report" : "reports"}
        {status && <> · {REPORT_STATUS_LABELS[status as ReportStatus] ?? status}</>}
        {q && (
          <>
            {" "}
            matching &ldquo;{q}&rdquo;
          </>
        )}
        .
      </p>

      {targetId && (
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="bg-navy-900 text-cream-50 font-semibold px-3 py-1.5 rounded-full">
            {target ? REPORT_TARGET_TYPE_LABELS[target as ReportTargetType] ?? target : "Target"}: {targetId}
          </span>
          <Link href={pageHref(1).replace(/[?&]targetId=[^&]*/, "")} className="text-ink-500 hover:text-ink-900">
            Clear
          </Link>
        </div>
      )}

      <form className="flex flex-wrap gap-3 mb-6">
        {targetId && <input type="hidden" name="targetId" value={targetId} />}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search description, reporter…"
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All statuses</option>
          {REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REPORT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All priorities</option>
          {REPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {REPORT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={category}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All categories</option>
          {REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {REPORT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          name="target"
          defaultValue={target}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any target type</option>
          {REPORT_TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {REPORT_TARGET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          name="assigned"
          defaultValue={assigned}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Anyone</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/reports"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {reports.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No reports match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Reported</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Reporter</th>
                <th className="px-5 py-3 font-semibold">Priority</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Assigned</th>
                <th className="px-5 py-3 font-semibold">Filed</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const reporterName = r.reporter
                  ? `${r.reporter.first_name} ${r.reporter.last_name}`.trim()
                  : "Unknown member";
                const assignedName = r.assignedStaff
                  ? `${r.assignedStaff.first_name} ${r.assignedStaff.last_name}`.trim()
                  : null;
                return (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/reports/${r.id}`} className="font-semibold text-ink-900 hover:underline">
                        {r.target.label}
                      </Link>
                      <div className="text-xs text-ink-500">{REPORT_TARGET_TYPE_LABELS[r.target_type]}</div>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{REPORT_CATEGORY_LABELS[r.category]}</td>
                    <td className="px-5 py-3">
                      {r.reporter ? (
                        <Link href={`/admin/users/${r.reporter_id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={reporterName} color={r.reporter.avatar_color} />
                          <span className="text-ink-900">{reporterName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{reporterName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge
                        status={r.priority}
                        labels={REPORT_PRIORITY_LABELS}
                        styles={REPORT_PRIORITY_STYLES}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={r.status} labels={REPORT_STATUS_LABELS} styles={REPORT_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{assignedName ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
