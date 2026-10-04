import { supabase } from "./supabase";

/**
 * The admin section, in the app, for super admins.
 *
 * WHAT THIS IS NOT: a security boundary. Hiding the row from everyone else is
 * tidiness. Every admin page on the website runs requireStaff() on the server,
 * page by page and action by action, and that is what keeps a member out —
 * the same check whether the page is opened in a browser or in the app's web
 * view.
 *
 * Each section opens the website's own admin page inside the app, signed in.
 * That gives a super admin every admin function the site has, today, with one
 * implementation to keep correct — rather than a second, native copy of twenty
 * screens that would drift. The site drops its own admin menu when it is
 * opened from the app (the pp_shell cookie), because this screen is the menu.
 */

/** is_staff() is SECURITY DEFINER and executable by signed-in members (0007). */
export async function isSuperAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_staff", { required_roles: ["super_admin"] });
  return !error && data === true;
}

export type AdminSection = { path: string; label: string; icon: string; hint?: string };

/**
 * Mirrors NAV_ITEMS in src/app/admin/layout.tsx on the website, grouped the
 * way someone looks for them on a phone. "Settings" is left out: it is a
 * "Soon" placeholder there.
 */
export const ADMIN_GROUPS: { title: string; sections: AdminSection[] }[] = [
  {
    title: "Overview",
    sections: [{ path: "/admin", label: "Overview", icon: "speedometer-outline", hint: "What needs attention" }],
  },
  {
    title: "People",
    sections: [
      { path: "/admin/users", label: "Users", icon: "people-outline" },
      { path: "/admin/support", label: "Support cases", icon: "help-buoy-outline" },
      { path: "/admin/staff", label: "Staff", icon: "shield-checkmark-outline" },
    ],
  },
  {
    title: "Safety and moderation",
    sections: [
      { path: "/admin/reports", label: "Reports", icon: "flag-outline" },
      { path: "/admin/feed", label: "Social", icon: "images-outline" },
      { path: "/admin/reviews", label: "Seller reviews", icon: "chatbox-ellipses-outline" },
      { path: "/admin/course-reviews", label: "Course reviews", icon: "star-outline" },
      { path: "/admin/risk-flags", label: "Risk flags", icon: "warning-outline" },
    ],
  },
  {
    title: "Marketplace and money",
    sections: [
      { path: "/admin/marketplace", label: "Marketplace", icon: "storefront-outline" },
      { path: "/admin/listings", label: "Listings", icon: "pricetags-outline" },
      { path: "/admin/orders", label: "Orders", icon: "receipt-outline" },
      { path: "/admin/payouts", label: "Seller accounts", icon: "card-outline" },
      { path: "/admin/payouts/ledger", label: "Payout ledger", icon: "cash-outline" },
      { path: "/admin/webhook-events", label: "Webhook events", icon: "git-network-outline" },
    ],
  },
  {
    title: "Golf",
    sections: [
      { path: "/admin/tee-times", label: "Tee times", icon: "golf-outline" },
      { path: "/admin/clubs", label: "Courses", icon: "map-outline" },
      { path: "/admin/news", label: "News review", icon: "newspaper-outline" },
      { path: "/admin/news/sources", label: "News sources", icon: "link-outline" },
    ],
  },
  {
    title: "Records",
    sections: [{ path: "/admin/audit-log", label: "Audit log", icon: "document-text-outline" }],
  },
];
