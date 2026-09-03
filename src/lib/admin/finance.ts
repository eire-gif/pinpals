// Roles allowed onto the /admin/orders finance surface. Mirrors
// src/lib/admin/moderation.ts's MODERATION_ROLES exactly — same reasoning,
// different slice: per admin-architecture-review.md §6, "finance — view/
// manage orders, offers, payouts, refunds, commission reporting; no user
// moderation", and support/moderator have no documented reason to see
// financial transaction data. Exported so the page, its queries, and the nav
// gate in src/app/admin/layout.tsx all use the exact same list rather than
// three copies that could drift.
export const FINANCE_ROLES = ["finance", "admin", "super_admin"] as const;
