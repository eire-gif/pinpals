// Pure, framework-free domain model for the support-case queue — mirrors
// reports.ts (no Supabase, no Next.js) so the vocab and labels are trivial
// to unit test and reuse from both queries.ts (server) and any client
// component that needs the same labels/styles. Keep this the one place
// these lists are declared — src/app/admin/support/**/*.ts should import
// from here, never redeclare a parallel copy that can drift from the DB
// check constraints in supabase/migrations/0026_support_cases.sql.

// A domain-appropriate alias for the same { error?, success? } shape every
// admin Server Action in this app returns (see ModerationState in
// moderation.ts) — kept as its own alias, not a second declaration, exactly
// like reports.ts's ReportActionState, so the two can never drift apart.
export type SupportCaseActionState = { error?: string; success?: boolean };

export const SUPPORT_CASE_STATUSES = ["open", "claimed", "waiting_on_member", "resolved", "closed"] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

// Statuses a case is still actively being worked in — the opposite of
// "closed out" (resolved/closed). Used both to gate which mutation forms a
// case detail page shows and to build the queue's default "still open"
// filter.
export const OPEN_SUPPORT_CASE_STATUSES: readonly SupportCaseStatus[] = ["open", "claimed", "waiting_on_member"];

export function isSupportCaseOpen(status: SupportCaseStatus): boolean {
  return (OPEN_SUPPORT_CASE_STATUSES as readonly string[]).includes(status);
}

export const SUPPORT_CASE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportCasePriority = (typeof SUPPORT_CASE_PRIORITIES)[number];

export const SUPPORT_CASE_CATEGORIES = [
  "account",
  "listing_marketplace",
  "tee_times",
  "payments_orders",
  "technical",
  "other",
] as const;
export type SupportCaseCategory = (typeof SUPPORT_CASE_CATEGORIES)[number];

// The one existing record a case can optionally point at for context — never
// a duplicate copy of that record's own data (see the migration's comment).
// 'conversation' resolves to a plain, unlinked label (see
// resolveLinkedTargetSummaries() in queries.ts) even though a real
// conversations table exists (supabase/migrations/0025_messaging.sql) —
// there is deliberately no general conversation-browsing admin page to link
// to; message content only ever surfaces through a report's own
// permission-gated, audited reveal flow (see reports.ts's comment on
// REPORT_TARGET_TYPES), and a support case shouldn't open a second path
// around that.
export const SUPPORT_CASE_LINKED_TARGET_TYPES = [
  "order",
  "listing",
  "tee_time_invite",
  "report",
  "conversation",
] as const;
export type SupportCaseLinkedTargetType = (typeof SUPPORT_CASE_LINKED_TARGET_TYPES)[number];

export const SUPPORT_CASE_STATUS_LABELS: Record<SupportCaseStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  waiting_on_member: "Waiting on member",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_CASE_STATUS_STYLES: Record<SupportCaseStatus, string> = {
  open: "bg-red-100 text-red-600",
  claimed: "bg-cream-100 text-ink-900",
  waiting_on_member: "bg-gold-500/20 text-gold-700",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-cream-100 text-ink-500",
};

export const SUPPORT_CASE_PRIORITY_LABELS: Record<SupportCasePriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_CASE_PRIORITY_STYLES: Record<SupportCasePriority, string> = {
  low: "bg-cream-100 text-ink-500",
  normal: "bg-cream-100 text-ink-900",
  high: "bg-gold-500/20 text-gold-700",
  urgent: "bg-red-100 text-red-600",
};

export const SUPPORT_CASE_CATEGORY_LABELS: Record<SupportCaseCategory, string> = {
  account: "Account",
  listing_marketplace: "Listing / marketplace",
  tee_times: "Tee-times",
  payments_orders: "Payments / orders",
  technical: "Technical",
  other: "Other",
};

export const SUPPORT_CASE_LINKED_TARGET_TYPE_LABELS: Record<SupportCaseLinkedTargetType, string> = {
  order: "Order",
  listing: "Listing",
  tee_time_invite: "Tee-time invite",
  report: "Report",
  conversation: "Conversation",
};

// Every support-case mutation in this slice — claim/release, status change,
// resolve/close/reopen, priority, notes, linking an action — is open to ANY
// active staff member (a bare requireStaff() call, no roles restriction).
// Unlike reports' MODERATION_ROLES gate, case triage/tracking isn't itself a
// destructive action (admin-architecture-review.md §6's own description of
// support is exactly "handle help requests, no destructive actions") — only
// the underlying actions a case might reference (suspending a user, issuing
// a refund) stay gated by their own existing role checks in their own
// actions.ts files. There is deliberately no SUPPORT_CASE_ROLES export here:
// every action.ts file in src/app/admin/support/** calls requireStaff() with
// no `roles` option at all.
