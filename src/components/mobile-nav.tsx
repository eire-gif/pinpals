"use client";

import { useState } from "react";
import Link from "next/link";

export default function MobileNav({
  isLoggedIn,
  navLinks,
  unreadCount = 0,
}: {
  isLoggedIn: boolean;
  navLinks: { href: string; label: string; children?: { href: string; label: string }[] }[];
  unreadCount?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        aria-label="Toggle menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="p-2 text-white"
      >
        {open ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-0 top-[76px] bottom-0 bg-navy-900 p-4 flex flex-col gap-1 overflow-y-auto">
          {/* A nav item with children renders its parent link and then its
              children indented beneath it, rather than a nested disclosure.
              The sheet is already a vertical list with room to spare, and a
              second thing to tap open before you can reach Scotland is one
              tap more than the country list is worth. */}
          {navLinks.map((link) => (
            <div key={link.href}>
              <Link
                href={link.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                {link.label}
              </Link>
              {link.children && (
                <div className="ml-4 border-l border-white/15 pl-2 mb-1">
                  {link.children
                    .filter((child) => child.href !== link.href)
                    .map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setOpen(false)}
                        className="block px-4 py-3 rounded-xl text-base font-semibold text-white/70 hover:bg-white/10 hover:text-white"
                      >
                        {child.label}
                      </Link>
                    ))}
                </div>
              )}
            </div>
          ))}
          <div className="h-px bg-white/10 my-2" />
          {isLoggedIn ? (
            <>
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10 flex items-center justify-between"
              >
                Notifications
                {unreadCount > 0 && (
                  <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-gold-500 text-navy-900 text-xs font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                Dashboard
              </Link>
              <Link
                href="/conversations"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                Messages
              </Link>
              <Link
                href="/profile"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                My profile
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="mt-2 px-4 py-4 rounded-full text-lg font-bold text-center bg-green-700 text-cream-50"
              >
                Join Pinpals
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
