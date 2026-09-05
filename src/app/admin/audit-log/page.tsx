import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listAuditLog, listAuditLogActors } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import { ADMIN_ACTIONS, AUDIT_TARGET_TYPES } from "@/lib/admin/audit";
import { ROLE_LABELS } from "@/lib/admin/roles";
import AdminAvatar from "@/components/admin/avatar";
import type { MessagesCursor } from "@/lib/messaging";

// Restricted to super_admin — see claude/admin-architecture-review.md §6
// ("super_admin — ... access the audit log"). Every other staff role gets
// the same 404 a non-staff user would get hitting this URL (requireStaff()
// with a `roles` restriction never distinguishes "wrong role" from "not
// staff at all" in its response — see the comment on requireStaff() itself).
//
// Pagination here is keyset/cursor-based (see listAuditLog() in queries.ts),
// not numbered pages: admin_audit_log is append-only and grows forever, so
// there's no cheap "page 12 of 400" to compute. Instead the URL carries a
// `history` param — a JSON-encoded stack of every cursor visited so far —
// so "Previous" can navigate back without a reverse keyset query, and
// "Next" pushes the freshly-fetched page's cursor onto that stack.

function parseHistory(raw: string | undefined): MessagesCursor[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MessagesCursor =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as MessagesCursor).createdAt === "string" &&
        typeof (entry as MessagesCursor).id === "number"
    );
  } catch {
    // A malformed/tampered `history` param just means "start over from the
    // first page" — never a 500.
    return [];
  }
}

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    actor?: string;
    action?: string;
    target?: string;
    from?: string;
    to?: string;
    history?: string;
  }>;
}) {
  await requireStaff({ roles: ["super_admin"] });
  const { actor = "", action = "", target = "", from = "", to = "", history: historyParam } = await searchParams;

  // The last entry in the stack is the cursor that produced the page we're
  // currently viewing (undefined/absent means "first page").
  const history = parseHistory(historyParam);
  const currentCursor = history.length ? history[history.length - 1] : undefined;

  const [{ rows, approxTotal, nextCursor }, actors] = await Promise.all([
    listAuditLog(
      {
        actorId: actor || undefined,
        action: action || undefined,
        targetType: target || undefined,
        from: from || undefined,
        // Treat `to` as an inclusive whole day — a bare date input like
        // "2026-09-02" would otherwise mean "before midnight at the start of
        // that day" and silently exclude everything that happened on it.
        to: to ? `${to}T23:59:59.999Z` : undefined,
      },
      currentCursor
    ),
    listAuditLogActors(),
  ]);

  const hasFilters = Boolean(actor || action || target || from || to);

  function baseParams() {
    const params = new URLSearchParams();
    if (actor) params.set("actor", actor);
    if (action) params.set("action", action);
    if (target) params.set("target", target);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }

  function hrefWithHistory(nextHistory: MessagesCursor[]) {
    const params = baseParams();
    if (nextHistory.length) params.set("history", JSON.stringify(nextHistory));
    const qs = params.toString();
    return qs ? `/admin/audit-log?${qs}` : "/admin/audit-log";
  }

  const nextHref = nextCursor ? hrefWithHistory([...history, nextCursor]) : null;
  const prevHref = history.length ? hrefWithHistory(history.slice(0, -1)) : null;

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Audit log</h1>
      <p className="text-ink-500 mb-6">
        About {approxTotal} {approxTotal === 1 ? "entry" : "entries"}
        {hasFilters && " matching these filters"}. Every admin action that changes another
        member&rsquo;s data is recorded here, permanently — there is no way to edit or delete an
        entry from within the app.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <select
          name="actor"
          defaultValue={actor}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any staff member</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || a.email || a.id}
            </option>
          ))}
        </select>
        <select
          name="action"
          defaultValue={action}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any action</option>
          {ADMIN_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          name="target"
          defaultValue={target}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">Any target</option>
          {AUDIT_TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="from"
          defaultValue={from}
          aria-label="From date"
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <input
          type="date"
          name="to"
          defaultValue={to}
          aria-label="To date"
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
        {hasFilters && (
          <Link
            href="/admin/audit-log"
            className="px-5 py-2.5 rounded-full font-bold text-sm border-[1.5px] border-line hover:bg-cream-100 transition"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No audit log entries match that search.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">When</th>
                <th className="px-5 py-3 font-semibold">Actor</th>
                <th className="px-5 py-3 font-semibold">Action</th>
                <th className="px-5 py-3 font-semibold">Target</th>
                <th className="px-5 py-3 font-semibold">Reason</th>
                <th className="px-5 py-3 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const actorName = entry.actor
                  ? `${entry.actor.first_name} ${entry.actor.last_name}`.trim()
                  : "Unknown staff member";
                return (
                  <tr key={entry.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
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
                    <td className="px-5 py-3 text-ink-500">
                      {entry.target_type}
                      {entry.target_id && <span className="text-ink-900"> #{entry.target_id}</span>}
                    </td>
                    <td className="px-5 py-3 text-ink-500 max-w-[24ch] truncate" title={entry.reason ?? undefined}>
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
      </div>

      {(prevHref || nextHref) && (
        <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
          <span>{history.length + 1 > 1 ? `Page ${history.length + 1}` : "Newest entries"}</span>
          <div className="flex gap-2">
            {prevHref && (
              <Link
                href={prevHref}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Previous
              </Link>
            )}
            {nextHref && (
              <Link
                href={nextHref}
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
