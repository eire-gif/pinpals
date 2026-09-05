import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listSupportCases } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import {
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_CATEGORY_LABELS,
  SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_STYLES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_STATUS_STYLES,
  type SupportCaseCategory,
  type SupportCasePriority,
  type SupportCaseStatus,
} from "@/lib/admin/support-cases";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";

export default async function AdminSupportCasesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    priority?: string;
    category?: string;
    assigned?: string; // a staff user id, "unassigned", or "mine"
    page?: string;
  }>;
}) {
  const { user } = await requireStaff();
  const { q = "", status = "", priority = "", category = "", assigned = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  // "mine" resolves against the signed-in staff member's own id here, on the
  // server, rather than the client ever having to know or submit it.
  const assignedFilter = assigned === "mine" ? user.id : assigned || undefined;

  const { rows: cases, total, pageSize } = await listSupportCases(
    q,
    {
      status: (status as SupportCaseStatus) || undefined,
      priority: (priority as SupportCasePriority) || undefined,
      category: (category as SupportCaseCategory) || undefined,
      assignedAdmin: assignedFilter,
    },
    page
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(q || status || priority || category || assigned);

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    if (assigned) params.set("assigned", assigned);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h1 className="font-display font-bold text-2xl">Support cases</h1>
        <Link
          href="/admin/support/new"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          New case
        </Link>
      </div>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "case" : "cases"}
        {status && <> · {SUPPORT_CASE_STATUS_LABELS[status as SupportCaseStatus] ?? status}</>}
        {q && (
          <>
            {" "}
            matching &ldquo;{q}&rdquo;
          </>
        )}
        .
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search subject, description, member…"
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All statuses</option>
          {SUPPORT_CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SUPPORT_CASE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All priorities</option>
          {SUPPORT_CASE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SUPPORT_CASE_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={category}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All categories</option>
          {SUPPORT_CASE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SUPPORT_CASE_CATEGORY_LABELS[c]}
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
            href="/admin/support"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {cases.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No cases match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Subject</th>
                <th className="px-5 py-3 font-semibold">Category</th>
                <th className="px-5 py-3 font-semibold">Member</th>
                <th className="px-5 py-3 font-semibold">Priority</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Assigned</th>
                <th className="px-5 py-3 font-semibold">Filed</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const requesterName = c.requester
                  ? `${c.requester.first_name} ${c.requester.last_name}`.trim()
                  : "Unknown member";
                const assignedName = c.assignedStaff
                  ? `${c.assignedStaff.first_name} ${c.assignedStaff.last_name}`.trim()
                  : null;
                return (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/support/${c.id}`} className="font-semibold text-ink-900 hover:underline">
                        {c.subject}
                      </Link>
                      {c.linkedTarget && (
                        <div className="text-xs text-ink-500">
                          {SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS[c.linked_target_type!]}: {c.linkedTarget.label}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{SUPPORT_CASE_CATEGORY_LABELS[c.category]}</td>
                    <td className="px-5 py-3">
                      {c.requester ? (
                        <Link href={`/admin/users/${c.requester_id}`} className="flex items-center gap-2.5">
                          <AdminAvatar name={requesterName} color={c.requester.avatar_color} />
                          <span className="text-ink-900">{requesterName}</span>
                        </Link>
                      ) : (
                        <span className="text-ink-500">{requesterName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge
                        status={c.priority}
                        labels={SUPPORT_CASE_PRIORITY_LABELS}
                        styles={SUPPORT_CASE_PRIORITY_STYLES}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={c.status} labels={SUPPORT_CASE_STATUS_LABELS} styles={SUPPORT_CASE_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{assignedName ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500 whitespace-nowrap">{formatDateTime(c.created_at)}</td>
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
