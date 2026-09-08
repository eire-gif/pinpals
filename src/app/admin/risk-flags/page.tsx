import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listFraudFlags } from "@/lib/admin/queries";
import { formatDateTime } from "@/lib/admin/format";
import {
  FRAUD_FLAG_SEVERITIES,
  FRAUD_FLAG_SEVERITY_LABELS,
  FRAUD_FLAG_SEVERITY_STYLES,
  FRAUD_FLAG_STATUSES,
  FRAUD_FLAG_STATUS_LABELS,
  FRAUD_FLAG_STATUS_STYLES,
  FRAUD_FLAG_TARGET_TYPES,
  FRAUD_FLAG_TARGET_TYPE_LABELS,
  FRAUD_FLAG_TYPE_LABELS,
  type FraudFlagSeverity,
  type FraudFlagStatus,
  type FraudFlagTargetType,
} from "@/lib/admin/risk";
import StatusBadge from "@/components/admin/status-badge";
import AdminPagination from "@/components/admin/pagination";

/**
 * The global risk-flags queue — every fraud/risk signal any staff member
 * has raised, across every target type, most recent first. Defaults to
 * showing open flags only (same "needs attention first" default as
 * /admin/reports' own unfiltered-but-effectively-"open-first" sort), since
 * that's the actual working queue; a "Cleared" status filter still lets
 * staff review history. Purely a read + filter surface — raising/clearing
 * happens from a target's own detail page (RiskFlagsPanel), not here.
 */
export default async function RiskFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; target?: string; severity?: string; page?: string }>;
}) {
  await requireStaff();
  const { status = "open", target = "", severity = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const { rows, total, pageSize } = await listFraudFlags(
    {
      status: (status as FraudFlagStatus) || undefined,
      targetType: (target as FraudFlagTargetType) || undefined,
      severity: (severity as FraudFlagSeverity) || undefined,
    },
    page
  );

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (target) params.set("target", target);
    if (severity) params.set("severity", severity);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/risk-flags?${qs}` : "/admin/risk-flags";
  }

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Risk flags</h1>
      <p className="text-ink-500 mb-6">
        {total} {total === 1 ? "flag" : "flags"} — internal signals only, never shown to members and never an
        automatic consequence. Raise or clear one from the member/listing/order&rsquo;s own detail page.
      </p>

      <form className="flex flex-wrap gap-3 mb-6">
        <select name="status" defaultValue={status} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <option value="">All statuses</option>
          {FRAUD_FLAG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FRAUD_FLAG_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="target" defaultValue={target} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <option value="">Any target type</option>
          {FRAUD_FLAG_TARGET_TYPES.map((t) => (
            <option key={t} value={t}>
              {FRAUD_FLAG_TARGET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="severity" defaultValue={severity} className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm">
          <option value="">Any severity</option>
          {FRAUD_FLAG_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {FRAUD_FLAG_SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
          Filter
        </button>
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No flags match that filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Target</th>
                <th className="px-5 py-3 font-semibold">Type</th>
                <th className="px-5 py-3 font-semibold">Severity</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Raised by</th>
                <th className="px-5 py-3 font-semibold">Raised</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const raisedByName = f.raisedByStaff
                  ? `${f.raisedByStaff.first_name} ${f.raisedByStaff.last_name}`.trim()
                  : "Unknown staff member";
                return (
                  <tr key={f.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      {f.target.href ? (
                        <Link href={f.target.href} className="font-semibold text-ink-900 hover:underline">
                          {f.target.label}
                        </Link>
                      ) : (
                        <span className="text-ink-900">{f.target.label}</span>
                      )}
                      <div className="text-xs text-ink-500">{FRAUD_FLAG_TARGET_TYPE_LABELS[f.target_type]}</div>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{FRAUD_FLAG_TYPE_LABELS[f.flag_type]}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={f.severity} labels={FRAUD_FLAG_SEVERITY_LABELS} styles={FRAUD_FLAG_SEVERITY_STYLES} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={f.status} labels={FRAUD_FLAG_STATUS_LABELS} styles={FRAUD_FLAG_STATUS_STYLES} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">{raisedByName}</td>
                    <td className="px-5 py-3 text-ink-500 whitespace-nowrap">{formatDateTime(f.raised_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <AdminPagination page={page} pageSize={pageSize} total={total} hrefForPage={pageHref} />
    </div>
  );
}
