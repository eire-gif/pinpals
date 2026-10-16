// The admin sidebar, grouped. Pure so the role filtering can be tested.
//
// `roles`, when set, hides the item from staff outside that set. This is a
// UX nicety only — every page calls requireStaff() with its own roles, which
// is the real boundary — so a staff member doesn't see a link that 404s.

import type { StaffRole } from "./roles";
import { FINANCE_ROLES } from "./finance";

export type NavItem = { href: string; label: string; roles?: readonly StaffRole[] };
export type NavSectionConfig = { title: string | null; items: NavItem[] };

export const NAV_SECTIONS: NavSectionConfig[] = [
  { title: null, items: [{ href: "/admin", label: "Overview" }] },
  {
    title: "Community",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/groups", label: "Groups & societies" },
      { href: "/admin/tee-times", label: "Tee times" },
      { href: "/admin/feed", label: "Social" },
      // Any active staff role may work a case (support-cases.ts).
      { href: "/admin/support", label: "Support cases" },
    ],
  },
  {
    title: "Marketplace",
    items: [
      // Every tab inside gates itself, so any staff member sees the link.
      { href: "/admin/marketplace", label: "Marketplace" },
      { href: "/admin/listings", label: "Listings" },
      { href: "/admin/orders", label: "Orders", roles: FINANCE_ROLES },
      { href: "/admin/reviews", label: "Reviews" },
    ],
  },
  {
    title: "Money",
    items: [
      // Seller Connect onboarding readiness (Phase 9) vs the money ledger
      // (Phase 12) — labelled apart so they aren't confused.
      { href: "/admin/payouts", label: "Seller accounts", roles: FINANCE_ROLES },
      { href: "/admin/payouts/ledger", label: "Payout ledger", roles: FINANCE_ROLES },
      { href: "/admin/webhook-events", label: "Webhook events", roles: FINANCE_ROLES },
    ],
  },
  {
    // Any staff member may look; writes re-check ADVERTISING_EDIT_ROLES.
    title: "Advertising",
    items: [{ href: "/admin/advertising", label: "Advertising" }],
  },
  {
    // Basic / Premium / Pro (0156). Any staff member may look; only a super
    // admin changes anything (re-checked in src/app/admin/monetisation/actions.ts).
    title: "Memberships",
    items: [{ href: "/admin/monetisation", label: "Monetisation" }],
  },
  {
    title: "Content",
    items: [
      { href: "/admin/clubs", label: "Courses" },
      { href: "/admin/course-reviews", label: "Course reviews" },
      { href: "/admin/news", label: "News review" },
      { href: "/admin/news/sources", label: "News sources" },
    ],
  },
  {
    title: "Safety",
    items: [
      { href: "/admin/reports", label: "Reports" },
      { href: "/admin/risk-flags", label: "Risk flags" },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/staff", label: "Staff", roles: ["super_admin"] },
      { href: "/admin/audit-log", label: "Audit log", roles: ["super_admin"] },
      // /admin/settings isn't built yet; it joins this list when it is.
    ],
  },
];

/** The sections this role sees, with empty sections dropped. */
export function navFor(role: StaffRole): NavSection[] {
  return NAV_SECTIONS.map((s) => ({
    title: s.title,
    items: s.items.filter((i) => !i.roles || i.roles.includes(role)).map(({ href, label }) => ({ href, label })),
  })).filter((s) => s.items.length > 0);
}

export type NavSection = { title: string | null; items: { href: string; label: string }[] };

/** The item a path belongs to: the longest matching href, so
 * /admin/payouts/ledger/4 lights up "Payout ledger", not "Seller accounts". */
export function activeHref(pathname: string, sections: readonly NavSection[]): string | null {
  let best: string | null = null;
  for (const s of sections) {
    for (const { href } of s.items) {
      const match = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
      if (match && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}
