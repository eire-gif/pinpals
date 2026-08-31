import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MobileNav from "@/components/mobile-nav";
import LogoMark from "@/components/logo-mark";
import SignOutButton from "@/components/sign-out-button";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const navLinks = [
    { href: "/community", label: "Find Golfers" },
    { href: "/courses", label: "Courses" },
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
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="px-4 py-2.5 rounded-full text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                Dashboard
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

        <MobileNav isLoggedIn={!!user} navLinks={navLinks} />
      </div>
    </header>
  );
}
