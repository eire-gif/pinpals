"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

export type NavChild = { href: string; label: string };

/**
 * A top-level nav item that also opens a menu — today only "Courses", which
 * has to offer five countries.
 *
 * The parent is a real link, not just a menu trigger. Someone who clicks
 * "Courses" expecting the directory gets the directory; the menu is a
 * shortcut past it, not a toll gate. That is also what makes this usable
 * without JavaScript and on a touch screen, where "hover to open" has no
 * meaning.
 *
 * Opens on hover and on focus for a pointer, and on an explicit click of the
 * chevron for touch. Escape closes it and returns focus to the trigger;
 * clicking anywhere outside closes it. The chevron is a separate button with
 * its own label so that a screen reader user is offered "open the Courses
 * menu" as something distinct from "go to Courses".
 */
export default function NavDropdown({
  href,
  label,
  items,
}: {
  href: string;
  label: string;
  /** Named `items`, not `children`: these are menu entries rendered inside
   * the dropdown, not React children of this component, and calling them
   * `children` would both mislead and trip react/no-children-prop at the
   * call site. */
  items: NavChild[];
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="flex items-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition">
        <Link href={href} className="pl-4 pr-1.5 py-2.5 text-sm font-semibold">
          {label}
        </Link>
        <button
          ref={toggleRef}
          type="button"
          aria-label={`${label} by country`}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          onFocus={() => setOpen(true)}
          className="pr-3 pl-0.5 py-2.5"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          id={menuId}
          className="absolute left-0 top-full pt-2 z-50 w-56"
        >
          <div className="bg-surface border border-line rounded-xl shadow-lg p-1.5">
            {items.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => setOpen(false)}
                className="block px-3.5 py-2.5 rounded-lg text-[14.5px] font-semibold text-ink-900 hover:bg-green-100 hover:text-green-800"
              >
                {child.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
