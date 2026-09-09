import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MobileNav from "@/components/mobile-nav";
import NavDropdown from "@/components/nav-dropdown";
import { COUNTRIES } from "@/lib/regions";
import LogoMark from "@/components/logo-mark";
import SignOutButton from "@/components/sign-out-button";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unread notification count for the bell — a cheap head-only count
  // (RLS's own "own rows" SELECT policy on `notifications` scopes this
  // without a service-role client), fetched on every page load the same
  // way the rest of this header re-derives `user` on every load rather than
  // caching client-side state.
  let unreadCount = 0;
  if (user) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    unreadCount = count ?? 0;
  }

  // One array, rendered twice: the desktop row below and MobileNav's own
  // sheet (passed as a prop at the bottom of this file), so a link can
  // never exist on one and not the other.
  //
  // "Tee Times" sits second, directly after Find Golfers: the two are the
  // same job from opposite ends — find someone to play with, or say when
  // you're free — and grouping them reads better than separating them with
  // Courses. Until now /tee-times was reachable only from the footer, which
  // is why almost nobody posts availability.
  //
  // Two items carry a menu.
  //
  // "Tee Times" is two jobs sharing one page: browsing what other members
  // have posted, and posting your own. The second lives at
  // /dashboard/availability/new — four levels from the top bar and reachable
  // only by first landing on /tee-times and finding the button — which is
  // part of why so little availability gets posted. The menu names both
  // halves outright. "Post your availability" appears only when signed in:
  // the page it goes to redirects to /login otherwise, and a menu entry that
  // bounces you to a sign-in form is worse than no entry at all.
  //
  // "Courses" has children for a different reason. The directory covers five
  // countries and ~3,000 clubs now, so landing someone on an undifferentiated
  // list is worse than letting them say which country they're looking in
  // before they arrive.
  //
  // In both cases the parent link still goes to its own page — the menu is a
  // shortcut, not a gate (see NavDropdown).
  const navLinks: {
    href: string;
    label: string;
    menuLabel?: string;
    children?: { href: string; label: string }[];
  }[] = [
    { href: "/community", label: "Find Golfers" },
    {
      href: "/tee-times",
      label: "Tee Times",
      menuLabel: "Tee time options",
      // undefined, not an array of one, when signed out: the only remaining
      // entry would be "Find a game this week", which is where the parent
      // link already goes. A chevron that opens a menu repeating the thing
      // you just clicked is worse than no chevron, so a signed-out visitor
      // gets a plain "Tee Times" link.
      children: user
        ? [
            { href: "/tee-times", label: "Find a game this week" },
            { href: "/dashboard/availability/new", label: "Post your availability" },
          ]
        : undefined,
    },
    {
      href: "/courses",
      label: "Courses",
      menuLabel: "Courses by country",
      children: [
        { href: "/courses", label: "All courses" },
        ...COUNTRIES.map((country) => ({
          href: `/courses/${country.code}`,
          label: country.name,
        })),
      ],
    },
    { href: "/marketplace", label: "Marketplace" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-navy-900 border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-[76px] flex items-center justify-between gap-5">
        <Link href="/" className="flex items-center gap-2.5 text-cream-50">
          <LogoMark className="w-10 h-10" />
          <span className="font-display font-bold text-2xl text-white">
            Pin<span className="text-gold-500">pals</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) =>
            link.children ? (
              <NavDropdown
                key={link.href}
                href={link.href}
                label={link.label}
                menuLabel={link.menuLabel}
                items={link.children}
              />
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                {link.label}
              </Link>
            )
          )}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/notifications"
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
                className="relative p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                <BellIcon />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-gold-500 text-navy-900 text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/dashboard"
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                Dashboard
              </Link>
              <Link
                href="/conversations"
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                Messages
              </Link>
              <Link
                href="/profile"
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                My profile
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white transition"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="px-5 py-2.5 rounded-full text-sm font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition shadow-sm"
              >
                Join Pinpals
              </Link>
            </>
          )}
        </div>

        <MobileNav isLoggedIn={!!user} navLinks={navLinks} unreadCount={unreadCount} />
      </div>
    </header>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 9a6 6 0 1112 0c0 4.5 1.5 6 2 6.5H4c.5-.5 2-2 2-6.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 004 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
