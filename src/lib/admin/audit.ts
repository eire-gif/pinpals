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
  "listing.hide",
  "listing.restore",
  "invite.cancel",
  "invite.restore",
  "refund.requested",
  "refund.completed",
  "admin.role_changed",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = ["user", "listing", "tee_time_invite", "offer", "staff_role"] as const;
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
