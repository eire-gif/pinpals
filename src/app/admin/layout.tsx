import { cookies } from "next/headers";
import type { ReactNode } from "react";
import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { navFor } from "@/lib/admin/nav";
import SignOutButton from "@/components/sign-out-button";
import AdminToaster from "@/components/admin/controls/toaster";
import AdminNav from "./admin-nav";

// Belt-and-braces alongside proxy.ts's Cache-Control header: every /admin
// page already renders dynamically in practice (requireStaff() reads
// cookies on every request), but that's implicit — nothing stops a future
// page from being written in a way that no longer triggers it. This makes
// the requirement explicit at the layout level so the whole /admin subtree
// fails safe (a build/type error pointing here) rather than silently
// starting to prerender private admin data if that ever changes.
export const dynamic = "force-dynamic";

// The sidebar's sections and their role filtering live in
// src/lib/admin/nav.ts (pure, tested). Grouped so twenty-odd pages read as
// eight areas rather than one long list.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // The layout's own guard. Every page under /admin also calls requireStaff()
  // itself (see src/lib/admin/authorization.ts for why) — this call keeps the
  // chrome (nav, identity, role badge) itself from ever rendering for a
  // non-staff request.
  const { user, staff } = await requireStaff();

  // Opened from the app's Admin screen (pp_shell — see src/proxy.ts). On a
  // phone the menu below stacks ABOVE every page, twenty links deep, and the
  // app already has the same list as its own screen; so in the app the menu
  // and the sign-out button go, and each page starts at its content. Signing
  // out from inside the app's web view would only end the web session the
  // app handed over, which is a confusing thing for a button to do.
  const inAppShell = (await cookies()).get("pp_shell")?.value === "1";

  const sections = navFor(staff.role);

  return (
    <div className="min-h-screen bg-cream-50">
      <header className="bg-navy-900 text-cream-50 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/admin" className="font-display font-bold text-lg text-white">
            Pinpals <span className="text-gold-500">Admin</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {!inAppShell && (
              <Link href="/" className="text-white/80 hover:text-white font-semibold">
                View site
              </Link>
            )}
            {!inAppShell && <span className="text-white/60 hidden lg:inline">{user.email}</span>}
            <span className="bg-gold-500 text-navy-900 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
              {ROLE_LABELS[staff.role]}
            </span>
            {!inAppShell && <SignOutButton />}
          </div>
        </div>
      </header>

      <div
        className={
          inAppShell
            ? "max-w-7xl mx-auto px-4 py-5"
            : "max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8 grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8"
        }
      >
        {!inAppShell && <AdminNav sections={sections} />}
        <main className="min-w-0">{children}</main>
      </div>
      <AdminToaster />
    </div>
  );
}
