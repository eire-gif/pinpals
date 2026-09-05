import type { ReactNode } from "react";
import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS, type StaffRole } from "@/lib/admin/roles";
import { FINANCE_ROLES } from "@/lib/admin/finance";
import SignOutButton from "@/components/sign-out-button";

// Placeholders for later phases — deliberately not linked to real pages yet.
// Keeping the full nav visible (disabled) from day one so the shape of the
// console is clear before each section is built. Users/Listings/Tee-times
// shipped in Phase 2 (read-only); the audit log framework (still no
// mutations to log yet) shipped ahead of the rest of Phase 3.
//
// `roles`, when set, hides the item from staff outside that set — this is a
// UX nicety only (not the security boundary; requireStaff()'s own `roles`
// check on the page itself is), so a moderator/support/finance/admin staff
// member doesn't see a live-looking link that 404s for them.
const NAV_ITEMS: { href: string; label: string; enabled?: boolean; roles?: readonly StaffRole[] }[] = [
  { href: "/admin", label: "Overview", enabled: true },
  { href: "/admin/users", label: "Users", enabled: true },
  { href: "/admin/listings", label: "Listings", enabled: true },
  { href: "/admin/tee-times", label: "Tee-times", enabled: true },
  { href: "/admin/orders", label: "Orders", enabled: true, roles: FINANCE_ROLES },
  // Two distinct sections sharing the "payouts" word: this one (Phase 9) is
  // seller Connect ONBOARDING readiness; ledger (Phase 12, 0024_payouts.sql)
  // is the actual money ledger, tracing order -> payment -> fee -> transfer
  // -> payout. Labeled apart here so staff don't confuse the two.
  { href: "/admin/payouts", label: "Seller accounts", enabled: true, roles: FINANCE_ROLES },
  { href: "/admin/payouts/ledger", label: "Payout ledger", enabled: true, roles: FINANCE_ROLES },
  { href: "/admin/webhook-events", label: "Webhook events", enabled: true, roles: FINANCE_ROLES },
  { href: "/admin/clubs", label: "Clubs" },
  { href: "/admin/reports", label: "Reports", enabled: true },
  // No `roles` restriction — any active staff role may work a case (see
  // src/lib/admin/support-cases.ts's file-header comment).
  { href: "/admin/support", label: "Support cases", enabled: true },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit-log", label: "Audit log", enabled: true, roles: ["super_admin"] },
  { href: "/admin/staff", label: "Staff", enabled: true, roles: ["super_admin"] },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The layout's own guard. Every page under /admin also calls requireStaff()
  // itself (see src/lib/admin/authorization.ts for why) — this call keeps the
  // chrome (nav, identity, role badge) itself from ever rendering for a
  // non-staff request.
  const { user, staff } = await requireStaff();

  return (
    <div className="min-h-screen bg-cream-50">
      <header className="bg-navy-900 text-cream-50 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <Link href="/admin" className="font-display font-bold text-lg text-white">
            Pinpals <span className="text-gold-500">Admin</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-white/70 hidden sm:inline">{user.email}</span>
            <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
              {ROLE_LABELS[staff.role]}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 grid md:grid-cols-[220px_1fr] gap-8">
        <nav className="space-y-1">
          {NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(staff.role)).map((item) =>
            item.enabled ? (
              <Link
                key={item.href}
                href={item.href}
                className="block px-3 py-2 rounded-lg text-sm font-semibold text-ink-900 hover:bg-cream-100 transition"
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.href}
                aria-disabled="true"
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-ink-500 cursor-not-allowed"
              >
                {item.label}
                <span className="text-[10px] font-bold uppercase tracking-wide text-ink-500/70">
                  Soon
                </span>
              </span>
            )
          )}
        </nav>

        <main>{children}</main>
      </div>
    </div>
  );
}
