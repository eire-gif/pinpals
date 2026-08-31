import Link from "next/link";
import LogoMark from "@/components/logo-mark";

export default function SiteFooter() {
  return (
    <footer className="bg-navy-900 text-white/75 pt-14 pb-7">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 text-white mb-3">
              <LogoMark className="w-8 h-8" />
              <span className="font-display font-bold text-xl">
                Pin<span className="text-gold-500">pals</span>
              </span>
            </div>
            <p className="text-sm text-white/60 max-w-[34ch]">
              The community for Irish golfers to find playing partners and discover new clubs.
            </p>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wider text-white mb-3">Explore</h4>
            <div className="flex flex-col gap-1.5 text-sm">
              <Link href="/community" className="hover:text-white">Find golfers</Link>
              <Link href="/courses" className="hover:text-white">Course directory</Link>
              <Link href="/marketplace" className="hover:text-white">Marketplace</Link>
              <Link href="/signup" className="hover:text-white">Join Pinpals</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wider text-white mb-3">Play</h4>
            <div className="flex flex-col gap-1.5 text-sm">
              <Link href="/tee-times" className="hover:text-white">Tee-time invites</Link>
              <Link href="/dashboard" className="hover:text-white">My dashboard</Link>
            </div>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wider text-white mb-3">Pinpals.ie</h4>
            <div className="flex flex-col gap-1.5 text-sm">
              <a href="mailto:hello@pinpals.ie" className="hover:text-white">hello@pinpals.ie</a>
            </div>
          </div>
        </div>
        <div className="border-t border-white/15 mt-10 pt-5 flex flex-wrap justify-between gap-2 text-xs">
          <span>&copy; {new Date().getFullYear()} Pinpals.ie &mdash; find golfers, play more.</span>
          <span>Made for golfers, by golfers.</span>
        </div>
      </div>
    </footer>
  );
}
