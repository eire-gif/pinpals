import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getReportDetail } from "@/lib/admin/queries";
import { canAccess } from "@/lib/admin/roles";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { MODERATION_ROLES } from "@/lib/admin/moderation";
import { formatDateTime } from "@/lib/admin/format";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_PRIORITY_LABELS,
  REPORT_PRIORITY_STYLES,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  REPORT_TARGET_TYPE_LABELS,
} from "@/lib/admin/reports";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import ConversationAccessPanel from "./conversation-access-panel";
import ResolveReportForm from "./resolve-form";
import PriorityForm from "./priority-form";
import { claimReport, releaseReport, dismissReport, reopenReport, addReportNote } from "./actions";

export default async function AdminReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, staff } = await requireStaff();
  const { id } = await params;
  const reportId = Number(id);
  if (!reportId || Number.isNaN(reportId)) notFound();

  const detail = await getReportDetail(reportId);
  if (!detail) notFound();

  const { report, reporter, assignedStaff, resolvedByStaff, target, notes, targetModerationHistory, linkedAction } =
    detail;

  // A UX nicety only — every mutation below re-checks this server-side
  // inside its own Server Action, which is the real boundary (see the
  // identical comment on the listing/user/tee-time detail pages).
  const canModerate = canAccess(staff, MODERATION_ROLES);
  const isSenior = staff.role === "admin" || staff.role === "super_admin";
  const canRelease = report.status === "claimed" && (report.assigned_admin === user.id || isSenior);
  const isOpenOrClaimed = report.status === "open" || report.status === "claimed";
  const isClosed = report.status === "resolved" || report.status === "dismissed";

  const reporterName = reporter ? `${reporter.first_name} ${reporter.last_name}`.trim() : "Unknown member";
  const assignedName = assignedStaff ? `${assignedStaff.first_name} ${assignedStaff.last_name}`.trim() : null;
  const resolvedByName = resolvedByStaff ? `${resolvedByStaff.first_name} ${resolvedByStaff.last_name}`.trim() : null;

  const evidenceRefs = Array.isArray(report.evidence_refs) ? report.evidence_refs : [];
  const isMessageTarget = report.target_type === "message" || report.target_type === "conversation";

  return (
    <div>
      <Link href="/admin/reports" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All reports
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">
              {REPORT_TARGET_TYPE_LABELS[report.target_type]} report
            </div>
            <h1 className="font-display font-bold text-2xl mt-1">
              {target.href ? (
                <Link href={target.href} className="hover:underline">
                  {target.label}
                </Link>
              ) : (
                target.label
              )}
            </h1>
            <p className="text-ink-500 mt-1">
              {REPORT_CATEGORY_LABELS[report.category]} · Filed {formatDateTime(report.created_at)}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <StatusBadge status={report.priority} labels={REPORT_PRIORITY_LABELS} styles={REPORT_PRIORITY_STYLES} />
            <StatusBadge status={report.status} labels={REPORT_STATUS_LABELS} styles={REPORT_STATUS_STYLES} />
          </div>
        </div>

        {report.description && <p className="text-sm text-ink-900 mt-4 max-w-[70ch] whitespace-pre-wrap">{report.description}</p>}

        <div className="text-xs text-ink-500 mt-4 flex gap-4 flex-wrap">
          <span>
            Reporter:{" "}
            {reporter ? (
              <Link href={`/admin/users/${report.reporter_id}`} className="text-ink-900 font-semibold hover:underline">
                {reporterName}
              </Link>
            ) : (
              reporterName
            )}
          </span>
          <span>
            Assigned: <span className="text-ink-900 font-semibold">{assignedName ?? "Unassigned"}</span>
          </span>
        </div>
      </div>

      {canModerate && (
        <Section title="Moderation">
          <div className="p-5 flex flex-col gap-5">
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Priority</div>
              <PriorityForm reportId={report.id} currentPriority={report.priority} />
            </div>

            {report.status === "open" && (
              <div>
                <div className="text-sm text-ink-500 font-semibold mb-2">Claim this report</div>
                <SimpleActionForm action={claimReport} idField="reportId" id={report.id} submitLabel="Claim" pendingLabel="Claiming…" />
              </div>
            )}

            {report.status === "claimed" && canRelease && (
              <div>
                <div className="text-sm text-ink-500 font-semibold mb-2">Release claim</div>
                <SimpleActionForm
                  action={releaseReport}
                  idField="reportId"
                  id={report.id}
                  submitLabel="Release back to open"
                  pendingLabel="Releasing…"
                />
              </div>
            )}

            {isOpenOrClaimed && (
              <div>
                <div className="text-sm text-ink-500 font-semibold mb-2">Resolve</div>
                <ResolveReportForm reportId={report.id} moderationHistory={targetModerationHistory} />
              </div>
            )}

            {isOpenOrClaimed && (
              <div>
                <div className="text-sm text-ink-500 font-semibold mb-2">Dismiss</div>
                <ModerationForm
                  action={dismissReport}
                  idField="reportId"
                  id={report.id}
                  submitLabel="Dismiss"
                  pendingLabel="Dismissing…"
                  tone="danger"
                  placeholder="Reason for dismissing (recorded in the audit log)"
                />
              </div>
            )}

            {isClosed && (
              <div>
                <div className="text-sm text-ink-500 font-semibold mb-2">Reopen</div>
                <ModerationForm
                  action={reopenReport}
                  idField="reportId"
                  id={report.id}
                  submitLabel="Reopen"
                  pendingLabel="Reopening…"
                  placeholder="Reason for reopening (recorded in the audit log)"
                />
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="Target">
        <div className="p-5">
          {isMessageTarget ? (
            canModerate ? (
              <ConversationAccessPanel
                reportId={report.id}
                label={REPORT_TARGET_TYPE_LABELS[report.target_type]}
                canModerate={canModerate}
              />
            ) : (
              <p className="text-sm text-ink-500">
                Only moderators and above can view message content for this report.
              </p>
            )
          ) : target.href ? (
            <Link href={target.href} className="text-sm font-semibold text-ink-900 hover:underline">
              Open this {REPORT_TARGET_TYPE_LABELS[report.target_type].toLowerCase()} →
            </Link>
          ) : (
            <p className="text-sm text-ink-500">{target.label}</p>
          )}
        </div>
      </Section>

      <Section title={`Evidence (${evidenceRefs.length})`}>
        {evidenceRefs.length === 0 ? (
          <EmptyRow>No evidence references attached to this report.</EmptyRow>
        ) : (
          <ul>
            {evidenceRefs.map((ref, i) => (
              <li key={i} className="px-5 py-3 border-b border-line last:border-0 text-sm text-ink-900 break-words">
                {String(ref)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {isClosed && (
        <Section title={report.status === "resolved" ? "Resolution" : "Dismissal"}>
          <div className="p-5">
            <p className="text-sm text-ink-900 whitespace-pre-wrap">{report.resolution}</p>
            <div className="text-xs text-ink-500 mt-3 flex gap-4 flex-wrap">
              {resolvedByName && (
                <span>
                  By <span className="text-ink-900 font-semibold">{resolvedByName}</span>
                </span>
              )}
              {report.resolved_at && <span>{formatDateTime(report.resolved_at)}</span>}
              {linkedAction && (
                <span>
                  Linked action:{" "}
                  <span className="text-ink-900 font-semibold">
                    {linkedAction.action} ({formatDateTime(linkedAction.created_at)})
                  </span>
                </span>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section title="This target's moderation history">
        {targetModerationHistory.length === 0 ? (
          <EmptyRow>No moderation actions recorded against this target yet.</EmptyRow>
        ) : (
          <ul>
            {targetModerationHistory.map((entry) => {
              const actorName = entry.actor
                ? `${entry.actor.first_name} ${entry.actor.last_name}`.trim()
                : "Unknown staff member";
              return (
                <li key={entry.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                  <span className="font-mono text-xs text-ink-900">{entry.action}</span>
                  <span className="text-ink-500"> · {actorName}</span>
                  <span className="text-ink-500"> · {formatDateTime(entry.created_at)}</span>
                  {entry.reason && <div className="text-ink-500 mt-1">{entry.reason}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Internal notes (${notes.length})`}>
        <div className="p-5 border-b border-line">
          {/* Any active staff member can add a note — same reasoning as
              addUserNote() (src/app/admin/users/[id]/actions.ts): a note
              isn't a moderation action, so this isn't gated to
              MODERATION_ROLES the way claim/resolve/dismiss above are. */}
          <ModerationForm
            action={addReportNote}
            idField="reportId"
            id={report.id}
            fieldName="note"
            submitLabel="Add note"
            pendingLabel="Saving…"
            placeholder="Add an internal note about this report — visible to all staff"
          />
        </div>
        {notes.length === 0 ? (
          <EmptyRow>No notes yet.</EmptyRow>
        ) : (
          <ul>
            {notes.map((n) => {
              const authorName = n.author ? `${n.author.first_name} ${n.author.last_name}`.trim() : "Unknown staff member";
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

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
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
