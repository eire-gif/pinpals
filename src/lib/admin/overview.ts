// Pure, framework-free config for the /admin overview page — no Supabase, no
// Next.js. Mirrors moderation.ts's split: the actual data fetching
// (getOverviewMetrics()) lives in queries.ts alongside every other admin
// read; this file only holds the role gate and the static description of
// what this phase deliberately does NOT have real data for.

import type { StaffRole } from "./roles";

// Metrics that touch money/payouts are finance-only, same as the role model
// in admin-architecture-review.md §6 ("finance — view/manage orders, offers,
// payouts, refunds, commission reporting"). `admin`/`super_admin` get "all of
// the above" per that same doc, so they're included alongside `finance`
// rather than this being finance-exclusive.
export const FINANCE_ROLES = ["finance", "admin", "super_admin"] as const;

/**
 * Whether `staff` should see finance-flavored metrics at all — including the
 * "data unavailable" placeholders for subsystems that don't exist yet, since
 * even knowing a payments queue is empty/unbuilt is finance-shaped
 * information. Wraps canAccess() so this one rule lives in exactly one place.
 */
export function canSeeFinanceMetrics(staff: { role: StaffRole; status: string } | null): boolean {
  if (!staff || staff.status !== "active") return false;
  return (FINANCE_ROLES as readonly string[]).includes(staff.role);
}

export type UnavailableMetric = {
  key: string;
  label: string;
  /** Why there's no number here — shown in place of a value, never a fabricated 0 or "—". */
  reason: string;
  financeOnly: boolean;
};

// Every subsystem the task's example metric list names that this codebase
// has no table for yet (confirmed live against Supabase, not assumed — see
// admin-architecture-review.md §3–4: no orders/payments table, no Stripe
// integration, no reports/support-case table of any kind). Listed here
// explicitly, one row each, so the overview page shows an honest "not built"
// state instead of quietly omitting them or inventing a number.
export const UNAVAILABLE_METRICS: UnavailableMetric[] = [
  {
    key: "open_reports",
    label: "Open reports",
    reason: "No reporting/flagging mechanism exists yet — nothing for members to report with.",
    financeOnly: false,
  },
  {
    key: "orders_needing_attention",
    label: "Orders needing attention",
    reason: "No orders table exists yet — the marketplace is offer-negotiation only, with no payment step.",
    financeOnly: true,
  },
  {
    key: "payment_webhook_failures",
    label: "Payment / webhook failures",
    reason: "No Stripe integration exists yet — nothing sends or receives payment webhooks.",
    financeOnly: true,
  },
  {
    key: "incomplete_seller_onboarding",
    label: "Sellers with incomplete onboarding",
    reason: "No seller payout onboarding (Stripe Connect) exists yet — sellers have nothing to complete.",
    financeOnly: true,
  },
];
