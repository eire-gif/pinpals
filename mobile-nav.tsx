"use client";

import { useState } from "react";
import Link from "next/link";

export default function MobileNav({
  isLoggedIn,
  navLinks,
}: {
  isLoggedIn: boolean;
  navLinks: { href: string; label: string }[];
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
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
            >
              {link.label}
            </Link>
          ))}
          <div className="h-px bg-white/10 my-2" />
          {isLoggedIn ? (
            <>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="px-4 py-4 rounded-xl text-lg font-semibold text-white/90 hover:bg-white/10"
              >
                Dashboard
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
