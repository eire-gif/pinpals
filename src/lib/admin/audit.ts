import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "./roles";

// The single write path for the admin_audit_log table (see
// supabase/migrations/0009_admin_audit_log.sql). Every admin mutation that
// touches another user's data should call recordAdminAction() — directly,
// not through some other helper that re-implements this — the same "one
// choke point" discipline requireStaff() uses for authorization. The table's
// RLS has no insert policy for `authenticated`/`anon` at all, so this is
// also the *only* thing in the app that is able to write a row: even a
// compromised staff session, using its own key, cannot insert or alter
// audit history through any ordinary application path.
//
// Nothing calls this yet — no admin mutations exist yet (Phase 2 is
// read-only). This file is the seam Phase 3's moderation actions build on.

export const ADMIN_ACTIONS = [
  "user.suspend",
  "user.reinstate",
  "user.note_added",
  "listing.hide",
  "listing.restore",
  "invite.cancel",
  "invite.restore",
  "refund.requested",
  "refund.completed",
  // Distinct from "refund.completed" — a refund whose Stripe call (or later
  // webhook reconciliation) failed. The task requires requested/succeeded/
  // failed as three separately auditable outcomes; "refund.completed" is
  // reused as the "succeeded" outcome rather than renamed, since it already
  // existed forward-declared and unused before this phase.
  "refund.failed",
  "admin.role_changed",
  "report.claimed",
  "report.status_changed",
  "report.resolved",
  "report.dismissed",
  "report.note_added",
  // The only admin *interaction* this phase's Stripe Connect work audits —
  // an admin's manual "Refresh from Stripe" click on /admin/payouts/[id]
  // (src/app/admin/payouts/[id]/actions.ts). Read-only views (the list/detail
  // pages themselves) aren't audited, same as every other admin read-only
  // page in this app.
  "seller_account.synced",
  // An admin's manual "Retry" click on a failed /admin/webhook-events row
  // (src/app/admin/webhook-events/[id]/actions.ts) — the one admin
  // *interaction* this phase's payment persistence work audits, same
  // reasoning as seller_account.synced above.
  "webhook_event.retried",
  // Phase 12 (finance/admin payout visibility & reconciliation, see
  // supabase/migrations/0024_payouts.sql) — an admin's manual "Sync from
  // Stripe" click on /admin/payouts/ledger/[id]
  // (src/app/admin/payouts/ledger/[id]/actions.ts), same
  // "Refresh from Stripe" shape as seller_account.synced above.
  "payout.synced",
  // An admin manually flagging (or releasing) a payout's orders for
  // follow-up — sets/clears the pre-existing but previously-unused 'held'
  // payout_status (0019) on every order that payout swept up. Not a Stripe
  // mutation of any kind, and never touches bank/account details — see
  // holdPayoutOrders()/releasePayoutOrders() in
  // src/app/admin/payouts/ledger/[id]/actions.ts.
  "payout.held",
  "payout.released",
  // The single audit event every privileged view of message content writes
  // — see grantConversationAccess() in src/app/admin/reports/[id]/actions.ts
  // and the privacy-model comment at the top of
  // supabase/migrations/0025_messaging.sql. Written on EVERY reveal/"load
  // older" call, not just the first, since each one is a fresh look at
  // another member's private conversation.
  "conversation.access_viewed",
  // hideMessage()/restoreMessage() (same file) — never rewrites
  // messages.body, only the hidden_at/hidden_by/hidden_reason flag.
  "message.hidden",
  "message.restored",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

// "order" was forward-declared the same way "message"/"conversation" were
// added to reports' target_type ahead of a messaging system; "seller_account"
// follows the same pattern now that seller_account.synced above needs it.
// admin_audit_log.target_type has no DB-level check constraint (unlike
// reports.target_type) — this array is the only place the closed list lives.
export const AUDIT_TARGET_TYPES = [
  "user",
  "listing",
  "tee_time_invite",
  "offer",
  "staff_role",
  "report",
  "order",
  "seller_account",
  "webhook_event",
  "payout",
  // A privileged VIEW is always audited against the *conversation*
  // (conversation.access_viewed, targetId = conversation id) even when the
  // triggering report named a single message, since that's the actual thing
  // access was opened to. A hide/restore MODERATION action, though, targets
  // the specific message row it acted on (message.hidden/message.restored,
  // targetId = message id) — see src/app/admin/reports/[id]/actions.ts.
  "conversation",
  "message",
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export type AuditOutcome = "success" | "failure";

export type RecordAdminActionInput = {
  /** Who performed the action, and their role *at the time* — never re-read
   * later, since a role can change after the fact and the log should
   * reflect what was true when the action happened. */
  actor: { id: string; role: StaffRole };
  action: AdminAction;
  targetType: AuditTargetType;
  /** The affected row's id. Text because targets mix uuid (profiles) and
   * bigint (listings, invites, offers) primary keys. Omit for an action with
   * no single row target. */
  targetId?: string | number | null;
  /** Why — freeform, shown to other staff reviewing the log. Never put
   * anything here a support agent shouldn't see in plain text. */
  reason?: string | null;
  /** Extra context safe to keep long-term: e.g. { previousStatus, newStatus }.
   * Run through sanitizeMetadata() before it ever reaches the database — see
   * that function for exactly what gets stripped. Never pass secrets,
   * tokens, or full request/response payloads here. */
  metadata?: Record<string, unknown>;
  outcome?: AuditOutcome;
  /** Override the auto-resolved correlation id (see resolveCorrelationId).
   * Only needed when a caller already has a better one (e.g. a webhook's own
   * event id) than what Vercel's request headers provide. */
  correlationId?: string;
};

// Key names that must never survive into the audit log, however they got
// into `metadata` — a case-insensitive substring match so `apiKey`,
// `api_key`, `authToken`, `SERVICE_ROLE_KEY`, etc. are all caught, not just
// exact matches. This is a safety net, not the only line of defense: callers
// still should not be passing secrets into metadata in the first place.
const SENSITIVE_KEY_PATTERN = /password|secret|token|credential|authoriz(a|e)tion|cookie|service[_-]?role|api[_-]?key/i;

const MAX_SANITIZE_DEPTH = 5;

/**
 * Strips any key (at any nesting depth, up to MAX_SANITIZE_DEPTH) that looks
 * like it might hold a secret. Pure and DB-free by design — see audit.test.ts
 * — so it can be trusted independent of the actual insert path.
 */
export function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > MAX_SANITIZE_DEPTH || typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;

    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = sanitizeMetadata(val, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Picks a correlation id for tracing a specific audit entry back to a
 * specific request: Vercel's own `x-vercel-id` header when one is present
 * (so a row can be cross-referenced against Vercel's request/runtime logs),
 * otherwise a generated id. Exported and pure over its input so the decision
 * logic is testable without mocking next/headers.
 */
export function pickCorrelationId(vercelRequestId: string | null): string {
  return vercelRequestId ?? crypto.randomUUID();
}

async function resolveCorrelationId(): Promise<string> {
  try {
    const h = await headers();
    return pickCorrelationId(h.get("x-vercel-id"));
  } catch {
    // headers() throws when called outside a request context (a script, a
    // queued job) — fall back rather than let that block the audit write.
    return pickCorrelationId(null);
  }
}

/**
 * Writes one row to admin_audit_log. Throws on failure rather than swallowing
 * the error — callers should decide for themselves whether an unaudited
 * mutation is acceptable to let through (it generally isn't), but that has to
 * be *their* decision, made explicitly, not one this function makes silently
 * on their behalf.
 */
export async function recordAdminAction(input: RecordAdminActionInput): Promise<void> {
  const admin = createAdminClient();
  const correlationId = input.correlationId ?? (await resolveCorrelationId());

  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: input.actor.id,
    actor_role: input.actor.role,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId == null ? null : String(input.targetId),
    reason: input.reason ?? null,
    metadata: sanitizeMetadata(input.metadata ?? {}),
    correlation_id: correlationId,
    outcome: input.outcome ?? "success",
  });

  if (error) {
    throw new Error(`Failed to record admin audit log entry: ${error.message}`);
  }
}
