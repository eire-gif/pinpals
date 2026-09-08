// Pure, framework-free domain model for fraud/risk flags (see
// supabase/migrations/0055_marketplace_trust_safety.sql's `fraud_flags`
// table) — same "no Supabase, no Next.js" shape as roles.ts/reports.ts, kept
// here so the vocab/labels are trivial to unit test and reused by both
// queries.ts (server) and every client component that needs the same
// labels/styles.
//
// The one rule every fraud-flag call site (src/app/admin/risk-flags/actions.ts,
// components/admin/risk-flags-panel.tsx) is built around: a flag is a
// SIGNAL, never a VERDICT. Raising one never suspends a user, removes a
// listing, cancels an order, or blocks anything automatically — nothing in
// this app reads `fraud_flags` for any purpose except showing it to a human
// staff member deciding what (if anything) to do next. If a future change
// ever makes anything automatic happen off the presence of a flag, that is a
// deliberate policy decision this file's design explicitly does not make on
// its own.

export type FraudFlagTargetType = "user" | "listing" | "order";

export const FRAUD_FLAG_TARGET_TYPES: readonly FraudFlagTargetType[] = ["user", "listing", "order"];

export const FRAUD_FLAG_TYPES = [
  "suspected_fraud",
  "payment_risk",
  "fake_identity",
  "fee_evasion",
  "account_takeover",
  "other",
] as const;
export type FraudFlagType = (typeof FRAUD_FLAG_TYPES)[number];

export const FRAUD_FLAG_SEVERITIES = ["low", "medium", "high"] as const;
export type FraudFlagSeverity = (typeof FRAUD_FLAG_SEVERITIES)[number];

export const FRAUD_FLAG_STATUSES = ["open", "cleared"] as const;
export type FraudFlagStatus = (typeof FRAUD_FLAG_STATUSES)[number];

export const FRAUD_FLAG_TYPE_LABELS: Record<FraudFlagType, string> = {
  suspected_fraud: "Suspected fraud",
  payment_risk: "Payment risk",
  fake_identity: "Fake identity",
  fee_evasion: "Fee evasion (off-platform deal)",
  account_takeover: "Possible account takeover",
  other: "Other",
};

export const FRAUD_FLAG_SEVERITY_LABELS: Record<FraudFlagSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const FRAUD_FLAG_SEVERITY_STYLES: Record<FraudFlagSeverity, string> = {
  low: "bg-cream-100 text-ink-500",
  medium: "bg-gold-500/20 text-gold-700",
  high: "bg-red-100 text-red-600",
};

export const FRAUD_FLAG_STATUS_LABELS: Record<FraudFlagStatus, string> = {
  open: "Open",
  cleared: "Cleared",
};

export const FRAUD_FLAG_STATUS_STYLES: Record<FraudFlagStatus, string> = {
  open: "bg-red-100 text-red-600",
  cleared: "bg-green-100 text-green-800",
};

export const FRAUD_FLAG_TARGET_TYPE_LABELS: Record<FraudFlagTargetType, string> = {
  user: "Member",
  listing: "Listing",
  order: "Order",
};
