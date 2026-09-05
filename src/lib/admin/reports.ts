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
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

// 'message'/'conversation' were declared in the DB (see 0016_admin_reports.sql)
// ahead of a messaging system — see supabase/migrations/0025_messaging.sql
// for that system and src/app/admin/reports/[id]/conversation-access-panel.tsx
// for how the two are handled: deliberately NOT a link into a general
// conversation-browsing page (there isn't one) — content only ever appears
// after a moderator submits a reason on this report's own page, and every
// reveal is audited (see ADMIN_ACTIONS' conversation.access_viewed).
export const REPORT_TARGET_TYPES = ["user", "listing", "tee_time_invite", "message", "conversation"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

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
};

export const REPORT_TARGET_TYPE_LABELS: Record<ReportTargetType, string> = {
  user: "Member",
  listing: "Listing",
  tee_time_invite: "Tee-time invite",
  message: "Message",
  conversation: "Conversation",
};

// Reports reuse the exact same ModerationState shape and MODERATION_ROLES
// gate every other admin mutation in this app uses (src/lib/admin/moderation.ts)
// — claim/status-change/resolve/dismiss are import { MODERATION_ROLES } from
// "./moderation" callers, not a second declaration here, so the two never
// drift apart. Support can still view the full queue (matches
// admin-architecture-review.md §6, "support — ... no destructive actions")
// but not act on it; any active staff member (support included) can still
// add an internal note — see report_notes' RLS comment and addReportNote() —
// a note isn't a moderation action.
