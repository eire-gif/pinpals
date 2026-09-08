import { canAccess } from "@/lib/admin/roles";
import type { StaffRecord } from "@/lib/admin/roles";
import { ESCALATION_ROLES } from "@/lib/admin/reports";
import type { AdminFraudFlagListItem } from "@/lib/admin/queries";
import {
  FRAUD_FLAG_SEVERITY_LABELS,
  FRAUD_FLAG_SEVERITY_STYLES,
  FRAUD_FLAG_STATUS_LABELS,
  FRAUD_FLAG_STATUS_STYLES,
  FRAUD_FLAG_TYPE_LABELS,
  type FraudFlagTargetType,
} from "@/lib/admin/risk";
import { formatDateTime } from "@/lib/admin/format";
import StatusBadge from "./status-badge";
import ModerationForm from "./moderation-form";
import RaiseFraudFlagForm from "./raise-fraud-flag-form";
import { clearFraudFlag } from "@/app/admin/risk-flags/actions";

/**
 * Embedded on the user/listing/order detail pages — the same "this
 * target's own history" shape as the "Reports on this X" sections those
 * pages already have (src/lib/admin/queries.ts's resolveTargetSummaries()
 * comment), just for fraud_flags instead of reports. Any active staff
 * member sees this panel and may raise a flag; only ESCALATION_ROLES
 * (moderator/finance/admin/super_admin — not support) sees a Clear control.
 */
export default function RiskFlagsPanel({
  targetType,
  targetId,
  flags,
  staff,
}: {
  targetType: FraudFlagTargetType;
  targetId: string;
  flags: AdminFraudFlagListItem[];
  staff: StaffRecord | null;
}) {
  const canClear = canAccess(staff, ESCALATION_ROLES);
  const openCount = flags.filter((f) => f.status === "open").length;

  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">
        Risk flags {openCount > 0 && <span className="text-red-600">({openCount} open)</span>}
      </h2>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {flags.length === 0 ? (
          <div className="text-center py-8 text-ink-500 text-sm">No risk flags against this target.</div>
        ) : (
          <ul>
            {flags.map((f) => {
              const raisedByName = f.raisedByStaff
                ? `${f.raisedByStaff.first_name} ${f.raisedByStaff.last_name}`.trim()
                : "Unknown staff member";
              return (
                <li key={f.id} className="px-5 py-4 border-b border-line last:border-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-sm font-semibold text-ink-900">{FRAUD_FLAG_TYPE_LABELS[f.flag_type]}</span>
                    <StatusBadge status={f.severity} labels={FRAUD_FLAG_SEVERITY_LABELS} styles={FRAUD_FLAG_SEVERITY_STYLES} />
                    <StatusBadge status={f.status} labels={FRAUD_FLAG_STATUS_LABELS} styles={FRAUD_FLAG_STATUS_STYLES} />
                  </div>
                  <p className="text-sm text-ink-900 whitespace-pre-wrap mb-1.5">{f.note}</p>
                  <p className="text-xs text-ink-500">
                    Raised by <span className="text-ink-900 font-semibold">{raisedByName}</span> · {formatDateTime(f.raised_at)}
                  </p>
                  {f.status === "cleared" && f.clear_reason && (
                    <p className="text-xs text-green-700 mt-1.5">Cleared: {f.clear_reason}</p>
                  )}
                  {f.status === "open" && canClear && (
                    <div className="mt-3">
                      <ModerationForm
                        action={clearFraudFlag}
                        idField="flagId"
                        id={f.id}
                        submitLabel="Clear"
                        pendingLabel="Clearing…"
                        placeholder="Reason for clearing this flag (recorded in the audit log)"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="mt-3">
        <RaiseFraudFlagForm targetType={targetType} targetId={targetId} />
      </div>
    </div>
  );
}
