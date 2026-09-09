// Pure, framework-free domain model for the report queue — mirrors roles.ts
// (no Supabase, no Next.js) so the vocab and labels are trivial to unit test
// and reuse from both queries.ts (server) and any client component that
// needs the same labels/styles. Keep this the one place these lists are
// declared — src/app/admin/reports/**/*.ts should import from here, never
// redeclare a parallel copy that can drift from the DB check constraints in
// supabase/migrations/0016_admin_reports.sql.
import type { ModerationState } from "./moderation";

// A domain-appropriate alias for the exact same shape ModerationState
// already declares — every report Server Action returns this, and every
// report form component (ModerationForm reused as-is, plus the
// report-specific SimpleActionForm/ResolveReportForm) is written against
// it. Kept as an alias, not a second declaration, so the two types can never
// drift apart.
export type ReportActionState = ModerationState;

export const REPORT_STATUSES = ["open", "claimed", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ReportPriority = (typeof REPORT_PRIORITIES)[number];

export const REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "inappropriate_content",
  "scam_fraud",
  "fake_listing",
  "no_show",
  "other",
  // marketplace-trust-safety (0055) — order-shaped categories, added
  // alongside the 'order' target type below. Shared across every target
  // type the same way "other"/"scam_fraud" already are (the category enum
  // has never been scoped per target type); a listing/message report simply
  // never offers these three in its own form's dropdown.
  "item_not_as_described",
  "item_not_received",
  "payment_issue",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// 'message'/'conversation' were declared in the DB (see 0016_admin_reports.sql)
// ahead of a messaging system — see supabase/migrations/0025_messaging.sql
// for that system and src/app/admin/reports/[id]/conversation-access-panel.tsx
// for how the two are handled: deliberately NOT a link into a general
// conversation-browsing page (there isn't one) — content only ever appears
// after a moderator submits a reason on this report's own page, and every
// reveal is audited (see ADMIN_ACTIONS' conversation.access_viewed).
//
// 'order' was added by marketplace-trust-safety (0055_marketplace_trust_safety.sql)
// — reportOrderIssue() (src/app/dashboard/orders/[id]/actions.ts) is the
// member-facing write path. Deliberately reuses this exact same table/queue
// rather than a parallel "order issues" system: an order report IS a
// report, and it already gets everything a report gets for free — a
// moderator/finance queue, assignment, internal notes, and (since "order"
// was already in AUDIT_TARGET_TYPES — see audit.ts) its own moderation
// history automatically includes every refund.requested/completed/failed
// audit entry finance makes against the same order, with no extra code.
// 'review' — marketplace-notifications-reviews (0056_marketplace_notifications_
// reviews.sql). Same reused-queue reasoning as 'order' above: a review
// report is a report, so it gets a moderator queue, assignment and internal
// notes for free. The member-facing write path is reportReview()
// (src/app/dashboard/buying/actions.ts); the moderation action it can lead
// to (hiding the review) goes through hideReview()/restoreReview()
// (src/app/admin/reviews/actions.ts) rather than this queue directly, same
// separation as report -> hideListing() for a listing report.
export const REPORT_TARGET_TYPES = ["user", "listing", "tee_time_invite", "message", "conversation", "order", "review"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

// Roles an open report can be escalated TO (reports.escalated_to_role,
// 0055) — deliberately excludes 'support': every report is already visible
// to support (the read-broad policy above), so "escalating to support"
// isn't a real escalation, it's the starting tier every report begins at.
export const ESCALATION_ROLES = ["moderator", "finance", "admin", "super_admin"] as const;
export type EscalationRole = (typeof ESCALATION_ROLES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open",
  claimed: "Claimed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  open: "bg-red-100 text-red-600",
  claimed: "bg-cream-100 text-ink-900",
  resolved: "bg-green-100 text-green-800",
  dismissed: "bg-cream-100 text-ink-500",
};

export const REPORT_PRIORITY_LABELS: Record<ReportPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const REPORT_PRIORITY_STYLES: Record<ReportPriority, string> = {
  low: "bg-cream-100 text-ink-500",
  normal: "bg-cream-100 text-ink-900",
  high: "bg-gold-500/20 text-gold-700",
  urgent: "bg-red-100 text-red-600",
};

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  spam: "Spam",
  harassment: "Harassment",
  inappropriate_content: "Inappropriate content",
  scam_fraud: "Scam / fraud",
  fake_listing: "Fake listing",
  no_show: "No-show",
  other: "Other",
  item_not_as_described: "Item not as described",
  item_not_received: "Item not received",
  payment_issue: "Payment issue",
};

export const REPORT_TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  user: "Member",
  listing: "Listing",
  tee_time_invite: "Tee-time invite",
  message: "Message",
  conversation: "Conversation",
  order: "Order",
  review: "Review",
};

// Category subsets each member-facing report form actually offers — the
// shared REPORT_CATEGORIES/REPORT_CATEGORY_LABELS stay one flat list (so the
// admin queue's filter dropdown and every existing report always show every
// value that could be on any report), but a report-a-listing form showing
// "Payment issue" or an order-issue form showing "Fake listing" would just
// confuse the reporter. Pure data, no DB/framework dependency, so it's
// trivial to keep in sync with REPORT_CATEGORIES by hand and unit-test.
export const LISTING_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "spam",
  "fake_listing",
  "scam_fraud",
  "inappropriate_content",
  "other",
];
export const USER_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "harassment",
  "scam_fraud",
  "spam",
  "no_show",
  "inappropriate_content",
  "other",
];
export const ORDER_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "item_not_as_described",
  "item_not_received",
  "payment_issue",
  "scam_fraud",
  "other",
];
export const REVIEW_REPORT_CATEGORIES: readonly ReportCategory[] = [
  "harassment",
  "inappropriate_content",
  "spam",
  "other",
];

const EVIDENCE_REF_MAX_ITEMS = 10;
const EVIDENCE_REF_MAX_LENGTH = 300;

/**
 * Turns a member-typed "one reference per line" textarea into the bounded
 * string array `reports.evidence_refs` expects (see
 * supabase/migrations/0016_admin_reports.sql's own comment on that column —
 * "not a file upload system; just short strings staff can read and click
 * through by hand"). Pure and framework-free so it's trivial to unit test:
 * trims each line, drops blanks, caps the count and each line's length
 * rather than rejecting an over-long submission outright — the same
 * "truncate, don't fail the whole report over one long line" leniency
 * everywhere else evidence_refs is described as forgiving.
 */
export function parseEvidenceRefs(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, EVIDENCE_REF_MAX_ITEMS)
    .map((line) => line.slice(0, EVIDENCE_REF_MAX_LENGTH));
}

// Reports reuse the exact same ModerationState shape and MODERATION_ROLES
// gate every other admin mutation in this app uses (src/lib/admin/moderation.ts)
// — claim/status-change/resolve/dismiss are import { MODERATION_ROLES } from
// "./moderation" callers, not a second declaration here, so the two never
// drift apart. Support can still view the full queue (matches
// admin-architecture-review.md §6, "support — ... no destructive actions")
// but not act on it; any active staff member (support included) can still
// add an internal note — see report_notes' RLS comment and addReportNote() —
// a note isn't a moderation action.
