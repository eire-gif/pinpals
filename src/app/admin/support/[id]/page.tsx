import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { getSupportCaseDetail } from "@/lib/admin/queries";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { formatDateTime } from "@/lib/admin/format";
import {
  SUPPORT_CASE_CATEGORY_LABELS,
  SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS,
  SUPPORT_CASE_PRIORITY_LABELS,
  SUPPORT_CASE_PRIORITY_STYLES,
  SUPPORT_CASE_STATUS_LABELS,
  SUPPORT_CASE_STATUS_STYLES,
  isSupportCaseOpen,
} from "@/lib/admin/support-cases";
import AdminAvatar from "@/components/admin/avatar";
import StatusBadge from "@/components/admin/status-badge";
import ModerationForm from "@/components/admin/moderation-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import UnavailableCard from "@/components/admin/unavailable-card";
import PriorityForm from "./priority-form";
import WaitingForm from "./waiting-form";
import ResolveCaseForm from "./resolve-form";
import LinkActionForm from "./link-action-form";
import { claimCase, releaseCase, closeCase, reopenCase, addCaseNote } from "./actions";

export default async function AdminSupportCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, staff } = await requireStaff();
  const { id } = await params;
  const caseId = Number(id);
  if (!caseId || Number.isNaN(caseId)) notFound();

  const detail = await getSupportCaseDetail(caseId);
  if (!detail) notFound();

  const {
    case: supportCase,
    requester,
    assignedStaff,
    resolvedByStaff,
    linkedTarget,
    notes,
    linkedActions,
    timeline,
    requesterAccountHistory,
    linkedTargetHistory,
  } = detail;

  // Every active staff member can act on a case — no canModerate gate like
  // reports has (see support-cases.ts's file-header comment). This is a UX
  // nicety only: every mutation below re-checks its own rules server-side
  // inside its own Server Action, which is the real boundary.
  const isSenior = staff.role === "admin" || staff.role === "super_admin";
  const canRelease =
    (supportCase.status === "claimed" || supportCase.status === "waiting_on_member") &&
    (supportCase.assigned_admin === user.id || isSenior);
  const isOpen = isSupportCaseOpen(supportCase.status);
  const isClosed = !isOpen;

  const requesterName = requester ? `${requester.first_name} ${requester.last_name}`.trim() : "Unknown member";
  const assignedName = assignedStaff ? `${assignedStaff.first_name} ${assignedStaff.last_name}`.trim() : null;
  const resolvedByName = resolvedByStaff ? `${resolvedByStaff.first_name} ${resolvedByStaff.last_name}`.trim() : null;

  const isConversationTarget = supportCase.linked_target_type === "conversation";

  // The link-action picker's candidates: this case's requester's own
  // account history plus (if the case has one) its linked record's own
  // history, deduped by audit-log id — linkCaseAction() re-verifies
  // whichever one is actually submitted, server-side, regardless of what
  // this list offers.
  const linkCandidates = [
    ...requesterAccountHistory.map((entry) => ({
      id: entry.id,
      action: entry.action,
      created_at: entry.created_at,
      source: "member" as const,
    })),
    ...linkedTargetHistory
      .filter((entry) => !requesterAccountHistory.some((r) => r.id === entry.id))
      .map((entry) => ({ id: entry.id, action: entry.action, created_at: entry.created_at, source: "linked record" as const })),
  ];
  const alreadyLinkedIds = new Set(linkedActions.map((l) => l.audit_log_id));
  const availableLinkCandidates = linkCandidates.filter((c) => !alreadyLinkedIds.has(c.id));

  return (
    <div>
      <Link href="/admin/support" className="text-sm text-ink-500 hover:text-ink-900 mb-4 inline-block">
        ← All support cases
      </Link>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">
              {SUPPORT_CASE_CATEGORY_LABELS[supportCase.category]} case
            </div>
            <h1 className="font-display font-bold text-2xl mt-1">{supportCase.subject}</h1>
            <p className="text-ink-500 mt-1">Filed {formatDateTime(supportCase.created_at)}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <StatusBadge
              status={supportCase.priority}
              labels={SUPPORT_CASE_PRIORITY_LABELS}
              styles={SUPPORT_CASE_PRIORITY_STYLES}
            />
            <StatusBadge
              status={supportCase.status}
              labels={SUPPORT_CASE_STATUS_LABELS}
              styles={SUPPORT_CASE_STATUS_STYLES}
            />
          </div>
        </div>

        {supportCase.description && (
          <p className="text-sm text-ink-900 mt-4 max-w-[70ch] whitespace-pre-wrap">{supportCase.description}</p>
        )}

        <div className="text-xs text-ink-500 mt-4 flex gap-4 flex-wrap">
          <span>
            Member:{" "}
            {requester ? (
              <Link href={`/admin/users/${supportCase.requester_id}`} className="text-ink-900 font-semibold hover:underline">
                {requesterName}
              </Link>
            ) : (
              requesterName
            )}
          </span>
          <span>
            Assigned: <span className="text-ink-900 font-semibold">{assignedName ?? "Unassigned"}</span>
          </span>
        </div>
      </div>

      <Section title="Actions">
        <div className="p-5 flex flex-col gap-5">
          <div>
            <div className="text-sm text-ink-500 font-semibold mb-2">Priority</div>
            <PriorityForm caseId={supportCase.id} currentPriority={supportCase.priority} />
          </div>

          {supportCase.status === "open" && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Claim this case</div>
              <SimpleActionForm action={claimCase} idField="caseId" id={supportCase.id} submitLabel="Claim" pendingLabel="Claiming…" />
            </div>
          )}

          {(supportCase.status === "claimed" || supportCase.status === "waiting_on_member") && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Status</div>
              <WaitingForm caseId={supportCase.id} isWaiting={supportCase.status === "waiting_on_member"} />
            </div>
          )}

          {(supportCase.status === "claimed" || supportCase.status === "waiting_on_member") && canRelease && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Release claim</div>
              <SimpleActionForm
                action={releaseCase}
                idField="caseId"
                id={supportCase.id}
                submitLabel="Release back to open"
                pendingLabel="Releasing…"
              />
            </div>
          )}

          {isOpen && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Resolve</div>
              <ResolveCaseForm caseId={supportCase.id} />
            </div>
          )}

          {isOpen && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Close</div>
              <ModerationForm
                action={closeCase}
                idField="caseId"
                id={supportCase.id}
                submitLabel="Close"
                pendingLabel="Closing…"
                tone="danger"
                placeholder="Reason for closing (recorded in the audit log)"
              />
            </div>
          )}

          {isClosed && (
            <div>
              <div className="text-sm text-ink-500 font-semibold mb-2">Reopen</div>
              <ModerationForm
                action={reopenCase}
                idField="caseId"
                id={supportCase.id}
                submitLabel="Reopen"
                pendingLabel="Reopening…"
                placeholder="Reason for reopening (recorded in the audit log)"
              />
            </div>
          )}
        </div>
      </Section>

      <Section title="Linked record">
        <div className="p-5">
          {!supportCase.linked_target_type ? (
            <p className="text-sm text-ink-500">No record linked to this case.</p>
          ) : isConversationTarget ? (
            <UnavailableCard
              label={SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS.conversation}
              reason="Conversation content isn't shown here — it's only ever revealed through a report filed against this conversation, with a reason recorded in the audit log. Open a report on it, or ask the member directly, rather than browsing it from this case."
            />
          ) : linkedTarget?.href ? (
            <Link href={linkedTarget.href} className="text-sm font-semibold text-ink-900 hover:underline">
              Open this {SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS[supportCase.linked_target_type].toLowerCase()} →
            </Link>
          ) : (
            <p className="text-sm text-ink-500">{linkedTarget?.label}</p>
          )}
        </div>
      </Section>

      {isClosed && (
        <Section title={supportCase.status === "resolved" ? "Resolution" : "Closure"}>
          <div className="p-5">
            <p className="text-sm text-ink-900 whitespace-pre-wrap">{supportCase.resolution}</p>
            <div className="text-xs text-ink-500 mt-3 flex gap-4 flex-wrap">
              {resolvedByName && (
                <span>
                  By <span className="text-ink-900 font-semibold">{resolvedByName}</span>
                </span>
              )}
              {supportCase.resolved_at && <span>{formatDateTime(supportCase.resolved_at)}</span>}
            </div>
          </div>
        </Section>
      )}

      <Section title={`Linked actions (${linkedActions.length})`}>
        <div className="p-5 border-b border-line">
          {/* Never re-performs or duplicates the underlying action — only
              points at an already-authorized admin_audit_log row. See
              linkCaseAction()'s comment for the re-verification this relies
              on. */}
          <LinkActionForm caseId={supportCase.id} candidates={availableLinkCandidates} />
        </div>
        {linkedActions.length === 0 ? (
          <EmptyRow>No consequential actions linked to this case yet.</EmptyRow>
        ) : (
          <ul>
            {linkedActions.map((link) => {
              const linkedByName = link.linkedByStaff
                ? `${link.linkedByStaff.first_name} ${link.linkedByStaff.last_name}`.trim()
                : "Unknown staff member";
              return (
                <li key={link.id} className="px-5 py-3 border-b border-line last:border-0 text-sm">
                  <span className="font-mono text-xs text-ink-900">{link.auditEntry?.action ?? "Action no longer available"}</span>
                  <span className="text-ink-500"> · linked by {linkedByName}</span>
                  <span className="text-ink-500"> · {formatDateTime(link.created_at)}</span>
                  {link.note && <div className="text-ink-500 mt-1">{link.note}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Timeline">
        {timeline.length === 0 ? (
          <EmptyRow>No events recorded yet.</EmptyRow>
        ) : (
          <ul>
            {timeline.map((entry) => {
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
          {/* Any active staff member can add a note — a note isn't a
              moderation action, same reasoning as addReportNote(). */}
          <ModerationForm
            action={addCaseNote}
            idField="caseId"
            id={supportCase.id}
            fieldName="note"
            submitLabel="Add note"
            pendingLabel="Saving…"
            placeholder="Add an internal note about this case — visible to all staff"
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
